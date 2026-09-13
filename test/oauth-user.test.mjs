import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isPublicHttps,
  createPendingState,
  verifyState,
  buildAuthorizeUrl,
} from '../lib/oauth.mjs';
import {
  clampLimit,
  normalizeOffset,
  normalizePaging,
} from '../lib/zhihuApi.mjs';

test('isPublicHttps 只接受公网 HTTPS', () => {
  assert.equal(isPublicHttps('https://cuizhi-production.up.railway.app/auth/callback'), true);
  assert.equal(isPublicHttps('http://cuizhi.example.com/auth/callback'), false);
  assert.equal(isPublicHttps('https://localhost/auth/callback'), false);
  assert.equal(isPublicHttps('https://127.0.0.1/auth/callback'), false);
});

test('verifyState: 平台未回传 state 时允许继续但标记未校验', () => {
  assert.deepEqual(verifyState(''), { valid: true, verified: false, reason: 'missing' });
  assert.equal(verifyState('expired').valid, false);
  createPendingState('abc');
  assert.deepEqual(verifyState('abc'), { valid: true, verified: true });
  assert.equal(verifyState('abc').valid, false);
});

test('buildAuthorizeUrl 包含 redirect_uri/app_id/state', () => {
  const config = {
    oauth: { appId: 'rui-rui-29-60-82', redirectUri: 'https://cuizhi.example.com/auth/callback' },
  };
  const url = new URL(buildAuthorizeUrl(config, 's1'));
  assert.equal(url.origin, 'https://openapi.zhihu.com');
  assert.equal(url.searchParams.get('app_id'), 'rui-rui-29-60-82');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('state'), 's1');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://cuizhi.example.com/auth/callback');
});

test('clampLimit 约束到 1..50 并回退默认值', () => {
  assert.equal(clampLimit('100', 20), 50);
  assert.equal(clampLimit('0', 20), 1);
  assert.equal(clampLimit('abc', 20), 20);
  assert.equal(clampLimit(undefined, 12), 12);
});

test('normalizeOffset 原样保留数字型 NextOffset 字符串', () => {
  assert.equal(normalizeOffset(undefined), '0');
  assert.equal(normalizeOffset('12'), '12');
  assert.equal(normalizeOffset(12), '12');
});

test('normalizePaging 处理末页与 NextOffset', () => {
  assert.deepEqual(normalizePaging({ IsEnd: true, Totals: 3 }), {
    isEnd: true, nextOffset: null, totals: 3,
  });
  assert.deepEqual(normalizePaging({ IsEnd: false, NextOffset: '12', Totals: 30 }, { offset: '2', limit: 10 }), {
    isEnd: false, nextOffset: '12', totals: 30,
  });
  const fallback = normalizePaging({ IsEnd: false }, { offset: '0', limit: 10 });
  assert.equal(fallback.isEnd, false);
  assert.equal(fallback.nextOffset, '10');
});
