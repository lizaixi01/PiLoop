# PiLoop

基于 [Pi](https://github.com/badlogic/pi-mono) 的轻量 Coding Agent / Harness。

**你定方向，Agent 找上下文、执行和检查；有实质分歧时再给你选择。**

保留 Pi 原生终端、工具、快捷键和模型选择，不另造一套操作方式。

## 安装

需要 [Node.js](https://nodejs.org/) 22.19 或更新版本（包含 npm）。

```sh
npm install -g https://github.com/lizaixi01/PiLoop/releases/latest/download/piloop.tgz
```

## 启动

在要工作的项目目录运行：

```sh
piloop
```

第一次使用：`/api` 选择供应商、填 Key，或 `/login` 登录；再输入 `/model` 选模型。模型列表中 Enter 切换当前会话，Ctrl+S 保存默认模型。

之后直接说你想做什么。也可用 `piloop /path/to/project` 指定项目。`Esc` 停止，`/quit` 退出。

## 更新

启动时以一行显示 PiLoop 版本，保留 Pi 原生界面。在后台检查更新，成功结果缓存一小时，有新版时用 Pi 原生通知提示；断网失败不会阻止下次启动重试。更新只需：

```sh
piloop update
```

不会自动替换正在使用的版本。断网不影响启动；设置 `PILOOP_NO_UPDATE_CHECK=1` 可关闭检查。更新检查只访问公开 GitHub Release，不上传项目或对话。

## PiLoop 增加了什么

- **主动工作的行为约定**：先按需调查，明确任务直接执行；实质分歧才提问，选择后继续。排版任务不随意增加路由或改写内容。
- **有范围的偏好记忆**：模型可保存用户明确表达的持续偏好和纠正；一般交流偏好跨项目，代码规则留在对应项目。`/memory` 查看，`/forget` 停用，`/remember` 可手动保存。
- **简短配置入口**：`/api`，沿用 Pi 的 `/login` 和 `/model`。
- **交付前运行验证**：开发与修复任务默认要求实际执行、检查失败并复查最终版本。网页可按需调用 `verify_web_page`，在桌面/窄屏运行操作和结果断言，保存截图及 JSON 报告到项目 `.pi/piloop-checks/`。每轮最多三次该工具调用；规则仍依赖模型执行，不是禁止提前回复的硬门禁，也不保证零缺陷。

网页工具优先复用项目已有的 Playwright；不会随 CLI 安装或启动下载浏览器。Windows 也可单独配置轻量驱动，复用本机 Edge：`npm install --prefix "$HOME/.piloop/browser" playwright-core`（PowerShell）。其他平台可在项目配置 Playwright 及其浏览器。缺少浏览器环境时明确报告未验证，普通 CLI 不受影响。只检查已授权的本地页面；操作可能触发页面自己的请求，并非网络沙箱，请勿用真实支付或生产数据作验收。

正常聊天不会被强行转成开发任务。代码直接修改当前项目，与 Pi 原生方式相同。

这些行为仍依赖模型判断；记忆是有预算的文本注入，不是已验证的语义检索或自主学习。当前小样本实验**没有证明 PiLoop 稳定优于原版 Pi**。Dream、增强 Compaction 和后台持续工作尚未实现。实验方法及边界见 [实验记录](docs/experiments/proactive-pilot.md)。

## 数据存在哪里

账号、模型设置和会话默认存于 `~/.piloop/agent/`，与安装目录分离，升级保留。旧开发版安装目录中的 `.piloop/agent/` 会在首次启动时复制到尚不存在的用户配置目录，不删除原文件、不覆盖已有用户配置。

项目约束存于项目内 `.pi/piloop-memory.json`；通用交流偏好存于用户配置目录的 `preferences.json`。`PILOOP_DATA_DIR` 可指定独立数据目录，`PILOOP_AUTH_FILE` / `PILOOP_MODELS_FILE` 可指定已有配置。凭据和会话不随软件发布。

## 开发

```sh
git clone https://github.com/lizaixi01/PiLoop.git
cd PiLoop
npm ci
npm run build
npm link
```

修改后运行 `npm test` 和 `npm run build`，重启 PiLoop。旧网页原型仅供源码开发实验：`npm run build:web` 后运行 `npm run web`，或使用 `npm run dev`。网页、浏览器及 React/Express/Playwright 依赖均不进入 CLI 发布包的生产依赖；普通用户无需安装浏览器。

启动优先复用锁定的 Pi 0.85.1 自带打包 SDK，减少分散模块加载；该路径未由上游公开导出，因此只针对已验证版本启用，缺失或不兼容时回退到公开 SDK。`PILOOP_UNBUNDLED_SDK=1` 可手动回退。开发者运行 `node scripts/startup-bench.mjs` 对比两条路径；测量到运行时就绪，不包括终端首帧或模型响应。

## 致谢与许可

PiLoop 复用 Pi 的运行时、TUI、工具循环和上下文机制。这些基础能力属于 Pi。PiLoop 代码使用 [MIT License](LICENSE)，依赖保留各自许可证。
