import { getHttpAccessSecret } from './config.mjs';

const DEVELOPER_BASE = 'https://developer.zhihu.com';
const OPENAPI_BASE = 'https://openapi.zhihu.com';

export const USER_ENDPOINTS = {
  contents: '/api/v1/user/contents',
  followees: '/api/v1/user/followees',
  favlists: '/api/v1/user/favlists',
  favlistContents: '/api/v1/user/favlist_contents',
  collections: '/api/v1/user/collections',
};

export function clampLimit(value, fallback = 20) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(50, Math.max(1, n));
}

export function normalizeOffset(value) {
  if (value === undefined || value === null || value === '') return '0';
  // 服务端 NextOffset 是字符串，分页时必须原样回传；这里只做字符白名单清洗
  return String(value).replace(/[^0-9]/g, '') || '0';
}

export function normalizePaging(paging, { offset = '0', limit = 20 } = {}) {
  const isEnd = paging ? Boolean(paging.IsEnd) : true;
  let nextOffset = null;
  if (!isEnd) {
    const raw = paging?.NextOffset;
    if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
      nextOffset = String(raw);
    } else {
      const base = Number.parseInt(String(offset), 10);
      nextOffset = String(Number.isFinite(base) ? base + limit : limit);
    }
  }
  return {
    isEnd,
    nextOffset,
    totals: Number(paging?.Totals || 0),
  };
}

function commonHeaders(accessSecret) {
  return {
    Authorization: `Bearer ${accessSecret}`,
    'X-Request-Timestamp': String(Math.floor(Date.now() / 1000)),
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

/**
 * 调用知乎用户数据 API。
 * - oauthToken 非空：第三方应用代表已授权用户（X-OAuth-Token）
 * - oauthToken 为空：服务端凭证所属账号本人模式（独立部署）
 */
export async function callUserApi(endpoint, params = {}, oauthToken) {
  const access = getHttpAccessSecret();
  if (!access.value) throw new Error('暂时无法连接知乎服务，请稍后再试');
  const url = new URL(DEVELOPER_BASE + endpoint);
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  const headers = commonHeaders(access.value);
  if (oauthToken) headers['X-OAuth-Token'] = oauthToken;

  const doFetch = () => fetch(url, { headers });
  let response = await doFetch();
  let data = await response.json().catch(() => ({}));
  // 知乎用户数据接口有 QPS 限制（30001），并发打开用户中心时退避重试一次
  if ((data.Code === 30001 || /second limit/i.test(String(data.Message || ''))) ) {
    await new Promise((r) => setTimeout(r, 700));
    response = await doFetch();
    data = await response.json().catch(() => ({}));
  }
  if (!response.ok || (data.Code !== undefined && data.Code !== 0)) {
    const error = new Error(data.Message || `知乎接口返回 ${response.status}`);
    error.code = data.Code;
    error.status = response.status;
    throw error;
  }
  return data.Data || data;
}

/**
 * OAuth 登录后获取授权用户资料（昵称/头像）。
 * /user 使用 OAuth access_token 本身作为 Bearer，不使用开放平台 Access Secret。
 * 该接口暂无正式响应 schema，任何失败都返回 null，避免阻断登录与用户数据接口。
 */
function normalizePublicUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('//')) return `https:${raw}`;
  return raw;
}

export async function fetchOAuthUser(oauthToken) {
  if (!oauthToken) return null;
  let payload = null;
  try {
    const response = await fetch(`${OPENAPI_BASE}/user`, {
      headers: {
        Authorization: `Bearer ${oauthToken}`,
        Accept: 'application/json',
      },
    });
    payload = await response.json().catch(() => null);
    if (!response.ok) return null;
  } catch {
    return null;
  }

  // 成功响应常见为 { code: 20000, data: {...} }；保留多种字段命名以兼容协议微调。
  if (payload?.code !== undefined && ![0, 20000].includes(Number(payload.code))) return null;
  const source = [payload?.data, payload?.Data, payload?.user, payload?.User, payload]
    .find((item) => item && typeof item === 'object' && !Array.isArray(item));
  if (!source) return null;

  const name = String(
    source.name || source.Name || source.fullname || source.Fullname || source.nickname || source.Nickname || '',
  ).trim();
  const avatarUrl = normalizePublicUrl(
    source.avatar_url || source.AvatarUrl || source.avatarUrl || source.avatar || source.Avatar || '',
  );
  const headline = String(
    source.headline || source.Headline || source.headline_text || source.description || source.Description || '',
  ).trim();
  // 用户主页 Token 字段在当前 OAuth 资料接口中不稳定；未确认可访问前不在产品里提供主页入口。
  if (!name && !avatarUrl) return null;
  return {
    name: name || '知乎用户',
    avatarUrl: avatarUrl || null,
    headline: headline || null,
    url: null,
  };
}
