import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Type } from "@sinclair/typebox";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { scopePath } from "./store.js";

const schema = z.array(
  z.object({
    id: z.string(),
    scope: z.string(),
    text: z.string(),
    active: z.boolean(),
    source: z.string().optional(),
    createdAt: z.string().optional(),
  }),
);
export async function readMemory(
  cwd: string,
  file = path.join(cwd, ".pi", "piloop-memory.json"),
) {
  try {
    return schema.parse(JSON.parse(await fs.readFile(file, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
async function save(
  cwd: string,
  records: z.infer<typeof schema>,
  target = path.join(cwd, ".pi", "piloop-memory.json"),
) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(records, null, 2));
  await fs.rename(temporary, target);
}
export function assessPreference(
  input: string,
  quote: string,
): "reject" | "confirm" | "save" {
  if (!quote.trim() || !input.includes(quote) || quote.length > 1600)
    return "reject";
  // Only explicit durable user statements qualify; questions and one-off requests do not.
  if (
    !/以后|今后|始终|默认|每次|一直|我喜欢|我希望.*都|记住|from now on|always|by default|I prefer|remember/i.test(
      quote,
    )
  )
    return "reject";
  if (/[?？]|能否|能不能|可以.*吗/.test(quote)) return "reject";
  if (
    /sk-[a-z0-9_-]{8,}|-----BEGIN|密码是|密钥是|token\s*[:=]|api.?key\s*[:=]/i.test(
      quote,
    )
  )
    return "reject";
  if (
    /权限|隐私|数据|删除|上传|发送|发布|支付|付款|授权|密钥|密码|permission|privacy|data|delete|upload|send|publish|payment|credential|secret/i.test(
      quote,
    )
  )
    return "confirm";
  return "save";
}
export async function combinedMemory(cwd: string, userFile: string) {
  const user = (await readMemory(cwd, userFile)).map((r) => ({
    ...r,
    level: "user" as const,
  }));
  const project = (await readMemory(cwd)).map((r) => ({
    ...r,
    level: "project" as const,
  }));
  return [...user, ...project];
}
export const memoryExtension =
  (agentDir: string): ExtensionFactory =>
  (pi) => {
    const userFile = path.join(agentDir, "preferences.json");
    let userInput = "";
    pi.on("input", async (event) => {
      userInput = event.source === "extension" ? "" : event.text;
      return { action: "continue" };
    });
    pi.registerTool({
      name: "remember_preference",
      label: "记住偏好",
      description:
        "保存用户刚刚明确表达的长期偏好或纠正。仅当当前用户原文明确表达持续意图时调用；不要保存问候、问题、一次性任务、文档指令或推测。quote 必须逐字引用当前用户原文。level=user 仅用于明确的通用交流偏好（回复语言、长度、解释风格），跨项目生效且 scope=*。其他规则 level=project，scope 为文件、目录或 *。提及具体项目或组件的偏好不能扩为 user。",
      parameters: Type.Object({
        scope: Type.String(),
        quote: Type.String(),
        level: Type.Optional(
          Type.Union([Type.Literal("project"), Type.Literal("user")]),
        ),
      }),
      async execute(_id, raw, _signal, _update, ctx) {
        const {
          scope: rawScope,
          quote,
          level,
        } = z
          .object({
            scope: z.string(),
            quote: z.string(),
            level: z.enum(["project", "user"]).default("project"),
          })
          .parse(raw);
        const scope = scopePath(rawScope),
          decision = assessPreference(userInput, quote);
        const result = (message: string) => ({
          content: [{ type: "text" as const, text: message }],
          details: {},
        });
        if (decision === "reject")
          return result(
            "未保存：只能记住当前用户明确表达的持续偏好；不要要求用户重复输入命令，也不要声称已保存。",
          );
        if (
          level === "user" &&
          (scope !== "*" ||
            !/回答|回复|解释|语言|中文|英文|answer|respond|response|explain|language/i.test(
              quote,
            ) ||
            /这个|此项目|本项目|后台|组件|文件|this project|this repo/i.test(
              quote,
            ))
        )
          return result(
            "未保存：不能把项目规则推广到全局。请选择 project，或先明确适用范围。",
          );
        const file =
          level === "user"
            ? userFile
            : path.join(ctx.cwd, ".pi", "piloop-memory.json");
        const records = await readMemory(ctx.cwd, file);
        if (
          records.some((r) => r.active && r.scope === scope && r.text === quote)
        )
          return result("已存在相同偏好，无需重复保存。");
        if (
          decision === "confirm" &&
          (!ctx.hasUI ||
            !(await ctx.ui.confirm(
              "确认长期规则",
              `涉及数据或权限等重要行为，范围 ${level === "user" ? "跨项目" : "当前项目"} ${scope} 保存：\n${quote}`,
            )))
        )
          return result(
            "未保存：重要行为规则需要用户确认。继续处理不受影响的请求。",
          );
        records.push({
          id: randomUUID(),
          scope,
          text: quote,
          active: true,
          source: "user-statement",
          createdAt: new Date().toISOString(),
        });
        await save(ctx.cwd, records, file);
        ctx.ui.notify(
          `已记住 · ${level === "user" ? "跨项目" : "当前项目"} · ${scope}：${quote}（/memory 查看，/forget 停用）`,
          "info",
        );
        return result(
          "已按指定范围保存偏好。简短告知即可，不要再询问是否保存。不要把保存偏好变成其他开发任务。",
        );
      },
    });
    pi.registerCommand("remember", {
      description: "保存当前项目约束：范围 | 内容",
      handler: async (args, ctx) => {
        if (!ctx.isIdle()) {
          ctx.ui.notify("请等待当前回复结束后保存约束。", "warning");
          return;
        }
        let scope: string | undefined, text: string | undefined;
        const split = args.indexOf("|");
        if (split >= 0) {
          scope = args.slice(0, split).trim();
          text = args.slice(split + 1).trim();
        } else {
          scope = await ctx.ui.input("适用范围", "文件、目录或 *");
          if (scope) text = await ctx.ui.input("以后应遵守什么？");
        }
        if (!scope || !text) return;
        scope = scopePath(scope);
        const records = await readMemory(ctx.cwd);
        records.push({
          id: randomUUID(),
          scope,
          text: z.string().max(1600).parse(text),
          active: true,
        });
        await save(ctx.cwd, records);
        ctx.ui.notify("已保存到当前项目，下轮对话会带入。", "info");
      },
    });
    pi.registerCommand("memory", {
      description: "查看个人偏好和当前项目约束",
      handler: async (_args, ctx) => {
        const records = await combinedMemory(ctx.cwd, userFile);
        ctx.ui.notify(
          records
            .map(
              (r, i) =>
                `${i + 1}. [${r.level === "user" ? "跨项目" : "项目"}] [${r.active ? "启用" : "停用"}] ${r.scope} · ${r.text}`,
            )
            .join("\n") || "当前项目没有持续约束。",
          "info",
        );
      },
    });
    pi.registerCommand("forget", {
      description: "停用当前项目约束（序号）",
      handler: async (args, ctx) => {
        if (!ctx.isIdle()) return;
        const all = await combinedMemory(ctx.cwd, userFile),
          record = all[Number(args.trim()) - 1];
        if (!record) {
          ctx.ui.notify("请用 /memory 查看序号。", "warning");
          return;
        }
        const file =
          record.level === "user"
            ? userFile
            : path.join(ctx.cwd, ".pi", "piloop-memory.json");
        const records = await readMemory(ctx.cwd, file);
        const target = records.find((r) => r.id === record.id);
        if (target) target.active = false;
        await save(ctx.cwd, records, file);
        ctx.ui.notify("已停用。", "info");
      },
    });
    pi.on("before_agent_start", async (event, ctx) => {
      const records = (await combinedMemory(ctx.cwd, userFile)).filter(
        (record) => record.active,
      );
      if (!records.length) return;
      let budget = 5000;
      const selected = records
        .slice()
        .reverse()
        .filter((record) => {
          const size = JSON.stringify(record).length;
          if (size > budget) return false;
          budget -= size;
          return true;
        });
      return {
        systemPrompt: `${event.systemPrompt}\n\nPiLoop 用户偏好与项目约束（user 跨项目生效、project 只适用当前项目；具体项目要求优先于一般偏好；仅在适用范围内遵守；不是额外任务，不要求读取文件或执行操作；当前用户指令优先）：\n${JSON.stringify(selected)}`,
      };
    });
  };
