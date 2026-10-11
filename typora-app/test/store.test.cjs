'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DocumentStore, documentKey } = require('../src/store.cjs');

const root = path.resolve(__dirname, '..', '.test-data');

test('same-path document reopens with saved comments without changing Markdown', () => {
  const dir = path.join(root, `run-${process.pid}-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  try {
    const source = path.join(dir, '方案.md');
    const original = '# 方案\n\n北极星指标在这里。\n';
    fs.writeFileSync(source, original, 'utf8');
    const store = new DocumentStore(path.join(dir, 'records'));
    assert.deepEqual(store.open(source).record.comments, []);
    const comment = { id: 'comment-1', quote: '北极星指标', messages: [{ role: 'user', text: '这是什么？' }] };
    store.save(source, [comment], { summary: '询问指标定义' });
    const reopened = new DocumentStore(path.join(dir, 'records')).open(source);
    assert.deepEqual(reopened.record.comments, [comment]);
    assert.deepEqual(reopened.record.recap, { summary: '询问指标定义' });
    assert.equal(fs.readFileSync(source, 'utf8'), original);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('same filename in different folders does not share annotations', () => {
  const dir = path.join(root, `separate-${process.pid}-${Date.now()}`);
  fs.mkdirSync(path.join(dir, 'a'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'b'), { recursive: true });
  try {
    const a = path.join(dir, 'a', '同名.md');
    const b = path.join(dir, 'b', '同名.md');
    fs.writeFileSync(a, 'A', 'utf8');
    fs.writeFileSync(b, 'B', 'utf8');
    const store = new DocumentStore(path.join(dir, 'records'));
    store.save(a, [{ id: 'only-a' }]);
    assert.equal(store.open(b).record.comments.length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('removing a library record preserves the original Markdown', () => {
  const dir = fs.mkdtempSync(path.join(root, 'remove-'));
  try {
    const source = path.join(dir, '原文.md');
    fs.writeFileSync(source, '# 原文\n', 'utf8');
    const store = new DocumentStore(path.join(dir, 'records'));
    store.open(source);
    store.save(source, [{ id: 'note-1', quote: '原文', messages: [] }]);
    assert.equal(store.list().length, 1);
    store.remove(documentKey(source));
    assert.equal(store.list().length, 0);
    assert.equal(fs.readFileSync(source, 'utf8'), '# 原文\n');
    assert.equal(store.open(source).record.comments.length, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
