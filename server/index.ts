import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { createServer, type Server } from "node:http";
import { z } from "zod";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { Store, ROOT, uid, now, scopePath, within } from "./store.js";
import { Runner } from "./agent.js";
import { inspect } from "./browser.js";
import type { Task } from "../shared/types.js";

const PORT = Number(process.env.PORT || 4510);
const PREVIEW_PORT = Number(process.env.PILOOP_PREVIEW_PORT || 4511);
const origin = `http://127.0.0.1:${PORT}`;
const previewOrigin = `http://127.0.0.1:${PREVIEW_PORT}`;
// Claim ports before loading state: a second entry point must not mark live tasks interrupted.
const listen = (port: number) =>
  new Promise<Server>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
const previewServer = await listen(PREVIEW_PORT);
const apiServer = await listen(PORT).catch((error) => {
  previewServer.close();
  throw error;
});
const store = new Store();
await store.init();
export const runtime = await ModelRuntime.create({
  authPath:
    process.env.PILOOP_AUTH_FILE || path.join(ROOT, "agent", "auth.json"),
  modelsPath:
    process.env.PILOOP_MODELS_FILE || path.join(ROOT, "agent", "models.json"),
  allowModelNetwork: false,
});
const runner = new Runner(store, runtime, previewOrigin);
const app = express();
app.disable("x-powered-by");
app.use((req, res, next) => {
  if (
    req.headers.host !== `127.0.0.1:${PORT}` &&
    req.headers.host !== `localhost:${PORT}`
  )
    return res.status(403).json({ error: "仅接受本机访问" });
  if (req.path.startsWith("/api")) {
    res.setHeader("Cache-Control", "no-store");
    if (
      req.headers.origin &&
      ![origin, `http://localhost:${PORT}`].includes(req.headers.origin)
    )
      return res.status(403).json({ error: "跨来源请求被拒绝" });
    if (req.headers["sec-fetch-site"] === "cross-site")
      return res.status(403).json({ error: "跨站请求被拒绝" });
    if (!["GET", "HEAD"].includes(req.method) && !req.is("application/json"))
      return res.status(415).json({ error: "需要 JSON 请求" });
  }
  next();
});
app.use(express.json({ limit: "200kb" }));
app.get("/favicon.ico", (_req, res) => res.sendStatus(204));
app.get("/api/state", (_req, res) =>
  res.json({ ...store.state, previewOrigin }),
);
app.get("/api/models", async (_req, res) => {
  const available = await runtime.getAvailable();
  res.json({
    models: available.map((m) => ({
      id: m.id,
      provider: m.provider,
      name: m.name,
    })),
    error: runtime.getError() || null,
  });
});
app.get("/api/evidence/:file", (req, res) => {
  if (!/^[a-f0-9-]+\.png$/.test(req.params.file)) return res.sendStatus(404);
  res.sendFile(req.params.file, {
    root: path.join(ROOT, "evidence"),
    dotfiles: "allow",
  });
});
app.post("/api/projects", async (req, res) => {
  if (store.state.tasks.some((t) => t.status === "running"))
    throw new Error("请等待当前任务结束后接入项目");
  const input = z
    .object({
      source: z.string().min(1).max(500),
      name: z.string().min(1).max(80),
      entry: z.string().min(1).max(300),
    })
    .parse(req.body);
  res.json(await store.import(input.source, input.name, input.entry));
});
app.post("/api/example", async (_req, res) => {
  const source = path.resolve("examples/studio");
  const existing = store.state.projects.find((p) => p.source === source);
  res.json(
    existing ||
      (await store.import(source, "Fieldnotes · 示例博客", "index.html")),
  );
});
app.post("/api/tasks", async (req, res) => {
  const input = z
    .object({
      projectId: z.string().uuid(),
      prompt: z.string().trim().min(1).max(12000),
      provider: z.string().min(1),
      modelId: z.string().min(1),
    })
    .parse(req.body);
  res
    .status(202)
    .json(
      await runner.start(
        input.projectId,
        input.prompt,
        input.provider,
        input.modelId,
      ),
    );
});
app.post("/api/tasks/:id/cancel", async (req, res) => {
  await runner.cancel(req.params.id);
  res.json({ ok: true });
});
app.post("/api/tasks/:id/adopt", async (req, res) => {
  if (store.state.tasks.some((t) => t.status === "running"))
    throw new Error("请等待当前任务结束");
  if (!store.task(req.params.id).changes.length)
    throw new Error("没有文件变化，不需要采用");
  store.adopt(req.params.id);
  await store.save();
  res.json({ ok: true });
});
app.post("/api/tasks/:id/restore", async (req, res) => {
  if (store.state.tasks.some((t) => t.status === "running"))
    throw new Error("请等待当前任务结束");
  const task = store.task(req.params.id);
  const p = store.project(task.projectId);
  if (task.status !== "adopted" || p.activeRevision !== task.revision)
    throw new Error("只能撤回当前采用的版本");
  p.activeRevision = task.baseRevision;
  task.status = "ready";
  await store.save();
  res.json({ ok: true });
});
app.post("/api/projects/:id/feedback", async (req, res) => {
  if (
    store.state.tasks.some(
      (t) => t.projectId === req.params.id && t.status === "running",
    )
  )
    throw new Error("请等待任务结束后保存反馈，确保一次任务使用一致的标准");
  const input = z
    .object({
      text: z.string().trim().min(1).max(1600),
      scope: z.string().min(1).max(300),
      sourceTaskId: z.string().uuid().optional(),
      supersedes: z.string().uuid().optional(),
    })
    .parse(req.body);
  const p = store.project(req.params.id);
  const scope = scopePath(input.scope);
  if (input.sourceTaskId && store.task(input.sourceTaskId).projectId !== p.id)
    throw new Error("反馈来源任务不属于此项目");
  if (input.supersedes) {
    const old = p.feedback.find((f) => f.id === input.supersedes);
    if (!old) throw new Error("旧反馈不存在");
    old.active = false;
  }
  const feedback = {
    ...input,
    scope,
    id: uid(),
    createdAt: now(),
    active: true,
  };
  p.feedback.push(feedback);
  await store.save();
  res.json(feedback);
});
app.post("/api/projects/:id/feedback/:feedbackId/toggle", async (req, res) => {
  if (
    store.state.tasks.some(
      (t) => t.projectId === req.params.id && t.status === "running",
    )
  )
    throw new Error("请等待任务结束后修改标准");
  const p = store.project(req.params.id);
  const f = p.feedback.find((f) => f.id === req.params.feedbackId);
  if (!f) throw new Error("反馈不存在");
  // An explicitly superseded record cannot silently override its successor.
  if (
    !f.active &&
    p.feedback.some((next) => next.supersedes === f.id && next.active)
  )
    throw new Error("此标准已被新版本替代，请修订当前标准");
  f.active = !f.active;
  await store.save();
  res.json(f);
});
app.post("/api/projects/:id/check", async (req, res) => {
  if (store.state.tasks.some((t) => t.status === "running"))
    throw new Error("请等待当前任务结束");
  const p = store.project(req.params.id);
  const task: Task = {
    id: uid(),
    projectId: p.id,
    prompt: "仅检查当前页面（未调用模型）",
    provider: "local",
    modelId: "playwright",
    status: "running",
    baseRevision: p.activeRevision,
    revision: p.activeRevision,
    createdAt: now(),
    recalled: [],
    events: [],
    evidence: [],
    changes: [],
    result: "",
  };
  store.state.tasks.push(task);
  await store.save();
  res.status(202).json(task);
  void (async () => {
    try {
      for (const width of [1280, 390]) {
        task.evidence.push(
          await inspect(
            runner.url(p.id, task.revision, p.entry),
            path.join(ROOT, "evidence"),
            [],
            width,
            900,
          ),
        );
        if (task.status !== "running") return;
      }
      task.status = "ready";
      task.result =
        "桌面与窄屏入口检查已完成。检查了加载、横向溢出和 JavaScript 错误；未自动证明审美、动效或业务交互正确。";
    } catch (error) {
      if (task.status === "running") {
        task.status = "failed";
        task.error = (error as Error).message;
      }
    } finally {
      task.endedAt = now();
      await store.save();
    }
  })();
});
app.use("/api", (_req, res) => res.status(404).json({ error: "接口不存在" }));

