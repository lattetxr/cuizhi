const SESSIONS = new Map();
const PENDING_STATES = new Map();

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
  setTimeout(() => PENDING_STATES.delete(stateId), 10 * 60 * 1000);
}

export function verifyState(stateId) {
  if (!stateId) return { valid: false, reason: 'missing' };
  if (!PENDING_STATES.has(stateId)) return { valid: false, reason: 'expired_or_invalid' };
  PENDING_STATES.delete(stateId);
  return { valid: true };
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

export async function exchangeCode({ appId, appKey, code, redirectUri }) {
  const body = new URLSearchParams({
    app_id: appId,
    app_key: appKey,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
    code,
  });
  const response = await fetch('https://openapi.zhihu.com/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await response.json().catch(() => ({}));
  if (!data?.access_token) {
    throw new Error(data?.Message || `Token 交换失败（${response.status}）`);
  }
  return data.access_token;
}

export function createSession(accessToken) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  SESSIONS.set(id, {
    accessToken,
    createdAt: Date.now(),
  });
  return id;
}

export function getSession(id) {
  const session = SESSIONS.get(id);
  if (!session) return null;
  if (Date.now() - session.createdAt > 24 * 60 * 60 * 1000) {
    SESSIONS.delete(id);
    return null;
  }
  return session;
}

export function deleteSession(id) {
  SESSIONS.delete(id);
}
