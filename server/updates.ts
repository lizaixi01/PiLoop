import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

export const RELEASE_API = "https://api.github.com/repos/lizaixi01/PiLoop/releases/latest";
export const INSTALL_URL = "https://github.com/lizaixi01/PiLoop/releases/latest/download/piloop.tgz";
export function isNewerVersion(latest: string, current: string): boolean {
  const parse = (v: string) => /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v)?.slice(1).map(Number);
  const a = parse(latest), b = parse(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
async function version() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  return (JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8")) as {version:string}).version;
}
export async function checkUpdate(dataDir: string, current: string, request = fetch, now = Date.now()) {
  const cache = path.join(dataDir, "update-check.json");
  let previous: string | undefined;
  try {
    const saved = JSON.parse(await fs.readFile(cache, "utf8")) as {checkedAt:number;latest?:string};
    previous = saved.latest;
    if (now >= saved.checkedAt && now - saved.checkedAt < 3600000)
      return saved.latest && isNewerVersion(saved.latest, current) ? saved.latest : undefined;
  } catch { /* Missing or damaged cache: retry a bounded public request. */ }
  // Cache successful checks only: an offline launch must not suppress the next online check.
  let response: Response;
  try { response = await request(RELEASE_API, {
    headers: {Accept:"application/vnd.github+json", "User-Agent":"PiLoop"}, signal:AbortSignal.timeout(2000),
  }); } catch { return previous && isNewerVersion(previous,current) ? previous : undefined; }
  if (!response.ok) return previous && isNewerVersion(previous,current) ? previous : undefined;
  const release = await response.json() as {tag_name?:unknown;assets?:{name:string}[]};
  if (typeof release.tag_name !== "string" || !/^v?\d+\.\d+\.\d+$/.test(release.tag_name)
    || !Array.isArray(release.assets) || !release.assets.some(a=>a.name==="piloop.tgz")) return undefined;
  await fs.mkdir(dataDir, {recursive:true});
  await fs.writeFile(cache, JSON.stringify({checkedAt:now,latest:release.tag_name}));
  return isNewerVersion(release.tag_name, current) ? release.tag_name : undefined;
}
export const updateExtension = (agentDir: string): ExtensionFactory => pi => {
  let announced = false;
  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;
    void version().then(v=>{
      if (!announced) { ctx.ui.notify(`PiLoop v${v} · powered by Pi`, "info"); announced = true; }
      if (process.env.PILOOP_NO_UPDATE_CHECK === "1") return undefined;
      return checkUpdate(path.dirname(agentDir),v);
    }).then(latest=>{
      if (latest) ctx.ui.notify(`PiLoop ${latest} 可用 · 退出后运行 piloop update`, "info");
    }).catch(()=>{}); // Offline must not prevent normal CLI use.
  });
};
export async function installUpdate(): Promise<number> {
  console.log("正在更新 PiLoop…");
  return new Promise(resolve=>{
    // Fixed arguments only; no model/user input is interpolated into the Windows shell.
    const child = process.platform === "win32"
      ? spawn(process.env.ComSpec || "cmd.exe", ["/d","/s","/c",`npm.cmd install --global ${INSTALL_URL}`], {stdio:"inherit"})
      : spawn("npm", ["install","--global",INSTALL_URL], {stdio:"inherit"});
    child.on("error",()=>{console.error("更新失败，请确认 Node.js/npm 已安装。");resolve(1);});
    child.on("exit",code=>{
      if (code === 0) console.log("更新完成。运行 piloop 开始使用。");
      else console.error("更新未完成。修复上方错误后可重试 piloop update。");
      resolve(code ?? 1);
    });
  });
}
