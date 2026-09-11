import { readFileSync } from "node:fs";

type SDK = typeof import("@earendil-works/pi-coding-agent");
const entry = import.meta.resolve("@earendil-works/pi-coding-agent");
const required = ["ModelRuntime", "createAgentSessionFromServices", "createAgentSessionRuntime",
  "createAgentSessionServices", "InteractiveMode", "runPrintMode", "SessionManager"] as const;

async function loadSDK(): Promise<SDK> {
  // Pi 0.85.1 ships a bundled SDK, but does not export its path publicly.
  // Keep this optimization version-bound, with the supported public entry as fallback.
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", entry), "utf8"));
    if (pkg.version === "0.85.1" && process.env.PILOOP_UNBUNDLED_SDK !== "1") {
      const bundled = await import(new URL("./bundle/index.js", entry).href) as SDK;
      if (required.every(name => typeof bundled[name] === "function")) return bundled;
    }
  } catch {
    // Missing/incompatible optional bundle must not prevent normal startup.
  }
  return import("@earendil-works/pi-coding-agent");
}

export const {
  ModelRuntime, createAgentSessionFromServices, createAgentSessionRuntime,
  createAgentSessionServices, InteractiveMode, runPrintMode, SessionManager,
} = await loadSDK();
export type { CreateAgentSessionRuntimeFactory, ExtensionFactory, ModelRuntime as ModelRuntimeType } from "@earendil-works/pi-coding-agent";
