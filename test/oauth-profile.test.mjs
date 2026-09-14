import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchOAuthUser } from '../lib/zhihuApi.mjs';

test('OAuth 用户资料使用 access token 作为 Bearer 并解析昵称头像', async () => {
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    return {
      ok: true,
      async json() {
        return {
          code: 20000,
          data: {
            name: '知乎同学',
            avatar_url: '//pic.example.com/avatar.jpg',
            headline: '终身学习者',
            url_token: 'zhihu-user',
          },
        };
      },
    };
  };
  try {
    const profile = await fetchOAuthUser('oauth-token-123');
    assert.deepEqual(profile, {
      name: '知乎同学',
      avatarUrl: 'https://pic.example.com/avatar.jpg',
      headline: '终身学习者',
      url: 'https://www.zhihu.com/people/zhihu-user',
    });
    assert.equal(requests[0].url, 'https://openapi.zhihu.com/user');
    assert.equal(requests[0].options.headers.Authorization, 'Bearer oauth-token-123');
    assert.equal(requests[0].options.headers['X-OAuth-Token'], undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('OAuth 用户资料接口返回业务失败时不生成占位用户', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return { code: 20005, data: "Access token is not' valid" };
    },
  });
  try {
    assert.equal(await fetchOAuthUser('bad-token'), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
