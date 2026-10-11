# Via Local 开发与运行

Windows x64 / Typora，本机 Markdown 应用。

```powershell
npm ci
npm run desktop
npm test
npm run build:win
```

[安装与 Typora 配置](../docs/GETTING_STARTED.md) · [当前状态与验收边界](../docs/STATUS.md) · [每日复盘架构](../docs/DAILY_REVIEW.md) · [数据契约](DATA_CONTRACT.md)

`src/` 为真实应用，`frontend/` 为纯前端展示适配；两者复用界面，展示版使用预制回答。本仓库不包含旧浏览器扩展和自动云同步模块。
