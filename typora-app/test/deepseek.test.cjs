'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DeepSeekSettings, answerWithDeepSeek } = require('../src/deepseek.cjs');

test('unreadable local key is reported for replacement and can be saved again', () => {
  const dataDir = path.join(__dirname, '..', '.test-data', 'deepseek-settings-test');
  fs.mkdirSync(dataDir, { recursive: true });
  const storage = {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(`encrypted:${value}`),
    decryptString: bytes => {
      const value = bytes.toString();
      if (!value.startsWith('encrypted:')) throw new Error('system decrypt failed');
      return value.slice('encrypted:'.length);
    }
  };
  const settings = new DeepSeekSettings(dataDir, storage);
  const previousKey = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  try {
    fs.writeFileSync(settings.file, JSON.stringify({ version: 1, encrypted: Buffer.from('broken').toString('base64') }));
    assert.deepEqual(settings.status(), { configured: false, needsReplacement: true, source: 'local' });
    assert.throws(() => settings.getKey(), /Via 主界面/);
    settings.setKey('test-key');
    assert.deepEqual(settings.status(), { configured: true, needsReplacement: false, source: 'local' });
    assert.equal(settings.getKey(), 'test-key');
  } finally {
    if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previousKey;
    fs.unlinkSync(settings.file);
  }
});

test('DeepSeek request sends the quote and bounded context with conversation history', async () => {
  const originalFetch = global.fetch;
  let request;
  global.fetch = async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ model: 'deepseek-flash', choices: [{ message: { content: '文档中的定义是……' } }] }) };
  };
  try {
    const result = await answerWithDeepSeek('test-key', {
      quote: '北极星指标', context: '正文上下文',
      messages: [{ role: 'user', text: '@Via 请解释' }]
    });
    assert.equal(result.text, '文档中的定义是……');
    assert.equal(request.url, 'https://api.deepseek.com/chat/completions');
    assert.equal(request.options.headers.Authorization, 'Bearer test-key');
    const body = JSON.parse(request.options.body);
    assert.equal(body.model, 'deepseek-flash');
    assert.match(body.messages[1].content, /正文上下文/);
    assert.equal(body.messages[2].content, '@Via 请解释');
  } finally {
    global.fetch = originalFetch;
  }
});

test('DeepSeek native search returns verified citations and uses the existing key', async () => {
  const originalFetch = global.fetch;
  let sent;
  global.fetch = async (url, options) => {
    assert.equal(url, 'https://api.deepseek.com/anthropic/v1/messages');
    sent = { headers: options.headers, body: JSON.parse(options.body) };
    return { ok: true, json: async () => ({ model: 'deepseek-flash', stop_reason: 'end_turn', content: [
      { type: 'server_tool_use', id: 'tool-1', name: 'web_search', input: { query: 'RSI AI' } },
      { type: 'web_search_tool_result', tool_use_id: 'tool-1', content: [{ type: 'web_search_result', title: 'Research', url: 'https://example.test/research' }] },
      { type: 'text', text: '联网结果说明。' }
    ] }) };
  };
  try {
    const result = await answerWithDeepSeek('same-deepseek-key', { quote: 'RSI', context: '上下文', search: true, messages: [{ role: 'user', text: '@Via 联网解释' }] });
    assert.equal(sent.headers['x-api-key'], 'same-deepseek-key');
    assert.equal(sent.body.tools[0].type, 'web_search_20250305');
    assert.equal(result.search.status, 'searched');
    assert.equal(result.citations[0].url, 'https://example.test/research');
    assert.equal(result.text, '联网结果说明。');
  } finally { global.fetch = originalFetch; }
});

test('DeepSeek search failure is labelled and falls back to document-only answer', async () => {
  const originalFetch = global.fetch;
  let count = 0;
  global.fetch = async () => ++count === 1
    ? { ok: false, status: 500, json: async () => ({}) }
    : { ok: true, json: async () => ({ model: 'deepseek-flash', choices: [{ message: { content: '仅根据原文回答。' } }] }) };
  try {
    const result = await answerWithDeepSeek('key', { quote: '引用', context: '正文', search: true, messages: [{ role: 'user', text: '@Via 问题' }] });
    assert.equal(result.search.status, 'failed');
    assert.match(result.source, /联网未完成/);
    assert.deepEqual(result.citations, []);
  } finally { global.fetch = originalFetch; }
});
