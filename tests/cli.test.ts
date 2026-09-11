import test from "node:test";
import assert from "node:assert/strict";
import { CliSession, terminalText, type Api } from "../server/cli-session.js";
import type { Project, Task } from "../shared/types.js";

const project: Project = {
  id: "project",
  name: "Blog",
  source: "local",
  entry: "index.html",
  activeRevision: "base",
  createdAt: "",
  feedback: [],
};
test("CLI submits natural language, reports completion, and preserves correction scope", async () => {
  const output: string[] = [];
  const calls: { route: string; body?: unknown }[] = [];
  let task: Task | undefined;
  const api: Api = async <T>(route: string, body?: unknown): Promise<T> => {
    calls.push({ route, body });
    let result: unknown;
    if (route === "/api/state")
      result = {
        projects: [project],
        tasks: task
          ? [
              {
                ...task,
                status: "ready",
                events: [{ at: "", kind: "tool", text: "检查页面" }],
                result: "已修改",
              },
            ]
          : [],
        previewOrigin: "http://localhost:4511",
      };
    else if (route === "/api/models")
      result = { models: [{ id: "test", provider: "fixture", name: "Test" }] };
    else if (route === "/api/tasks")
      result = task = {
        id: "task",
        projectId: project.id,
        prompt: "",
        provider: "fixture",
        modelId: "test",
        status: "running",
        baseRevision: "base",
        revision: "candidate",
        createdAt: "",
        recalled: [],
        events: [],
        evidence: [],
        changes: [
          { path: "index.html", kind: "modified", before: "a", after: "b" },
        ],
        result: "",
      };
    else result = {};
    return result as T;
  };
  const cli = new CliSession(
    api,
    (text) => output.push(text),
    async () => {},
  );
  await cli.init();
  await cli.execute("修复菜单交互");
  assert.deepEqual(calls.find((c) => c.route === "/api/tasks")?.body, {
    projectId: "project",
    prompt: "修复菜单交互",
    provider: "fixture",
    modelId: "test",
  });
  assert.ok(output.some((line) => line.includes("检查页面")));
  assert.ok(output.some((line) => line.includes("候选未充分验证")));
  assert.equal(cli.runningId, undefined);
  await cli.execute("/remember index.html | 点击外部应关闭");
  assert.deepEqual(calls.at(-1)?.body, {
    scope: "index.html",
    text: "点击外部应关闭",
    sourceTaskId: "task",
  });
  await cli.execute("/preview");
  assert.equal(
    output.at(-1),
    "http://localhost:4511/p/project/candidate/index.html",
  );
  await cli.execute("/preview current");
  assert.equal(
    output.at(-1),
    "http://localhost:4511/p/project/base/index.html",
  );
  assert.equal(await cli.execute("/exit"), false);
});

test("CLI without credentials rejects generation but permits local checks", async () => {
  const calls: string[] = [];
  const api: Api = async <T>(route: string): Promise<T> => {
    calls.push(route);
    return (
      route === "/api/models"
        ? { models: [] }
        : route.endsWith("/check")
          ? {
              id: "check",
              status: "ready",
              events: [],
              evidence: [],
              changes: [],
              recalled: [],
              result: "仅检查",
            }
          : { projects: [project], tasks: [] }
    ) as T;
  };
  const cli = new CliSession(api, () => {});
  await cli.init();
  await assert.rejects(cli.execute("修改页面"), /配置模型凭据/);
  assert.ok(!calls.includes("/api/tasks"));
  await cli.execute("/check");
  assert.ok(calls.includes("/api/projects/project/check"));
  await assert.rejects(cli.execute("/remember 没有范围"), /用法/);
});

test("terminal output removes model supplied control characters", () => {
  assert.equal(terminalText("正文\x1b[2J\x07\n下一行"), "正文[2J\n下一行");
});

test("example opens its current HTML preview without a configured model", async () => {
  const opened: string[] = [];
  const api: Api = async <T>(route: string): Promise<T> =>
    (route === "/api/example" ? project : { projects: [project], tasks: [], previewOrigin: "http://127.0.0.1:4511" }) as T;
  const cli = new CliSession(api, () => {}, undefined, async (url) => { opened.push(url); });
  await cli.execute("/example");
  assert.deepEqual(opened, ["http://127.0.0.1:4511/p/project/base/index.html"]);
});
