import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

test("installed entry resolves its version and help outside the source directory", () => {
  const launcher = path.resolve("bin/piloop.mjs");
  const run = (arg: string) => execFileSync(process.execPath, [launcher, arg], { cwd: tmpdir(), encoding: "utf8", timeout: 10000 });
  assert.equal(run("--version").trim(), "0.1.0");
  assert.match(run("--help"), /piloop \[项目目录\]/);
});