const preview = express();
preview.disable("x-powered-by");
preview.use((req, res, next) => {
  if (
    ![`127.0.0.1:${PREVIEW_PORT}`, `localhost:${PREVIEW_PORT}`].includes(
      req.headers.host || "",
    )
  )
    return res.sendStatus(403);
  res.setHeader(
    "Content-Security-Policy",
    `default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'none'; worker-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors ${origin} http://localhost:${PORT}; sandbox allow-scripts`,
  );
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  next();
});
preview.use("/p/:projectId/:revision", (req, res, next) => {
  const p = store.state.projects.find((p) => p.id === req.params.projectId);
  if (!p || !/^[a-f0-9-]{36}$/.test(req.params.revision))
    return res.sendStatus(404);
  if (
    req.params.revision !== p.activeRevision &&
    !store.state.tasks.some(
      (t) =>
        t.projectId === p.id &&
        (t.revision === req.params.revision ||
          t.baseRevision === req.params.revision),
    )
  )
    return res.sendStatus(404);
  express.static(store.revision(p.id, req.params.revision), {
    dotfiles: "deny",
    index: p.entry,
  })(req, res, next);
});
preview.use((_req, res) => res.sendStatus(404));

if (process.env.PILOOP_CLI === "1") {
  app.get("/", (_req, res) =>
    res.send("PiLoop CLI 正在运行。请在终端输入任务。"),
  );
} else if (
  !process.argv.includes("--dev") &&
  (await fs.access(path.resolve("dist/index.html")).then(
    () => true,
    () => false,
  ))
) {
  app.use(express.static("dist"));
  app.get("/", (_req, res) => res.sendFile(path.resolve("dist/index.html")));
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    res.status(400).json({
      error:
        error instanceof z.ZodError
          ? error.issues.map((i) => i.message).join("；")
          : error instanceof Error
            ? error.message
            : "请求失败",
    });
  },
);
previewServer.on("request", preview);
apiServer.on("request", app);
export async function shutdown() {
  for (const task of store.state.tasks.filter((t) => t.status === "running"))
    await runner.cancel(task.id);
  await store.save();
  await Promise.all(
    [apiServer, previewServer].map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeIdleConnections();
        }),
    ),
  );
}
if (process.env.PILOOP_CLI !== "1")
  console.log(
    `PiLoop: ${origin}\n预览服务: ${previewOrigin}\n数据: ${ROOT}\n可用模型: ${runtime.getAvailableSnapshot().length}`,
  );
