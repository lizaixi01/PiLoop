import fs from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser } from "playwright";
import type { Evidence } from "../shared/types.js";
import { uid, now } from "./store.js";

export type BrowserStep = {
  action:
    | "click"
    | "fill"
    | "press"
    | "expectVisible"
    | "expectHidden"
    | "expectText";
  selector: string;
  value?: string;
};
export async function openBrowser(): Promise<Browser> {
  try {
    return await chromium.launch({ headless: true });
  } catch {
    try {
      return await chromium.launch({ headless: true, channel: "msedge" });
    } catch {
      throw new Error(
        "无法启动浏览器。请运行 npx playwright install chromium，或安装 Microsoft Edge。",
      );
    }
  }
}
export async function inspect(
  url: string,
  output: string,
  steps: BrowserStep[] = [],
  width = 1280,
  height = 900,
): Promise<Evidence> {
  const browser = await openBrowser();
  try {
    const context = await browser.newContext({
      viewport: { width, height },
      reducedMotion: "no-preference",
    });
    // Project code can only load files from its own preview origin.
    const origin = new URL(url).origin;
    await context.route("**/*", (route) => {
      const target = new URL(route.request().url());
      return target.origin === origin ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message.slice(0, 700)));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text().slice(0, 700));
    });
    const response = await page.goto(url, {
      waitUntil: "networkidle",
      timeout: 20000,
    });
    const checks = [{ label: "HTML 入口正常响应", passed: !!response?.ok() }];
    const actions: string[] = [];
    for (const step of steps) {
      const description = `${step.action}: ${step.selector}`;
      actions.push(description);
      try {
        const locator = page.locator(step.selector);
        if (step.action === "click") await locator.click();
        if (step.action === "fill") await locator.fill(step.value || "");
        if (step.action === "press")
          await locator.press(step.value || "Escape");
        if (step.action === "expectVisible")
          await locator.waitFor({ state: "visible" });
        if (step.action === "expectHidden")
          await locator.waitFor({ state: "hidden" });
        if (
          step.action === "expectText" &&
          !(await locator.innerText()).includes(step.value || "")
        )
          throw new Error("文字不匹配");
        checks.push({ label: description, passed: true });
      } catch (error) {
        checks.push({
          label: `${description} — ${(error as Error).message.slice(0, 180)}`,
          passed: false,
        });
        break;
      }
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    const id = uid();
    await fs.mkdir(output, { recursive: true });
    await page.screenshot({
      path: path.join(output, `${id}.png`),
      fullPage: true,
    });
    const title = await page.title();
    checks.push(
      { label: "没有横向溢出", passed: !overflow },
      { label: "页面 JavaScript 错误检查", passed: !errors.length },
    );
    return {
      id,
      url,
      screenshot: `/api/evidence/${id}.png`,
      width,
      height,
      title,
      overflow,
      consoleErrors: [...errors],
      actions,
      checks,
      createdAt: now(),
    };
  } finally {
    await browser.close();
  }
}
