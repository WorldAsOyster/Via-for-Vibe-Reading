'use strict';
// Explicit live check: uses the user's selected, locally encrypted API key, never prints it.
const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { DeepSeekSettings, answerWithDeepSeek } = require('../src/deepseek.cjs');
const { OpenAISettings, answerWithOpenAI } = require('../src/openai.cjs');
const { DesktopSettings } = require('../src/desktop-settings.cjs');
const { DocumentStore } = require('../src/store.cjs');
const { DailyReview, dayKey } = require('../src/daily-review.cjs');
app.whenReady().then(async () => {
  try {
    const folder = path.join(app.getPath('appData'), 'via-local-markdown');
    const provider = new DesktopSettings(folder).read().aiProvider;
    const settings = provider === 'openai' ? new OpenAISettings(folder, safeStorage) : new DeepSeekSettings(folder, safeStorage);
    if (!settings.status().configured) { console.log('LIVE_REVIEW_WAITING_FOR_KEY ' + provider); app.exit(2); return; }
    const answer = (payload, options) => provider === 'openai' ? answerWithOpenAI(settings.getKey(), payload, options) : answerWithDeepSeek(settings.getKey(), payload, options);
    const target = path.resolve(__dirname, '../.test-data/live-review-' + Date.now());
    const store = new DocumentStore(path.join(target, 'documents'));
    const service = new DailyReview(target, { sources: () => store.list(), answer });
    require('../src/onboarding.cjs').installExamples(path.resolve(__dirname, '../onboarding'), target, store, service);
    const date = dayKey(new Date()); await service.generate(date);
    const packet = service.snapshot().days[date];
    for (const q of packet.questions) service.choose(date, q.id, q.correct);
    await service.submit(date); const final = service.snapshot().days[date];
    fs.writeFileSync(path.join(target, 'result.json'), JSON.stringify({ provider, model: final.model, questions: final.questions.length, score: final.result, searchStatus: final.searchStatus, articles: final.articles.length, persisted: true }, null, 2));
    console.log('LIVE_REVIEW_OK ' + target + ' questions=' + final.questions.length + ' search=' + final.searchStatus + ' articles=' + final.articles.length); app.exit(0);
  } catch (error) { console.error('LIVE_REVIEW_FAILED ' + error.message); app.exit(1); }
});
