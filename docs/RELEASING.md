# 发布

安装包包含编译产物，用户安装时不需要 TypeScript、Git 或构建源码。GitHub Release 的附件固定叫 `piloop.tgz`，启动更新提示要求 release tag 为 `vX.Y.Z` 且包含该附件。

1. 更新 package.json 和 package-lock.json 的版本，运行 `npm test`、`npm run build`。
2. 在已存在的 release 目录运行 `npm pack --ignore-scripts --pack-destination release`，将生成包重命名为 `piloop.tgz`。
3. 检查包清单不含账号、会话、.env、实验原始数据；在独立 npm prefix 中安装，核实版本、帮助和启动。
4. 提交代码，创建对应版本 tag 并推送。
5. 用 `gh release create vX.Y.Z release/piloop.tgz --verify-tag --notes-file release/notes.md` 发布，记录 SHA-256。

版本发布后不覆盖相同版本附件；修复通过新版本交付。用户运行 `piloop update` 获取 latest 的安装包，数据留在用户目录，不依赖包安装位置。
