'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { OpenAISettings, answerWithOpenAI } = require('../src/openai.cjs');

test('OpenAI key is saved separately with system encryption', () => {
  const dir = path.join(__dirname, '..', '.test-data', `openai-${process.pid}-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  try {
    const storage = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(`encrypted:${value}`), decryptString: value => value.toString().replace(/^encrypted:/, '') };
    const settings = new OpenAISettings(dir, storage);
    settings.setKey('private-test-key');
    assert.equal(settings.getKey(), 'private-test-key');
    assert.equal(settings.status().configured, true);
    assert.ok(!fs.readFileSync(settings.file, 'utf8').includes('private-test-key'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('OpenAI answer sends bounded quote and context without storing response', async () => {
  const originalFetch = global.fetch;
  let sent;
  global.fetch = async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    sent = JSON.parse(options.body);
    return { ok: true, json: async () => ({ model: 'gpt-5-mini', output: [{ content: [{ type: 'output_text', text: '根据引用可得。' }] }] }) };
  };
  try {
    const result = await answerWithOpenAI('test-key', { quote: '测试引用', context: '相邻内容', messages: [{ role: 'user', text: '@Via 如何理解？' }] });
    assert.equal(sent.store, false);
    assert.match(sent.input[0].content, /测试引用/);
    assert.equal(result.text, '根据引用可得。');
  } finally { global.fetch = originalFetch; }
});

test('OpenAI native search returns verified citations without storing response', async () => {
  const originalFetch = global.fetch;
  let sent;
  global.fetch = async (_url, options) => {
    sent = JSON.parse(options.body);
    return { ok: true, json: async () => ({ model: 'gpt-5-mini', status: 'completed', output: [
      { type: 'web_search_call', status: 'completed', action: { sources: [{ title: 'Primary', url: 'https://example.test/primary' }] } },
      { type: 'message', content: [{ type: 'output_text', text: '联网结果。', annotations: [{ type: 'url_citation', title: 'Primary', url: 'https://example.test/primary' }] }] }
    ] }) };
  };
  try {
    const result = await answerWithOpenAI('same-openai-key', { quote: '引用', context: '正文', search: true, messages: [{ role: 'user', text: '@Via 联网说明' }] });
    assert.equal(sent.store, false);
    assert.deepEqual(sent.tools, [{ type: 'web_search' }]);
    assert.equal(result.search.status, 'searched');
    assert.equal(result.citations.length, 1);
    assert.equal(result.citations[0].url, 'https://example.test/primary');
  } finally { global.fetch = originalFetch; }
});

test('OpenAI search failure is labelled and falls back to document-only answer', async () => {
  const originalFetch = global.fetch;
  let count = 0;
  global.fetch = async () => ++count === 1
    ? { ok: false, status: 500, json: async () => ({}) }
    : { ok: true, json: async () => ({ model: 'gpt-5-mini', output: [{ content: [{ type: 'output_text', text: '仅根据原文回答。' }] }] }) };
  try {
    const result = await answerWithOpenAI('key', { quote: '引用', context: '正文', search: true, messages: [{ role: 'user', text: '@Via 问题' }] });
    assert.equal(result.search.status, 'failed');
    assert.match(result.source, /联网未完成/);
    assert.deepEqual(result.citations, []);
  } finally { global.fetch = originalFetch; }
});
