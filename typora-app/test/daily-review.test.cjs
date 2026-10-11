'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const daily=require('../src/desktop/daily-review.js');
const scope=require('../src/shared/export-scope.js');
const {buildPdfHtml}=require('../src/pdf.cjs');
const seed=require('../frontend/fixture.cjs');
test('daily examples cite exact text, completed Via questions, and no more than six questions/three articles',()=>{
  assert.equal(seed.sources.length,2);
  for(const source of seed.sources){assert.equal(source.comments.length,10);for(const comment of source.comments){assert.ok(source.content.includes(comment.quote));assert.ok(comment.quote.length<=180);for(const message of comment.messages.filter(m=>m.role==='via'))assert.ok(message.text.length<=500);}}
  assert.deepEqual(Object.values(seed.dailyReview.days).map(p=>p.questions.map(q=>q.id)),[['binding','draft','value'],['adoption','idempotency','acl']]);
  for(const packet of Object.values(seed.dailyReview.days)){
    assert.ok(packet.questions.length>0&&packet.questions.length<=6);
    assert.ok(packet.articles.length<=3);
    for(const q of packet.questions){const source=seed.sources.find(s=>s.id===q.sourceId),comment=source.comments.find(c=>c.id===q.commentId);assert.ok(source.content.includes(q.quote));assert.ok(comment.messages.some(m=>m.id===q.messageId&&m.role==='user'&&m.text.startsWith('@Via')));assert.ok(comment.messages.some(m=>m.role==='via'&&m.status==='answered'&&m.replyTo===q.messageId));assert.ok(q.answer.length<=500);assert.equal(new Set(q.options).size,q.options.length);assert.ok(Number.isInteger(q.correct)&&q.correct>=0&&q.correct<q.options.length);}
  }
});

