'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { DailyReview, candidates, articlesFrom, dayKey } = require('../src/daily-review.cjs');
const { DocumentStore } = require('../src/store.cjs');
const { installExamples } = require('../src/onboarding.cjs');
function env(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'via-native-review-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const file = path.join(folder, 'review.md'); fs.writeFileSync(file, '重试应复用相同幂等键，避免重复创建任务。');
  const source = { id: 'source', documentPath: file, exists: true, name: 'review.md', comments: [{ id: 'c', quote: '重试应复用相同幂等键', messages: [{ id: 'q', role: 'user', text: '@Via 为什么复用幂等键？', createdAt: '2026-10-11T02:00:00Z' }, { id: 'a', role: 'via', replyTo: 'q', status: 'answered', text: '避免重复创建任务' }] }] };
  return { folder, source };
}
const question = { id: 'q', title: '如何安全重试？', options: ['复用幂等键', '更换幂等键', '忽略幂等键'], correct: 0, evidence: '重试应复用相同幂等键', explanation: '原文要求复用幂等键避免重复创建。', topic: '幂等与重试' };
test('repeated quotes require a valid stored anchor, and oversized source files are skipped', t => {
  const { folder, source } = env(t); const quote = source.comments[0].quote;
  const content = '第一处的前提\n' + quote + '\n' + '间隔'.repeat(400) + '\n第二处的前提\n' + quote;
  fs.writeFileSync(source.documentPath, content);
  assert.equal(candidates([source], '2026-10-11').length, 0);
  source.comments[0].anchor = { offset: content.lastIndexOf(quote) };
  const [found] = candidates([source], '2026-10-11'); assert.match(found.context, /第二处/); assert.ok(!found.context.includes('第一处'));
  fs.writeFileSync(source.documentPath, quote + 'x'.repeat(5 * 1024 * 1024));
  assert.equal(candidates([source], '2026-10-11').length, 0);
});
test('native review generation is deduplicated, grounded, persisted, and grading locks answers', async t => {
  const { folder, source } = env(t); let calls = 0;
  const answer = async payload => { calls++; if (payload.search) return { text: '{}', search: { status: 'searched' }, citations: [{ title: 'AWS retries', url: 'https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/' }] }; if (payload.messages[0].text.startsWith('用300字')) return { text: '再次核对重试的幂等边界。' }; await new Promise(r => setTimeout(r, 15)); return { text: JSON.stringify({ questions: [question, question] }), model: 'test' }; };
  const service = new DailyReview(folder, { sources: () => [source], answer });
  await Promise.all([service.generate('2026-10-11'), service.generate('2026-10-11')]);
  assert.equal(calls, 1); assert.equal(service.snapshot().days['2026-10-11'].questions.length, 1);
  service.choose('2026-10-11', 'q', 1); await service.submit('2026-10-11');
  const restored = new DailyReview(folder, { sources: () => [source], answer });
  const packet = restored.snapshot().days['2026-10-11'];
  assert.equal(packet.result.correct, 0); assert.equal(packet.articles.length, 1); assert.match(packet.summary, /幂等/);
  assert.throws(() => restored.choose('2026-10-11', 'q', 0)); await restored.submit('2026-10-11'); assert.equal(calls, 3);
});
test('unknown concepts and invented citations cannot leak private labels into recommendation queries', async t => {
  const { folder, source } = env(t); const calls = [];
  const service = new DailyReview(folder, { sources: () => [source], answer: async payload => {
    calls.push(payload); return payload.search ? { text: JSON.stringify({ articles: [{url:'https://openai.com/fake',reason:'fake'}] }), search: { status: 'searched' }, citations: [] } : { text: JSON.stringify({ questions: [{ ...question, topic: '某私人项目名称' }] }) };
  } });
  await service.generate('2026-10-11'); service.choose('2026-10-11', 'q', 0); await service.submit('2026-10-11');
  const request = calls.find(p => p.search); assert.equal(request.context, ''); assert.equal(request.quote, '');
  assert.ok(!request.messages[0].text.includes('私人')); assert.ok(!request.messages[0].text.includes(source.comments[0].quote));
  assert.equal(service.snapshot().days['2026-10-11'].articles.length, 0);
  assert.equal(articlesFrom({ search: {status:'searched'}, citations:[{url:'https://openai.com.evil.example/article'}] },['阅读理解']).length,0);
});
test('changed/deleted sources invalidate in-flight generation, and interrupted jobs can recover', async t => {
  const { folder, source } = env(t); let complete;
  const service = new DailyReview(folder, { sources: () => [source], answer: () => new Promise(r => complete = r) });
  const job = service.generate('2026-10-11'); service.removeSource('source'); complete({ text: JSON.stringify({questions:[question]}) });
  await assert.rejects(job, /变更/); assert.equal(service.snapshot().days['2026-10-11'], undefined);
  service.data.days['2026-10-11']={status:'generating',questions:[]}; service.persist();
  assert.equal(new DailyReview(folder,{sources:()=>[source],answer:async()=>{}}).snapshot().days['2026-10-11'].status,'failed');
});
test('onboarding copies two real files with ten annotations each, preserves user edits and never resurrects removed examples', t => {
  const {folder}=env(t),store=new DocumentStore(path.join(folder,'documents'));
  const service=new DailyReview(folder,{sources:()=>store.list(),answer:async()=>{}});
  const resources=path.resolve(__dirname,'../onboarding'); installExamples(resources,folder,store,service);
  assert.equal(store.list().length,2); assert.deepEqual(store.list().map(s=>s.comments.length),[10,10]);
  const source=store.list()[0],content=fs.readFileSync(source.documentPath,'utf8'); assert.ok(content.includes(source.comments[0].quote));
  assert.ok(source.comments.flatMap(c=>c.messages).filter(m=>m.role==='via').every(m=>m.model==='example'));
  assert.ok(candidates(store.list(),dayKey(new Date())).length>0);
  source.comments[0].quote='用户编辑'; store.save(source.documentPath,source.comments,source.recap);
  installExamples(resources,folder,store,service); assert.equal(store.readRecord(source.documentPath).comments[0].quote,'用户编辑');
  store.remove(source.id); installExamples(resources,folder,store,service); assert.equal(store.list().length,1);
});
