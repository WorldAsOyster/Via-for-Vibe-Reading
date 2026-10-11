'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname,'..');

test('review delivery builds two independent static entries with no backend dependency', () => {
  const out = path.join(root,'.test-data','frontend-contract');
  execFileSync(process.execPath,[path.join(root,'frontend','build.cjs')],{env:{...process.env,VIA_DEMO_OUTPUT:out}});
  for(const file of ['index.html','workbench.html']) {
    const html=fs.readFileSync(path.join(out,file),'utf8');
    for(const match of html.matchAll(/(?:src|href)="(assets\/[^"#]+)"/g)) assert.ok(fs.existsSync(path.join(out,match[1])), `${file}: missing ${match[1]}`);
    assert.doesNotMatch(html,/preview-bar|auth-ui\.js|preload\.cjs/);
  }
  const runtime=fs.readFileSync(path.join(out,'assets','runtime.js'),'utf8');
  assert.doesNotMatch(runtime,/fetch\(|\/api\/|require\(['"]electron/);
  assert.match(runtime,/localStorage\.setItem/);
  assert.match(runtime,/location\.href='workbench\.html'/);
  assert.match(runtime,/location\.href='index\.html\?doc=/);
  const pkg=JSON.parse(fs.readFileSync(path.join(out,'package.json'),'utf8'));
  assert.equal(pkg.version,'2.1.5');
  assert.ok(pkg.scripts.build);
});

test('portable desktop derivation shares full sample conversations and separate todo completion', () => {
  const seed=structuredClone(require('../frontend/fixture.cjs'));
  const browser={window:{}};
  vm.runInNewContext(fs.readFileSync(path.join(root,'src','desktop-data.cjs'),'utf8').replace('module.exports =','window.viaDemoData ='),browser);
  const before=browser.window.viaDemoData.deriveDesktopData(seed.sources);
  assert.equal(before.tasks.length,6);
  assert.equal(before.sources.length,2);
  assert.equal(before.saved[0].messages.length,3);
  seed.sources[0].todoStates['task-adoption']={resolvedAt:'2026-10-11T03:00:00Z'};
  const after=browser.window.viaDemoData.deriveDesktopData(seed.sources);
  assert.equal(after.metrics.pendingTasks,before.metrics.pendingTasks-1);
  assert.equal(after.metrics.comments,before.metrics.comments);
  assert.equal(after.metrics.averageReadingMinutes,null);
});
