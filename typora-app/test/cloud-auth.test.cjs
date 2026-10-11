'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { CloudAuth } = require('../src/cloud-auth.cjs');
const storage = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => value.toString() };
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
function fixture(fetch) {
  fs.mkdirSync(path.join(__dirname, '..', '.test-data'), { recursive: true });
  const dir = fs.mkdtempSync(path.join(__dirname, '..', '.test-data', 'cloud-auth-'));
  const auth = new CloudAuth(dir, storage, { fetch, config: { envId: 'fixture-env', region: 'ap-shanghai' } });
  return { auth, dir };
}
test('email registration verifies identity, encrypts the session and restores it only after refresh', async () => {
  const calls = [];
  const { auth, dir } = fixture(async (url, options) => {
    const endpoint = new URL(url).pathname; const body = options.body ? JSON.parse(options.body) : null; calls.push({ endpoint, body });
    if (endpoint.endsWith('/verification')) return response({ verification_id: 'verify-1', expires_in: 600, is_user: false });
    if (endpoint.endsWith('/verification/verify')) return response({ verification_token: 'verified-token' });
    if (endpoint.endsWith('/signup')) return response({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 7200, sub: 'user-1' });
    if (endpoint.endsWith('/user/me')) return response({ sub: 'user-1', email: 'reader@example.test', providers: [{ id: 'email', provider_user_id: 'reader@example.test' }] });
    if (endpoint.endsWith('/token')) return response({ access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 7200, sub: 'user-1' });
    throw Error(endpoint);
  });
  try {
    const pending = await auth.sendCode({ email: 'reader@example.test', purpose: 'register' });
    assert.equal(pending.state, 'pendingVerification'); assert.equal(pending.pending.email, 'reader@example.test');
    const signed = await auth.verifyCode({ code: '123456', password: 'Password123!' });
    assert.deepEqual(signed.user, { id: 'user-1', email: 'reader@example.test', emailVerified: true });
    auth.session.user.emailVerified = false;
    assert.equal(auth.snapshot().user.emailVerified, true, 'older verified email sessions should recover their verified state');
    assert.ok(fs.existsSync(auth.file)); assert.ok(!fs.readFileSync(auth.file, 'utf8').includes('access-1'));
    assert.deepEqual(calls.find(item => item.endpoint.endsWith('/signup')).body, { email: 'reader@example.test', password: 'Password123!', verification_token: 'verified-token' });
    const restored = new CloudAuth(dir, storage, { fetch: auth.fetch, config: auth.config });
    assert.equal(restored.snapshot().state, 'expired');
    assert.equal((await restored.status()).state, 'signedIn');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('passwordless login sends only verification token and stale refresh cannot replace a new login', async () => {
  let releaseRefresh; const oldRefresh = new Promise(resolve => { releaseRefresh = resolve; });
  const { auth, dir } = fixture(async (url, options) => {
    const endpoint = new URL(url).pathname; const body = options.body ? JSON.parse(options.body) : null;
    if (endpoint.endsWith('/token')) { await oldRefresh; return response({ access_token: 'old-access', refresh_token: 'old-refresh-2', expires_in: 7200, sub: 'old-user' }); }
    if (endpoint.endsWith('/signin') && body.password) return response({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 7200, sub: 'new-user' });
    if (endpoint.endsWith('/user/me')) return response(options.headers.Authorization.includes('new-access') ? { sub: 'new-user', email: 'new@example.test', providers: [{ id: 'email', provider_user_id: 'new@example.test' }] } : { sub: 'old-user', email: 'old@example.test', providers: [{ id: 'email', provider_user_id: 'old@example.test' }] });
    throw Error(endpoint);
  });
  try {
    auth.session = { accessToken: 'old', refreshToken: 'old-refresh', expiresAt: 0, user: { id: 'old-user', email: 'old@example.test', emailVerified: true } }; auth.state = 'expired';
    const refreshing = auth.status();
    const signed = await auth.signIn({ email: 'new@example.test', password: 'Password123!' });
    assert.equal(signed.user.id, 'new-user');
    releaseRefresh(); await refreshing;
    assert.equal(auth.snapshot().user.id, 'new-user');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('auth errors stay user-readable and secrets are never returned', async () => {
  const { auth, dir } = fixture(async () => response({ error: 'invalid_username_or_password' }, 400));
  try {
    await assert.rejects(auth.signIn({ email: 'reader@example.test', password: 'Password123!' }), /邮箱或密码不正确/);
    assert.equal(JSON.stringify(auth.snapshot()).includes('password'), false);
    await assert.rejects(auth.sendCode({ email: 'reader@example.test', purpose: 'resetPassword' }), /不支持/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('forgotten password uses a verified email token and signs in with the new password', async () => {
  const calls = [];
  const { auth, dir } = fixture(async (url, options) => {
    const endpoint = new URL(url).pathname; const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ endpoint, body });
    if (endpoint.endsWith('/verification')) return response({ verification_id: 'reset-verify', expires_in: 600, is_user: true });
    if (endpoint.endsWith('/verification/verify')) return response({ verification_token: 'reset-token' });
    if (endpoint.endsWith('/reset')) return response({});
    if (endpoint.endsWith('/signin')) return response({ access_token: 'access-reset', refresh_token: 'refresh-reset', expires_in: 7200, sub: 'user-reset' });
    if (endpoint.endsWith('/user/me')) return response({ sub: 'user-reset', email: 'reader@example.test', providers: [{ id: 'email', provider_user_id: 'reader@example.test' }] });
    throw Error(endpoint);
  });
  try {
    await auth.sendCode({ email: 'reader@example.test', purpose: 'reset' });
    const signed = await auth.verifyCode({ code: '123456', password: 'NewPassword123!' });
    assert.equal(signed.state, 'signedIn');
    assert.deepEqual(calls.find(item => item.endpoint.endsWith('/reset')).body, {
      email: 'reader@example.test', new_password: 'NewPassword123!', verification_token: 'reset-token'
    });
    assert.deepEqual(calls.find(item => item.endpoint.endsWith('/signin')).body, {
      username: 'reader@example.test', password: 'NewPassword123!'
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('database RPC uses the verified session internally without exposing its token', async () => {
  let request;
  const { auth, dir } = fixture(async (url, options) => {
    request = { url, options };
    return response({ syncEnabled: false });
  });
  try {
    auth.session = { accessToken: 'private-access-token', refreshToken: 'refresh', expiresAt: Date.now() + 3_600_000,
      user: { id: 'user-1', email: 'reader@example.test', emailVerified: true } };
    auth.state = 'signedIn';
    assert.deepEqual(await auth.rpc('via_disable_sync'), { syncEnabled: false });
    assert.equal(request.url, 'https://fixture-env.api.tcloudbasegateway.com/v1/rdb/rest/rpc/via_disable_sync');
    assert.equal(request.options.headers.Authorization, 'Bearer private-access-token');
    assert.equal(JSON.stringify(auth.snapshot()).includes('private-access-token'), false);
    await assert.rejects(auth.rpc('other_function'), /不支持/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