test('new presets migrate once while preserving review answers, edits, and source/comment deletion',()=>{
  const previous=structuredClone(seed);delete previous.fixtureRevision;
  previous.sources=previous.sources.slice(0,1);
  previous.sources[0].comments=previous.sources[0].comments.filter(c=>c.presetRevision===1&&c.id!=='c-value');
  previous.sources[0].comments[0].messages[0].text='用户修改过的提问';
  previous.sources[0].comments.push({id:'user-note',quote:'我的引用',messages:[]});
  previous.dailyReview.days['2026-10-11'].choices={adoption:1,idempotency:2,acl:1};
  previous.dailyReview.days['2026-10-11'].submittedAt='2026-10-11T08:00:00Z';
  const storage=new Map([['via-redcowork-demo-v3',JSON.stringify(previous)]]);
  function reload(){const context={window:{viaDemoSeed:structuredClone(seed),addEventListener(){}},document:{addEventListener(){},getElementById(){return null;}},localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},location:{search:'',pathname:'/workbench.html'},URLSearchParams,structuredClone,setTimeout};vm.runInNewContext(fs.readFileSync(require.resolve('../frontend/runtime.js'),'utf8'),context);return JSON.parse(storage.get('via-redcowork-demo-v3'));}
  const migrated=reload();assert.equal(migrated.sources.length,1);assert.equal(migrated.sources[0].comments.length,10);
  assert.equal(migrated.sources[0].comments[0].messages[0].text,'用户修改过的提问');
  assert.ok(migrated.sources[0].comments.some(c=>c.id==='user-note'));assert.ok(!migrated.sources[0].comments.some(c=>c.id==='c-value'));
  assert.deepEqual(migrated.dailyReview,previous.dailyReview);
  migrated.sources[0].comments=migrated.sources[0].comments.filter(c=>c.id!=='c-software-scope');storage.set('via-redcowork-demo-v3',JSON.stringify(migrated));
  assert.equal(reload().sources[0].comments.length,9);
});
test('grading rejects incomplete/out-of-range choices, identifies specific gaps, caps rendering at six',()=>{
  const packet=structuredClone(seed.dailyReview.days['2026-10-11']);
  assert.throws(()=>daily.grade(packet),/完成全部题目/);
  for(const q of packet.questions)packet.choices[q.id]=q.correct;
  assert.deepEqual(daily.grade(packet),{total:3,correct:3,weakTopics:[]});
  packet.choices.acl=1;
  assert.deepEqual(daily.grade(packet).weakTopics,['权限边界']);
  packet.choices.acl=9;assert.throws(()=>daily.grade(packet));
  const over={...packet,questions:Array.from({length:10},(_,i)=>({...packet.questions[0],id:'q'+i}))};assert.equal(daily.questions(over).length,6);
  const empty=daily.render({metrics:{},activity:{},dailyReview:seed.dailyReview},'2026-10-09');assert.match(empty,/这一天还没有复盘题目/);assert.doesNotMatch(empty,/data-review-choice/);
});
test('person export retains ancestors and replies, excludes unrelated people and prefix matches in MD/PDF',()=>{
  const comments=[{id:'mixed',quote:'引用甲',messages:[{id:'q',role:'user',text:'@Via 解释幂等'},{id:'a',role:'via',text:'关联回答',replyTo:'q'},{id:'c',role:'user',text:'@Codex 补充用例',replyTo:'a'},{id:'d',role:'user',text:'@Claude 独立任务',replyTo:'a'},{id:'da',role:'via',text:'其他人的回复',replyTo:'d'},{id:'ca',role:'via',text:'对象追问的回复',replyTo:'c'}]},{id:'prefix',quote:'引用乙',messages:[{id:'x',role:'user',text:'@CodexExtra 不属于目标对象'}]}];
  const scoped=scope.forPerson(comments,'Codex');assert.equal(scoped.length,1);assert.deepEqual(scoped[0].messages.map(m=>m.id),['q','a','c','ca']);assert.equal(comments[0].messages.length,6);
  const html=buildPdfHtml('原文.md','原文全部保留\n\n引用甲\n\n引用乙',comments,{person:'Codex'});assert.match(html,/原文全部保留/);assert.match(html,/@Codex 补充用例/);assert.match(html,/关联回答/);assert.doesNotMatch(html,/@Claude|CodexExtra|其他人的回复/);
});
test('demo review state survives reload, rejects changing submitted answers, and validates time',async()=>{
  const storage=new Map();
  function browser(){const context={window:{viaDemoSeed:structuredClone(seed),viaDailyReview:daily,addEventListener(){}},document:{addEventListener(){},getElementById(){return null;}},localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},location:{search:'',pathname:'/workbench.html'},URLSearchParams,structuredClone,setTimeout,clearTimeout,Date,Map,Set,Promise};vm.runInNewContext(fs.readFileSync(require.resolve('../frontend/runtime.js'),'utf8'),context);return context.window.viaDesktop;}
  const api=browser();for(const q of seed.dailyReview.days['2026-10-11'].questions)await api.chooseReviewAnswer('2026-10-11',q.id,q.correct);
  await api.submitReview('2026-10-11');assert.ok(JSON.parse(storage.get('via-redcowork-demo-v3')).dailyReview.days['2026-10-11'].submittedAt);
  await assert.rejects(browser().chooseReviewAnswer('2026-10-11','acl',2),/不能改写/);
  await api.saveReviewReminder('19:45');assert.equal(JSON.parse(storage.get('via-redcowork-demo-v3')).dailyReview.reminderTime,'19:45');await assert.rejects(api.saveReviewReminder('25:30'));
  await api.askDailyReview('2026-10-11','我不懂幂等');const packet=JSON.parse(storage.get('via-redcowork-demo-v3')).dailyReview.days['2026-10-11'];assert.equal(packet.questions.length,3);assert.equal(packet.conversation.at(-1).role,'via');assert.ok(packet.conversation.at(-1).text.length<=500);
});
