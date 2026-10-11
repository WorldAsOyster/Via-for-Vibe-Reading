(() => {
  'use strict';

  const messageMarkdown = window.markdownit({ html: false, breaks: true }).disable(['image', 'link', 'autolink']);
  const state = { document: null, comments: [], recap: null, tab: 'notes', composer: null, locatingCommentId: null, aiConfigured: false, aiProvider: 'deepseek' };
  const content = document.getElementById('content');
  const composer = document.getElementById('composer');
  const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
  const timeLabel = value => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '';
  const mentions = text => [...String(text || '').matchAll(/@([\p{L}\p{N}_-]+)/gu)].map(match => match[1]);
  const asksVia = text => mentions(text).some(name => name.toLowerCase() === 'via');
  const isSaveOnly = text => /^(?:收藏|保存)(?:一下)?(?:这段|这句|这个)?(?:文字|原文|内容|话)?$/.test(String(text || '').trim().replace(/^@Via\s*/i, '').replace(/[。！!]+$/g, '').replace(/\s+/g, ''));
  let exportPerson = null;
  let saveChain = Promise.resolve();
  let toastTimer;
  const expandedSources = new Set();
  const collapsedAnswers = new Set();

  function toast(message) {
    const element = document.getElementById('toast');
    element.textContent = String(message);
    element.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.classList.remove('show'), 3200);
  }

  function closeOverlays() {
    document.querySelectorAll('.overlay').forEach(element => element.classList.remove('open'));
  }

  function matchingOffsets(quote) {
    const source = state.document?.content || '';
    if (!quote) return [];
    const offsets = [];
    let start = 0;
    while (offsets.length <= 50) {
      const offset = source.indexOf(quote, start);
      if (offset < 0) break;
      offsets.push(offset);
      start = offset + quote.length;
    }
    if (offsets.length) return offsets;

    // Typora exposes rendered text while Via reads the Markdown source. Match
    // across line wrapping and inline Markdown markers, while retaining the
    // original source offset for anchoring.
    const compact = (value, withMap = false) => {
      let text = '';
      const map = [];
      for (let index = 0; index < value.length; index++) {
        const character = value[index];
        if (/\s|[\u200B-\u200D\uFEFF]/u.test(character) || /[*_~`]/.test(character)) continue;
        text += character;
        if (withMap) map.push(index);
      }
      return { text, map };
    };
    const normalizedSource = compact(source, true);
    const normalizedQuote = compact(String(quote)).text;
    if (!normalizedQuote) return [];
    let normalizedStart = 0;
    while (offsets.length <= 50) {
      const offset = normalizedSource.text.indexOf(normalizedQuote, normalizedStart);
      if (offset < 0) break;
      offsets.push(normalizedSource.map[offset]);
      normalizedStart = offset + normalizedQuote.length;
    }
    return offsets;
  }

  function anchorFor(quote) {
    const offsets = matchingOffsets(quote);
    if (!offsets.length) return { status: 'missing', offset: null };
    if (offsets.length > 1) return { status: 'ambiguous', offset: null };
    return { status: 'located', offset: offsets[0] };
  }

  function anchorChoices(quote, selectId = 'anchorChoice') {
    const offsets = matchingOffsets(quote);
    if (offsets.length <= 1) return '';
    if (offsets.length > 50) return '<span class="anchor-warning">这段引用出现超过 50 次，请扩大引用范围。</span>';
    const source = state.document.content;
    const options = offsets.map((offset, index) => {
      const before = source.slice(Math.max(0, offset - 34), offset).replace(/\s+/g, ' ');
      const after = source.slice(offset + quote.length, offset + quote.length + 34).replace(/\s+/g, ' ');
      return `<option value="${offset}">第 ${index + 1} 处 · …${escape(before)}【${escape(quote)}】${escape(after)}…</option>`;
    }).join('');
    return `<label class="anchor-choice-label">原文出现多次，请选择这条批注的位置<select class="anchor-choice" id="${escape(selectId)}"><option value="">选择原文位置</option>${options}</select></label>`;
  }

  function anchorState(comment) {
    const quote = String(comment.quote || '');
    const offsets = matchingOffsets(quote);
    if (Number.isInteger(comment.anchor?.offset) && offsets.includes(comment.anchor.offset)) {
      return { status: 'located', offset: comment.anchor.offset };
    }
    if (!offsets.length) return { status: 'missing', offset: null };
    if (offsets.length > 1) return { status: 'ambiguous', offset: null };
    return { status: 'located', offset: offsets[0] };
  }

  async function refreshSource() {
    if (!state.document) return;
    const documentPath = state.document.documentPath;
    await saveChain;
    const latest = await window.via.openDocument(documentPath);
    if (state.document.documentPath !== documentPath) throw new Error('文档已切换，请重试');
    state.document.content = latest.content;
    for (const comment of state.comments) {
      const anchor = anchorState(comment);
      if (anchor.status === 'located') comment.anchor = anchor;
    }
  }

  function relocationForm(comment) {
    return `<div class="anchor-choices anchor-repair"><p>先在 Typora 按 Ctrl+S 保存，再刷新原文。引用已改动时，粘贴新的原文并选择位置；确认后将更新这条批注的引用，问答保留。</p><button class="ghost" data-action="refresh-anchor" data-id="${escape(comment.id)}">刷新已保存原文</button><label class="anchor-choice-label">用于重新定位的引用<textarea class="anchor-replacement" data-anchor-id="${escape(comment.id)}" maxlength="1000">${escape(comment.quote)}</textarea></label><div class="repair-options">${anchorChoices(comment.quote, `anchor-${comment.id}`)}</div><button class="ghost" data-action="set-anchor" data-id="${escape(comment.id)}">确认引用与位置</button></div>`;
  }

  function contextFor(comment) {
    const anchor = anchorState(comment);
    const source = state.document.content;
    if (anchor.status === 'ambiguous') {
      const candidates = matchingOffsets(comment.quote).slice(0, 6);
      return `这段引用在原文中出现多次，尚未选定具体位置。候选上下文：\n${candidates.map((offset, index) => `${index + 1}. ${source.slice(Math.max(0, offset - 180), Math.min(source.length, offset + comment.quote.length + 180))}`).join('\n')}`;
    }
    if (anchor.status !== 'located') return comment.quote;
    const start = Math.max(0, anchor.offset - 1200);
    const end = Math.min(source.length, anchor.offset + comment.quote.length + 1200);
    return source.slice(start, end);
  }

  function buildRecap() {
    const material = state.comments.map(item => `${item.quote} ${item.messages.filter(message => message.role === 'user').map(message => message.text).join(' ')}`).join(' ');
    const north = /北极星|指标|有效协作/.test(material);
    const attribution = /归因|触达|转化率/.test(material);
    const topics = [north ? '指标定义与有效协作' : '', attribution ? '归因与转化口径' : ''].filter(Boolean);
    const recommendations = [];
    if (north) recommendations.push(
      { title: '北极星指标框架：如何找到代表用户价值的指标', source: 'Amplitude · North Star Playbook', url: 'https://amplitude.com/books/north-star/about-north-star-framework' },
      { title: '如何清楚定义北极星指标与输入指标', source: 'Amplitude · North Star Playbook', url: 'https://amplitude.com/books/north-star/defining-your-North-Star' }
    );
    if (attribution) recommendations.push({ title: '归因窗口如何影响转化归属', source: 'Google Analytics 帮助', url: 'https://support.google.com/analytics/answer/16291704?hl=en' });
    return { topics, recommendations, generatedAt: new Date().toISOString(), kind: 'keyword-demo' };
  }

  function persist() {
    if (!state.document) return Promise.resolve();
    state.recap = buildRecap();
    const payload = {
      documentPath: state.document.documentPath,
      comments: structuredClone(state.comments),
      recap: structuredClone(state.recap)
    };
    const job = saveChain.catch(() => {}).then(() => window.via.saveRecord(payload));
    saveChain = job;
    job.catch(error => toast(`保存失败：${error.message}`));
    return job;
  }

  async function loadDocument(payload) {
    if (!payload) return;
    await saveChain.catch(() => {});
    state.document = payload;
    state.comments = Array.isArray(payload.record?.comments) ? structuredClone(payload.record.comments) : [];
    state.recap = payload.record?.recap || null;
    state.tab = 'notes';
    state.composer = null;
    state.locatingCommentId = null;
    let interrupted = false;
    for (const comment of state.comments) {
      for (const message of comment.messages || []) {
        if (message.role === 'via' && message.status === 'pending') {
          message.status = 'interrupted';
          message.text = '上次回复中断，可点击重试。';
          interrupted = true;
        }
        if (message.role === 'via' && message.status === 'error' && /safeStorage\.decryptString|Error while decrypting the ciphertext/.test(message.text || '')) {
          message.status = 'needs-key';
          message.text = '本机保存的 DeepSeek 密钥无法解密。请到 Via 主界面「设置」重新保存，再点击重试回答。';
          interrupted = true;
        }
      }
    }
    if (interrupted) await persist().catch(() => {});
    if (payload.selectedText) {
      if (payload.selectedText.length <= 180) state.composer = { type: 'new', quote: payload.selectedText, text: '@Via ' };
      else toast('选区超过 180 字，请在 Typora 中缩短选区后重试');
    }
    render();
    if (state.composer?.type === 'new') {
      requestAnimationFrame(() => {
        const input = document.getElementById('messageInput');
        input?.focus();
        input?.setSelectionRange(input.value.length, input.value.length);
      });
    }
  }

  function questionCount() {
    const userMessages = state.comments.flatMap(comment => comment.messages || []).filter(message => message.role === 'user');
    const pending = state.comments.flatMap(comment => comment.messages || []).filter(message => message.role === 'via' && message.status === 'pending');
    return `${pending.length}/${userMessages.length}`;
  }

  function renderMessage(comment, message) {
    const isVia = message.role === 'via';
    const status = message.status || 'complete';
    const body = status === 'pending' ? '正在回复…' : message.text || '';
    const retry = isVia && ['error', 'interrupted', 'needs-key'].includes(status)
      ? `<button data-action="retry" data-id="${escape(comment.id)}" data-message="${escape(message.id)}">重试回答</button>` : '';
    const expanded = expandedSources.has(message.id);
    const canCollapse = isVia && status === 'answered' && (message.search || (message.citations || []).length) && (body.length > 320 || (message.citations || []).length > 3);
    const collapsed = canCollapse && collapsedAnswers.has(message.id);
    const sourceDetail = expanded ? `<div class="source-detail">对应原文：${escape(contextFor(comment).slice(0, 650))}</div>` : '';
    return `<div class="message ${status === 'pending' ? 'pending' : ''} ${['error', 'needs-key'].includes(status) ? 'error' : ''}">
      <div class="message-header"><span class="avatar ${isVia ? 'via' : ''}">${isVia ? 'v' : '我'}</span><strong>${isVia ? message.localAction === 'saved' ? 'Via' : ['demo', 'example'].includes(message.model) ? 'Via · 示例' : `Via · ${message.provider === 'openai' || message.model?.startsWith('gpt-') ? 'OpenAI' : message.provider === 'deepseek' || message.model ? 'DeepSeek' : state.aiProvider === 'openai' ? 'OpenAI' : 'DeepSeek'}` : '我'}</strong><time>${escape(timeLabel(message.createdAt))}</time></div>
      <div class="answer-content" ${collapsed ? 'hidden' : ''}><div class="message-body markdown-body">${messageMarkdown.render(body)}</div>${isVia ? window.viaSearchEvidence.html(message) : ""}${message.source ? `<div class="source-row"><span class="source">${escape(message.source)}</span><button data-action="toggle-source" data-message="${escape(message.id)}" title="${expanded ? '收起' : '展开'}依据">${expanded ? '⌃' : '⌄'}</button></div>${sourceDetail}` : ''}</div>
      ${canCollapse ? `<button class="answer-collapse" data-action="toggle-answer" data-message="${escape(message.id)}" aria-expanded="${!collapsed}">${collapsed ? '展开回答' : '收起回答'}</button>` : ''}
      <div class="message-actions">${retry}<button data-action="reply" data-id="${escape(comment.id)}" data-message="${escape(message.id)}">回复</button><button data-action="edit" data-id="${escape(comment.id)}" data-message="${escape(message.id)}">编辑</button><button data-action="delete-message" data-id="${escape(comment.id)}" data-message="${escape(message.id)}">删除</button></div>
    </div>`;
  }

  function renderNotes() {
    if (!state.document) return `<div class="empty"><h2>从 Typora 开始批注</h2><p>选择一份 Markdown 文档。配置 Typora 快捷命令后，按所设快捷键可按相同路径找回批注。</p><button class="primary" data-action="choose">选择文档</button></div>`;
    const cards = state.comments.map(comment => {
      const anchor = anchorState(comment);
      const warning = anchor.status === 'ambiguous' ? '原文出现多次，请选择对应位置' : anchor.status === 'missing' ? '原文已变化，需重新定位' : '';
      return `<article class="note-card ${warning ? 'needs-anchor' : ''}" data-card="${escape(comment.id)}">
        <div class="note-top"><div><span class="quote">${escape(comment.quote)}</span>${warning ? `<span class="anchor-warning">${warning} · <button class="anchor-link" data-action="locate" data-id="${escape(comment.id)}">重新定位</button></span>` : ''}</div>
        <div class="card-actions"><button class="icon-btn ${comment.saved ? 'active' : ''}" data-action="save" data-id="${escape(comment.id)}" title="${comment.saved ? '取消收藏' : '收藏'}" aria-label="${comment.saved ? '取消收藏' : '收藏'}">★</button><button class="icon-btn resolve-icon" data-action="resolve" data-id="${escape(comment.id)}" title="解决并移除" aria-label="解决并移除"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.2"/><path d="m6.5 10 2.4 2.4 4.6-4.8"/></svg></button></div></div>
        ${state.locatingCommentId === comment.id ? relocationForm(comment) : ''}
        ${(comment.messages || []).map(message => renderMessage(comment, message)).join('')}
      </article>`;
    }).join('');
    return cards || '<div class="empty">尚无批注。请在 Typora 中选中文字并按所设快捷键。</div>';
  }

  function todoGroups() {
    const groups = new Map();
    for (const comment of state.comments) {
      for (const message of comment.messages || []) {
        if (message.role !== 'user') continue;
        for (const name of mentions(message.text)) {
          if (name.toLowerCase() === 'via') continue;
          if (!groups.has(name)) groups.set(name, []);
          groups.get(name).push({ comment, message });
        }
      }
    }
    return groups;
  }

  function renderReview() {
    if (!state.document) return `<div class="empty">请先选择文档。</div>`;
    const recap = state.recap || buildRecap();
    const groups = todoGroups();
    const saved = state.comments.filter(comment => comment.saved);
    const recommendations = recap.recommendations.map(link => `<a class="review-link" href="${escape(link.url)}" target="_blank" rel="noopener noreferrer">${escape(link.title)} ↗<small>${escape(link.source)} · 公开资料</small></a>`).join('');
    const todos = [...groups.entries()].map(([name, items]) => `<div class="review-person"><strong>@${escape(name)} · ${items.length} 条</strong><button data-action="export-person" data-person="${escape(name)}">按人导出 ↓</button></div>${items.map(item => `<div class="review-row"><strong>“${escape(item.comment.quote)}”</strong><span>${escape(item.message.text)}</span></div>`).join('')}`).join('');
    const savedHtml = saved.map(comment => `<div class="review-row"><strong>“${escape(comment.quote)}”</strong><span>${escape((comment.messages || []).map(message => `${message.role === 'via' ? 'Via' : '我'}：${message.text || ''}`).join('\n'))}</span></div>`).join('');
    return `<section class="review-card"><div class="review-count">${state.comments.length}<small>批注数</small></div><div><p class="review-lead">${recap.topics.length ? `你主要询问了「${escape(recap.topics.join('、'))}」相关的问题。` : '目前的问题尚不足以识别稳定主题。'}</p>${recommendations || '<p class="review-hint">暂无相关阅读推荐。</p>'}<p class="review-hint">推荐基于关键词；个人知识库尚未连接。</p></div></section>
      <section class="review-card"><div class="review-count">${[...groups.values()].reduce((sum, items) => sum + items.length, 0)}<small>待办数</small></div><div><p class="review-lead">按被 @ 的人或其他 AI 汇总</p>${todos || '<p class="review-hint">目前没有给他人或其他 AI 的待办。</p>'}</div></section>
      <section class="review-card"><div class="review-count">${saved.length}<small>收藏数</small></div><div><p class="review-lead">你收藏的批注与回复</p>${savedHtml || '<p class="review-hint">还没有收藏的批注。</p>'}</div></section>`;
  }

  function renderComposer() {
    const draft = state.composer;
    if (!draft || state.tab !== 'notes') { composer.innerHTML = ''; return; }
    const isNew = draft.type === 'new';
    const title = isNew ? '引用原文并批注' : draft.type === 'edit' ? '编辑消息' : '继续讨论';
    composer.innerHTML = `<div class="composer-title"><span>${title}</span><button data-action="cancel-compose" title="取消">×</button></div>
      ${isNew ? `<input class="quote-field" id="quoteInput" maxlength="180" value="${escape(draft.quote || '')}" placeholder="输入或粘贴被引原文（最多 180 字）">` : ''}
      ${isNew ? `<div id="anchorChoiceSlot">${anchorChoices(draft.quote || '')}</div>` : ''}
      <textarea id="messageInput" placeholder="写下你的问题或批注；@Via 会请求当前选择的 AI 回答">${escape(draft.text || '')}</textarea>
      <label class="search-option"><input id="searchEnabled" type="checkbox" ${draft.search ? 'checked' : ''}>联网搜索<span title="检索问题会发送给所选 AI 或搜索服务，可能产生额外 API 费用。可用服务以主界面设置为准。">ⓘ</span></label>
      <div class="composer-bottom"><small>Ctrl+Enter 提交</small><span class="composer-actions">${isNew ? '<button class="ghost" data-action="save-quote">只收藏文字</button>' : ''}<button class="primary" data-action="submit">${draft.type === 'edit' ? '保存修改' : '提交批注'}</button></span></div>`;
  }

  function render() {
    document.getElementById('documentTitle').textContent = state.document ? `批注-${state.document.name}` : 'Via · Typora';
    document.getElementById('documentTitle').title = state.document ? `批注-${state.document.name}` : 'Via';
    document.getElementById('questionCount').textContent = questionCount();
    document.querySelectorAll('[data-tab]').forEach(button => button.classList.toggle('active', button.dataset.tab === state.tab));
    content.innerHTML = state.tab === 'notes' ? renderNotes() : renderReview();
    renderComposer();
  }

  function startNew(quote = '') {
    if (!state.document) { toast('请先选择文档'); return; }
    state.tab = 'notes';
    state.composer = { type: 'new', quote, text: '@Via ' };
    render();
    document.getElementById(quote ? 'messageInput' : 'quoteInput')?.focus();
  }

  async function runAnswer(commentId, answerId) {
    const documentPath = state.document?.documentPath;
    const comment = state.comments.find(item => item.id === commentId);
    const answer = comment?.messages.find(item => item.id === answerId);
    if (!comment || !answer) return;
    if (!state.aiConfigured) {
      answer.status = 'needs-key';
      answer.text = '请先在 Via 主界面「设置」配置当前选择的 AI 密钥，再点击重试回答。';
      await persist().catch(() => {});
      render();
      return;
    }
    answer.status = 'pending';
    answer.provider = state.aiProvider;
    answer.text = '';
    render();
    await persist().catch(() => {});
    const index = comment.messages.indexOf(answer);
    try {
      const result = await window.via.answer({
        documentPath,
        quote: comment.quote,
        search: answer.searchRequested === true,
        context: contextFor(comment),
        messages: comment.messages.slice(0, index).filter(message => message.status !== 'pending')
      });
      if (state.document?.documentPath !== documentPath || !state.comments.includes(comment) || answer.status !== 'pending') return;
      answer.text = result.text;
      answer.source = result.source;
      answer.model = result.model;
      answer.search = result.search;
      answer.citations = result.citations || [];
      answer.status = 'answered';
      answer.createdAt = new Date().toISOString();
      await persist();
    } catch (error) {
      if (state.document?.documentPath !== documentPath || !state.comments.includes(comment)) return;
      answer.status = 'error';
      answer.text = /safeStorage\.decryptString|Error while decrypting the ciphertext/.test(error.message)
        ? '本机保存的 DeepSeek 密钥无法解密。请到 Via 主界面「设置」重新保存，再点击重试回答。'
        : error.message.replace(/^Error invoking remote method '[^']+': Error:\s*/, '');
      await persist().catch(() => {});
    }
    render();
  }

  async function submit() {
    if (!state.document || !state.composer) return;
    const draft = state.composer;
    const text = document.getElementById('messageInput')?.value.trim() || '';
    if (!text) { toast('请填写批注内容'); return; }
    const now = new Date().toISOString();
    let comment;
    let answer;
    const saveOnly = isSaveOnly(text);
    const searchRequested = !saveOnly && document.getElementById('searchEnabled')?.checked === true;
    if (draft.type === 'new') {
      const quote = document.getElementById('quoteInput')?.value.trim() || '';
      if (!quote || quote.length > 180) { toast('引用原文需填写且不超过 180 字'); return; }
      const offsets = matchingOffsets(quote);
      let anchor = anchorFor(quote);
      if (offsets.length > 1) {
        const chosen = document.getElementById('anchorChoice')?.value;
        if (chosen === undefined || chosen === '' || !offsets.includes(Number(chosen))) {
          toast('这段原文出现多次，请先选择引用位置；出现次数过多时请扩大引用范围');
          return;
        }
        anchor = { status: 'located', offset: Number(chosen) };
      }
      comment = { id: crypto.randomUUID(), quote, anchor, createdAt: now, saved: false, messages: [] };
      state.comments.push(comment);
      comment.messages.push({ id: crypto.randomUUID(), role: 'user', text, createdAt: now, status: 'complete' });
    } else if (draft.type === 'reply') {
      comment = state.comments.find(item => item.id === draft.commentId);
      if (!comment) return;
      comment.messages.push({ id: crypto.randomUUID(), role: 'user', text, createdAt: now, status: 'complete', replyTo: draft.messageId || null });
    } else if (draft.type === 'edit') {
      comment = state.comments.find(item => item.id === draft.commentId);
      const message = comment?.messages.find(item => item.id === draft.messageId);
      if (!message) return;
      message.text = text;
      message.editedAt = now;
      if (message.role === 'user') {
        comment.messages = comment.messages.filter(item => item.replyTo !== message.id || item.role !== 'via');
        if (asksVia(text) || saveOnly) {
          answer = { id: crypto.randomUUID(), role: 'via', text: saveOnly ? '已收藏' : '', createdAt: now, status: saveOnly ? 'answered' : 'pending', replyTo: message.id, ...(saveOnly ? { localAction: 'saved' } : {}) };
          const questionIndex = comment.messages.findIndex(item => item.id === message.id);
          comment.messages.splice(questionIndex + 1, 0, answer);
        }
      }
    }
    if (draft.type !== 'edit' && (asksVia(text) || saveOnly)) {
      const lastUser = comment.messages[comment.messages.length - 1];
      answer = { id: crypto.randomUUID(), role: 'via', text: saveOnly ? '已收藏' : '', createdAt: now, status: saveOnly ? 'answered' : 'pending', replyTo: lastUser.id, ...(saveOnly ? { localAction: 'saved' } : {}) };
    }
    if (answer) answer.searchRequested = searchRequested;
    if (answer && draft.type !== 'edit') comment.messages.push(answer);
    if (saveOnly) {
      comment.saved = true;
      comment.savedAt = now;
      comment.contextSnapshot = contextFor(comment).slice(0, 450);
    }
    state.composer = null;
    render();
    await persist().catch(() => {});
    if (answer && !saveOnly) runAnswer(comment.id, answer.id);
  }

  function threadMarkdown(comment, index) {
    const lines = [`## 批注 ${index} · ${comment.quote}`, '', `> ${comment.quote}`, ''];
    for (const message of comment.messages || []) {
      lines.push(`**${message.role === 'via' ? 'Via' : '我'} · ${timeLabel(message.createdAt)}**`, '', message.text || (message.status === 'pending' ? '正在回复…' : ''), '');
      if (message.source) lines.push(`_来源：${message.source}_`, '');
      if (message.role === 'via') lines.push(window.viaSearchEvidence.markdown(message), '');
    }
    return lines.join('\n');
  }

  function exportBody(person = null) {
    const comments = window.viaExportScope.forPerson(state.comments, person);
    return [`# 批注-${state.document.name}`, '', `来源：${state.document.documentPath}`, '', ...comments.map((comment, index) => threadMarkdown(comment, index + 1))].join('\n');
  }

  async function exportMarkdown(person = null) {
    if (!state.document) return;
    try {
      const saved = await window.via.exportMarkdown({ documentPath: state.document.documentPath, body: exportBody(person) });
      if (saved) toast('Markdown 已保存');
    } catch (error) { toast(error.message); }
  }

  async function handleAction(button) {
    const action = button.dataset.action;
    const id = button.dataset.id;
    const comment = state.comments.find(item => item.id === id);
    const message = comment?.messages.find(item => item.id === button.dataset.message);
    if (action === 'choose') {
      try { await loadDocument(await window.via.chooseDocument()); } catch (error) { toast(error.message); }
    } else if (action === 'new') startNew();
    else if (action === 'save-quote') {
      const input = document.getElementById('messageInput');
      if (input) input.value = '@Via 收藏这段文字';
      await submit();
    }
    else if (action === 'cancel-compose') { state.composer = null; render(); }
    else if (action === 'submit') await submit();
    else if (action === 'save' && comment) {
      comment.saved = !comment.saved;
      if (comment.saved) {
        comment.savedAt = new Date().toISOString();
        const context = contextFor(comment).slice(0, 450);
        comment.contextSnapshot = context === comment.quote ? '' : context;
      }
      await persist();
      render();
    }
    else if (action === 'locate' && comment) {
      state.locatingCommentId = state.locatingCommentId === comment.id ? null : comment.id;
      render();
    }
    else if (action === 'refresh-anchor' && comment) {
      try {
        await refreshSource();
        await persist();
        if (anchorState(comment).status === 'located') state.locatingCommentId = null;
        render();
        toast(anchorState(comment).status === 'located' ? '已按最新原文重新定位' : '已刷新。请粘贴当前原文并确认位置；未保存的文字需先在 Typora 保存。');
      } catch (error) { toast(error.message); }
    }
    else if (action === 'set-anchor' && comment) {
      const form = button.closest('.anchor-choices');
      const quote = form.querySelector('textarea').value.trim();
      const chosen = form.querySelector('select')?.value;
      try { await refreshSource(); } catch (error) { toast(error.message); return; }
      const offsets = matchingOffsets(quote);
      const offset = offsets.length === 1 ? offsets[0] : chosen !== '' && chosen !== undefined ? Number(chosen) : null;
      if (!offsets.includes(offset)) {
        toast(offsets.length ? '请选择正确的原文位置' : '已保存原文中找不到这段引用。请先在 Typora 保存，再粘贴当前原文。');
        return;
      }
      comment.quote = quote;
      comment.anchor = { status: 'located', offset };
      if (comment.saved) comment.contextSnapshot = contextFor(comment).slice(0, 450);
      state.locatingCommentId = null;
      await persist();
      render();
    }
    else if (action === 'resolve' && comment) {
      if (!confirm('解决并移除这条批注及对应收藏？此操作无法从 Via 中撤销。')) return;
      state.comments = state.comments.filter(item => item.id !== comment.id);
      state.composer = null;
      await persist();
      render();
    } else if (action === 'reply' && comment) {
      state.tab = 'notes';
      state.composer = { type: 'reply', commentId: comment.id, messageId: message?.id || null, text: message?.role === 'via' ? '@Via ' : '' };
      render();
      document.getElementById('messageInput')?.focus();
    } else if (action === 'edit' && comment && message) {
      state.tab = 'notes';
      state.composer = { type: 'edit', commentId: comment.id, messageId: message.id, text: message.text };
      render();
      document.getElementById('messageInput')?.focus();
    } else if (action === 'delete-message' && comment && message) {
      comment.messages = comment.messages.filter(item => item.id !== message.id && item.replyTo !== message.id);
      await persist();
      render();
    } else if (action === 'toggle-source') {
      const key = button.dataset.message;
      expandedSources.has(key) ? expandedSources.delete(key) : expandedSources.add(key);
      render();
    } else if (action === 'toggle-answer') {
      const key = button.dataset.message;
      collapsedAnswers.has(key) ? collapsedAnswers.delete(key) : collapsedAnswers.add(key);
      render();
    } else if (action === 'retry' && comment && message) runAnswer(comment.id, message.id);
    else if (action === 'export-person') openExport(button.dataset.person);
  }

  document.addEventListener('click', event => {
    const tab = event.target.closest('[data-tab]');
    if (tab) { state.tab = tab.dataset.tab; state.composer = null; render(); return; }
    const action = event.target.closest('[data-action]');
    if (action) { handleAction(action).catch(error => toast(error.message)); return; }
    if (event.target.matches('[data-close-overlay]') || event.target.classList.contains('overlay')) closeOverlays();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeOverlays();
    if (event.key === 'Enter' && event.ctrlKey && state.composer) { event.preventDefault(); submit().catch(error => toast(error.message)); }
  });
  document.addEventListener('input', event => {
    if (event.target.id === 'searchEnabled' && state.composer) state.composer.search = event.target.checked;
    if (event.target.matches('.anchor-replacement')) {
      event.target.closest('.anchor-choices').querySelector('.repair-options').innerHTML = anchorChoices(event.target.value.trim(), `anchor-${event.target.dataset.anchorId}`);
    }
    if (event.target.id === 'quoteInput' && state.composer?.type === 'new') {
      state.composer.quote = event.target.value;
      document.getElementById('anchorChoiceSlot').innerHTML = anchorChoices(event.target.value.trim());
    }
  });
  document.getElementById('closeWindow').onclick = window.via.closeWindow;
  document.getElementById('minimizeWindow').onclick = window.via.minimizeWindow;
  document.getElementById('openDesktop').onclick = window.via.openDesktop;
  function openExport(person = null) {
    if (!state.document) { toast('请先选择文档'); return; }
    exportPerson = person;
    const overlay = document.getElementById('exportOverlay');
    overlay.querySelector('h2').textContent = person ? `导出 @${person} 的批注` : '导出这篇文档';
    overlay.querySelector('p').textContent = person ? '只包含该对象的批注及关联问答；原文完整保留。' : '保留未解决的批注与完整问答。';
    document.getElementById('exportPdf').querySelector('strong').textContent = person ? `原文与 @${person} 的批注 · PDF` : '原文与全部批注 · PDF';
    overlay.classList.add('open');
  }
  document.getElementById('exportButton').onclick = () => openExport();
  document.getElementById('exportMarkdown').onclick = async () => { const person = exportPerson; closeOverlays(); await exportMarkdown(person); };
  document.getElementById('exportPdf').onclick = async () => {
    closeOverlays();
    try {
      await refreshSource();
      if (!state.document.content.trim()) { toast('磁盘中的文档正文为空，请先在 Typora 按 Ctrl+S 保存后再导出。'); return; }
      await persist();
      render();
      await window.via.exportPdf({ documentPath: state.document.documentPath, person: exportPerson });
    }
    catch (error) { toast(error.message); }
  };
  window.via.onLaunch(payload => loadDocument(payload).catch(error => toast(error.message)));
  window.via.onAiChanged(status => { state.aiConfigured = status.configured; state.aiProvider = status.provider || 'deepseek'; render(); });
  window.via.aiStatus().then(status => { state.aiConfigured = status.configured; state.aiProvider = status.provider || 'deepseek'; render(); }).catch(() => render());
  render();
})();
