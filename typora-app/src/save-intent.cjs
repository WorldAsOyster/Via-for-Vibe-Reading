'use strict';

function isSaveOnly(text) {
  const command = String(text || '').trim().replace(/^@Via\s*/i, '')
    .replace(/[。！!]+$/g, '').replace(/\s+/g, '');
  return /^(?:收藏|保存)(?:一下)?(?:这段|这句|这个)?(?:文字|原文|内容|话)?$/.test(command);
}

module.exports = { isSaveOnly };
