'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { documentKey } = require('./store.cjs');
const { dayKey } = require('./daily-review.cjs');
function installExamples(resources, folder, store, review) {
  const marker = path.join(folder, 'onboarding-v1.json');
  if (fs.existsSync(marker)) return;
  const seed = JSON.parse(fs.readFileSync(path.join(resources, 'seed.json'), 'utf8'));
  const target = path.join(folder, '示例文档'); fs.mkdirSync(target, { recursive: true });
  const today = new Date(), yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const dates = { '2026-10-11': dayKey(today), '2026-10-10': dayKey(yesterday) };
  const remap = value => typeof value === 'string' ? value.replace(/2026-10-(10|11)/g, v => dates[v]) : value;
  const ids = {};
  for (const source of seed.sources) {
    const file = path.join(target, path.basename(source.name));
    if (!fs.existsSync(file)) fs.copyFileSync(path.join(resources, path.basename(source.name)), file, fs.constants.COPYFILE_EXCL);
    ids[source.id] = documentKey(file);
    // Never overwrite annotations if onboarding was interrupted and retried.
    if (!fs.existsSync(store.recordPath(file))) {
      const comments = JSON.parse(JSON.stringify(source.comments), (_k, v) => remap(v));
      for (const comment of comments) for (const message of comment.messages) if (message.model === 'demo') message.model = 'example';
      store.open(file); store.save(file, comments, source.recap);
    }
  }
  for (const [date, packet] of Object.entries(seed.dailyReview.days)) {
    const shifted = dates[date]; if (review.data.days[shifted]) continue;
    const copy = JSON.parse(JSON.stringify(packet), (_k, v) => remap(v));
    copy.articles = []; copy.searchMessage = '这是预制上手题。真实复盘提交后，Via 会通过联网搜索推荐文章。';
    for (const q of copy.questions) q.sourceId = ids[q.sourceId];
    review.data.days[shifted] = copy;
  }
  review.persist();
  store.writeJson(marker, { version: 1, installedAt: new Date().toISOString(), examples: Object.values(ids) });
}
module.exports = { installExamples };
