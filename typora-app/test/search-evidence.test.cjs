'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const evidence=require('../src/shared/search-evidence.js');
test('native search evidence is safe, retained in Markdown and PDF',()=>{
  const message={role:'via',text:'Test answer',search:{status:'searched',retrievedAt:'2026-10-09T00:00:00Z'},citations:[{title:'<img onerror=bad()>',url:'https://example.test/evidence'},{title:'bad',url:'javascript:alert(1)'},{title:'private',url:'https://user:password@example.test/'}]};
  const html=evidence.html(message);
  assert.match(html,/已联网检索/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img|javascript:|password/);
  const source={name:'test',documentPath:'https://example.test/',comments:[{id:'c',quote:'reference',messages:[message]}]};
  assert.match(require('../src/shared/search-evidence.js').markdown(message),/https:\/\/example.test\/evidence/);
  assert.match(require('../src/pdf.cjs').buildPdfHtml('test','reference',source.comments),/https:\/\/example.test\/evidence/);
  assert.match(evidence.html({search:{status:'failed',message:'网络不可用'}}),/联网搜索未完成/);
  assert.equal(evidence.html({text:'No search'}),'');
});
