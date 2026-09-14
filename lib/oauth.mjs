const SESSIONS = new Map();
const PENDING_STATES = new Map();
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export function isPublicHttps(value) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const local =
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname === '::1' ||
      hostname === '0.0.0.0' ||
      /^127\./.test(hostname) ||
      /^10\./.test(hostname) ||
      /^192\.168\./.test(hostname) ||
      (() => {
        const match = hostname.match(/^172\.(\d{1,3})\./);
        return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
      })();
    return url.protocol === 'https:' && !local;
  } catch {
    return false;
  }
}

export function createPendingState(stateId) {
  PENDING_STATES.set(stateId, { createdAt: Date.now() });
  setTimeout(() => PENDING_STATES.delete(stateId), 10 * 60 * 1000).unref?.();
}

/**
 * 校验知乎回调的 state。
 * 已知协议缺口：知乎当前实测可能不回传 state。返回 { valid, verified }：
 * - verified=true：state 一致
 * - verified=false / valid=true：平台未回传 state，登录可继续，但会提示用户重新授权
 * - valid=false：state 被回传但不匹配/过期，必须拒绝
 */
export function verifyState(stateId) {
  if (!stateId) return { valid: true, verified: false, reason: 'missing' };
  if (!PENDING_STATES.has(stateId)) return { valid: false, verified: false, reason: 'expired_or_invalid' };
  PENDING_STATES.delete(stateId);
  return { valid: true, verified: true };
}

export function buildAuthorizeUrl(config, state = '') {
  const appId = String(config.oauth?.appId || '').trim();
  const redirectUri = String(config.oauth?.redirectUri || '').trim();
  if (!appId || !isPublicHttps(redirectUri)) return null;
  const params = new URLSearchParams({
    redirect_uri: redirectUri,
    app_id: appId,
    response_type: 'code',
  });
  if (state) params.set('state', state);
  return `https://openapi.zhihu.com/authorize?${params.toString()}`;
}

export async function exchangeCode({ appId, appKey, code, redirectUri, fetchImpl = fetch }) {
  const body = new URLSearchParams({
    app_id: appId,
    app_key: appKey,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
    code,
  });
  const response = await fetchImpl('https://openapi.zhihu.com/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  });
  const raw = await response.text().catch(() => '');
  let data = {};
  try {
    data = JSON.parse(raw);
  } catch {
    data = Object.fromEntries(new URLSearchParams(raw));
  }
  const tokenData = data?.data && typeof data.data === 'object' ? data.data : data;
  const accessToken = tokenData?.access_token || data?.access_token || tokenData?.accessToken;
  const expiresIn = Number(tokenData?.expires_in ?? data?.expires_in);
  const apiCode = data?.code ?? data?.Code ?? tokenData?.code;
  const apiMessage = data?.error_description || data?.message || data?.Message || data?.error || tokenData?.message;

  if (!response.ok || !accessToken) {
    const error = new Error('知乎登录暂未完成，请稍后再试');
    error.code = 'OAUTH_TOKEN_FAILED';
    error.status = response.status;
    error.apiCode = apiCode;
    error.apiMessage = apiMessage;
    throw error;
  }
  return {
    accessToken: String(accessToken),
    expiresIn: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : null,
  };
}

export function createSession(accessToken, meta = {}) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const expiresInMs = meta.expiresIn && Number.isFinite(meta.expiresIn)
    ? meta.expiresIn * 1000
    : SESSION_TTL_MS;
  SESSIONS.set(id, {
    accessToken,
    createdAt: Date.now(),
    expiresAt: Date.now() + expiresInMs,
    profile: meta.profile || null,
    stateVerified: Boolean(meta.stateVerified),
  });
  return id;
}

export function getSession(id) {
  const session = SESSIONS.get(id);
  if (!session) return null;
  if (session.expiresAt && Date.now() > session.expiresAt) {
    SESSIONS.delete(id);
    return null;
  }
  return session;
}

export function deleteSession(id) {
  SESSIONS.delete(id);
}
