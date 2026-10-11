'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { metadata, parseDeepSeek, SEARCH_INSTRUCTIONS } = require('./search-response.cjs');

class DeepSeekSettings {
  constructor(userDataPath, safeStorage) {
    this.file = path.join(userDataPath, 'deepseek-key.json');
    this.safeStorage = safeStorage;
  }

  hasKey() {
    return this.status().configured;
  }

  status() {
    if (process.env.DEEPSEEK_API_KEY) return { configured: true, needsReplacement: false, source: 'environment' };
    if (!fs.existsSync(this.file)) return { configured: false, needsReplacement: false, source: null };
    try {
      return { configured: Boolean(this.getKey()), needsReplacement: false, source: 'local' };
    } catch {
      return { configured: false, needsReplacement: true, source: 'local' };
    }
  }

  setKey(value) {
    const key = String(value || '').trim();
    if (!key) throw new Error('请输入 DeepSeek API 密钥');
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new Error('系统加密存储不可用；请改用 DEEPSEEK_API_KEY 环境变量');
    }
    const encrypted = this.safeStorage.encryptString(key).toString('base64');
    fs.writeFileSync(this.file, JSON.stringify({ version: 1, encrypted }), { encoding: 'utf8', mode: 0o600 });
  }

  getKey() {
    if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY;
    if (!fs.existsSync(this.file)) return null;
    try {
      const settings = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (settings.version !== 1 || typeof settings.encrypted !== 'string') throw new Error('invalid saved key');
      return this.safeStorage.decryptString(Buffer.from(settings.encrypted, 'base64'));
    } catch {
      throw new Error('本机保存的 DeepSeek 密钥无法解密，请到 Via 主界面「设置」重新保存密钥');
    }
  }
}

async function answerWithDeepSeek(apiKey, { quote, context, messages, search = false }, { maxTokens = 1400 } = {}) {
  if (!apiKey) throw new Error('请先在 Via 主界面「设置」配置 DeepSeek API 密钥');
  if (typeof search !== 'boolean') throw new Error('联网选项格式不正确');
  const history = messages
    .filter(message => message?.role === 'user' || message?.role === 'via')
    .filter(message => typeof message.text === 'string' && message.text.trim())
    .slice(-12)
    .map(message => ({ role: message.role === 'via' ? 'assistant' : 'user', content: message.text.slice(0, 4000) }));
  if (!history.length || history[history.length - 1].role !== 'user') throw new Error('没有可回答的用户问题');
  if (search) {
    try {
      const input = [{ role: 'user', content: `当前引用：${String(quote || '').slice(0, 500)}\n\n相邻文档内容：${String(context || '').slice(0, 4500)}` }, ...history];
      const signal = AbortSignal.timeout(90_000);
      const evidence = [];
      let parsed;
      for (let turn = 0; turn < 2; turn++) {
        const response = await fetch('https://api.deepseek.com/anthropic/v1/messages', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: 'deepseek-flash', max_tokens: 2000, system: SEARCH_INSTRUCTIONS,
            messages: input, tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 2 }],
            tool_choice: turn === 0 ? { type: 'tool', name: 'web_search' } : { type: 'auto' } }), signal, redirect: 'error'
        });
        if (!response.ok) {
          if (response.status === 401 || response.status === 429) throw Object.assign(new Error(response.status === 401 ? 'DeepSeek 密钥无效，请重新配置' : 'DeepSeek 请求过于频繁或额度不足，请稍后重试'), { noFallback: true });
          throw new Error('DeepSeek 搜索接口暂不可用');
        }
        const body = await response.json();
        parsed = parseDeepSeek({ content: [...evidence, ...(body.content || [])] });
        evidence.push(...(body.content || []).filter(item => item.type === 'server_tool_use' || item.type === 'web_search_tool_result'));
        if (body.stop_reason === 'pause_turn' && turn === 0) { input.push({ role: 'assistant', content: body.content }); continue; }
        if (parsed.search.status !== 'searched' || !parsed.text || body.stop_reason === 'pause_turn') throw new Error('DeepSeek 未完成检索');
        return { ...parsed, model: body.model || 'deepseek-flash', source: '依据：当前引用、相邻内容及联网来源' };
      }
    } catch (error) {
      if (error.noFallback) throw error;
      const fallback = await answerWithDeepSeek(apiKey, { quote, context, messages, search: false });
      return { ...fallback, source: '依据：当前引用与相邻内容（联网未完成）',
        ...metadata('failed', 'deepseek', '联网检索未完成，本次已改为仅依据当前文档回答') };
    }
  }
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'deepseek-flash',
      thinking: { type: 'disabled' },
      max_tokens: Math.min(6000, Math.max(1400, maxTokens)),
      stream: false,
      messages: [
        { role: 'system', content: '你是 Via，帮助用户阅读当前 Markdown 文档。仅根据给出的引用和上下文回答；证据不足时直接说明，不要编造原文或外部来源。回答简洁、准确，使用中文。默认每次回复控制在500字以内；用户明确要求详细展开时可适当放宽，引用和依据不得编造。' },
        { role: 'user', content: `当前引用：${String(quote || '').slice(0, 500)}\n\n相邻文档内容：${String(context || '').slice(0, 4500)}` },
        ...history
      ]
    }),
    signal: AbortSignal.timeout(90_000)
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error('DeepSeek 密钥无效，请到 Via 主界面「设置」重新配置');
    if (response.status === 429) throw new Error('DeepSeek 请求过于频繁或额度不足，请稍后重试');
    throw new Error(`DeepSeek 请求失败（${response.status}）`);
  }
  const body = await response.json();
  const text = body.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) throw new Error('DeepSeek 返回了空回答');
  return { text: text.trim(), model: body.model || 'deepseek-flash', source: '依据：当前文档选区与相邻内容', ...metadata('off', 'deepseek') };
}

module.exports = { DeepSeekSettings, answerWithDeepSeek };
