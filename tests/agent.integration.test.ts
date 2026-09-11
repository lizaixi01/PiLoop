import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import express from "express";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { Runner } from "../server/agent.js";
import { Store, now } from "../server/store.js";

// A deterministic local SSE provider tests the real Pi SDK/tool boundary.
// This is NOT an LLM quality evaluation and does not call a paid provider.
test(
  "real Pi SDK executes read/edit tools; next session receives persisted scoped feedback",
  { timeout: 90000 },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "piloop-sdk-"));
    const prompts: string[] = [];
    let calls = 0;
    const provider = http.createServer(async (req, res) => {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      prompts.push(raw);
      const step = calls++ % 3;
      const run = Math.floor((calls - 1) / 3);
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      });
      const chunk = (delta: unknown, finish: string | null = null) =>
        res.write(
          `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture-model", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
        );
      if (step === 0)
        chunk({
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: `read-${run}`,
              type: "function",
              function: {
                name: "project_read",
                arguments: JSON.stringify({ path: "index.html" }),
              },
            },
          ],
        });
      else if (step === 1)
        chunk({
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: `edit-${run}`,
              type: "function",
              function: {
                name: "project_edit",
                arguments: JSON.stringify({
                  path: "index.html",
                  oldText: run ? "first change" : "original",
                  newText: run ? "second change" : "first change",
                }),
              },
            },
          ],
        });
      else
        chunk({
          role: "assistant",
          content: "本地协议测试已修改候选；实际模型质量未评估。",
        });
      chunk({}, step === 2 ? "stop" : "tool_calls");
      res.end("data: [DONE]\n\n");
    });
    const previewApp = express();
    previewApp.use("/p", express.static(path.join(root, "data", "projects")));
    const preview = http.createServer(previewApp);
    const listen = (s: http.Server) =>
      new Promise<number>((resolve) =>
        s.listen(0, "127.0.0.1", () =>
          resolve((s.address() as { port: number }).port),
        ),
      );
    try {
      const providerPort = await listen(provider),
        previewPort = await listen(preview);
      const source = path.join(root, "source");
      await fs.mkdir(source);
      await fs.writeFile(
        path.join(source, "index.html"),
        "<html><head><title>Fixture</title></head><body><h1>original</h1></body></html>",
      );
      const store = new Store(path.join(root, "data"));
      await store.init();
      const p = await store.import(source, "fixture", "index.html");
      const runtime = await ModelRuntime.create({
        authPath: path.join(root, "auth.json"),
        modelsPath: null,
        modelsStorePath: path.join(root, "models.json"),
        refreshOnCreate: false,
      });
      runtime.registerProvider("piloop-fixture", {
        baseUrl: `http://127.0.0.1:${providerPort}/v1`,
        apiKey: "fixture-local-only",
        api: "openai-completions",
        models: [
          {
            id: "fixture-model",
            name: "Local protocol fixture",
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 32000,
            maxTokens: 1000,
          },
        ],
      });
      const runner = new Runner(
        store,
        runtime,
        `http://127.0.0.1:${previewPort}`,
      );
      const wait = async (id: string) => {
        const deadline = Date.now() + 30000;
        while (store.task(id).status === "running" && Date.now() < deadline)
          await new Promise((resolve) => setTimeout(resolve, 50));
        assert.equal(store.task(id).status, "ready", store.task(id).error);
      };
      const first = await runner.start(
        p.id,
        "Change the heading.",
        "piloop-fixture",
        "fixture-model",
      );
      await wait(first.id);
      assert.equal(first.changes.length, 1);
      assert.match(first.changes[0].after, /first change/);
      assert.equal(
        await fs.readFile(path.join(source, "index.html"), "utf8"),
        "<html><head><title>Fixture</title></head><body><h1>original</h1></body></html>",
      );
      assert.equal(first.evidence.length, 2, first.error);
      assert.ok(first.evidence.every((e) => e.checks.every((c) => c.passed)));
      store.adopt(first.id);
      p.feedback.push({
        id: "feedback",
        scope: "index.html",
        text: "Keep the heading as h1; do not change the title.",
        active: true,
        createdAt: now(),
      });
      await store.save();
      const second = await runner.start(
        p.id,
        "Change the heading again.",
        "piloop-fixture",
        "fixture-model",
      );
      await wait(second.id);
      assert.equal(second.recalled.length, 1);
      assert.match(prompts[3], /Keep the heading as h1/);
      assert.match(second.changes[0].after, /second change/);
      assert.ok(prompts.some((x) => x.includes("applicableFeedback")));
      assert.equal(
        first.recalled.length,
        0,
        "earlier task keeps its original recall snapshot",
      );
      assert.equal(second.evidence.length, 2);
      p.feedback[0].active = false;
      assert.equal(
        second.recalled[0].active,
        true,
        "later feedback changes cannot rewrite a historical recall snapshot",
      );
    } finally {
      provider.closeAllConnections();
      preview.closeAllConnections();
      await Promise.all([
        new Promise<void>((resolve) => provider.close(() => resolve())),
        new Promise<void>((resolve) => preview.close(() => resolve())),
      ]);
      const tempBase = path.resolve(os.tmpdir()) + path.sep;
      assert.ok(path.resolve(root).startsWith(tempBase));
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);
