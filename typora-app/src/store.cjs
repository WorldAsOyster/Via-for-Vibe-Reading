'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_RECORD_BYTES = 5 * 1024 * 1024;

function documentKey(filePath) {
  const normalized = path.resolve(filePath);
  const identity = process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  return crypto.createHash('sha256').update(identity).digest('hex');
}

function samePath(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function requireMarkdown(filePath) {
  if (typeof filePath !== 'string' || !filePath.trim()) throw new Error('请先选择 Markdown 文档');
  const resolved = path.resolve(filePath);
  if (!/\.(md|markdown)$/i.test(resolved)) throw new Error('目前只支持 .md 和 .markdown 文件');
  const stats = fs.statSync(resolved);
  if (!stats.isFile()) throw new Error('所选路径不是文件');
  if (stats.size > MAX_FILE_BYTES) throw new Error('文档超过当前版本的 5 MB 限制');
  return resolved;
}

function emptyRecord(filePath) {
  return { version: 1, documentPath: filePath, comments: [], recap: null, updatedAt: null };
}

class DocumentStore {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.indexFile = path.join(baseDir, 'documents-index.json');
    fs.mkdirSync(baseDir, { recursive: true });
  }

  writeJson(destination, value) {
    const serialized = JSON.stringify(value, null, 2);
    if (Buffer.byteLength(serialized) > MAX_RECORD_BYTES) throw new Error('本机数据超过当前版本的 5 MB 限制');
    const temporary = `${destination}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, serialized, { encoding: 'utf8', flag: 'wx' });
      fs.renameSync(temporary, destination);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }

  readIndex() {
    if (!fs.existsSync(this.indexFile)) return { version: 1, documents: {} };
    const index = JSON.parse(fs.readFileSync(this.indexFile, 'utf8'));
    if (index.version !== 1 || !index.documents || typeof index.documents !== 'object') {
      throw new Error('资料索引格式不匹配');
    }
    return index;
  }

  trackDocument(filePath) {
    const index = this.readIndex();
    const id = documentKey(filePath);
    index.documents[id] = {
      documentPath: filePath,
      sourceType: 'typora',
      lastOpenedAt: new Date().toISOString()
    };
    this.writeJson(this.indexFile, index);
  }

  recordPath(filePath) {
    return path.join(this.baseDir, `${documentKey(filePath)}.json`);
  }

  readRecord(filePath) {
    const file = this.recordPath(filePath);
    if (!fs.existsSync(file)) return emptyRecord(filePath);
    const raw = fs.readFileSync(file, 'utf8');
    if (Buffer.byteLength(raw) > MAX_RECORD_BYTES) throw new Error('批注数据超过当前版本的 5 MB 限制');
    const record = JSON.parse(raw);
    if (record.version !== 1 || !samePath(record.documentPath, filePath) || !Array.isArray(record.comments)) {
      throw new Error('批注数据格式不匹配，未覆盖原数据');
    }
    return record;
  }

  open(filePath) {
    const documentPath = requireMarkdown(filePath);
    const content = fs.readFileSync(documentPath, 'utf8');
    const record = this.readRecord(documentPath);
    this.trackDocument(documentPath);
    return { documentPath, name: path.basename(documentPath), content, record };
  }

  list() {
    const index = this.readIndex();
    const entries = new Map(Object.entries(index.documents));
    for (const name of fs.readdirSync(this.baseDir)) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
      try {
        const record = JSON.parse(fs.readFileSync(path.join(this.baseDir, name), 'utf8'));
        if (record.version !== 1 || !Array.isArray(record.comments) ||
            documentKey(record.documentPath) !== name.slice(0, -5)) continue;
        const id = name.slice(0, -5);
        const existing = entries.get(id) || {};
        entries.set(id, { ...existing, documentPath: record.documentPath });
      } catch { /* Keep other valid documents available if one record is damaged. */ }
    }
    return [...entries.entries()].map(([id, entry]) => {
      const file = this.recordPath(entry.documentPath);
      let record = emptyRecord(entry.documentPath);
      try { record = this.readRecord(entry.documentPath); } catch { /* Show the source, not corrupt comments. */ }
      return {
        id,
        sourceType: entry.sourceType || 'typora',
        documentPath: entry.documentPath,
        name: path.basename(entry.documentPath),
        lastOpenedAt: entry.lastOpenedAt || record.updatedAt || null,
        updatedAt: record.updatedAt || null,
        exists: fs.existsSync(entry.documentPath),
        comments: record.comments,
        recap: record.recap,
        todoStates: record.todoStates || {},
        hasRecord: fs.existsSync(file)
      };
    }).sort((left, right) => String(right.updatedAt || right.lastOpenedAt || '').localeCompare(String(left.updatedAt || left.lastOpenedAt || '')));
  }

  save(filePath, comments, recap = null) {
    const documentPath = requireMarkdown(filePath);
    if (!Array.isArray(comments)) throw new Error('批注数据必须是数组');
    const previous = this.readRecord(documentPath);
    const activeMessages = new Set(comments.flatMap(comment => comment.messages || [])
      .filter(message => message.role === 'user' && typeof message.id === 'string')
      .map(message => message.id));
    const record = {
      version: 1,
      documentPath,
      comments,
      recap,
      todoStates: Object.fromEntries(Object.entries(previous.todoStates || {})
        .filter(([messageId]) => activeMessages.has(messageId))),
      updatedAt: new Date().toISOString()
    };
    this.writeJson(this.recordPath(documentPath), record);
    return record;
  }

  setTodoResolved(filePath, messageId, resolved) {
    const documentPath = requireMarkdown(filePath);
    const record = this.readRecord(documentPath);
    const message = record.comments.flatMap(comment => comment.messages || [])
      .find(item => item.id === messageId && item.role === 'user');
    if (!message) throw new Error('待办已不存在');
    record.todoStates = record.todoStates || {};
    if (resolved) record.todoStates[messageId] = { resolvedAt: new Date().toISOString() };
    else delete record.todoStates[messageId];
    record.updatedAt = new Date().toISOString();
    this.writeJson(this.recordPath(documentPath), record);
    return record.todoStates[messageId] || null;
  }

  applyCloud(id, item) {
    const snapshot = item?.snapshot;
    if (!/^[a-f0-9]{64}$/.test(id) || !snapshot || !Array.isArray(snapshot.comments) ||
        !snapshot.todoStates || typeof snapshot.todoStates !== 'object') throw new Error('云端批注格式不匹配');
    const source = this.list().find(item => item.id === id);
    if (!source?.documentPath) return false;
    const record = { version: 1, documentPath: source.documentPath, comments: snapshot.comments,
      todoStates: snapshot.todoStates, recap: snapshot.recap ?? null,
      updatedAt: Number.isFinite(Date.parse(item.updatedAt)) ? item.updatedAt : new Date().toISOString() };
    this.writeJson(this.recordPath(source.documentPath), record);
    const index = this.readIndex();
    if (index.documents[id] && Number.isFinite(Date.parse(item.lastOpenedAt))) {
      index.documents[id].lastOpenedAt = item.lastOpenedAt;
      this.writeJson(this.indexFile, index);
    }
    return true;
  }

  remove(id) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('无效的资料 ID');
    const index = this.readIndex();
    const entry = index.documents[id] || this.list().find(item => item.id === id);
    if (!entry) throw new Error('资料已不存在');
    if (documentKey(entry.documentPath) !== id) throw new Error('资料身份不匹配');
    delete index.documents[id];
    this.writeJson(this.indexFile, index);
    const record = this.recordPath(entry.documentPath);
    if (fs.existsSync(record)) fs.unlinkSync(record);
    return entry.documentPath;
  }
}

module.exports = { DocumentStore, documentKey, requireMarkdown };
