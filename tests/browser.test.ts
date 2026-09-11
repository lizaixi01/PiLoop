import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { inspect } from "../server/browser.js";

test(
  "browser evidence executes interaction assertions under preview sandbox without injecting false errors",
  { timeout: 30000 },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "piloop-browser-"));
    const server = http.createServer((_req, res) => {
      res.writeHead(200, {
        "Content-Type": "text/html",
        "Content-Security-Policy": "sandbox allow-scripts; worker-src 'none'",
      });
      res.end(
        `<html><head><title>Interaction fixture</title></head><body><button id="open">Open</button><div id="panel" hidden>Menu</div><script>document.querySelector('#open').onclick=()=>document.querySelector('#panel').hidden=false;document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelector('#panel').hidden=true;});</script></body></html>`,
      );
    });
    try {
      const port = await new Promise<number>((resolve) =>
        server.listen(0, "127.0.0.1", () =>
          resolve((server.address() as { port: number }).port),
        ),
      );
      const evidence = await inspect(`http://127.0.0.1:${port}`, root, [
        { action: "click", selector: "#open" },
        { action: "expectVisible", selector: "#panel" },
        { action: "press", selector: "body", value: "Escape" },
        { action: "expectHidden", selector: "#panel" },
      ]);
      assert.equal(evidence.actions.length, 4);
      assert.ok(
        evidence.checks.every((c) => c.passed),
        JSON.stringify(evidence),
      );
      assert.equal(evidence.consoleErrors.length, 0);
      await fs.access(path.join(root, `${evidence.id}.png`));
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      assert.ok(
        path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep),
      );
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);
test(
  "browser errors remain failures instead of being presented as a passing visual check",
  { timeout: 30000 },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "piloop-browser-"));
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        '<title>Broken fixture</title><script>throw new Error("intentional-fixture-error")</script>',
      );
    });
    try {
      const port = await new Promise<number>((resolve) =>
        server.listen(0, "127.0.0.1", () =>
          resolve((server.address() as { port: number }).port),
        ),
      );
      const evidence = await inspect(`http://127.0.0.1:${port}`, root);
      assert.ok(
        evidence.consoleErrors.some((e) =>
          e.includes("intentional-fixture-error"),
        ),
      );
      assert.equal(
        evidence.checks.find((c) => c.label === "页面 JavaScript 错误检查")
          ?.passed,
        false,
      );
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      assert.ok(
        path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep),
      );
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);
