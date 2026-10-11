'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPdfHtml } = require('../src/pdf.cjs');

test('PDF preview places a uniquely anchored annotation beside its paragraph', () => {
  const content = '# 标题\n\n第一段包含北极星指标。\n\n第二段。';
  const html = buildPdfHtml('增长方案.md', content, [{
    quote: '北极星指标',
    anchor: { offset: content.indexOf('北极星指标') },
    messages: [{ role: 'user', text: '如何计算？' }, { role: 'via', text: '按有效协作人数计算。' }]
  }]);
  assert.match(html, /第一段包含北极星指标/);
  assert.match(html, /批注 1/);
  assert.match(html, /如何计算？/);
  assert.doesNotMatch(html, /未能可靠定位到原文的批注/);
});

test('ambiguous quote stays in unplaced section instead of attaching to a wrong paragraph', () => {
  const html = buildPdfHtml('重复.md', '重复词。\n\n重复词。', [{ quote: '重复词', messages: [] }]);
  assert.match(html, /未能可靠定位到原文的批注/);
});

test('web article PDF uses plain text and saved context to place a repeated quote', () => {
  const content = '第一段提到有效协作。\n\n第二段明确有效协作需要邀请同事。';
  const html = buildPdfHtml('网页', content, [{ quote: '有效协作',
    contextSnapshot: '第二段明确有效协作需要邀请同事。', messages: [{ role: 'user', text: '怎么做？' }] }], { plainText: true });
  assert.doesNotMatch(html, /未能可靠定位到原文的批注/);
  assert.match(html, /第二段明确有效协作需要邀请同事。<\/p><\/div><div class="notes"><article class="annotation"/);
});

test('web article PDF escapes page content and leaves ambiguous mentions unplaced', () => {
  const html = buildPdfHtml('网页', '<script>x</script> 有效协作\n\n有效协作',
    [{ quote: '有效协作', messages: [] }], { plainText: true });
  assert.doesNotMatch(html, /<script>x<\/script>/);
  assert.match(html, /&lt;script&gt;x&lt;\/script&gt;/);
  assert.match(html, /未能可靠定位到原文的批注/);
});

test('web quote with changed whitespace still anchors beside the article block', () => {
  const html = buildPdfHtml('网页', '第一段。\n\n这段内容说明 Agent 评测的目标。',
    [{ quote: 'Agent   评测', messages: [] }], { plainText: true });
  assert.doesNotMatch(html, /未能可靠定位到原文的批注/);
});
