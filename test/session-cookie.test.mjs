import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createStateToken,
  openSession,
  sealSession,
  verifyStateToken,
} from '../lib/sessionCookie.mjs';
import { exchangeCode } from '../lib/oauth.mjs';

const secret = 'test-session-secret-at-least-16-chars';

test('加密会话 Cookie 可跨进程重启后解密，篡改后失效', () => {
  const session = {
    accessToken: 'oauth-token',
    createdAt: 1,
    expiresAt: Date.now() + 60_000,
    profile: { name: '知乎用户' },
    stateVerified: true,
  };
  const token = sealSession(session, secret);
  assert.equal(openSession(token, secret)?.accessToken, 'oauth-token');
  assert.equal(openSession(`${token}x`, secret), null);
  assert.equal(openSession(token, 'another-secret-at-least-16-chars'), null);
});

test('OAuth state cookie 支持知乎不回传 state 的场景，并拒绝过期/伪造 state', () => {
  const state = createStateToken(secret);
  assert.deepEqual(
    verifyStateToken(state.cookie, state.state, secret),
    { valid: true, verified: true },
  );
  assert.deepEqual(verifyStateToken(state.cookie, '', secret), { valid: true, verified: true, reason: 'verified_by_cookie' });
  assert.equal(verifyStateToken(`${state.cookie}x`, state.state, secret).valid, false);
  const expired = createStateToken(secret, -1);
  assert.equal(verifyStateToken(expired.cookie, expired.state, secret).valid, false);
});

test('exchangeCode 兼容嵌套 data.access_token 响应', async () => {
  const requests = [];
  const result = await exchangeCode({
    appId: '467',
    appKey: 'app-key',
    code: 'authorization-code',
    redirectUri: 'https://example.com/auth/callback',
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ code: 20000, data: { access_token: 'nested-token', expires_in: 7200 } });
        },
      };
    },
  });
  assert.deepEqual(result, { accessToken: 'nested-token', expiresIn: 7200 });
  assert.equal(requests[0].url, 'https://openapi.zhihu.com/access_token');
  assert.match(String(requests[0].options.body), /grant_type=authorization_code/);
});
