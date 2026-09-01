import { getHttpAccessSecret } from './config.mjs';

const BASE = 'https://developer.zhihu.com';

export const USER_ENDPOINTS = {
  contents: '/api/v1/user/contents',
  followees: '/api/v1/user/followees',
  favlists: '/api/v1/user/favlists',
  favlistContents: '/api/v1/user/favlist_contents',
  collections: '/api/v1/user/collections',
};

export async function callUserApi(endpoint, params, oauthToken) {
  const access = getHttpAccessSecret();
  if (!access.value) throw new Error('Access Secret 未配置');
  if (!oauthToken) throw new Error('OAuth Token 未配置');
  const url = new URL(BASE + endpoint);
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${access.value}`,
      'X-Request-Timestamp': String(Math.floor(Date.now() / 1000)),
      'X-OAuth-Token': oauthToken,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || (data.Code !== undefined && data.Code !== 0)) {
    throw new Error(data.Message || `知乎接口返回 ${response.status}`);
  }
  return data.Data || data;
}
