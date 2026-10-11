'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DesktopSettings } = require('../src/desktop-settings.cjs');

test('local profile and Typora switch survive a settings reload', () => {
  const dir = path.join(__dirname, '..', '.test-data', `settings-${process.pid}-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  try {
    const settings = new DesktopSettings(dir);
    const initial = settings.read();
    assert.ok(initial.profile.id.startsWith('via_'));
    const avatar = 'data:image/png;base64,aGVsbG8=';
    settings.saveProfile('测试用户', 'reader@example.com', '专注阅读', avatar);
    settings.setAiProvider('openai');
    settings.setTyporaEnabled(false);
    settings.setBrowserEnabled(false);
    settings.setTyporaShortcut('alt+shift+k');
    const reopened = new DesktopSettings(dir).read();
    assert.equal(reopened.profile.id, initial.profile.id);
    assert.equal(reopened.profile.name, '测试用户');
    assert.equal(reopened.profile.email, 'reader@example.com');
    assert.equal(reopened.profile.signature, '专注阅读');
    assert.equal(reopened.profile.avatar, avatar);
    assert.equal(reopened.aiProvider, 'openai');
    assert.equal(reopened.typoraEnabled, false);
    assert.equal(reopened.browserEnabled, false);
    assert.equal(reopened.typoraShortcut, 'Alt+Shift+K');
    assert.throws(() => settings.setTyporaShortcut('Q'), /Ctrl 或 Alt/);
    assert.throws(() => settings.setTyporaShortcut('Ctrl+1'), /A–Z/);
    assert.throws(() => settings.saveProfile('', 'reader@example.com'), /用户名称/);
    assert.throws(() => settings.saveProfile('测试用户', 'invalid'), /邮箱/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
