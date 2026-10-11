'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const pkg = require('../package.json');
const release = path.join(root, 'dist', `v${pkg.version}-shipping`);
const unpacked = path.join(release, 'win-unpacked');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(item => {
    const file = path.join(dir, item.name);
    assert.ok(!item.isSymbolicLink(), `Unexpected symlink: ${file}`);
    return item.isDirectory() ? files(file) : [file];
  }).sort();
}
const sourceFiles = [];
for (const [source, target] of [
  [path.join(root, 'src'), 'resources/app/src'],
  [path.join(root, 'onboarding'), 'resources/examples']
]) {
  const original = files(source).filter(f => !['browser-bridge.cjs','web-store.cjs','cloud-sync.cjs'].includes(path.basename(f)));
  const packaged = files(path.join(unpacked, target));
  assert.equal(packaged.length, original.length, `Unexpected files in ${target}`);
  for (const file of original) {
    const relative = path.relative(source, file);
    const sha256 = hash(file);
    assert.equal(hash(path.join(unpacked, target, relative)), sha256, `Source changed during build: ${relative}`);
    sourceFiles.push({ path: path.join(target, relative).replaceAll('\\', '/'), sha256 });
  }
}
assert.equal(hash(path.join(unpacked, 'launch-via.cmd')), hash(path.join(root, 'release', 'launch-via.cmd')));
assert.equal(hash(path.join(unpacked, 'resources', 'via.ico')), hash(path.join(root, 'release', 'via.ico')));
const appDir = path.join(unpacked, 'resources', 'app');
const packaged = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json')));
for (const field of ['name', 'version', 'main', 'dependencies']) assert.deepEqual(packaged[field], pkg[field]);
assert.ok(!packaged.devDependencies && !packaged.scripts, 'Development metadata must not be shipped');
assert.ok(!fs.existsSync(path.join(appDir, 'node_modules', 'electron-builder')));
assert.ok(!fs.existsSync(path.join(unpacked, 'resources/browser-extension')));
for (const name of ['browser-bridge.cjs', 'web-store.cjs', 'cloud-sync.cjs']) assert.ok(!fs.existsSync(path.join(appDir, 'src', name)));
assert.equal(require('../electron-builder.cjs').appId, 'com.worldasoyster.via.localmarkdown');
assert.ok(fs.existsSync(path.join(unpacked, 'ViaLocal.exe')));
assert.ok(!fs.existsSync(path.join(unpacked, 'Via.exe')));
const runtimeFiles = files(unpacked).map(file => ({
  path: path.relative(unpacked, file).replaceAll('\\', '/'), bytes: fs.statSync(file).size, sha256: hash(file)
}));
for (const item of runtimeFiles) {
  assert.ok(!/(^|\/)(\.test-data|\.git|trashwaiting|\.npm-cache|\.electron-cache|cloud|test)(\/|$)/.test(item.path), `Unexpected private/development file: ${item.path}`);
}
const artifacts = [`Via-${pkg.version}-Setup-x64.exe`, `Via-${pkg.version}-win-x64.zip`].map(name => ({
  name, bytes: fs.statSync(path.join(release, name)).size, sha256: hash(path.join(release, name))
}));
const metadata = {
  checkedAt: new Date().toISOString(), appVersion: pkg.version,
  appId: 'com.worldasoyster.via.localmarkdown',
  electronVersion: pkg.devDependencies.electron, builderVersion: pkg.devDependencies['electron-builder'],
  signed: false, sourceCommit: null, sourceIdentity: 'Workspace file hashes; repository has no HEAD commit',
  excludedWorkspaceFiles: [],
  lockSha256: hash(path.join(root, 'package-lock.json')),
  configSha256: hash(path.join(root, 'electron-builder.cjs')),
  artifacts, sourceFiles, runtimeFiles
};
fs.writeFileSync(path.join(release, 'build-manifest.json'), JSON.stringify(metadata, null, 2) + '\n');
fs.writeFileSync(path.join(release, 'SHA256SUMS.txt'), artifacts.map(item => `${item.sha256}  ${item.name}`).join('\n') + '\n');
console.log(JSON.stringify({ appVersion: pkg.version, sourceFiles: sourceFiles.length, runtimeFiles: runtimeFiles.length, artifacts }, null, 2));
