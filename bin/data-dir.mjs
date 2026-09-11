import path from "node:path";
import os from "node:os";
import { existsSync, mkdirSync, cpSync } from "node:fs";

export function resolveDataDir(root, override, home = os.homedir()) {
  if (override) return path.resolve(override);
  const target = path.join(home, ".piloop");
  const legacy = path.join(root, ".piloop", "agent");
  const agent = path.join(target, "agent");
  if (legacy !== agent && existsSync(legacy) && !existsSync(agent)) {
    mkdirSync(agent, { recursive: true });
    // Keep existing user configuration; never remove the original copy.
    cpSync(legacy, agent, { recursive: true, force: false });
  }
  return target;
}
