'use strict';
window.viaHelpSections = [
  { title:'开始使用', items:[
    { question:'首次使用，如何在 Typora 侧唤起 Via？',steps:[
      '打开 Via App，依次点击「设置 → 连接器管理」，复制 Typora 命令。请使用你电脑上复制的实际命令。',
      '用 Typora 打开任意 Markdown 文档，在顶栏点击「文件 → 导出 → 导出设置」，进入设置页面。',
      '依次点击「导出 → ＋」，选择「自定义」并保存。将命令命名为「问 Via」（中间有空格），粘贴第 1 步复制的命令；选择「不选择导出路径」，无需勾选显示命令行输出。',
      '在 Typora 设置中点击「通用 → 打开高级设置」，打开 conf.user.json。搜索 for example，找到 keyBinding 部分，在其中加入 "问 Via": "Ctrl+Q"。命令名须与导出菜单完全一致；已有其他快捷键时留意逗号。保存文件并重启 Typora。',
      '在已保存的文档中选中文字后按 Ctrl+Q，即可唤起 Via。同一窗口、同一文档后续可直接继续批注。'
    ],note:'默认命令名「问 Via」，默认快捷键 Ctrl+Q。可按需修改，但 conf.user.json 内的命令名必须与 Typora 菜单相同，快捷键也须与 Via「连接器管理」中的 Typora 快捷键一致。首次关联、更换文档或重启 Via 后，Typora 可能显示一次「正在导出」提示；Via 不会因此生成导出文件。'},
    { question:'阅读现场与工作台有什么区别？', paragraphs:['阅读现场负责围绕原文提问、批注、追问和收藏。工作台负责从资料、对象和收藏找回完整上下文，处理待办并导出。两者共用同一份记录。'] },
    { question:'如何体验本作品？', steps:['在安克示例文档中选中文字，按 Ctrl+Q 或点击划词后浮现的「问 Via」。','提交 @Via 问题，查看预设演示回答；点击消息下的「回复」继续讨论。','回复 @Codex、@Claude 或 @同事名 留下待办，再点击「打开工作台」。','在首页完成复盘选择题；点击阅读统计中的日期，可查看当天问答。'], note:'纯前端作品使用预设回答。真实桌面版通过 Typora 选区与快捷键获取引用，并连接用户配置的 AI 服务。' }
  ] },
  { title:'批注与整理',items:[
    { question:'@Via、@Codex 与普通批注有什么区别？',paragraphs:['@Via 用于带引用的问答；@Codex、@Claude 或其他对象形成待办，由用户导出后交给对方。没有 @ 的内容保存为普通批注。Via 不会自动执行修改，也不向他人发送消息。'] },
    { question:'只想收藏文字，需要提问吗？',paragraphs:['不需要。引用文字后点击「只收藏文字」，即可保存引用。星标也可以收藏整条问答。收藏可从阅读复盘和工作台找回。'] },
    { question:'标记待办完成会移除批注吗？',paragraphs:['不会。待办完成与整条批注的「解决并移除」独立。标记完成会保留历史，批注只有在用户主动确认解决后才会移除。'] },
    { question:'为什么需要重新定位引用？',paragraphs:['原文修改或引用重复时，Via 可能无法确定对应位置。请在候选上下文中选择位置，或粘贴新的原文重新绑定。Via 不会在位置不确定时猜测。'] }
  ] },
  {title:'导出与保存',items:[
    {question:'如何把待办交给终端 AI？',paragraphs:['在待办页展开 @Codex 或 @Claude，按资料导出 Markdown。文件包含待办正文、引用和资料来源，可粘贴给终端 AI 继续修改。']},
    {question:'能导出原文和回答吗？',paragraphs:['阅读侧栏的导出菜单支持完整引用与问答 Markdown。纯前端演示的原文与批注通过浏览器打印，可在打印窗口选择保存为 PDF；正式桌面版提供独立 PDF 排版。折叠回答仍会完整导出。']},
    {question:'演示的数据存在哪里？',paragraphs:['作品演示使用两份安克示例文档，操作保存在当前浏览器；工作台和阅读现场共享同一份数据。设置 → 连接器管理 可恢复初始演示。正式桌面版将批注与原 Markdown 分开保存在本机。']},
    {question:'如何反馈问题？',paragraphs:['请在 GitHub Issues 按问题类型选择模板，并说明阅读来源、操作步骤、实际表现、预期表现和 Via 版本。附截图前请遮盖 API 密钥、配对码和敏感文档内容。'],link:{label:'打开 GitHub Issues ↗',url:'https://github.com/WorldAsOyster/Via-for-Vibe-Reading/issues'}}
  ]}
];

if (!window.viaDesktop?.isDemo) {
  const start = window.viaHelpSections[0];
  start.items[1] = { question: 'Via 主窗口与 Typora 侧栏有什么区别？', paragraphs: ['Typora 侧栏负责围绕原文提问、批注、追问和收藏；Via 主窗口负责资料、待办、收藏、每日复盘与设置。点击侧栏的 Via 图标即可打开主窗口，两者共用同一份本机记录。'] };
  start.items[2] = { question: '如何开始第一次阅读与复盘？', steps: ['在资料库选择示例文档，在原应用继续阅读；也可以在 Typora 打开自己的 Markdown。', '按连接器管理和使用帮助配置问 Via 命令，选中文字按 Ctrl+Q。提交 @Via 问题后，由已配置的模型实际回答。', '可以回复、收藏，或 @其他AI或同事留下待办。在 Via 主窗口按对象导出。', '首页生成每日复盘，提交选择题后查看解析、巩固建议与公开文章。阅读统计中的日期可恢复历史问答。'], note: '示例文档附预制批注并明确标记；新增 @Via 提问、生成复盘和联网推荐均需要自己的 AI 密钥。' };
  for (const section of window.viaHelpSections) for (const item of section.items) {
    if (item.question === '能导出原文和回答吗？') item.paragraphs = ['侧栏导出菜单支持引用与问答 Markdown、原文与全部批注 PDF。按人导出也提供 Markdown 和原文+该人批注 PDF；折叠回答仍会完整导出，原 Markdown 文件不变。'];
    if (item.question === '演示的数据存在哪里？') { item.question = '本机数据和示例文档存在哪里？'; item.paragraphs = ['本机记录保存在 %APPDATA%/via-local-markdown。两份示例文档在其中的示例文档目录，安装包也包含原始副本。批注与 Markdown 分开保存；卸载保留数据。邮箱登录不自动上传阅读记录。']; }
  }
}
