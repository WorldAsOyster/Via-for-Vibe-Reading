'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DocumentStore } = require('../src/store.cjs');
const { deriveDesktopData, buildTodoMarkdown } = require('../src/desktop-data.cjs');

test('desktop data uses the sidecar record and keeps task completion separate from comment removal', () => {
  const dir = path.join(__dirname, '..', '.test-data', `desktop-${process.pid}-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  try {
    const documentPath = path.join(dir, '增长方案.md');
    fs.writeFileSync(documentPath, '# 增长方案\n\n有效协作需要确认。', 'utf8');
    const store = new DocumentStore(path.join(dir, 'records'));
    store.open(documentPath);
    const comment = {
      id: 'c1', quote: '有效协作', saved: true, contextSnapshot: '有效协作需要确认。',
      messages: [
        { id: 'q1', role: 'user', text: '@Via 这里是什么意思？', createdAt: '2026-09-25T09:00:00Z' },
        { id: 'a1', role: 'via', text: '需要同事协作。', status: 'answered', createdAt: '2026-09-25T09:00:01Z', replyTo: 'q1' },
        { id: 't1', role: 'user', text: '@同事A 请确认有效协作的定义', createdAt: '2026-09-25T09:01:00Z' }
      ]
    };
    store.save(documentPath, [comment], { topics: ['协作'], recommendations: [] });
    let data = deriveDesktopData(store.list(), new Date('2026-09-25T12:00:00Z'));
    assert.equal(data.metrics.sources, 1);
    assert.equal(data.metrics.comments, 1);
    assert.equal(data.metrics.viaAnswers, 1);
    assert.equal(data.metrics.pendingTasks, 1);
    assert.equal(data.metrics.saved, 1);
    assert.equal(data.tasks[0].person, '同事A');
    assert.equal(data.tasks[0].body, '请确认有效协作的定义');
    assert.equal(data.saved[0].messages.length, 3);
    const exported = buildTodoMarkdown(data.sources[0], '同事A');
    assert.match(exported, /请确认有效协作的定义/);
    assert.match(exported, /> 有效协作/);

    store.setTodoResolved(documentPath, 't1', true);
    store.save(documentPath, [comment], { topics: ['协作'], recommendations: [] });
    data = deriveDesktopData(new DocumentStore(path.join(dir, 'records')).list());
    assert.equal(data.metrics.pendingTasks, 0);
    assert.equal(data.tasks.length, 1);
    assert.ok(data.tasks[0].resolvedAt);
    assert.throws(() => buildTodoMarkdown(data.sources[0], '同事A'), /没有未完成待办/);
    assert.equal(data.sources[0].comments.length, 1);
    assert.equal(fs.readFileSync(documentPath, 'utf8'), '# 增长方案\n\n有效协作需要确认。');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('desktop library discovers records created before the document index existed', () => {
  const dir = path.join(__dirname, '..', '.test-data', `legacy-${process.pid}-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  try {
    const documentPath = path.join(dir, '旧批注.md');
    fs.writeFileSync(documentPath, '旧文档', 'utf8');
    const store = new DocumentStore(path.join(dir, 'records'));
    store.save(documentPath, [{ id: 'old-comment', quote: '旧文档', messages: [] }]);
    assert.equal(fs.existsSync(store.indexFile), false);
    const listed = store.list();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].comments[0].id, 'old-comment');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('reading portrait waits for enough sources and mixes themes with concrete terms', () => {
  const sources = Array.from({ length: 5 }, (_, index) => ({
    id: `s${index}`, sourceType: 'typora', name: `AI技术与保险理赔研究-${index}.md`,
    documentPath: `C:/docs/${index}.md`, recap: { topics: ['保险理赔'] }, comments: [{
      id: `c${index}`, quote: '理赔风险定价模型', messages: [{ id: `q${index}`, role: 'user', text: '@Via 保险理赔的风险定价依据是什么？' }]
    }]
  }));
  assert.equal(deriveDesktopData(sources.slice(0, 4)).portrait.remaining, 1);
  const data = deriveDesktopData(sources);
  assert.equal(data.portrait.ready, true);
  assert.ok(data.readingKeywords.includes('AI 技术'));
  assert.ok(data.readingKeywords.includes('保险学研究'));
  assert.equal(data.readingKeywords.length, 4);
  assert.equal(data.portrait.readingThemeCount * 2, data.readingKeywords.length);
  assert.ok(!data.questionKeywords.includes('什么'));
});
