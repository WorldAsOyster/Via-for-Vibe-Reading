'use strict';
const { safeUrl } = require('./search-response.cjs');
function protectNavigation(contents, openExternal) {
  contents.setWindowOpenHandler(({ url }) => {
    const target = safeUrl(url);
    if (target) Promise.resolve(openExternal(target)).catch(() => {});
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    event.preventDefault();
    const target = safeUrl(url);
    if (target) Promise.resolve(openExternal(target)).catch(() => {});
  });
}
function requireDesktopSender(event, window, expectedUrl) {
  if (!window || window.isDestroyed() || event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame || event.senderFrame?.url !== expectedUrl) {
    throw new Error('此操作只允许在 Via 主界面执行');
  }
}
module.exports = { protectNavigation, requireDesktopSender };
