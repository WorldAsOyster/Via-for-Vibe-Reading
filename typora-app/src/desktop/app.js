(() => {
  'use strict';

  const api = window.viaDesktop;
  const content = document.getElementById('content');
  const sourceApps = [{ key: 'typora', label: 'Typora', format: '本机 Markdown', icon: 'T' }];
  const state = {
    data: { sources: [], tasks: [], saved: [], activity: {}, readingKeywords: [], questionKeywords: [], portrait: { ready: false, target: 5, remaining: 5 }, metrics: {} },
    settings: null, install: null,
    ai: { configured: false, needsReplacement: false, source: null },
    page: 'home', sourceId: null, sourceFilter: 'all', search: '', expandedPeople: new Set(), avatarDraft: null,
    settingsTab: 'profile', release: null, capturingShortcut: false, setupDismissed: false
  };
  let toastTimer;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
  const sourceLabel = key => sourceApps.find(item => item.key === key)?.label || key;
  const sourceIcon = key => sourceApps.find(item => item.key === key)?.icon || '文';
  const sourceById = id => state.data.sources.find(item => item.id === id);
  const current = () => sourceById(state.sourceId);
  const displayTime = value => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '时间未记录';

  function toast(message) {
    const element = document.getElementById('toast');
    element.textContent = String(message);
    element.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.classList.remove('show'), 3000);
  }

  async function refresh() {
    const result = await api.getData();
    state.data = result;
    state.settings = result.settings;
    state.ai = result.ai || { configured: false, needsReplacement: false, source: null };
    state.install = result.install || null;
    state.release = result.release || null;
    state.auth = result.auth || {state:'signedOut'};
    window.viaAuthUi?.update(result.auth);
    if (state.sourceId && !current()) {
      state.sourceId = null;
      if (state.page === 'detail') state.page = 'documents';
    }
    render();
  }

  function pageTitle(kicker, title, description, right = '') {
    return `<div class="page-title"><div><span class="eyebrow">${esc(kicker)}</span><h2>${esc(title)}</h2></div>${right}</div>`;
  }

  function dateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function activityDots() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Array.from({ length: 84 }, (_, index) => {
      const date = new Date(today);
      date.setDate(date.getDate() - (83 - index));
      const key = dateKey(date);
      const count = state.data.activity[key] || 0;
      const level = count === 0 ? 0 : count === 1 ? 1 : count <= 3 ? 2 : 3;
      return `<i class="activity-dot" data-level="${level}" title="${key} · ${count} 次记录"></i>`;
    }).join('');
  }

  function metric(value, label, unavailable = false) {
    return `<div class="metric"><strong class="${unavailable ? 'unavailable' : ''}">${esc(value)}</strong><span>${esc(label)}</span></div>`;
  }

  function keywordChips(items, themeCount = 0) {
    return items.length ? `<div class="keyword-list">${items.map((item, index) => `<span class="${index < themeCount ? 'theme' : ''}">${esc(item)}</span>`).join('')}</div>`
      : '<p class="muted">有了阅读记录后，这里会逐步形成关键词。</p>';
  }

  function home() {
    state.reviewDate ||= window.viaDailyReview.latestDate(state.data);
    return window.viaDailyReview.render(state.data, state.reviewDate);
  }

  function sourceRow(source) {
    const last = source.updatedAt || source.lastOpenedAt;
    return `<div class="doc-row"><button class="doc-open" data-open-source="${esc(source.id)}" title="查看 ${esc(source.name)}"><span class="doc-icon">${esc(sourceIcon(source.sourceType))}</span><span class="doc-row-main"><strong>${esc(source.name)}</strong><small title="${esc(source.documentPath)}">${esc(sourceLabel(source.sourceType))} · ${esc(source.documentPath || '需在本机重新关联原文件')}</small></span></button><span class="doc-meta-right"><span>${last ? esc(new Date(last).toLocaleDateString('zh-CN')) : '—'}</span><span class="pill">${source.comments.length} 条批注</span></span><button class="doc-remove" data-remove-source="${esc(source.id)}" title="从资料库移除" aria-label="从资料库移除 ${esc(source.name)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/></svg></button></div>`;
  }

  function libraryList() {
    const query = state.search.trim().toLowerCase();
    const matches = state.data.sources.filter(source =>
      (state.sourceFilter === 'all' || source.sourceType === state.sourceFilter) &&
      `${source.name} ${source.documentPath}`.toLowerCase().includes(query));
    if (!matches.length) {
      const reason = query ? '没有找到符合搜索条件的资料。' : '还没有资料。在 Typora 中打开一份 Markdown，留下批注后可从这里找回。';
      return `<div class="empty large"><h3>这里暂时是空的</h3><p>${esc(reason)}</p></div>`;
    }
    return `<div class="doc-list">${matches.map(sourceRow).join('')}</div>`;
  }

  function library() {
    return pageTitle('本机 Markdown', '资料库', '按来源找回已记录的资料；当前只展示真实接入或打开过的内容。', `<input class="search" id="sourceSearch" type="search" placeholder="搜索资料名称或路径" value="${esc(state.search)}" aria-label="搜索资料">`)
      + `<div class="filter-row"><span class="pill">本机 Markdown</span></div><div id="sourceList">${libraryList()}</div>`;
  }

  function stateIcons(comment, source) {
    const tasks = source.tasks.filter(item => item.commentId === comment.id && !item.resolvedAt);
    const icons = [];
    for (const person of [...new Set(tasks.map(item => item.person))].slice(0, 2)) {
      icons.push(`<span class="state-icon todo" title="待 @${esc(person)} 确认">@${esc(person)}</span>`);
    }
    if (comment.saved) icons.push('<span class="state-icon saved" title="已收藏">★</span>');
    if ((comment.messages || []).some(item => item.role === 'via' && item.status === 'answered')) {
      icons.push('<span class="state-icon answered" title="Via 已回答">✓</span>');
    }
    return `<span class="state-stack">${icons.slice(0, 3).join('')}</span>`;
  }

  function detailIndex(source) {
    if (!source.comments.length) return '<div class="empty">这份资料还没有批注。请在对应阅读侧栏中创建。</div>';
    return `<div class="index-list">${source.comments.map(comment => {
      const questions = (comment.messages || []).filter(item => item.role === 'user');
      return `<div class="index-row">${stateIcons(comment, source)}<div><strong class="quote-text">被引原文 · “${esc(comment.quote)}”</strong><div class="question-list">${questions.length ? questions.map((item, index) => `<p>${questions.length > 1 ? `内容 ${index + 1}` : '提问或批注'}：${esc(item.text)}</p>`).join('') : '<p>尚无用户内容</p>'}</div></div></div>`;
    }).join('')}</div>`;
  }

  function review(source) {
    const recap = source.recap || {};
    const links = Array.isArray(recap.recommendations) ? recap.recommendations : [];
    const topics = Array.isArray(recap.topics) ? recap.topics : [];
    const groups = new Map();
    for (const task of source.tasks.filter(item => !item.resolvedAt)) {
      if (!groups.has(task.person)) groups.set(task.person, []);
      groups.get(task.person).push(task);
    }
    const linkHtml = links.map(link => `<a href="#" class="review-link" data-open-link="${esc(link.url)}">${esc(link.title)} ↗<small>${esc(link.source)} · 公开资料</small></a>`).join('');
    const todoHtml = [...groups].map(([person, items]) => `<div class="review-person"><strong>@${esc(person)} · ${items.length} 条</strong><button data-export-person="${esc(person)}" data-source-id="${esc(source.id)}">按人导出 ↓</button></div>${items.map(item => `<div class="review-detail"><strong>${esc(item.body)}</strong><span>“${esc(item.quote)}”</span></div>`).join('')}`).join('');
    const savedHtml = source.savedItems.map(item => `<div class="review-detail"><strong>“${esc(item.quote)}”</strong><span>${esc(item.messages.map(message => `${message.role === 'via' ? 'Via' : '我'}：${message.text}`).join('\n'))}</span></div>`).join('');
    return `<section class="document-review"><h2>阅读复盘</h2><div class="review-card"><div class="review-count">${source.comments.length}<small>批注数</small></div><div><h3>${topics.length ? `你主要关注「${esc(topics.join('、'))}」相关的问题。` : '继续阅读，Via 会在这里整理你关注的主题。'}</h3>${linkHtml || '<p>目前没有相关阅读推荐。</p>'}<p class="review-hint">推荐来自 Typora 侧栏保存的关键词复盘；推荐基于本机关键词规则。</p></div></div>
      <div class="review-card"><div class="review-count">${source.tasks.filter(item => !item.resolvedAt).length}<small>待办数</small></div><div><h3>按被 @ 的人或 AI 汇总</h3>${todoHtml || '<p>这份资料没有未完成的待办。</p>'}</div></div>
      <div class="review-card"><div class="review-count">${source.savedItems.length}<small>收藏数</small></div><div><h3>你收藏的批注与回答</h3>${savedHtml || '<p>这份资料还没有收藏。</p>'}</div></div></section>`;
  }

  function detail() {
    const source = current();
    if (!source) return '<div class="empty">资料已不存在，请返回资料库。</div>';
    const pending = source.tasks.filter(item => !item.resolvedAt).length;
    return `<div class="detail-top"><div><div class="detail-origin"><span class="pill">${esc(sourceLabel(source.sourceType))}</span><span class="detail-path" title="${esc(source.documentPath)}">${esc(source.documentPath || '本机原文件未关联')}</span></div><h2>${esc(source.name)}</h2></div><div class="detail-actions"><button class="primary" data-return-source="${esc(source.id)}" ${source.exists ? '' : 'disabled'}>在原应用继续 ↗</button></div></div>
      <div class="index-heading"><h3>批注索引</h3><div class="detail-summary"><span><b>${source.comments.length}</b> 条批注</span><span>· <b>${pending}</b> 条待办</span><span>· <b>${source.savedItems.length}</b> 条收藏</span></div></div>${detailIndex(source)}${review(source)}`;
  }

  function actions() {
    const groups = new Map();
    for (const task of state.data.tasks) {
      if (!groups.has(task.person)) groups.set(task.person, []);
      groups.get(task.person).push(task);
    }
    const cards = [...groups].map(([person, items]) => {
      const pending = items.filter(item => !item.resolvedAt);
      const open = state.expandedPeople.has(person);
      const isAi = /ai|codex|claude|gpt|deepseek/i.test(person);
      const bySource = new Map();
      for (const item of items) {
        if (!bySource.has(item.sourceId)) bySource.set(item.sourceId, []);
        bySource.get(item.sourceId).push(item);
      }
      const sourceGroups = [...bySource].map(([sourceId, sourceItems]) => {
        const source = sourceItems[0];
        const pendingHere = sourceItems.some(item => !item.resolvedAt);
        return `<section class="todo-document"><div class="todo-document-head"><strong>${esc(source.sourceName)}</strong><span>${esc(sourceLabel(source.sourceType))}</span><button class="plain-btn" data-open-source="${esc(sourceId)}">查看资料 →</button><button class="plain-btn" data-export-person="${esc(person)}" data-source-id="${esc(sourceId)}" ${pendingHere ? '' : 'disabled'}>导出批注 ↓</button></div>${sourceItems.map(item => `<article class="todo-item ${item.resolvedAt ? 'resolved' : ''}"><div class="todo-content"><div class="todo-top"><span>${esc(displayTime(item.createdAt))}</span><span class="task-state ${item.resolvedAt ? 'done' : ''}">${item.resolvedAt ? '已完成' : '待跟进'}</span></div><p>${esc(item.body)}</p><span class="todo-quote">被引原文：“${esc(item.quote)}”</span></div><button class="toggle-task" data-task-toggle="${esc(item.messageId)}" data-source-id="${esc(item.sourceId)}" data-resolved="${item.resolvedAt ? 'true' : 'false'}" >${item.resolvedAt ? '重新打开' : '标记完成'}</button></article>`).join('')}</section>`;
      }).join('');
      return `<section class="person-card ${open ? 'open' : ''}"><button class="person-toggle" data-person="${esc(person)}"><span class="person-avatar ${isAi ? 'ai' : ''}">${isAi ? 'AI' : '@'}</span><span class="person-summary"><strong>@${esc(person)}</strong></span><span class="person-count">${pending.length} 条待跟进</span><span class="person-chevron">›</span></button>${open ? `<div class="person-items">${sourceGroups}</div>` : ''}</section>`;
    }).join('');
    return pageTitle('阅读后的行动', '待办', '按 @ 的人或 AI 归档；卡片优先呈现需要沟通的内容。')
      + (cards ? `<div class="person-list">${cards}</div>` : '<div class="empty large"><h3>目前没有待办</h3><p>在阅读侧栏的批注中 @ 同事或其他 AI，相关事项会出现在这里。</p></div>');
  }

  function saved() {
    const cards = state.data.saved.map(item => {
      const firstQuestion = item.messages.find(message => message.role === 'user')?.text || item.quote;
      const body = item.messages.map(message => `${message.role === 'via' ? 'Via 回答' : '我的内容'}：${message.text}`).join('\n\n');
      return `<article class="saved-card"><div class="saved-card-inner"><span class="saved-quote">“${esc(item.quote)}”</span><h3>${esc(firstQuestion)}</h3><p>${esc(body)}</p>${item.context && item.context !== item.quote ? `<p class="saved-context">原文上下文：${esc(item.context)}</p>` : ''}</div><div class="saved-card-footer"><span>${esc(sourceLabel(item.sourceType))} · ${esc(item.sourceName)}</span><button class="plain-btn" data-open-source="${esc(item.sourceId)}">打开资料 ↗</button></div></article>`;
    }).join('');
    return pageTitle('个人记忆', '收藏', '完整保留引用、批注与回答，方便不打开原文时重读。')
      + (cards ? `<div class="masonry">${cards}</div>` : '<div class="empty large"><h3>还没有收藏</h3><p>在 Typora 侧栏点击批注上的星标，完整内容会汇入这里。</p></div>');
  }

  function layoutMasonry() {
    document.querySelectorAll('.masonry .saved-card').forEach(card => { card.style.gridRowEnd = 'auto'; });
    document.querySelectorAll('.masonry .saved-card').forEach(card => {
      card.style.gridRowEnd = `span ${Math.ceil((card.getBoundingClientRect().height + 15) / 8)}`;
    });
  }

  function helpContent() {
    return (window.viaHelpSections || []).map(group => `<section class="help-group"><h3>${esc(group.title)}</h3><div class="help-list">${group.items.map((item, index) => `<details class="help-item" ${group.title === '开始使用' && index === 0 ? 'open' : ''}><summary>${esc(item.question)}</summary><div class="help-answer">${item.steps ? `<ol>${item.steps.map((step, stepIndex) => `<li>${esc(step)}${(item.stepImages?.[stepIndex] || []).map(file => `<button class="help-figure" data-help-image="${esc(file)}" aria-label="放大步骤 ${stepIndex + 1} 图片"><img src="help-images/${esc(file)}" alt="步骤 ${stepIndex + 1} 操作示意" loading="lazy"><span>点击放大</span></button>`).join('')}</li>`).join('')}</ol>` : ''}${(item.paragraphs || []).map(paragraph => `<p>${esc(paragraph)}</p>`).join('')}${item.note ? `<p class="help-note">${esc(item.note)}</p>` : ''}${item.link ? `<a href="#" data-open-link="${esc(item.link.url)}">${esc(item.link.label)}</a>` : ''}</div></details>`).join('')}</div></section>`).join('') + '<dialog id="helpImageDialog" class="help-image-dialog"><button class="outline-btn" data-close-help-image>关闭图片</button><img id="helpLargeImage" alt="操作步骤放大图"></dialog>';
  }

  function settings() {
    const profile = state.settings?.profile || { name: '', id: '', email: '', signature: '', avatar: '' };
    const demo = api.isDemo === true;
    const providerRow = (provider, label) => {
      const status = state.ai.providers?.[provider] || {};
      return `<div class="ai-setting-row"><label class="provider-choice"><input type="radio" name="aiProvider" data-provider="${provider}" ${state.ai.provider === provider ? 'checked' : ''}><span><strong>${label}</strong><small>${demo ? '预设回答演示' : status.configured ? '已配置' : '尚未配置'}</small></span></label>${demo ? '<button class="outline-btn" data-demo-unavailable>配置密钥</button>' : `<label class="account-field">API 密钥<input id="${provider}Key" type="password" autocomplete="new-password" placeholder="输入 ${label} API 密钥" ${status.source === 'environment' ? 'disabled' : ''}></label><button class="outline-btn" data-save-ai-key="${provider}" ${status.source === 'environment' ? 'disabled' : ''}>保存密钥</button>`}</div>`;
    };
    const tabs = `<nav class="settings-tabs" aria-label="设置分类"><button class="settings-tab ${state.settingsTab === 'profile' ? 'active' : ''}" data-settings-tab="profile">个人资料与 AI</button><button class="settings-tab ${state.settingsTab === 'local' ? 'active' : ''}" data-settings-tab="local">连接器管理</button><button class="settings-tab ${state.settingsTab === 'help' ? 'active' : ''}" data-settings-tab="help">使用帮助</button></nav>`;
    const accountRow = `<div class="account-login-row"><div><strong>Via 账号</strong>${window.viaAuthUi?.summary() || '<span>尚未登录</span><small>登录后使用账号服务</small>'}</div><div>${window.viaAuthUi?.buttons() || '<button class="outline-btn" data-auth="register">注册</button><button class="primary" data-auth="login">登录</button>'}</div></div>`;
    const profilePage = accountRow + `<h3 class="settings-heading">本机个人资料</h3><div class="surface profile-surface"><div class="profile-layout"><div class="profile-edit"><div class="profile-avatar" id="profileAvatarPreview">${profile.avatar ? `<img src="${esc(profile.avatar)}" alt="用户头像">` : esc(profile.name?.slice(0, 1) || '我')}</div><button class="outline-btn" data-choose-avatar>选择图片</button><input id="avatarFile" type="file" accept="image/png,image/jpeg,image/webp" hidden></div><div class="profile-fields"><div class="account-grid"><label class="account-field">显示名称<input id="accountName" value="${esc(profile.name)}" autocomplete="off"></label><label class="account-field">联系邮箱（可选）<input id="accountEmail" type="email" value="${esc(profile.email)}" autocomplete="off"></label><label class="account-field wide">个人签名<input id="accountSignature" value="${esc(profile.signature || '')}" placeholder="阅读，留下思考" maxlength="80" autocomplete="off"></label></div><div class="account-actions"><span class="account-id">${demo ? '仅保存在当前浏览器' : '资料仅保存在本机'}</span><button class="outline-btn" data-save-profile>保存资料</button></div></div></div></div><h3 class="settings-heading">AI 连接</h3>${demo ? '<p class="setting-note">作品演示使用预设回答，不联网调用模型，也不收集 API 密钥。</p>' : ''}<div class="surface ai-providers">${providerRow('deepseek', 'DeepSeek')}${providerRow('openai', 'OpenAI')}</div>`;
    const shortcut = state.settings?.typoraShortcut || 'Ctrl+Q';
    const localPage = `<h3 class="settings-heading">连接器管理</h3><div class="setting-group"><div class="setting-row"><div><strong>Typora · 本机 Markdown</strong><small>在原阅读位置提问、批注与收藏；原 Markdown 保持只读。</small></div><button class="app-toggle ${state.settings?.typoraEnabled ? 'on' : ''}" ${demo?'data-demo-unavailable':'data-toggle-typora'} aria-label="Typora 接入" aria-pressed="${Boolean(state.settings?.typoraEnabled)}"></button></div><div class="setting-row"><div><strong>Typora 快捷键</strong><small>与 Typora 自定义导出命令的快捷键保持一致。</small></div><div class="shortcut-controls"><span class="keycap">${esc(shortcut.replaceAll('+', ' + '))}</span><button class="outline-btn" ${demo?'data-demo-unavailable':'data-capture-shortcut'}>${state.capturingShortcut?'取消':'修改'}</button></div></div>${state.capturingShortcut?'<p class="shortcut-capture">请按 Ctrl 或 Alt + 可选 Shift + A–Z；Esc 取消。</p>':''}<div class="connector-heading"><strong>Typora 自定义导出命令</strong><p>首次使用时，复制命令并在 Typora 的导出设置中创建「问 Via」。</p></div><div class="connector-command"><input id="typoraCommand" aria-label="Typora 自定义导出命令" readonly value="${demo?'使用完整安装包获取本机命令':esc(state.install?.typoraCommand || '')}"><button class="outline-btn" ${demo?'data-demo-unavailable':'data-copy-typora-command'}>复制命令</button></div><div class="connector-help">操作步骤见「使用帮助 → 首次使用，如何在 Typora 侧唤起 Via？」</div></div><h3 class="settings-heading">本机数据</h3><div class="setting-group"><div class="setting-row"><div><strong>批注与原文分开保存</strong><small>${demo?'演示记录保存在当前浏览器。正式桌面版使用本机数据目录。':'按原文件路径保存批注、收藏、待办与问答。'}</small></div><span class="setting-value">${demo?'前端演示':'本机保存'}</span></div></div>${demo?'<button class="outline-btn" data-demo-reset>恢复初始演示</button>':''}`;
    return pageTitle('偏好与连接', '设置', '') + tabs + (state.settingsTab === 'profile' ? profilePage : state.settingsTab === 'local' ? localPage : helpContent());
  }

  function render() {
    const metrics = state.data.metrics;
    const profile = state.settings?.profile || { name: '本机用户', signature: '', avatar: '' };
    const brandAvatar = document.getElementById('brandAvatar');
    brandAvatar.innerHTML = profile.avatar ? `<img src="${esc(profile.avatar)}" alt="">` : esc(profile.name?.slice(0, 1) || '我');
    document.getElementById('brandName').textContent = profile.name || '本机用户';
    document.getElementById('brandSignature').textContent = profile.signature || '阅读，留下思考';
    document.querySelectorAll('.nav-button[data-page]').forEach(button => {
      button.classList.toggle('active', button.dataset.page === state.page || (state.page === 'detail' && button.dataset.page === 'documents'));
    });
    document.getElementById('navDocCount').textContent = String(metrics.sources || 0);
    document.getElementById('navActionCount').textContent = String(metrics.pendingTasks || 0);
    document.getElementById('navSavedCount').textContent = String(metrics.saved || 0);
    const title = { home: '首页', documents: '资料库', detail: '资料记录', actions: '待办', saved: '收藏', settings: '设置' }[state.page];
    document.title = `Vibe with Via · 你的终端Vibe搭子 · ${title}`;
    document.getElementById('releaseTitle').textContent = state.release ? `${state.release.version} · ${state.release.title}` : '版本信息';
    document.getElementById('releaseSummary').textContent = state.release?.summary || '本次更新内容将在这里显示。';
    content.classList.toggle('daily-home', state.page === 'home');
    content.innerHTML = state.page === 'home' ? home() : state.page === 'documents' ? library() : state.page === 'detail' ? detail() : state.page === 'actions' ? actions() : state.page === 'saved' ? saved() : settings();
    document.getElementById('setupOverlay').hidden = Boolean(state.ai.configured || state.setupDismissed || window.viaAuthUi?.blocksSetup());
    if (state.page === 'saved') requestAnimationFrame(layoutMasonry);
  }

  document.addEventListener('click', async event => {
    const button = event.target.closest('button,a[data-open-link]');
    if (!button) return;
    try {
      if (button.hasAttribute('data-demo-unavailable') || (api.isDemo && button.dataset.auth)) {
        toast(api.isDemo ? '当前仅前端无法使用此功能，请联系开发者获取完整安装包。' : '语音输入暂未支持，请使用文字输入。');
      } else if (button.hasAttribute('data-review-generate')) {
        button.disabled = true; toast('正在依据原文生成复盘题目…');
        await api.generateReview(state.reviewDate); await refresh();
      } else if (button.dataset.reviewDate) {
        state.reviewDate = button.dataset.reviewDate; render();
      } else if (button.dataset.reviewChoice) {
        await api.chooseReviewAnswer(state.reviewDate, button.dataset.reviewChoice, Number(button.dataset.option));
        const scroll = document.getElementById('reviewTimeline').scrollTop;
        await refresh(); document.getElementById('reviewTimeline').scrollTop = scroll;
      } else if (button.hasAttribute('data-review-submit')) {
        await api.submitReview(state.reviewDate); await refresh();
        document.querySelector('.review-feedback')?.scrollIntoView({block:'start'}); toast('已保存这一天的复盘');
      } else if (button.hasAttribute('data-review-reminder')) {
        if (!api.saveReviewReminder) return toast('每日复盘服务尚未连接');
        document.getElementById('reviewReminderDialog').showModal();
      } else if (button.hasAttribute('data-review-reminder-close')) {
        document.getElementById('reviewReminderDialog').close();
      } else if (button.hasAttribute('data-copy-typora-command')) {
        await navigator.clipboard.writeText(state.install?.typoraCommand || ''); toast('已复制 Typora 命令');
      } else if (button.dataset.page) {
        state.page = button.dataset.page;
        render();
        content.scrollTop = 0;
      } else if (button.hasAttribute('data-setup-configure')) {
        state.setupDismissed = true;
        state.page = 'settings';
        state.settingsTab = 'profile';
        render();
        content.scrollTop = 0;
        document.querySelector('.ai-providers')?.scrollIntoView({ block: 'center' });
        document.getElementById(`${state.ai.provider || 'deepseek'}Key`)?.focus();
      } else if (button.hasAttribute('data-setup-later')) {
        state.setupDismissed = true;
        render();
      } else if (button.dataset.settingsTab) {
        state.settingsTab = button.dataset.settingsTab;
        render();
        content.scrollTop = 0;
      } else if (button.dataset.openSource) {
        state.sourceId = button.dataset.openSource;
        state.page = 'detail';
        render();
        content.scrollTop = 0;
      } else if (button.dataset.removeSource) {
        const source = sourceById(button.dataset.removeSource);
        if (!source || !confirm(`从 Via 资料库移除「${source.name}」？\n\n这会删除 Via 保存的批注、待办和收藏，不会删除原 Markdown。`)) return;
        await api.removeSource(source.id);
        await refresh();
        toast('已从 Via 资料库移除');
      } else if (button.dataset.filter) {
        state.sourceFilter = button.dataset.filter;
        render();
      } else if (button.dataset.person) {
        state.expandedPeople.has(button.dataset.person) ? state.expandedPeople.delete(button.dataset.person) : state.expandedPeople.add(button.dataset.person);
        render();
      } else if (button.dataset.taskToggle) {
        await api.toggleTodo(button.dataset.sourceId, button.dataset.taskToggle, button.dataset.resolved !== 'true');
        await refresh();
      } else if (button.dataset.returnSource) {
        await api.openSource(button.dataset.returnSource);
      } else if (button.dataset.exportPerson) {
        const saved = await api.exportTodos(button.dataset.sourceId, button.dataset.exportPerson);
        if (saved) toast('待办已导出');
      } else if (button.hasAttribute('data-toggle-typora')) {
        state.settings = await api.toggleTypora(!state.settings.typoraEnabled);
        render();
      } else if (button.hasAttribute('data-capture-shortcut')) {
        state.capturingShortcut = !state.capturingShortcut;
        render();
      } else if (button.dataset.helpImage) {
        document.getElementById('helpLargeImage').src = `help-images/${button.dataset.helpImage}`;
        document.getElementById('helpImageDialog').showModal();
      } else if (button.hasAttribute('data-close-help-image')) {
        document.getElementById('helpImageDialog').close();
      } else if (button.hasAttribute('data-save-profile')) {
        const name = document.getElementById('accountName').value;
        const email = document.getElementById('accountEmail').value;
        const signature = document.getElementById('accountSignature').value;
        const avatar = state.avatarDraft ?? state.settings.profile.avatar;
        state.settings = await api.saveProfile(name, email, signature, avatar);
        state.avatarDraft = null;
        toast('用户资料已保存');
        render();
      } else if (button.hasAttribute('data-save-ai-key')) {
        const provider = button.dataset.saveAiKey;
        const key = document.getElementById(`${provider}Key`).value;
        state.ai = await api.saveAiKey(provider, key);
        toast(`${provider === 'openai' ? 'OpenAI' : 'DeepSeek'} 密钥已保存`);
        render();
      } else if (button.hasAttribute('data-demo-reset')) {
        await api.resetDemo();
      } else if (button.hasAttribute('data-choose-avatar')) {
        document.getElementById('avatarFile').click();
      } else if (button.dataset.openLink) {
        event.preventDefault();
        await api.openLink(button.dataset.openLink);
      }
    } catch (error) { toast(error.message); }
  });
  document.addEventListener('keydown', async event => {
    if (!state.capturingShortcut) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') { state.capturingShortcut = false; render(); return; }
    if (!/^Key[A-Z]$/.test(event.code) || event.metaKey || (!event.ctrlKey && !event.altKey)) return;
    const chord = [...(event.ctrlKey ? ['Ctrl'] : []), ...(event.altKey ? ['Alt'] : []), ...(event.shiftKey ? ['Shift'] : []), event.code.slice(3)].join('+');
    try {
      state.settings = await api.setTyporaShortcut(chord);
      state.capturingShortcut = false;
      render();
      toast('Typora 快捷键已更新；首次唤起的自定义命令也请设为同一组合键');
    } catch (error) { toast(error.message); }
  }, true);
  document.addEventListener('submit', async event => {
    if (!['dailyReviewForm', 'reviewReminderForm'].includes(event.target.id)) return;
    event.preventDefault();
    try {
      if (event.target.id === 'reviewReminderForm') {
        await api.saveReviewReminder(document.getElementById('reviewReminderTime').value);
        await refresh(); toast('复盘提示时间已保存');
      } else {
        const input = document.getElementById('dailyReviewInput');
        const text = input.value.trim(); if (!text) return;
        await api.askDailyReview(state.reviewDate, text); await refresh();
        const timeline = document.getElementById('reviewTimeline'); timeline.scrollTop = timeline.scrollHeight;
      }
    } catch (error) { toast(error.message); }
  });
  document.addEventListener('input', event => {
    if (event.target.id === 'sourceSearch') {
      state.search = event.target.value;
      document.getElementById('sourceList').innerHTML = libraryList();
    }
  });
  document.addEventListener('change', async event => {
    if (event.target.dataset.provider) {
      try {
        state.ai = await api.setAiProvider(event.target.dataset.provider);
        render();
        toast(`已选择 ${state.ai.provider === 'openai' ? 'OpenAI' : 'DeepSeek'} 回答`);
      } catch (error) { toast(error.message); }
    } else if (event.target.id === 'avatarFile') {
      const file = event.target.files?.[0];
      if (!file) return;
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 1_000_000) { toast('请选择 1 MB 内的 PNG、JPG 或 WebP 图片'); return; }
      state.avatarDraft = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
      document.getElementById('profileAvatarPreview').innerHTML = `<img src="${esc(state.avatarDraft)}" alt="用户头像">`;
    }
  });
  window.addEventListener('resize', () => { if (state.page === 'saved') requestAnimationFrame(layoutMasonry); });
  document.getElementById('minimizeWindow').onclick = api.minimize;
  document.getElementById('maximizeWindow').onclick = api.maximize;
  document.getElementById('closeWindow').onclick = api.close;
  window.viaAuthUi?.configure(() => refresh().catch(error => toast(error.message)));
  api.onChanged(() => refresh().catch(error => toast(error.message)));
  refresh().catch(error => toast(`无法读取本机资料：${error.message}`));
})();
