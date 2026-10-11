# Via Local 0.1.0-alpha.8 · Windows x64 试用版

安装程序：Via-0.1.0-alpha.8-Setup-x64.exe。解压运行包：Via-0.1.0-alpha.8-win-x64.zip，解压后运行 ViaLocal.exe。两者均包含完整程序与示例文件，无需 Node.js。

1. 安装并打开 Via Local，在设置中选择 DeepSeek 或 OpenAI，保存自己的 API 密钥。
2. 可使用邮箱注册、验证码/密码登录及找回密码，也可先在本机使用。当前账号服务连接 CloudBase 开发环境；登录不上传阅读记录，未启用云同步。
3. 资料库内有两份安克示例文件，每篇10条明确标识的预制批注。首次启动将文件复制到 %APPDATA%/via-local-markdown/示例文档，可直接本地阅读。
4. 设置 → 连接器管理，复制本机命令。按使用帮助在 Typora 创建“问 Via”自定义导出，并绑定 Ctrl+Q。首次关联文件后，后续快捷键直接恢复真实侧栏。
5. 原文选区 → @Via 提问 → 回答/追问 → 收藏或交办。@其他AI或同事只记录本机待办。原 Markdown 不自动改写。
6. 首页点“依据原文生成复盘/生成这一天的复盘”。每日最多6题，提交后评分并生成巩固建议，再按公开概念使用模型原生搜索推荐最多3篇文章。点击日期可恢复历史答题。
7. 提醒仅在应用运行时触发；关闭期间不运行后台模型任务，重新启动补查当日提醒。

应用与旧 Via 独立：appId com.worldasoyster.via.localmarkdown，快捷方式 Via Local，数据目录 %APPDATA%/via-local-markdown。卸载保留本机记录；旧 Via 1.1.1 的目录不做迁移或覆盖。

未签名安装包；校验 SHA256SUMS.txt。此包为 alpha 试用版，真实邮箱送达、干净 Windows 环境与双屏/多窗口需要继续验收；不要将预制示例当作真实模型调用结果。GitHub 公开下载链接尚未发布。

主窗口关闭后 Via 在托盘继续运行；需要完全退出时，右键 Via 托盘图标选择“退出 Via”。
