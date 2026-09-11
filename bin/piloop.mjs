#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { resolveDataDir } from "./data-dir.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(`PiLoop — Coding Agent\n\n用法：piloop [项目目录]\n      piloop update\n\n在任意目录运行 piloop 即可进入终端。\n/api 配置 Key，/login 登录，/model 选择模型。\n/ 查看命令菜单，/quit 退出。\n\n选项：\n  --help, -h     帮助\n  --version, -v  版本`);
} else if (args.includes("--version") || args.includes("-v")) {
  console.log(JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version);
} else if (args.length === 1 && args[0] === "update") {
  if (existsSync(path.join(root, ".env"))) process.loadEnvFile(path.join(root, ".env"));
  // Preserve legacy local data even when updating before the first normal launch.
  resolveDataDir(root, process.env.PILOOP_DATA_DIR);
  const { installUpdate } = await import("../lib/server/updates.js");
  process.exitCode = await installUpdate();
} else {
  if (args.length > 1 || args[0]?.startsWith("-")) {
    console.error("用法：piloop [项目目录]。输入 piloop --help 查看帮助。");
    process.exitCode = 1;
  } else {
    const start = path.resolve(args[0] || process.cwd());
    process.env.PILOOP_CALLER_DIR = process.cwd();
    process.env.PILOOP_WORK_DIR = start;
    // Resolve shipped assets/config independently of the caller's working directory.
    if (existsSync(path.join(root, ".env"))) process.loadEnvFile(path.join(root, ".env"));
    process.env.PILOOP_DATA_DIR = resolveDataDir(root, process.env.PILOOP_DATA_DIR);
    process.chdir(root);
    try { await import("../lib/server/cli.js"); }
    catch (error) {
      console.error(`PiLoop 启动失败：${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  }
}
