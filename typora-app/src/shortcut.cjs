'use strict';

const DEFAULT_TYPORA_SHORTCUT = 'Ctrl+Q';

function normalizeShortcut(value) {
  const parts = String(value || '').split('+').map(part => part.trim().toLowerCase()).filter(Boolean);
  const key = parts.pop();
  if (!/^[a-z]$/.test(key || '')) throw new Error('快捷键末位必须是 A–Z 字母');
  const modifiers = new Set(parts.map(part => ({ control: 'ctrl', ctrl: 'ctrl', alt: 'alt', shift: 'shift' })[part]));
  if (modifiers.has(undefined) || modifiers.size !== parts.length || (!modifiers.has('ctrl') && !modifiers.has('alt'))) {
    throw new Error('请使用 Ctrl 或 Alt，加可选的 Shift 和 A–Z 字母');
  }
  return [...['ctrl', 'alt', 'shift'].filter(part => modifiers.has(part)).map(part => ({ ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift' })[part]), key.toUpperCase()].join('+');
}

module.exports = { DEFAULT_TYPORA_SHORTCUT, normalizeShortcut };
