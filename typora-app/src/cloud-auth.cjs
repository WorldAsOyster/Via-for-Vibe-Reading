'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('./cloud-auth-config.cjs');

const PURPOSES = new Set(['register', 'login', 'reset']);
function email(value) {
  if (typeof value !== 'string' || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) throw new Error('请输入有效的邮箱地址');
  return value.trim();
}
function password(value) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128) throw new Error('密码需为 8–128 个字符');
  return value;
}
function authError(body, status) {
  const code = String(body?.error || body?.code || '');
  const messages = {
    invalid_verification_code: '验证码错误，请重新输入', verification_code_expired: '验证码已过期，请重新发送',
    captcha_required: '平台要求图片验证码验证，请稍后重试；当前版本暂不支持图片验证码',
    rate_limit_exceeded: '操作过于频繁，请稍后重试', resource_exhausted: '操作过于频繁，请稍后重试',
    invalid_password: '邮箱或密码不正确', invalid_credentials: '邮箱或密码不正确', invalid_username_or_password: '邮箱或密码不正确', user_not_found: '账号不存在，请先注册',
    already_exists: '邮箱已注册，请直接登录', unauthenticated: '登录已失效，请重新登录', invalid_grant: '登录已失效，请重新登录',
    failed_precondition: '邮箱登录或邮件代发尚未就绪，请联系 Via 维护人', provider_not_enabled: '邮箱登录尚未开启，请联系 Via 维护人'
  };
  const error = new Error(messages[code] || (status === 429 ? '操作过于频繁，请稍后重试' : `账号服务请求失败（${status || '未知状态'}），请稍后重试`));
  error.authInvalid = status === 401 || ['unauthenticated', 'invalid_grant'].includes(code);
  return error;
}

