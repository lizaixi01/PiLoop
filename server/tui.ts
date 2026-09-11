import path from "node:path";
import {
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  InteractiveMode,
  runPrintMode,
  SessionManager,
  type CreateAgentSessionRuntimeFactory,
  type ExtensionFactory,
  type ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import { Input, truncateToWidth } from "@earendil-works/pi-tui";
import { memoryExtension } from "./native-memory.js";
import { updateExtension } from "./updates.js";

export const PILOOP_CONTEXT = `Runtime identity: this session runs in PiLoop, a small Harness extension built on Pi, not a separate model or a replacement for Pi.
Pi provides the native TUI, model routing, sessions, context management, skills and read/edit/write/bash tools. Keep their normal behavior.
For a task, use existing context and proportionate read-only inspection to understand the relevant environment before asking the user for information you can discover yourself. When the direction is clear, carry out the authorized work and relevant checks without repeatedly confirming routine reversible steps. When materially different interpretations remain, ask one consequential question with a few concrete options, a recommendation and brief tradeoffs; accept free-form answers too. Do not manufacture choices or require a fixed number of options. After the user chooses, use the conversation to continue the selected work without asking them to restate it or confirm the same direction. Respect permission and privacy boundaries; this does not authorize unrelated changes or unrestricted exploration. Greetings and discussion alone do not trigger file inspection or modification.
Keep changes tied to the requested outcome: a readability or styling request does not by itself authorize new pages, routes, rewritten content or extra features. Preserve existing behavior while improving presentation. Never turn labels into links with guessed destinations. When navigation changes are requested, inspect the routing or files and use verified destinations, or create the requested destination as part of the task. Before reporting completion, review the actual changes for unintended scope expansion and check any links you added with the available tools; distinguish checks performed from unverified assumptions.
PiLoop currently adds /api (provider API-key setup) and optional project constraints: /remember saves user-authored text and scope in .pi/piloop-memory.json, /memory lists records, /forget disables a record. Enabled records are appended on subsequent turns within a character budget; scope is interpreted by the model, not enforced by a verifier. With no saved constraints, memory adds no records.
When asked how this Harness differs from Pi, distinguish these implemented additions from inherited Pi capabilities. Do not confuse the Harness comparison with model versus runtime. These additions are currently modest; do not claim a proven product advantage.
When the user clearly states a lasting preference or correction, proactively call remember_preference with an exact quote and the narrowest supported scope. Use level=user only for general communication preferences (language, reply length or explanation style), stored in agent preferences.json across projects. Use level=project for code, UI and project-specific rules. Never generalize a project rule into a user preference. Do not ask them to repeat it using /remember. Ordinary reversible preferences can be saved immediately; sensitive rules require confirmation through the tool. Never infer an arbitrary number or preference from a question. Keep one-off instructions temporary. The tool checks provenance and persistence cues; it is not an autonomous background extractor. Do not edit the memory JSON with general file tools to bypass these checks. If saved rules conflict and the user has not clearly resolved the conflict, ask a concise question rather than guessing. A successful save is required before claiming to remember across sessions.
Semantic retrieval, Dream, improved compaction, proactive background work and integrated browser verification are not implemented in the default CLI. The old web prototype is separate. Do not claim its tools are available here.
This description is context, not an instruction to start work. Respond normally to conversation and use tools only as the request warrants.`;

export function apiExtension(modelRuntime: ModelRuntime): ExtensionFactory {
  return (pi) => {
    pi.registerCommand("api", {
      description: "快速配置 API：选择供应商并填入 Key",
      handler: async (_args, ctx) => {
        if (!ctx.isIdle()) {
          ctx.ui.notify("请先等待当前任务结束或按 Esc 停止。", "warning");
          return;
        }
        const providers = modelRuntime
          .getProviders()
          .filter((provider) => provider.auth.apiKey)
          .slice()
          .sort((a, b) => a.name.localeCompare(b.name));
        const labels = providers.map(
          (provider) => `${provider.name} (${provider.id})`,
        );
        const selected = await ctx.ui.select("选择 API 供应商", labels);
        if (!selected) return;
        const provider = providers[labels.indexOf(selected)];
        try {
          await modelRuntime.login(provider.id, "api_key", {
            prompt: async (prompt) => {
              if (prompt.type === "select") {
                const choice = await ctx.ui.select(
                  prompt.message,
                  prompt.options.map((option) => option.label),
                );
                const id = prompt.options.find(
                  (option) => option.label === choice,
                )?.id;
                if (!id) throw new Error("配置已取消");
                return id;
              }
              const value = await ctx.ui.custom<string | undefined>(
                (tui, theme, _keys, done) => {
                  const input = new Input();
                  input.onSubmit = (text) => {
                    if (text.trim()) done(text.trim());
                  };
                  input.onEscape = () => done(undefined);
                  return {
                    invalidate() {},
                    handleInput(data: string) {
                      if (data === "\x03") done(undefined);
                      else input.handleInput(data);
                      tui.requestRender();
                    },
                    render(width: number) {
                      return [
                        theme.fg(
                          "accent",
                          `${provider.name} · ${prompt.message}`,
                        ),
                        `> ${"•".repeat(Math.min(input.getValue().length, Math.max(0, width - 4)))}▏`,
                        theme.fg(
                          "dim",
                          "输入或粘贴 Key · Enter 保存 · Esc 取消",
                        ),
                      ].map((line) => truncateToWidth(line, width));
                    },
                  };
                },
              );
              if (!value) throw new Error("配置已取消");
              return value;
            },
            notify: () => {},
          });
          ctx.ui.notify(
            `${provider.name} 的 Key 已保存。输入 /model 选择模型。`,
            "info",
          );
        } catch {
          ctx.ui.notify(
            "未完成 API 配置，未确认保存成功。可重新输入 /api。",
            "warning",
          );
        }
      },
    });
  };
}

export const nativeRuntimeFactory =
  (
    modelRuntime: ModelRuntime,
    agentDir: string,
  ): CreateAgentSessionRuntimeFactory =>
  async ({ cwd, sessionManager, sessionStartEvent }) => {
    const services = await createAgentSessionServices({
      cwd,
      agentDir,
      modelRuntime,
      resourceLoaderOptions: {
        appendSystemPrompt: [PILOOP_CONTEXT],
        extensionFactories: [
          { name: "PiLoop updates", factory: updateExtension(agentDir), hidden: true },
          {
            name: "PiLoop API",
            factory: apiExtension(modelRuntime),
            hidden: true,
          },
          {
            name: "PiLoop memory",
            factory: memoryExtension(agentDir),
            hidden: true,
          },
        ],
      },
    });
    return {
      ...(await createAgentSessionFromServices({
        services,
        sessionManager,
        sessionStartEvent,
      })),
      services,
      diagnostics: services.diagnostics,
    };
  };

export async function runNativeTui(
  modelRuntime: ModelRuntime,
  agentDir: string,
  cwd: string,
) {
  const host = await createAgentSessionRuntime(
    nativeRuntimeFactory(modelRuntime, agentDir),
    {
      cwd,
      agentDir,
      sessionManager: SessionManager.create(
        cwd,
        path.join(agentDir, "sessions"),
      ),
    },
  );
  if (process.stdin.isTTY && process.stdout.isTTY)
    await new InteractiveMode(host).run();
  else {
    let input = "";
    for await (const chunk of process.stdin) input += chunk;
    try {
      if (input.trim())
        process.exitCode = await runPrintMode(host, {
          mode: "text",
          initialMessage: input.trim(),
        });
    } finally {
      await host.dispose();
    }
  }
}
