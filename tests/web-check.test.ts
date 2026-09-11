import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { checkWeb, type WebPlan } from "../server/web-check.js";

test("real browser catches runtime failure and wrong state, then verifies repaired final artifact in fresh viewports", { timeout: 60000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "piloop-web-regression-"));
  const file = path.join(root, "index.html");
  const plan: WebPlan = { url: pathToFileURL(file).href, steps: [
    { action: "click", selector: "#increment" },
    { action: "text", selector: "#count", expected: "1" },
  ] };
  const html = (script: string) => `<!doctype html><meta name="viewport" content="width=device-width"><button id="increment">加一</button><output id="count">0</output><script>document.querySelector('#increment').onclick=()=>{${script}}</script>`;
  try {
    // Syntactically valid, but the dynamically constructed ID fails at runtime.
    await fs.writeFile(file, html("document.getElementById('c'+'ounter').textContent='1'"));
    const broken = await checkWeb(plan, root);
    assert.equal(broken.status, "failed");
    assert.ok(broken.checks.every(c => c.errors.some(e => /null/.test(e))));
    await fs.writeFile(file, html("document.getElementById('count').textContent='2'"));
    const wrong = await checkWeb(plan, root);
    assert.equal(wrong.status, "failed");
    assert.ok(wrong.checks.every(c => c.errors.some(e => e.includes("断言失败"))));
    await fs.writeFile(file, html("document.getElementById('count').textContent='1'"));
    const fixed = await checkWeb(plan, root);
    assert.equal(fixed.status, "passed");
    assert.deepEqual(fixed.checks.map(c => c.width), [1280, 390]);
    assert.notEqual(fixed.fileHash, broken.fileHash);
    assert.notEqual(fixed.reportPath, broken.reportPath);
    for (const shot of fixed.screenshots) assert.ok((await fs.stat(shot)).size > 0);
    assert.equal(JSON.parse(await fs.readFile(fixed.reportPath, "utf8")).status, "passed");
    await assert.rejects(checkWeb({ ...plan, steps: [{ action: "click", selector: "#increment" }] }, root), /结果断言/);
    await assert.rejects(checkWeb({ ...plan, url: "https://example.com" }, root), /本地/);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(checkWeb(plan, root, controller.signal));
  } finally {
    if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith("piloop-web-regression-")) throw new Error("unsafe cleanup");
    await fs.rm(root, { recursive: true, force: true });
  }
});
