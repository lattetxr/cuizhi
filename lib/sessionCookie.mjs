import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const SESSION_VERSION = 1;

function normalizeSecret(secret) {
  const value = String(secret || '');
  if (value.length < 16) {
    throw new Error('会话密钥长度不足');
  }
  // 32 bytes for AES-256-GCM. Stable server secrets keep users logged in across restarts/replicas.
  return createHash('sha256').update(value).digest();
}

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function decode(value) {
  return JSON.parse(value);
}

export function sealSession(payload, secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', normalizeSecret(secret), iv);
  const body = Buffer.from(JSON.stringify({ v: SESSION_VERSION, ...payload }), 'utf8');
  const encrypted = Buffer.concat([cipher.update(body), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join('.');
}

export function openSession(token, secret) {
  try {
    const [ivText, tagText, dataText] = String(token || '').split('.');
    if (!ivText || !tagText || !dataText) return null;
    const decipher = createDecipheriv('aes-256-gcm', normalizeSecret(secret), Buffer.from(ivText, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataText, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
    const payload = decode(decrypted);
    if (payload.v !== SESSION_VERSION || !payload.accessToken) return null;
    if (payload.expiresAt && Date.now() > payload.expiresAt) return null;
    return {
      accessToken: String(payload.accessToken),
      createdAt: Number(payload.createdAt) || Date.now(),
      expiresAt: Number(payload.expiresAt) || null,
      profile: payload.profile || null,
      stateVerified: Boolean(payload.stateVerified),
    };
  } catch {
    return null;
  }
}



function signState(value, secret) {
  return createHmac('sha256', normalizeSecret(secret)).update(value).digest('base64url');
}

export function createStateToken(secret, ttlMs = 10 * 60 * 1000) {
  const state = `${Date.now().toString(36)}-${randomBytes(18).toString('base64url')}`;
  const expiresAt = Date.now() + ttlMs;
  const body = `${state}.${expiresAt}`;
  return { state, cookie: `${body}.${signState(body, secret)}` };
}

export function verifyStateToken(cookieToken, returnedState, secret) {
  try {
    const parts = String(cookieToken || '').split('.');
    if (parts.length !== 3) return { valid: false, verified: false, reason: 'malformed' };
    const [state, expiresText, signature] = parts;
    const expiresAt = Number(expiresText);
    if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) {
      return { valid: false, verified: false, reason: 'expired' };
    }
    const body = `${state}.${expiresText}`;
    const expected = signState(body, secret);
    const actual = Buffer.from(signature);
    const wanted = Buffer.from(expected);
    if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) {
      return { valid: false, verified: false, reason: 'bad_signature' };
    }
    // 知乎部分环境会丢失 query state。有我方 HttpOnly state cookie 时，仍可证明本次回调来自浏览器刚发起的授权。
    if (returnedState) {
      return returnedState === state
        ? { valid: true, verified: true }
        : { valid: false, verified: false, reason: 'state_mismatch' };
    }
    return { valid: true, verified: true, reason: 'verified_by_cookie' };
  } catch {
    return { valid: false, verified: false, reason: 'invalid' };
  }
}
