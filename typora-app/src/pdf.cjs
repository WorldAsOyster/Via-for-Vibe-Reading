'use strict';

const MarkdownIt = require('markdown-it');
const searchEvidence = require('./shared/search-evidence.js');

const markdown = new MarkdownIt({ html: false, linkify: false, typographer: true });
const messageMarkdown = new MarkdownIt({ html: false, breaks: true }).disable(['image', 'link', 'autolink']);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[character]));

function printMessages(comment) {
  return (comment.messages || []).map(message => {
    const name = message.role === 'via' ? 'Via' : '用户';
    const body = message.status === 'pending' ? '正在回复…' : message.text || '';
    return `<div class="message"><strong>${name}</strong><div class="message-body">${messageMarkdown.render(body)}</div>${message.source ? `<small>${escapeHtml(message.source)}</small>` : ''}${searchEvidence.html(message)}</div>`;
  }).join('');
}

function printAnnotation(comment, number) {
  return `<article class="annotation"><div class="annotation-title">批注 ${number}${comment.saved ? ' · ★ 收藏' : ''}</div><div class="quote">“${escapeHtml(comment.quote)}”</div>${printMessages(comment)}</article>`;
}

function splitBlocks(content) {
  let cursor = 0;
  return content.split(/\r?\n\s*\r?\n/).filter(Boolean).map(raw => {
    const start = content.indexOf(raw, cursor);
    cursor = start + raw.length;
    return { raw, start, end: cursor, comments: [] };
  });
}

function findOffset(content, comment) {
  const quote = String(comment.quote || '');
  if (!quote) return -1;
  const previous = comment.anchor?.offset;
  if (Number.isInteger(previous) && content.slice(previous, previous + quote.length) === quote) return previous;
  const first = content.indexOf(quote);
  if (first >= 0 && content.indexOf(quote, first + quote.length) < 0) return first;
  // Web pages often repeat a short phrase. Use saved neighboring text only
  // when it identifies exactly one occurrence; never place a guess in PDF.
  const context = String(comment.contextSnapshot || '').trim();
  if (context && context.includes(quote)) {
    const contextAt = content.indexOf(context);
    const quoteAt = context.indexOf(quote);
    if (contextAt >= 0 && content.indexOf(context, contextAt + context.length) < 0 &&
        context.indexOf(quote, quoteAt + quote.length) < 0) return contextAt + quoteAt;
  }
  // Readability can normalize spaces differently from the user's selection.
  const mapped = [];
  let normalized = '';
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (/\s/.test(character)) {
      if (normalized && !normalized.endsWith(' ')) { mapped.push(index); normalized += ' '; }
    } else { mapped.push(index); normalized += character; }
  }
  const normalizedQuote = quote.replace(/\s+/g, ' ').trim();
  const normalizedContext = context.replace(/\s+/g, ' ').trim();
  if (!normalizedQuote) return -1;
  const quoteMatch = normalized.indexOf(normalizedQuote);
  if (quoteMatch >= 0 && normalized.indexOf(normalizedQuote, quoteMatch + normalizedQuote.length) < 0) return mapped[quoteMatch];
  if (!normalizedContext || !normalizedContext.includes(normalizedQuote)) return -1;
  const contextMatch = normalized.indexOf(normalizedContext);
  if (contextMatch < 0 || normalized.indexOf(normalizedContext, contextMatch + normalizedContext.length) >= 0) return -1;
  const withinContext = normalizedContext.indexOf(normalizedQuote);
  if (normalizedContext.indexOf(normalizedQuote, withinContext + normalizedQuote.length) >= 0) return -1;
  return mapped[contextMatch + withinContext];
}

function buildPdfHtml(name, content, comments, options = {}) {
  comments = require('./shared/export-scope.js').forPerson(comments, options.person);
  const blocks = splitBlocks(content);
  const unplaced = [];
  (comments || []).forEach((comment, index) => {
    const offset = findOffset(content, comment);
    const block = blocks.find(item => item.start <= offset && offset < item.end);
    if (block) block.comments.push({ comment, number: index + 1 });
    else unplaced.push({ comment, number: index + 1 });
  });
  const rows = blocks.map(block => `<div class="row"><div class="source">${options.plainText ? `<p>${escapeHtml(block.raw).replace(/\r?\n/g, '<br>')}</p>` : markdown.render(block.raw)}</div><div class="notes">${block.comments.map(item => printAnnotation(item.comment, item.number)).join('')}</div></div>`).join('');
  const missing = unplaced.length ? `<section class="unplaced"><h2>未能可靠定位到原文的批注</h2>${unplaced.map(item => printAnnotation(item.comment, item.number)).join('')}</section>` : '';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>批注-${escapeHtml(name)}</title><style>
    *{box-sizing:border-box}body{margin:0;background:#e7efea;color:#24372f;font:14px/1.65 "Segoe UI","Microsoft YaHei",sans-serif}.toolbar{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:16px;background:#fff;padding:13px 24px;border-bottom:1px solid #dce7df}.toolbar span{color:#81968a;font-size:12px}.toolbar button{margin-left:auto;background:#178a77;color:#fff;border:0;border-radius:7px;padding:8px 13px;cursor:pointer}.sheet{width:min(1120px,calc(100% - 36px));margin:22px auto 40px;padding:34px 38px;background:#fff;box-shadow:0 10px 34px #1b523520}.head{display:flex;justify-content:space-between;gap:16px;border-bottom:1px solid #dce9df;padding-bottom:12px;margin-bottom:24px}.head strong{font-size:17px}.head small{color:#84998c}.row{display:grid;grid-template-columns:minmax(0,1.65fr) minmax(0,1fr);gap:22px;align-items:start;break-inside:avoid-page}.source{min-width:0;font-family:"Songti SC","SimSun",serif;overflow-wrap:anywhere}.source h1{font-size:24px}.source h2{font-size:18px}.source p,.source li{font-size:13px;line-height:1.85}.source pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f7f9f7;padding:8px}.source img{max-width:100%}.source table{border-collapse:collapse;width:100%}.source td,.source th{border:1px solid #dce7df;padding:4px}.notes{min-width:0}.annotation{border:1px solid #cfe6d9;border-left:3px solid #218e74;border-radius:7px;padding:10px 12px;margin:0 0 12px;overflow-wrap:anywhere;break-inside:avoid-page}.annotation-title{font-weight:700;color:#15836b}.quote{font-size:12px;color:#6f8979;margin:5px 0}.message{border-top:1px solid #e9eee9;padding-top:6px;margin-top:7px}.message strong{font-size:11px}.message p{white-space:pre-wrap;margin:3px 0;font-size:11px}.message small{color:#8aa096;font-size:10px}.unplaced{border-top:1px solid #dce7df;margin-top:24px;padding-top:12px}.unplaced h2{font-size:15px}@media print{@page{size:A4 landscape;margin:12mm}body{background:#fff}.toolbar{display:none}.sheet{width:auto;margin:0;padding:0;box-shadow:none}.row{gap:6mm}}
  </style></head><body><div class="toolbar"><strong>原文与批注 · PDF 预览</strong><span>批注排在对应段落旁</span><button id="save">保存为 PDF</button></div><main class="sheet"><div class="head"><strong>批注-${escapeHtml(name)}</strong><small>${(comments || []).length} 条批注</small></div>${rows}${missing}</main><script>document.getElementById('save').onclick=async()=>{const button=document.getElementById('save');button.disabled=true;try{await window.viaPdf.save();}finally{button.disabled=false;}};</script></body></html>`;
}

module.exports = { buildPdfHtml, findOffset };
