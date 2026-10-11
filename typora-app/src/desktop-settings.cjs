'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DEFAULT_TYPORA_SHORTCUT, normalizeShortcut } = require('./shortcut.cjs');

class DesktopSettings {
  constructor(userDataPath) {
    this.file = path.join(userDataPath, 'desktop-settings.json');
  }

  read() {
    if (fs.existsSync(this.file)) {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (saved.version !== 1) throw new Error('本机设置格式不匹配');
      saved.profile ||= {};
      saved.profile.signature ??= '';
      saved.profile.avatar ??= '';
      saved.aiProvider ||= 'deepseek';
      saved.browserEnabled ??= true;
      saved.typoraShortcut = normalizeShortcut(saved.typoraShortcut || DEFAULT_TYPORA_SHORTCUT);
      return saved;
    }
    const fresh = {
      version: 1,
      profile: { name: '本机用户', id: `via_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`, email: '', signature: '', avatar: '' },
      aiProvider: 'deepseek',
      typoraEnabled: true,
      browserEnabled: true,
      typoraShortcut: DEFAULT_TYPORA_SHORTCUT
    };
    this.write(fresh);
    return fresh;
  }

  write(value) {
    const temporary = `${this.file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { encoding: 'utf8', flag: 'wx' });
      fs.renameSync(temporary, this.file);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }

  saveProfile(name, email, signature = '', avatar = '') {
    const cleanName = String(name || '').trim();
    const cleanEmail = String(email || '').trim();
    const cleanSignature = String(signature || '').trim();
    const cleanAvatar = String(avatar || '');
    if (!cleanName) throw new Error('请填写用户名称');
    if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) throw new Error('请填写有效的邮箱地址');
    if (cleanAvatar && (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(cleanAvatar) || cleanAvatar.length > 1_400_000)) throw new Error('头像格式或大小不支持');
    const settings = this.read();
    settings.profile = { ...settings.profile, name: cleanName.slice(0, 80), email: cleanEmail.slice(0, 254), signature: cleanSignature.slice(0, 80), avatar: cleanAvatar };
    this.write(settings);
    return settings;
  }

  setAiProvider(provider) {
    if (!['deepseek', 'openai'].includes(provider)) throw new Error('不支持这家 AI 服务');
    const settings = this.read();
    settings.aiProvider = provider;
    this.write(settings);
    return settings;
  }

  setTyporaEnabled(enabled) {
    const settings = this.read();
    settings.typoraEnabled = Boolean(enabled);
    this.write(settings);
    return settings;
  }
  setBrowserEnabled(enabled) {
    const settings = this.read();
    settings.browserEnabled = Boolean(enabled);
    this.write(settings);
    return settings;
  }
  setTyporaShortcut(value) {
    const settings = this.read();
    settings.typoraShortcut = normalizeShortcut(value);
    this.write(settings);
    return settings;
  }
}

module.exports = { DesktopSettings };
