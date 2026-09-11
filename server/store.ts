import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import type { State, Feedback, Change, Project } from "../shared/types.js";

export const uid = () => randomUUID();
export const now = () => new Date().toISOString();
export const ROOT = path.resolve(process.env.PILOOP_DATA_DIR || ".piloop");
const OMIT = new Set([
  "node_modules",
  ".git",
  ".piloop",
  ".npm-cache",
  ".codex",
  ".agents",
]);
const ALLOWED = new Set([
  ".html",
  ".htm",
  ".css",
  ".js",
  ".mjs",
  ".json",
  ".svg",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".ico",
  ".woff",
  ".woff2",
  ".txt",
  ".md",
]);
const MAX_BYTES = 30 * 1024 * 1024;

export function within(root: string, input: string) {
  const absolute = path.resolve(root, input);
  const relative = path.relative(root, absolute);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    throw new Error("路径必须位于项目副本中");
  return absolute;
}
export function scopePath(value: string) {
  const normalized = value.trim().replaceAll("\\", "/").replace(/^\.\//, "");
  if (normalized === "*") return normalized;
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized.includes(":") ||
    normalized.split("/").some((x) => x === ".." || x === "." || !x)
  )
    throw new Error("范围应是项目内的文件或目录，例如 index.html、styles 或 *");
  return normalized;
}
export function recall(
  feedback: Feedback[],
  target: string,
  budget = 5000,
): Feedback[] {
  const entry = scopePath(target);
  let size = 0;
  return [...feedback].reverse().filter((f) => {
    const applies =
      f.active &&
      (f.scope === "*" || entry === f.scope || entry.startsWith(f.scope + "/"));
    if (!applies || size + f.text.length > budget) return false;
    size += f.text.length;
    return true;
  });
}
export async function files(root: string): Promise<string[]> {
  const result: string[] = [];
  async function walk(dir: string) {
    for (const item of await fs.readdir(dir, { withFileTypes: true })) {
      if (
        OMIT.has(item.name) ||
        item.name.startsWith(".env") ||
        item.name.startsWith(".")
      )
        continue;
      if (item.isSymbolicLink()) throw new Error("项目副本不接受符号链接");
      const full = path.join(dir, item.name);
      if (item.isDirectory()) await walk(full);
      else if (ALLOWED.has(path.extname(item.name).toLowerCase()))
        result.push(path.relative(root, full).replaceAll("\\", "/"));
      if (result.length > 600)
        throw new Error("V0 最多接入 600 个静态项目文件");
    }
  }
  await walk(root);
  return result.sort();
}
export async function copyProject(source: string, target: string) {
  const list = await files(source);
  let bytes = 0;
  // Validate the complete input before copying any file.
  for (const relative of list) {
    bytes += (await fs.stat(within(source, relative))).size;
    if (bytes > MAX_BYTES) throw new Error("V0 静态项目文件总量不能超过 30 MB");
  }
  for (const relative of list) {
    const dest = within(target, relative);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(within(source, relative), dest);
  }
}
const textual = /\.(html?|css|m?js|json|svg|txt|md)$/i;
export async function diff(before: string, after: string): Promise<Change[]> {
  const a = await files(before);
  const b = await files(after);
  const changes: Change[] = [];
  for (const name of new Set([...a, ...b])) {
    const old = a.includes(name)
      ? await fs.readFile(within(before, name))
      : null;
    const next = b.includes(name)
      ? await fs.readFile(within(after, name))
      : null;
    if (
      old &&
      next &&
      createHash("sha256").update(old).digest("hex") ===
        createHash("sha256").update(next).digest("hex")
    )
      continue;
    const text = (buffer: Buffer | null) =>
      !buffer
        ? ""
        : textual.test(name)
          ? buffer.toString("utf8").slice(0, 24000)
          : "[二进制文件]";
    changes.push({
      path: name,
      kind: old ? (next ? "modified" : "deleted") : "added",
      before: text(old),
      after: text(next),
    });
  }
  return changes;
}

export class Store {
  state: State = { projects: [], tasks: [] };
  private writes: Promise<unknown> = Promise.resolve();
  constructor(public root = ROOT) {}
  revision(projectId: string, revision: string) {
    return within(this.root, `projects/${projectId}/${revision}`);
  }
  async init() {
    await fs.mkdir(this.root, { recursive: true });
    try {
      this.state = JSON.parse(
        await fs.readFile(path.join(this.root, "state.json"), "utf8"),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    for (const task of this.state.tasks)
      if (task.status === "running") {
        task.status = "interrupted";
        task.error = "服务重启中断了任务；候选副本保留，请新建任务重试。";
        task.endedAt = now();
      }
    await this.save();
  }
  save() {
    const serialized = JSON.stringify(this.state, null, 2);
    const write = this.writes
      .catch(() => {})
      .then(async () => {
        const temp = path.join(this.root, "state.json.tmp");
        await fs.writeFile(temp, serialized, "utf8");
        await fs.rename(temp, path.join(this.root, "state.json"));
      });
    this.writes = write;
    return write;
  }
  project(id: string) {
    const p = this.state.projects.find((p) => p.id === id);
    if (!p) throw new Error("项目不存在");
    return p;
  }
  task(id: string) {
    const t = this.state.tasks.find((t) => t.id === id);
    if (!t) throw new Error("任务不存在");
    return t;
  }
  async import(source: string, name: string, entry: string) {
    const absolute = await fs.realpath(path.resolve(source));
    if (!(await fs.stat(absolute)).isDirectory())
      throw new Error("请选择静态项目目录");
    const normalized = scopePath(entry);
    if (!/\.html?$/i.test(normalized)) throw new Error("入口必须是 HTML 文件");
    const file = await fs.lstat(within(absolute, normalized));
    if (!file.isFile() || file.isSymbolicLink())
      throw new Error("HTML 入口不存在或是链接");
    const p: Project = {
      id: uid(),
      name,
      source: absolute,
      entry: normalized,
      activeRevision: uid(),
      createdAt: now(),
      feedback: [],
    };
    await copyProject(absolute, this.revision(p.id, p.activeRevision));
    this.state.projects.push(p);
    await this.save();
    return p;
  }
  adopt(id: string) {
    const t = this.task(id);
    const p = this.project(t.projectId);
    if (t.status !== "ready") throw new Error("只有已结束的候选版本可以采用");
    if (p.activeRevision !== t.baseRevision)
      throw new Error(
        "当前版本已变化，请基于最新版本重新执行，避免覆盖其他修改",
      );
    p.activeRevision = t.revision;
    t.status = "adopted";
  }
}
