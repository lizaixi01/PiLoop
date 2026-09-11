// Small live-model pilot. Run manually; not part of npm test.
import fs from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { ModelRuntime, SessionManager, createAgentSessionServices, createAgentSessionFromServices } from "@earendil-works/pi-coding-agent";
import { PILOOP_CONTEXT } from "../lib/server/tui.js";

const root = process.cwd();
if (existsSync(path.join(root, ".env"))) process.loadEnvFile(path.join(root, ".env"));
const configDir = path.resolve(process.env.PILOOP_DATA_DIR || ".piloop", "agent");
const settings = JSON.parse(await fs.readFile(path.join(configDir, "settings.json"), "utf8"));
const runtime = await ModelRuntime.create({
  authPath: process.env.PILOOP_AUTH_FILE || path.join(configDir, "auth.json"),
  modelsPath: process.env.PILOOP_MODELS_FILE || path.join(configDir, "models.json"),
  allowModelNetwork: false,
});
const model = runtime.getModel(settings.defaultProvider, settings.defaultModel);
if (!model) throw new Error("Configured model unavailable; no automatic fallback in this experiment.");
const scopePilot = process.argv.includes("--scope");
const behavior = PILOOP_CONTEXT.split("\n").find(line => line.startsWith(scopePilot ? "Keep changes tied" : "For a task,"));
if (!behavior) throw new Error("Build the updated prompt first.");
const before = PILOOP_CONTEXT.replace(behavior + "\n", "");
const tools = ["read", "edit", "write", "ls", "find", "grep"];
const output = path.join(root, ".piloop-experiments", `proactive-${Date.now()}`);
await fs.mkdir(output, { recursive: true });
const fixture = '<!doctype html><html lang="zh"><meta charset="utf-8"><title>小林的博客</title><style>body{font:16px/1.5 sans-serif;margin:32px}article{max-width:1100px}nav{padding:12px}</style><nav>首页 · 文章 · 关于</nav><article><h1>我的学习笔记</h1><p>记录学习、编程和生活中的发现。这是一篇希望让读者舒适阅读的博客文章。</p></article></html>';
const tasks = scopePilot ? {
  ambiguous: ["帮我改善这个博客的阅读体验。"],
  styling: ["只改善这个博客的排版和手机阅读体验，保持正文内容和导航功能不变。"],
  requested_navigation: ["创建 about.html 关于页面，内容是：这是小林的学习博客。把首页导航里的关于改成指向它的链接，其他保持不变。"],
} : {
  greeting: ["你好"],
  clear: ["把 index.html 的文章正文最大宽度改成 720px，其他保持不变。"],
  ambiguous: ["帮我改善这个博客的阅读体验。"],
  continuation: ["先不要修改。针对这个博客，给我两个方向：A 只将正文最大宽度改为 720px；B 只将正文字号改为 18px。我选完你再执行。", "A"],
};
await fs.writeFile(path.join(output, "manifest.json"), JSON.stringify({
  experiment: scopePilot ? "scope" : "proactive", provider: model.provider, model: model.id, thinking: "low", tools,
  prompts: { before, after: PILOOP_CONTEXT }, tasks, fixture,
}, null, 2));
console.log(JSON.stringify({ output, provider: model.provider, model: model.id, thinking: "low", tools }));
for (let repeat = 0; repeat < 2; repeat++) {
  for (const [scenario, prompts] of Object.entries(tasks)) {
    for (const arm of repeat ? ["after", "before"] : ["before", "after"]) {
      const cwd = path.join(output, `${repeat}-${scenario}-${arm}`);
      const agentDir = path.join(cwd, "agent");
      await fs.mkdir(agentDir, { recursive: true });
      await fs.writeFile(path.join(cwd, "index.html"), fixture);
      const services = await createAgentSessionServices({ cwd, agentDir, modelRuntime: runtime,
        resourceLoaderOptions: { noExtensions: true, noSkills: true, noContextFiles: true,
          noPromptTemplates: true, appendSystemPrompt: [arm === "after" ? PILOOP_CONTEXT : before] } });
      const { session } = await createAgentSessionFromServices({ services,
        sessionManager: SessionManager.inMemory(cwd), model, thinkingLevel: "low",
        tools });
      const activeTools = session.getActiveToolNames().sort();
      if (JSON.stringify(activeTools) !== JSON.stringify([...tools].sort())) {
        session.dispose();
        throw new Error(`Unexpected tools: ${activeTools.join(", ")}`);
      }
      const events = [];
      let count = 0, timeout = false;
      session.subscribe(event => {
        if (event.type === "tool_execution_start") {
          events.push({ tool: event.toolName, args: event.args });
          if (++count > 12) void session.abort();
        }
      });
      const started = Date.now();
      const timer = setTimeout(() => { timeout = true; void session.abort(); }, 90000);
      let error;
      try { for (const prompt of prompts) await session.prompt(prompt); }
      catch (e) { error = String(e); }
      finally { clearTimeout(timer); }
      const result = { arm, repeat, scenario, provider: model.provider, model: model.id,
        thinking: "low", activeTools, elapsedMs: Date.now() - started, timeout, error, events,
        messages: session.messages, html: await fs.readFile(path.join(cwd, "index.html"), "utf8"),
        aboutHtml: await fs.readFile(path.join(cwd, "about.html"), "utf8").catch(e => {
          if (e.code === "ENOENT") return null;
          throw e;
        }) };
      await fs.writeFile(path.join(cwd, "result.json"), JSON.stringify(result, null, 2));
      session.dispose();
      console.log(JSON.stringify({ arm, repeat, scenario, tools: events.length, elapsedMs: result.elapsedMs, timeout, error }));
      if (error || result.messages.some(m => m.role === "assistant" && m.stopReason === "error")) {
        throw new Error(`Provider failure; inspect ${cwd}/result.json before retrying.`);
      }
    }
  }
}
