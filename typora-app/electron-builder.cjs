'use strict';
const { version } = require('./package.json');

module.exports = {
  appId: 'com.worldasoyster.via.localmarkdown',
  productName: 'Via Local',
  copyright: 'Copyright © 2026 WorldAsOyster. All rights reserved.',
  directories: { output: `dist/v${version}-shipping`, buildResources: 'release' },
  electronDist: 'node_modules/electron/dist',
  // The existing PowerShell helpers are invoked using real paths under src.
  asar: false,
  npmRebuild: false,
  files: ['src/**/*', '!src/browser-bridge.cjs', '!src/web-store.cjs', '!src/cloud-sync.cjs', 'package.json'],
  extraFiles: [{ from: 'release/launch-via.cmd', to: 'launch-via.cmd' }],
  extraResources: [
    { from: 'onboarding', to: 'examples', filter: ['**/*'] },
    { from: 'release/via.ico', to: 'via.ico' }
  ],
  forceCodeSigning: false,
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'release/via.ico',
    executableName: 'ViaLocal',
    requestedExecutionLevel: 'asInvoker',
    artifactName: 'Via-${version}-Setup-${arch}.exe',
    signAndEditExecutable: true,
    signExecutable: false,
    verifyUpdateCodeSignature: false
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowElevation: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'Via Local',
    uninstallDisplayName: 'Via Local',
    deleteAppDataOnUninstall: false,
    runAfterFinish: false,
    differentialPackage: false,
    installerLanguages: ['zh_CN', 'en_US'],
    language: '2052'
  },
  publish: null
};
