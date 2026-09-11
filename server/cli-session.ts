import path from "node:path";
import type { Project, State, Task } from "../shared/types.js";

export type Api = <T>(route: string, body?: unknown) => Promise<T>;
type Model = { id: string; provider: string; name: string };
export const help = `直接输入修改要求，Agent 会读取、修改并检查候选。
/open 目录 | HTML入口     接入项目副本（入口默认 index.html）
/example                  打开示例
/projects · /use 序号      列出 / 切换项目
/model [序号]             查看 / 选择模型
/remember 范围 | 纠正内容 保存持续约束，范围为文件、目录或 *
/memory · /forget 序号     查看约束 / 停用约束
/check                    检查当前采用版本
/status · /diff            查看最近任务 / 文件变化
/accept · /undo            采用候选 / 撤回当前采用
/preview [current]         显示候选 / 当前版本预览链接
/help · /exit              帮助 / 退出
运行时 Ctrl+C 停止任务；空闲时 Ctrl+C 退出。`;

// Project content and model output must not inject terminal control sequences.
export function terminalText(value: string) {
  return value.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "");
}
export class CliSession {
  projectId = "";
  model?: Model;
  runningId?: string;
  constructor(
    private api: Api,
    private print: (text: string) => void,
    private sleep = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms)),
    private openUrl: (url: string) => Promise<void> = async () => {},
  ) {}
  async init() {
    const state = await this.api<State>("/api/state");
    this.projectId = state.projects.at(-1)?.id || "";
    const { models } = await this.api<{ models: Model[] }>("/api/models");
    this.model = models[0];
    this.print(
      `PiLoop · Coding Agent\n${this.projectId ? `项目：${state.projects.at(-1)!.name}` : "输入 /open 目录 或 /example 开始"}\n${this.model ? `模型：${this.model.provider}/${this.model.id}` : "尚未配置模型。可先用 /example 和 /check 体验浏览器检查。"}\n输入 /help 查看命令。`,
    );
  }
  private async context() {
    const state = await this.api<State & { previewOrigin: string }>(
      "/api/state",
    );
    const project = state.projects.find((p) => p.id === this.projectId);
    if (!project) throw new Error("请先 /open 目录 或 /example");
    return {
      state,
      project,
      task: state.tasks.filter((t) => t.projectId === project.id).at(-1),
    };
  }
  async cancel() {
    if (this.runningId)
      await this.api(`/api/tasks/${this.runningId}/cancel`, {});
  }
  private async watch(task: Task) {
    this.runningId = task.id;
    let seen = 0;
    try {
      for (;;) {
        for (const event of task.events.slice(seen)) {
          if (event.kind !== "message") this.print(`  ${event.text}`);
        }
        seen = task.events.length;
        if (task.status !== "running") break;
        await this.sleep(500);
        const state = await this.api<State>("/api/state");
        const updated = state.tasks.find((t) => t.id === task.id);
        if (!updated) throw new Error("任务记录不存在");
        task = updated;
      }
      this.summary(task);
    } finally {
      this.runningId = undefined;
    }
  }
  private summary(task: Task) {
    const lines: string[] = [];
    lines.push(
      `\n${task.result || task.status}${task.error ? `\n错误：${task.error}` : ""}`,
    );
    lines.push(
      `状态：${task.status} · 修改 ${task.changes.length} 个文件 · 带入 ${task.recalled.length} 条约束`,
    );
    for (const evidence of task.evidence) {
      const current = (evidence.writeVersion || 0) === (task.writeVersion || 0);
      lines.push(
        `  ${evidence.width}px ${current ? "最终版本" : "较早版本"}：${evidence.checks.map((c) => `${c.passed ? "通过" : "失败"} ${c.label}`).join("；")}`,
      );
    }
    if (task.status === "ready" && task.changes.length)
      lines.push(
        "候选未充分验证。/diff 查看变化，/preview 查看页面，/accept 采用。",
      );
    this.print(lines.join("\n"));
  }
  async execute(line: string): Promise<boolean> {
    line = line.trim();
    if (!line) return true;
    const split = line.indexOf(" ");
    const command = split < 0 ? line : line.slice(0, split);
    const arg = split < 0 ? "" : line.slice(split + 1).trim();
    if (command === "/exit") return false;
    if (command === "/help") {
      this.print(help);
      return true;
    }
    if (command === "/open" || command === "/example") {
      const [source, entry = "index.html"] = arg
        .split("|")
        .map((x) => x.trim().replace(/^"(.*)"$/, "$1"));
      if (command === "/open" && !source)
        throw new Error("用法：/open 本地目录 | index.html");
      const project = await this.api<Project>(
        command === "/example" ? "/api/example" : "/api/projects",
        command === "/example"
          ? {}
          : {
              source: path.resolve(
                process.env.PILOOP_CALLER_DIR || process.cwd(),
                source,
              ),
              entry,
              name: path.basename(source),
            },
      );
      this.projectId = project.id;
      this.print(`项目：${project.name}（在 PiLoop 副本中工作）`);
      if (command === "/example") await this.execute("/preview current");
      return true;
    }
    if (command === "/model") {
      const { models } = await this.api<{ models: Model[] }>("/api/models");
      if (arg) {
        const model = models[Number(arg) - 1];
        if (!model) throw new Error("模型序号无效");
        this.model = model;
      }
      this.print(
        models
          .map(
            (m, i) =>
              `${i + 1}. ${m.provider}/${m.id}${m.id === this.model?.id && m.provider === this.model?.provider ? " ←" : ""}`,
          )
          .join("\n") || "没有可用模型，请配置 .env 后重启。",
      );
      return true;
    }
    if (command === "/projects" || command === "/use") {
      const { projects } = await this.api<State>("/api/state");
      if (command === "/use") {
        const project = projects[Number(arg) - 1];
        if (!project) throw new Error("项目序号无效");
        this.projectId = project.id;
      }
      this.print(
        projects
          .map(
            (p, i) =>
              `${i + 1}. ${p.name}${p.id === this.projectId ? " ←" : ""}`,
          )
          .join("\n") || "尚无项目",
      );
      return true;
    }
    const { state, project, task } = await this.context();
    if (command === "/remember") {
      const divider = arg.indexOf("|");
      if (divider < 1 || !arg.slice(divider + 1).trim())
        throw new Error("用法：/remember index.html | 菜单点击外部应关闭");
      await this.api(`/api/projects/${project.id}/feedback`, {
        scope: arg.slice(0, divider).trim(),
        text: arg.slice(divider + 1).trim(),
        sourceTaskId: task?.id,
      });
      this.print(
        "已保存，下次相关修改会带入。/memory 查看，/forget 序号 停用。",
      );
    } else if (command === "/memory" || command === "/forget") {
      if (command === "/forget") {
        const feedback = project.feedback[Number(arg) - 1];
        if (!feedback) throw new Error("约束序号无效");
        if (feedback.active)
          await this.api(
            `/api/projects/${project.id}/feedback/${feedback.id}/toggle`,
            {},
          );
        this.print("约束已停用。");
      } else
        this.print(
          project.feedback
            .map(
              (f, i) =>
                `${i + 1}. [${f.active ? "启用" : "停用"}] ${f.scope} · ${f.text}`,
            )
            .join("\n") || "尚无持续约束。",
        );
    } else if (command === "/preview") {
      const revision =
        arg === "current"
          ? project.activeRevision
          : task?.revision || project.activeRevision;
      const url = `${state.previewOrigin}/p/${project.id}/${revision}/${project.entry.split("/").map(encodeURIComponent).join("/")}`;
      this.print(url);
      await this.openUrl(url);
    } else if (command === "/check") {
      this.print("正在检查当前版本…");
      await this.watch(
        await this.api<Task>(`/api/projects/${project.id}/check`, {}),
      );
    } else if (["/accept", "/undo", "/diff", "/status"].includes(command)) {
      const target =
        command === "/undo"
          ? state.tasks.find(
              (t) =>
                t.projectId === project.id &&
                t.status === "adopted" &&
                t.revision === project.activeRevision,
            )
          : task;
      if (!target) throw new Error("没有可操作的任务");
      if (command === "/accept" || command === "/undo") {
        await this.api(
          `/api/tasks/${target.id}/${command === "/accept" ? "adopt" : "restore"}`,
          {},
        );
        this.print(
          command === "/accept"
            ? "已采用候选，后续任务从此版本继续。原目录未改变。"
            : "已撤回当前采用版本。",
        );
      } else if (command === "/status") this.summary(target);
      else
        this.print(
          target.changes
            .map(
              (c) =>
                `\n${c.kind} ${c.path}\n--- 修改前\n${c.before}\n+++ 修改后\n${c.after}`,
            )
            .join("\n") || "没有文件变化。",
        );
    } else if (line.startsWith("/"))
      throw new Error("未知命令，输入 /help 查看。");
    else {
      if (!this.model)
        throw new Error("请先配置模型凭据并重启，再用 /model 选择模型。");
      this.print("开始处理…");
      await this.watch(
        await this.api<Task>("/api/tasks", {
          projectId: project.id,
          prompt: line,
          provider: this.model.provider,
          modelId: this.model.id,
        }),
      );
    }
    return true;
  }
}
