'use strict';

const { app, safeStorage } = require('electron');
const { DeepSeekSettings, answerWithDeepSeek } = require('../src/deepseek.cjs');

(async () => {
  await app.whenReady();
  const settings = new DeepSeekSettings(app.getPath('userData'), safeStorage);
  const answer = await answerWithDeepSeek(settings.getKey(), {
    quote: '本季度的北极星指标是新用户在注册后 7 天内完成首次有效协作的人数。',
    context: '有效协作指邀请至少一位同事，并产生一次评论、编辑或确认动作。',
    messages: [{ role: 'user', text: '这里的有效协作包括哪些动作？' }]
  });
  process.stdout.write(`DeepSeek answered successfully; model=${answer.model}; characters=${answer.text.length}.\n`);
  app.quit();
})().catch(error => {
  process.stderr.write(`DeepSeek check failed: ${error.message}\n`);
  app.quit();
  process.exitCode = 1;
});
