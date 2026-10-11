(() => {
  'use strict';
  const api = window.viaDesktop;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let status = { available: false, state: 'signedOut', user: null };
  let mode = 'login';
  let busy = false;
  let changed = () => {};
  const dialog = document.createElement('dialog');
  dialog.id = 'authDialog'; dialog.className = 'auth-dialog';
  document.body.append(dialog);
  const welcome = document.createElement('div');
  welcome.className = 'setup-overlay'; welcome.id = 'accountWelcome'; welcome.hidden = true;
  welcome.innerHTML = '<section class="setup-dialog" role="dialog" aria-modal="true" aria-labelledby="accountWelcomeTitle"><span class="setup-mark">v</span><span class="eyebrow">欢迎使用 Via</span><h2 id="accountWelcomeTitle">创建你的 Via 账号</h2><p>用邮箱验证码注册并验证邮箱。账号为后续多端服务建立身份；当前批注仍保存在本机，登录不会自动上传资料。</p><div class="setup-actions"><button class="primary" data-auth="register">注册账号</button><button class="outline-btn" data-auth="login">已有账号，登录</button></div><button class="text-button" data-auth-skip>先在本机使用</button></section>';
  document.body.append(welcome);
  let introSeen = localStorage.getItem('via-account-intro-seen') === '1';
  function dismissIntro() { introSeen = true; localStorage.setItem('via-account-intro-seen', '1'); welcome.hidden = true; }
  function message(text, failure = false) {
    const target = dialog.querySelector('[data-auth-message]');
    if (target) { target.textContent = String(text || ''); target.classList.toggle('failure', failure); }
  }
  function fields() {
    const pending = status.pending;
    const verification = mode === 'verify' && pending;
    const title = verification ? (pending.purpose === 'reset' ? '验证邮箱并设置新密码' : '验证邮箱') : mode === 'register' ? '注册 Via 账号' : mode === 'loginCode' ? '邮箱验证码登录' : mode === 'reset' ? '重置密码' : '登录 Via';
    const email = verification ? pending.email : document.getElementById('accountEmail')?.value || '';
    dialog.innerHTML = `<form id="authForm"><div class="auth-dialog-heading"><h2>${title}</h2><button class="text-button" type="button" data-auth-close aria-label="关闭账号窗口">×</button></div>
      <p class="auth-explanation">${verification ? `验证码已发送到 ${esc(email)}，请在有效期内填写${pending.purpose === 'reset' ? '并设置新密码' : ''}。` : mode === 'reset' ? '输入注册邮箱获取验证码。验证通过并设置新密码后会自动登录。' : '验证邮箱后使用账号。登录不会上传、合并或删除这台电脑的阅读记录。'}</p>
      ${verification ? `<label class="account-field">邮箱验证码<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" minlength="6" maxlength="6" required autofocus></label>${pending.purpose !== 'login' ? '<label class="account-field">设置密码<input name="password" type="password" autocomplete="new-password" minlength="8" maxlength="128" required placeholder="至少 8 位，建议组合字母和数字"></label>' : ''}` : `<label class="account-field">邮箱<input name="email" type="email" autocomplete="email" value="${esc(email)}" maxlength="254" required autofocus></label>${mode === 'login' ? '<label class="account-field">密码<input name="password" type="password" autocomplete="current-password" maxlength="128" required></label>' : ''}`}
      <p data-auth-message class="auth-message" role="status"></p><button class="primary auth-submit" type="submit">${verification ? '验证并继续' : mode === 'login' ? '登录' : '发送验证码'}</button>
      <div class="auth-alternatives">${verification ? '<button type="button" class="text-button" data-auth-resend>重新发送</button><button type="button" class="text-button" data-auth="login">换个邮箱</button>' : '<button type="button" class="text-button" data-auth="register">注册账号</button><button type="button" class="text-button" data-auth="login">密码登录</button><button type="button" class="text-button" data-auth="loginCode">验证码登录</button><button type="button" class="text-button" data-auth="reset">忘记密码</button>'}</div></form>`;
  }
  function lock(value) {
    busy = value;
    dialog.querySelectorAll('button,input').forEach(element => { element.disabled = value; });
  }
  async function execute(job) {
    if (busy) return;
    lock(true); message('正在处理…');
    try {
      status = await job();
      if (status.state === 'signedIn') {
        dialog.close(); dialog.replaceChildren();
      } else if (status.pending) { mode = 'verify'; fields(); }
      else if (mode === 'verify') { mode = 'login'; fields(); message(status.message || '验证已完成，请登录。'); }
      else message(status.message || '操作已完成');
      changed(status);
    } catch (error) { message(error.message.replace(/^Error invoking remote method '[^']+': Error:\s*/, ''), true); }
    finally { lock(false); }
  }
  function open(next) {
    if (busy) return;
    dismissIntro();
    mode = next === 'verify' && status.pending ? 'verify' : next;
    fields();
    if (!dialog.open) dialog.showModal();
    if (!status.available) {
      message(status.message || '邮箱服务尚未就绪，请稍后重试；本机阅读仍可使用。', true);
      dialog.querySelector('.auth-submit').disabled = true;
    }
    changed(status);
  }
  document.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.auth) open(button.dataset.auth);
    else if (button.hasAttribute('data-auth-skip')) { dismissIntro(); changed(status); }
    else if (button.hasAttribute('data-auth-close') && !busy) { dialog.close(); dialog.replaceChildren(); changed(status); }
    else if (button.hasAttribute('data-auth-resend') && status.pending) {
      const wait = new Date(status.pending.resendAfter).getTime() - Date.now();
      if (wait > 0) return message(`请 ${Math.ceil(wait / 1000)} 秒后再发送。`);
      execute(() => api.authSendCode({ email: status.pending.email, purpose: status.pending.purpose }));
    } else if (button.hasAttribute('data-auth-signout') && !busy) {
      lock(true); button.disabled = true;
      api.authSignOut().then(next => { status = next; changed(status); }).catch(error => window.alert(error.message)).finally(() => { lock(false); button.disabled = false; });
    }
  });
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); else { event.preventDefault(); dialog.close(); dialog.replaceChildren(); changed(status); } });
  dialog.addEventListener('submit', event => {
    event.preventDefault();
    if (!status.available || busy) return;
    const data = new FormData(event.target);
    const email = String(data.get('email') || '').trim();
    const password = String(data.get('password') || '');
    const code = String(data.get('code') || '').trim();
    execute(() => mode === 'verify' ? api.authVerifyCode({ code, password }) : mode === 'login' ? api.authSignIn({ email, password }) : api.authSendCode({ email, purpose: mode === 'loginCode' ? 'login' : mode }));
  });
  window.viaAuthUi = {
    configure(callback) { changed = callback; },
    update(next) {
      if (next) status = next;
      welcome.hidden = !(status.available && status.state !== 'signedIn' && !introSeen && !dialog.open);
    },
    blocksSetup() { return !welcome.hidden || dialog.open; },
    summary() {
      if (status.state === 'signedIn') return `<span class="auth-verified">${esc(status.user?.email || '')} · ${status.user?.emailVerified ? '邮箱已验证' : '邮箱待验证'}</span><small>账号 ID · ${esc(status.user?.id || '')}</small>`;
      return `<span>${esc(status.state === 'expired' ? '登录已过期，请重新登录' : status.pending ? `待验证：${status.pending.email}` : '尚未登录')}</span>${status.message ? `<small>${esc(status.message)}</small>` : ''}<small>阅读记录保存在本机；登录不会自动上传。</small>`;
    },
    buttons() { return status.state === 'signedIn' ? '<button class="outline-btn" data-auth-signout>退出登录</button>' : `${status.pending ? '<button class="outline-btn" data-auth="verify">继续验证</button>' : ''}<button class="outline-btn" data-auth="register">注册</button><button class="outline-btn" data-auth="login">登录</button>`; }
  };
})();
