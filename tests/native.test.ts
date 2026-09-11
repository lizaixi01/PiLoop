import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { nativeRuntimeFactory } from "../server/tui.js";
import { assessPreference, combinedMemory } from "../server/native-memory.js";

test(
  "native Pi greets without harness work and writes in the actual cwd when asked",
  { timeout: 30000 },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "piloop-native-"));
    const cwd = path.join(root, "project"),
      agentDir = path.join(root, "agent");
    await fs.mkdir(cwd);
    await fs.mkdir(agentDir);
    let calls = 0;
    let receivedContext = "";
    const server = http.createServer(async (req, res) => {
      let body = "";
      for await (const chunk of req) body += chunk;
      receivedContext = body;
      const step = calls++;
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      const emit = (delta: unknown, finish: string | null = null) =>
        res.write(
          `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
        );
      emit(
        step === 1 || step === 3
          ? {
              role: "assistant",
              tool_calls: [
                {
                  index: 0,
                  id: "write1",
                  type: "function",
                  function: {
                    name: step === 1 ? "write" : "remember_preference",
                    arguments: JSON.stringify(
                      step === 1
                        ? {
                            path: "note.txt",
                            content: "done",
                          }
                        : {
                            scope: "*",
                            quote: "以后默认用中文回答",
                            level: "user",
                          },
                    ),
                  },
                },
              ],
            }
          : { role: "assistant", content: step === 0 ? "你好！" : "已完成" },
      );
      emit({}, step === 1 || step === 3 ? "tool_calls" : "stop");
      res.end("data: [DONE]\n\n");
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    let session:
      | Awaited<ReturnType<ReturnType<typeof nativeRuntimeFactory>>>["session"]
      | undefined;
    try {
      const runtime = await ModelRuntime.create({
        authPath: path.join(agentDir, "auth.json"),
        modelsPath: null,
        modelsStorePath: path.join(agentDir, "models.json"),
        refreshOnCreate: false,
      });
      runtime.registerProvider("fixture", {
        baseUrl: `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}/v1`,
        apiKey: "local-test",
        api: "openai-completions",
        models: [
          {
            id: "fixture",
            name: "fixture",
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 32000,
            maxTokens: 1000,
          },
        ],
      });
      ({ session } = await nativeRuntimeFactory(
        runtime,
        agentDir,
      )({
        cwd,
        agentDir,
        sessionManager: SessionManager.create(
          cwd,
          path.join(agentDir, "sessions"),
        ),
      }));
      await session.setModel(runtime.getModel("fixture", "fixture")!);
      assert.ok(
        ["read", "write", "edit", "bash"].every((name) =>
          session!.getActiveToolNames().includes(name),
        ),
      );
      assert.equal(session.sessionManager.getCwd(), cwd);
      await session.prompt("你好");
      assert.ok(receivedContext.includes("this session runs in PiLoop"));
      assert.ok(receivedContext.includes("not implemented in the default CLI"));
      assert.equal(calls, 1);
      assert.deepEqual(await fs.readdir(cwd), []);
      await session.prompt("创建 note.txt，内容为 done");
      assert.equal(
        await fs.readFile(path.join(cwd, "note.txt"), "utf8"),
        "done",
      );
      await session.prompt("以后默认用中文回答");
      const userFile = path.join(agentDir, "preferences.json");
      assert.match(await fs.readFile(userFile, "utf8"), /以后默认用中文回答/);
      await fs.mkdir(path.join(cwd, ".pi"));
      await fs.writeFile(
        path.join(cwd, ".pi", "piloop-memory.json"),
        JSON.stringify([
          {
            id: "local",
            scope: "admin",
            text: "后台使用紧凑布局",
            active: true,
          },
        ]),
      );
      const other = path.join(root, "other");
      await fs.mkdir(other);
      assert.equal((await combinedMemory(cwd, userFile)).length, 2);
      assert.deepEqual(
        (await combinedMemory(other, userFile)).map((r) => r.text),
        ["以后默认用中文回答"],
      );
      session.dispose();
      ({ session } = await nativeRuntimeFactory(
        runtime,
        agentDir,
      )({
        cwd: other,
        agentDir,
        sessionManager: SessionManager.create(
          other,
          path.join(agentDir, "sessions"),
        ),
      }));
      await session.setModel(runtime.getModel("fixture", "fixture")!);
      await session.prompt("你好");
      assert.ok(receivedContext.includes("以后默认用中文回答"));
      assert.ok(!receivedContext.includes("后台使用紧凑布局"));
    } finally {
      session?.dispose();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (
        path.dirname(root) !== os.tmpdir() ||
        !path.basename(root).startsWith("piloop-native-")
      )
        throw new Error("unsafe cleanup");
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);

test("preference guards reject questions, guesses and one-off tasks; sensitive rules require confirmation", () => {
  for (const value of ["hello", "你能记住吗？", "这次回答短一点"])
    assert.equal(assessPreference(value, value), "reject");
  assert.equal(assessPreference("回答简洁", "以后限制150字"), "reject");
  assert.equal(assessPreference("以后回答简洁", "以后回答简洁"), "save");
  assert.equal(
    assessPreference("以后自动上传数据", "以后自动上传数据"),
    "confirm",
  );
});
