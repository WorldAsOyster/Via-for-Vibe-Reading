'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { metadata, parseOpenAI, SEARCH_INSTRUCTIONS } = require('./search-response.cjs');

class OpenAISettings {
  constructor(userDataPath, safeStorage) {
    this.file = path.join(userDataPath, 'openai-key.json');
    this.safeStorage = safeStorage;
  }

  status() {
    if (process.env.OPENAI_API_KEY) return { configured: true, needsReplacement: false, source: 'environment' };
    if (!fs.existsSync(this.file)) return { configured: false, needsReplacement: false, source: null };
    try {
      return { configured: Boolean(this.getKey()), needsReplacement: false, source: 'local' };
    } catch {
      return { configured: false, needsReplacement: true, source: 'local' };
    }
  }

  setKey(value) {
    const key = String(value || '').trim();
    if (!key) throw new Error('请输入 OpenAI API 密钥');
    if (!this.safeStorage.isEncryptionAvailable()) throw new Error('系统加密存储不可用；请改用 OPENAI_API_KEY 环境变量');
    const encrypted = this.safeStorage.encryptString(key).toString('base64');
    fs.writeFileSync(this.file, JSON.stringify({ version: 1, encrypted }), { encoding: 'utf8', mode: 0o600 });
  }

  getKey() {
    if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
    if (!fs.existsSync(this.file)) return null;
    try {
      const settings = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (settings.version !== 1 || typeof settings.encrypted !== 'string') throw new Error('invalid saved key');
      return this.safeStorage.decryptString(Buffer.from(settings.encrypted, 'base64'));
    } catch {
      throw new Error('本机保存的 OpenAI 密钥无法解密，请到 Via 主界面「设置」重新保存密钥');
    }
  }
}

async function answerWithOpenAI(apiKey, { quote, context, messages, search = false }, { maxTokens = 1200 } = {}) {
  if (!apiKey) throw new Error('请先在 Via 主界面「设置」配置 OpenAI API 密钥');
  if (typeof search !== 'boolean') throw new Error('联网选项格式不正确');
  const history = messages
    .filter(message => message?.role === 'user' || message?.role === 'via')
    .filter(message => typeof message.text === 'string' && message.text.trim())
    .slice(-12)
    .map(message => ({ role: message.role === 'via' ? 'assistant' : 'user', content: message.text.slice(0, 4000) }));
  if (!history.length || history.at(-1).role !== 'user') throw new Error('没有可回答的用户问题');
  try {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'gpt-5-mini',
      store: false,
      max_output_tokens: search ? 2400 : Math.min(6000, Math.max(1200, maxTokens)),
      ...(search ? { tools: [{ type: 'web_search' }], tool_choice: 'required', include: ['web_search_call.action.sources'] } : {}),
      instructions: search ? SEARCH_INSTRUCTIONS : '你是 Via，帮助用户阅读当前 Markdown 文档。仅根据给出的引用和上下文回答；证据不足时直接说明，不要编造原文或外部来源。回答简洁、准确，使用中文。默认每次回复控制在500字以内；用户明确要求详细展开时可适当放宽，引用和依据不得编造。',
      input: [{ role: 'user', content: `当前引用：${String(quote || '').slice(0, 500)}\n\n相邻文档内容：${String(context || '').slice(0, 4500)}` }, ...history]
    }),
    signal: AbortSignal.timeout(90_000), redirect: 'error'
  });
  if (!response.ok) {
    if (response.status === 401) throw Object.assign(new Error('OpenAI 密钥无效，请到 Via 主界面「设置」重新配置'), { noFallback: true });
    if (response.status === 429) throw Object.assign(new Error('OpenAI 请求过于频繁或额度不足，请稍后重试'), { noFallback: true });
    throw new Error(`OpenAI 请求失败（${response.status}）`);
  }
  const body = await response.json();
  if (search) {
    const parsed = parseOpenAI(body);
    if (parsed.search.status !== 'searched' || !parsed.text || body.status === 'failed' || body.status === 'incomplete') throw new Error('OpenAI 未完成联网回答');
    return { ...parsed, model: body.model || 'gpt-5-mini', source: '依据：当前引用、相邻内容及联网来源' };
  }
  const text = (body.output || []).flatMap(item => item.content || []).filter(item => item.type === 'output_text').map(item => item.text).join('\n').trim();
  if (!text) throw new Error('OpenAI 返回了空回答');
  return { text, model: body.model || 'gpt-5-mini', source: '依据：当前文档选区与相邻内容', ...metadata('off', 'openai') };
  } catch (error) {
    if (!search || error.noFallback) throw error;
    const fallback = await answerWithOpenAI(apiKey, { quote, context, messages, search: false });
    return { ...fallback, source: '依据：当前引用与相邻内容（联网未完成）',
      ...metadata('failed', 'openai', '联网检索未完成，本次已改为仅依据当前文档回答') };
  }
}

module.exports = { OpenAISettings, answerWithOpenAI };
