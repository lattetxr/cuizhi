import assert from 'node:assert/strict';
import test from 'node:test';

const { callLlm } = await import('../lib/llm.mjs');

test('callLlm 会在超时后主动中断，避免炼金请求无限等待', async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.LLM_API_KEY;
  process.env.LLM_API_KEY = 'fake-key-for-timeout-test';
  globalThis.fetch = (_url, options = {}) => new Promise((_resolve, reject) => {
    options.signal?.addEventListener('abort', () => {
      const error = new Error('The operation was aborted');
      error.name = 'AbortError';
      reject(error);
    });
  });

  const startedAt = Date.now();
  await assert.rejects(
    () => callLlm([{ role: 'user', content: '测试超时' }], false, { timeoutMs: 1000 }),
    /1 秒/,
  );
  assert.ok(Date.now() - startedAt < 1300, '超时清理应及时完成');

  globalThis.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.LLM_API_KEY;
  else process.env.LLM_API_KEY = originalApiKey;
});
