'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.resolve(process.env.VIA_DEMO_OUTPUT || path.resolve(root, '../demo'));
const assets = path.join(output, 'assets');
fs.mkdirSync(assets, { recursive: true });
function copy(from, to) { fs.copyFileSync(path.join(root, from), path.join(assets, to)); }
for (const [from, to] of [
  ['src/desktop/app.js','desktop.js'], ['src/desktop/styles.css','desktop.css'], ['src/desktop/help-content.js','help-content.js'],
  ['src/desktop/daily-review.js','daily-review.js'], ['src/desktop/daily-review.css','daily-review.css'],
  ['src/shared/export-scope.js','export-scope.js'],
  ['src/renderer/app.js','sidecar.js'], ['src/renderer/styles.css','sidecar.css'],
  ['src/shared/markdown-it.min.js','markdown-it.min.js'], ['src/shared/markdown-it-LICENSE.txt','markdown-it-LICENSE.txt'],
  ['src/shared/search-evidence.js','search-evidence.js'], ['frontend/runtime.js','runtime.js'], ['frontend/styles.css','demo.css']
]) copy(from,to);
fs.mkdirSync(path.join(output,'help-images'),{recursive:true});
for (const file of fs.readdirSync(path.join(root,'src/desktop/help-images')).filter(file=>file.startsWith('typora-'))) {
  fs.mkdirSync(path.join(output,'help-images'),{recursive:true});
  fs.copyFileSync(path.join(root,'src/desktop/help-images',file),path.join(output,'help-images',file));
}
let pdf = fs.readFileSync(path.join(root,'src/pdf.cjs'),'utf8')
  .replace("require('markdown-it')",'window.markdownit')
  .replace("require('./shared/search-evidence.js')",'window.viaSearchEvidence')
  .replace("require('./shared/export-scope.js')",'window.viaExportScope')
  .replace('module.exports =','window.viaDemoPdf =');
pdf = pdf.replace('const markdown = new MarkdownIt({ html: false, linkify: false, typographer: true });', "const markdown = new MarkdownIt({ html: false, linkify: false, typographer: true }).disable(['image','link','autolink']);");
fs.writeFileSync(path.join(assets,'pdf.js'),'(() => {\n'+pdf+'\n})();');
const dataModule = fs.readFileSync(path.join(root,'src/desktop-data.cjs'),'utf8').replace('module.exports =', 'window.viaDemoData =');
fs.writeFileSync(path.join(assets,'data.js'), '(() => {\n' + dataModule + '\n})();');
fs.writeFileSync(path.join(assets,'seed.js'), 'window.viaDemoSeed = ' + JSON.stringify(require('./fixture.cjs')) + ';\n');
const scripts = '<link rel="stylesheet" href="assets/demo.css"><script src="assets/data.js"></script><script src="assets/seed.js"></script><script src="assets/runtime.js"></script>';
for (const [type, name] of [['renderer','index.html'], ['desktop','workbench.html']]) {
  let html = fs.readFileSync(path.join(root,'src',type,'index.html'),'utf8');
  html = html.replace('href="styles.css"', `href="assets/${type === 'desktop' ? 'desktop' : 'sidecar'}.css"`)
    .replace('src="app.js"', `src="assets/${type === 'desktop' ? 'desktop' : 'sidecar'}.js"`)
    .replaceAll('src="../shared/', 'src="assets/').replace('src="help-content.js"','src="assets/help-content.js"')
    .replace('href="daily-review.css"','href="assets/daily-review.css"').replace('src="daily-review.js"','src="assets/daily-review.js"')
    .replace('  <script src="auth-ui.js"></script>','')
    .replace('<script src="assets/sidecar.js">','<script src="assets/pdf.js"></script><script src="assets/sidecar.js">')
    .replace('<script src="assets/desktop.js">','<script src="assets/markdown-it.min.js"></script><script src="assets/search-evidence.js"></script><script src="assets/export-scope.js"></script><script src="assets/pdf.js"></script><script src="assets/desktop.js">')
    .replace('</head>', scripts + '</head>');
  if (type === 'renderer') html = html.replace('原文与全部批注 · PDF', '原文与全部批注 · 打印 / PDF');
  fs.writeFileSync(path.join(output,name), html);
}
fs.copyFileSync(path.join(__dirname,'DEPLOY.md'),path.join(output,'README.md'));
fs.writeFileSync(path.join(output,'package.json'),JSON.stringify({name:'via-markdown-demo',version:'2.1.5',private:true,license:'UNLICENSED',scripts:{start:'vite --host 0.0.0.0',dev:'vite --host 0.0.0.0',build:'vite build',preview:'vite preview --host 0.0.0.0'},devDependencies:{vite:'8.3.4'}},null,2));
fs.writeFileSync(path.join(output,'vite.config.mjs'),"import { defineConfig } from 'vite';\nimport { resolve } from 'node:path';\nimport { cpSync } from 'node:fs';\nexport default defineConfig({ base: './', plugins: [{ name: 'via-static-assets', closeBundle() { for(const folder of ['assets','help-images']) cpSync(resolve(import.meta.dirname, folder), resolve(import.meta.dirname, 'dist', folder), { recursive: true }); } }], build: { rollupOptions: { input: { reading: resolve(import.meta.dirname, 'index.html'), workbench: resolve(import.meta.dirname, 'workbench.html') } } } });\n");
console.log('Static demo built at '+output);
