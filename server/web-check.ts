import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Type } from "@sinclair/typebox";
import { z } from "zod";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

const planSchema = z.object({
  url: z.string().url(),
  steps: z.array(z.object({
    action: z.enum(["click", "fill", "press", "text", "value", "visible"]),
    selector: z.string().min(1),
    expected: z.string().optional(),
  })).min(1).max(40),
});
export type WebPlan = z.infer<typeof planSchema>;

export async function checkWeb(raw: WebPlan, cwd: string, signal?: AbortSignal) {
  const plan = planSchema.parse(raw);
  const url = new URL(plan.url);
  if (!(url.protocol === "file:" && !url.host) &&
      !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
    throw new Error("仅检查当前任务的本地文件或 localhost 页面。");
  if (!plan.steps.some(s => ["text", "value", "visible"].includes(s.action)))
    throw new Error("需要至少一个结果断言，点击或无报错不能代替功能正确。");
  for (const step of plan.steps) {
    if (["fill", "press", "text", "value"].includes(step.action) && step.expected === undefined)
      throw new Error(`${step.action} 需要 expected。`);
  }
  // Resolve optional tooling only when requested, never during CLI startup.
  let pw: typeof import("playwright") | undefined;
  for (const base of [path.join(cwd, "package.json"), path.join(os.homedir(), ".piloop", "browser", "package.json"), import.meta.url]) {
    for (const name of ["playwright", "playwright-core"]) {
      try { pw = createRequire(base)(name) as typeof import("playwright"); break; } catch {}
    }
    if (pw) break;
  }
  if (!pw) throw new Error("未运行验证：未找到 Playwright。可复用其他已有浏览器工具，或在项目中配置 Playwright；不要声称检查通过。");
  signal?.throwIfAborted();
  const dir = path.join(cwd, ".pi", "piloop-checks", randomUUID());
  await fs.mkdir(dir, { recursive: true });
  const fingerprint = async () => url.protocol === "file:"
    ? createHash("sha256").update(await fs.readFile(fileURLToPath(url))).digest("hex") : null;
  const before = await fingerprint();
  const report = { url: plan.url, startedAt: new Date().toISOString(), fileHash: before,
    status: "failed", checks: [] as { width: number; passed: number; errors: string[] }[],
    plan, limitation: "仅覆盖列出的操作和断言；截图需查看。HTTP 及文件的外部依赖未绑定版本，后续修改需重跑。" };
  const browser = await pw.chromium.launch({ headless: true, timeout: 15000 }).catch(async error => {
    if (process.platform !== "win32") throw error;
    return pw!.chromium.launch({ channel: "msedge", headless: true, timeout: 15000 });
  });
  let expired = false;
  const abort = () => { expired = true; void browser.close().catch(() => {}); };
  const timer = setTimeout(abort, 60000);
  signal?.addEventListener("abort", abort, { once: true });
  try {
    for (const width of [1280, 390]) {
      signal?.throwIfAborted();
      const context = await browser.newContext({ viewport: { width, height: 850 }, serviceWorkers: "block" });
      const page = await context.newPage();
      page.setDefaultTimeout(3000);
      const check = { width, passed: 0, errors: [] as string[] };
      report.checks.push(check);
      page.on("pageerror", e => check.errors.push(e.message));
      page.on("console", msg => { if (msg.type() === "error") check.errors.push(msg.text()); });
      try {
        const response = await page.goto(plan.url, { waitUntil: "load", timeout: 10000 });
        if (response && !response.ok()) throw new Error(`HTTP ${response.status()}`);
        for (const step of plan.steps) {
          const element = page.locator(step.selector);
          if (step.action === "click") await element.click();
          else if (step.action === "fill") await element.fill(step.expected!);
          else if (step.action === "press") await element.press(step.expected!);
          else {
            const deadline = Date.now() + 3000;
            let matches = false;
            do {
              matches = step.action === "visible" ? await element.isVisible()
                : step.action === "value" ? await element.inputValue() === step.expected
                : (await element.textContent())?.trim() === step.expected;
              if (!matches) await page.waitForTimeout(100);
            } while (!matches && Date.now() < deadline);
            if (!matches) throw new Error(`断言失败 ${JSON.stringify(step)}`);
          }
          check.passed++;
        }
        if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1))
          check.errors.push("页面横向溢出");
      } catch (e) { check.errors.push(String(e)); }
      await page.screenshot({ path: path.join(dir, `${width}.png`), fullPage: true }).catch(e => check.errors.push(String(e)));
      await context.close();
    }
    if (!expired && !signal?.aborted && report.checks.every(c => !c.errors.length) && await fingerprint() === before)
      report.status = "passed";
  } catch (e) {
    report.checks.push({ width: 0, passed: 0, errors: [String(e)] });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    await browser.close();
  }
  const reportPath = path.join(dir, "report.json");
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  return { ...report, reportPath, screenshots: report.checks.filter(c => c.width).map(c => path.join(dir, `${c.width}.png`)) };
}

export const webCheckExtension: ExtensionFactory = pi => {
  let attempts = 0;
  pi.on("input", async () => { attempts = 0; return { action: "continue" }; });
  pi.registerTool({
    name: "verify_web_page", label: "运行网页验收",
    description: "检查当前任务的最终本地页面。先从需求/可信来源确定预期，再提供 CSS 选择器和操作/断言；text 是精确文本匹配，value 是输入值，visible 是可见。两种视口分别运行，返回错误和截图。仅用于已授权的本地交互，不能触发支付、发布、删除真实数据等行为。每次用户输入最多调用三次；失败修复后重跑，不能篡改断言迎合错误实现。passed 仅表示本次列出的检查通过，必须查看截图并说明未覆盖内容。",
    parameters: Type.Object({ url: Type.String(), steps: Type.Array(Type.Object({
      action: Type.Union(["click", "fill", "press", "text", "value", "visible"].map(v => Type.Literal(v))),
      selector: Type.String(), expected: Type.Optional(Type.String()),
    })) }),
    async execute(_id, args, signal, _update, ctx) {
      try {
        if (++attempts > 3) throw new Error("本轮三次网页验收预算已用完。报告剩余失败与证据，不要声称完成或绕过预算继续重试。");
        const result = await checkWeb(args, ctx.cwd, signal);
        return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
      } catch (e) {
        return { content: [{ type: "text", text: `未完成验证：${String(e)}` }], details: { status: "unverified" } };
      }
    },
  });
};