class CloudAuth {
  constructor(userDataPath, safeStorage, options = {}) {
    this.config = options.config || config;
    this.fetch = options.fetch || globalThis.fetch;
    this.now = options.now || Date.now;
    this.safeStorage = safeStorage;
    this.file = path.join(userDataPath, 'cloud-session.json');
    this.pending = null;
    this.session = null;
    this.state = 'signedOut';
    this.message = '';
    this.epoch = 0;
    this.busy = false;
    this.refreshing = null;
    this.resendAfter = 0;
    this.onChanged = options.changed || (() => {});
    this.deviceId = crypto.randomUUID();
    if (!/^[a-z0-9-]+$/.test(this.config.envId || '')) throw new Error('Invalid public cloud environment');
    this.origin = `https://${this.config.envId}.api.tcloudbasegateway.com`;
    this.load();
  }
  load() {
    if (!fs.existsSync(this.file)) return;
    try {
      const envelope = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (envelope.version !== 1 || envelope.envId !== this.config.envId) throw new Error('session environment mismatch');
      const saved = JSON.parse(this.safeStorage.decryptString(Buffer.from(envelope.encrypted, 'base64')));
      if (!saved.session?.accessToken || !saved.session?.refreshToken || !saved.session?.user?.id || !Number.isFinite(saved.session.expiresAt)) throw new Error('invalid session');
      this.session = saved.session; this.deviceId = saved.deviceId;
      // A loaded session must be verified with the platform before exposing signedIn.
      this.state = 'expired';
    } catch { this.message = '本机登录会话无法恢复，请重新登录'; this.state = 'expired'; }
  }
  persist() {
    if (!this.safeStorage.isEncryptionAvailable()) throw new Error('系统加密存储不可用，暂时无法保存登录会话');
    const encrypted = this.safeStorage.encryptString(JSON.stringify({ session: this.session, deviceId: this.deviceId })).toString('base64');
    const temporary = this.file + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify({ version: 1, envId: this.config.envId, encrypted }), { mode: 0o600 });
    fs.renameSync(temporary, this.file);
  }
  snapshot() {
    const pending = this.pending && this.pending.expiresAt > this.now() ? this.pending : null;
    return { state: pending ? 'pendingVerification' : this.state,
      // Via accounts can only be created after the mailbox code has been
      // verified. Older sessions did not persist that fact reliably, so
      // normalize authenticated email accounts when presenting the session.
      user: this.state === 'signedIn' ? { ...this.session.user, emailVerified: Boolean(this.session.user?.email) } : null,
      pending: pending ? { email: pending.email, purpose: pending.purpose, expiresAt: pending.expiresAt, resendAfter: pending.resendAfter } : null,
      available: true, message: this.message };
  }
  async request(endpoint, body, token) {
    let response;
    try {
      response = await this.fetch(this.origin + '/auth/v1/' + endpoint, {
        method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json',
          'x-device-id': this.deviceId, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error', signal: AbortSignal.timeout(20000)
      });
    } catch { throw new Error('无法连接账号服务，请检查网络后重试'); }
    let data;
    try { data = await response.json(); } catch { throw new Error('账号服务返回异常，请稍后重试'); }
    if (!response.ok || data.error) throw authError(data, response.status);
    return data;
  }
  async rpc(name, body = {}) {
    if (!/^via_[a-z_]+$/.test(name)) throw new Error('不支持的云端操作');
    await this.status();
    if (this.state !== 'signedIn' || !this.session?.accessToken) throw new Error('请先登录 Via 账号');
    let response;
    try {
      response = await this.fetch(`${this.origin}/v1/rdb/rest/rpc/${name}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.session.accessToken}` },
        body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(30000)
      });
    } catch { throw new Error('无法连接同步服务，请检查网络后重试'); }
    let data;
    try { data = await response.json(); } catch { throw new Error('同步服务返回异常，请稍后重试'); }
    if (!response.ok || data?.error || data?.code) {
      const detail = String(data?.message || data?.error_description || data?.error || data?.code || '');
      if (response.status === 401 || /auth|jwt|token/i.test(detail)) {
        this.state = 'expired'; this.message = '登录已失效，请重新登录'; this.onChanged();
        throw new Error(this.message);
      }
      const known = {
        sync_consent_required: '请先确认开启云同步', device_required: '当前设备尚未登记，请重试',
        device_revoked: '当前设备已被撤销，请重新登录', import_confirmation_required: '请先完成旧记录导入确认',
        import_not_writable: '这次导入已结束，请重新开始', operation_id_reused: '同步操作标识冲突，请重试',
        invalid_snapshot: '记录格式不符合云端规则', invalid_comment: '批注格式不符合云端规则',
        invalid_message: '消息格式不符合云端规则', invalid_citation: '联网来源格式不符合云端规则'
      };
      throw new Error(Object.entries(known).find(([key]) => detail.includes(key))?.[1] || `同步服务请求失败（${response.status}）`);
    }
    return data;
  }
  async exclusive(work) {
    if (this.busy) throw new Error('正在处理账号操作，请稍候');
    this.busy = true;
    const epoch = ++this.epoch;
    try { return await work(epoch); } finally { this.busy = false; }
  }
  checkEpoch(epoch) { if (epoch !== this.epoch) throw new Error('账号操作已取消，请重试'); }
  async accept(tokens, epoch) {
    if (!tokens.access_token || !tokens.refresh_token || !tokens.sub || !Number.isFinite(Number(tokens.expires_in))) throw new Error('账号服务返回的会话不完整');
    const raw = await this.request('user/me', undefined, tokens.access_token);
    this.checkEpoch(epoch);
    if (raw.sub !== tokens.sub || typeof raw.email !== 'string' || !raw.email || raw.is_anonymous === true) throw new Error('账号身份核验失败');
    const next = { accessToken: tokens.access_token, refreshToken: tokens.refresh_token,
      expiresAt: this.now() + Number(tokens.expires_in) * 1000,
      user: { id: raw.sub, email: raw.email,
        emailVerified: true } };
    const previous = this.session;
    this.session = next;
    try { this.persist(); } catch (e) { this.session = previous; throw e; }
    this.pending = null; this.state = 'signedIn'; this.message = '';
    this.onChanged(); return this.snapshot();
  }
  async status() {
    if (this.busy) return this.snapshot();
    if (this.session && (this.state !== 'signedIn' || this.session.expiresAt <= this.now() + 60000)) {
      if (!this.refreshing) {
        const epoch = this.epoch;
        this.refreshing = (async () => {
          try {
            const tokens = await this.request('token', { grant_type: 'refresh_token', refresh_token: this.session.refreshToken });
            if (tokens.sub !== this.session?.user.id) throw new Error('会话身份发生变化，请重新登录');
            await this.accept(tokens, epoch);
          } catch (e) {
            if (epoch === this.epoch) {
              this.state = 'expired'; this.message = e.message;
              if (e.authInvalid) { this.session = null; fs.rmSync(this.file, { force: true }); }
            }
          } finally { this.refreshing = null; }
        })();
      }
      await this.refreshing;
    }
    return this.snapshot();
  }
  async sendCode(input) {
    return this.exclusive(async epoch => {
      const address = email(input?.email), purpose = input?.purpose;
      if (!PURPOSES.has(purpose)) throw new Error('不支持的验证码用途');
      if (this.resendAfter > this.now()) throw new Error('请等待 60 秒后再发送验证码');
      const data = await this.request('verification', { email: address, target: purpose === 'register' ? 'ANY' : 'USER' });
      this.checkEpoch(epoch);
      this.resendAfter = this.now() + 60000;
      if (purpose === 'register' && data.is_user === true) throw new Error('邮箱已注册，请直接登录');
      if (!data.verification_id) throw new Error('验证码发送未完成，请稍后重试');
      this.pending = { email: address, purpose, verificationId: data.verification_id,
        expiresAt: this.now() + Math.min(Number(data.expires_in) || 600, 600) * 1000, resendAfter: this.resendAfter };
      this.message = '验证码已发送，请查看邮箱'; this.onChanged(); return this.snapshot();
    });
  }
  async verifyCode(input) {
    return this.exclusive(async epoch => {
      const pending = this.pending;
      if (!pending || pending.expiresAt <= this.now()) throw new Error('请重新发送验证码');
      if (typeof input?.code !== 'string' || !/^\d{6}$/.test(input.code)) throw new Error('请输入 6 位数字验证码');
      const nextPassword = pending.purpose === 'login' ? null : password(input.password);
      const verified = await this.request('verification/verify', { verification_id: pending.verificationId, verification_code: input.code });
      this.checkEpoch(epoch);
      if (!verified.verification_token) throw new Error('验证码验证未完成');
      let tokens;
      if (pending.purpose === 'register') tokens = await this.request('signup', { email: pending.email, password: nextPassword, verification_token: verified.verification_token });
      else if (pending.purpose === 'reset') {
        await this.request('reset', { email: pending.email, new_password: nextPassword, verification_token: verified.verification_token });
        this.checkEpoch(epoch);
        tokens = await this.request('signin', { username: pending.email, password: nextPassword });
      } else tokens = await this.request('signin', { verification_token: verified.verification_token });
      return this.accept(tokens, epoch);
    });
  }
  async signIn(input) {
    return this.exclusive(async epoch => {
      const tokens = await this.request('signin', { username: email(input?.email), password: password(input?.password) });
      return this.accept(tokens, epoch);
    });
  }
  async signOut() {
    // Invalidate in-flight login/refresh before any network wait.
    this.epoch++; const token = this.session?.accessToken;
    this.session = null; this.pending = null; this.state = 'signedOut'; this.message = '';
    fs.rmSync(this.file, { force: true }); this.onChanged();
    if (token) { try { await this.request('user/signout', {}, token); } catch { this.message = '已退出本机；未能确认远端退出，请联网后检查账号设备'; } }
    return this.snapshot();
  }
}
module.exports = { CloudAuth, authError };
