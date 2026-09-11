import path from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { runNativeTui } from "./tui.js";
const agentDir = path.resolve(
  process.env.PILOOP_DATA_DIR || ".piloop",
  "agent",
);
const runtime = await ModelRuntime.create({
  authPath: process.env.PILOOP_AUTH_FILE || path.join(agentDir, "auth.json"),
  modelsPath:
    process.env.PILOOP_MODELS_FILE || path.join(agentDir, "models.json"),
  allowModelNetwork: false,
});
await runNativeTui(
  runtime,
  agentDir,
  process.env.PILOOP_WORK_DIR || process.env.PILOOP_CALLER_DIR || process.cwd(),
);
