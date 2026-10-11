# Via 本机数据契约

## 唯一事实源

Typora 侧栏与桌面主窗口属于同一 Electron 应用。DocumentStore 保存 Markdown 批注；主窗口从同一份记录派生资料、待办、收藏与统计，不另建批注数据库。没有 WebStore 或自动云同步运行入口。

- 资料按规范化绝对文件路径识别，Windows 比较不区分大小写；键为路径 SHA-256。同名不同路径隔离，文件移动不承诺自动恢复。
- 原 Markdown 只读。documents-index.json 保存已打开资料；每份记录独立存储。移除资料只删 Via 记录，不删原文，并清理关联复盘。
- comments[] 保存 id、quote、anchor、messages、saved、savedAt 和 contextSnapshot。anchor 保存偏移及定位状态；重复引用由用户选候选，不能猜位置。
- messages[] 包含 id、role(user/via)、text、时间、status、replyTo；可含 searchRequested、联网 search 状态和核验 citations。完整导出包括折叠内容。
- @Via 触发选定模型，其他 @ 对象从用户消息派生待办。todoStates[messageId].resolvedAt 独立于整条批注的解决移除；保存时保留仍存在消息的完成状态。
- 同进程保存通过 IPC 通知主窗口刷新，重启从磁盘恢复。阅读时长未采集，显示空值。

## 设置、认证与示例

数据目录为 %APPDATA%/via-local-markdown。DesktopSettings 保存本机资料、Typora 开关/快捷键和 AI 服务选择；两家密钥分别经 safeStorage 加密。cloud-session.json 保存加密认证会话，渲染层不取得 token/密码。登录不上传阅读记录。当前 CloudAuth 为开发环境。

示例首次复制到示例文档目录，批注模型标记 example。onboarding-v1.json 记录初始化完成，不覆盖用户编辑或恢复用户已移除的示例。

## 每日复盘派生数据

daily-review.json 按本地日期保存状态、题目快照、原问答身份、模型版本、用户选择、评分、反馈、真实搜索文章、追问及提醒偏好。输入是当日带有效引用和已完成回答的 @Via 问题；跨资料轮询最多6组。程序校验原文摘录和单选结构，确定性评分；提交后锁定选择，避免重复评分。

生成期间原问答变化/删除使结果失效；成功真实题目不重复生成，中断可重试。资料删除清理相关快照。推荐仅接受公开概念检索产生的真实 HTTPS 可信来源，最多3篇。提醒在进程运行时触发，关闭后不运行服务。

扩展来源、消息投递、路径迁移或账号同步前，先约定身份、授权、写入者、状态和迁移规则。
