(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.viaSearchEvidence = factory();
})(globalThis, function () {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function citations(message) {
    return (Array.isArray(message.citations) ? message.citations : []).filter(item => {
      if (typeof item?.url !== 'string' || item.url.length > 4096 || /[\u0000-\u0020]/.test(item.url)) return false;
      try { const url = new URL(item.url); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
    }).slice(0, 30);
  }
  function label(message) {
    const search = message.search;
    if (!search || search.status === 'off') return '';
    const base = { searched: '已联网检索', unavailable: '联网搜索不可用', failed: '联网搜索未完成', notUsed: '本次未使用联网搜索' }[search.status] || '搜索状态未知';
    const date = search.retrievedAt && Number.isFinite(Date.parse(search.retrievedAt)) ? ` · ${new Date(search.retrievedAt).toLocaleString('zh-CN', { hour12: false })}` : '';
    return `${base}${date}${search.message ? ` · ${search.message}` : ''}`;
  }
  function html(message) {
    const items = citations(message);
    const status = label(message);
    if (!items.length && !status) return '';
    return `<div class="search-evidence">${status ? `<p class="search-status">${escape(status)}</p>` : ''}${items.length ? `<ol>${items.map(item => `<li><a href="${escape(item.url)}" target="_blank" rel="noopener noreferrer">${escape(item.title || new URL(item.url).hostname)} ↗</a><small>${escape(new URL(item.url).hostname)}</small></li>`).join('')}</ol>` : ''}</div>`;
  }
  function markdown(message) {
    const status = label(message);
    // Plain title and angle-wrapped URLs keep provider text from injecting Markdown destinations.
    return [status, ...citations(message).map(item => `${String(item.title || '检索来源').replace(/[\r\n]/g,' ')}\n<${new URL(item.url).href.replace(/</g,'%3C').replace(/>/g,'%3E')}>`)].filter(Boolean).join('\n\n');
  }
  return { citations, label, html, markdown };
});
