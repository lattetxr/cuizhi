import assert from 'node:assert/strict';
import test from 'node:test';

process.env.CUZHI_LLM_MODE = 'mock';
process.env.LLM_API_KEY = '';

const { generateLearningPackage } = await import('../lib/llm.mjs');

test('Mock 学习包包含完整结构', async () => {
  const result = await generateLearningPackage({
    title: '测试标题',
    sourceUrl: 'https://www.zhihu.com/question/1',
    sourceExcerpt: '这是一段用于测试的正文内容。',
    goal: '备考',
  });
  assert.equal(result.ok, true);
  assert.equal(result.mock, true);
  assert.ok(result.data.title);
  assert.ok(result.data.coreQuestion);
  assert.ok(result.data.summary);
  assert.ok(result.data.spectrum.length >= 3);
  assert.ok(result.data.concepts.length >= 3);
  assert.ok(result.data.cards.length >= 5 && result.data.cards.length <= 8);
  assert.equal(result.data.scenarios.length, 3);
  assert.ok(result.data.path.length >= 3);
});

test('Mock 再创作包含理解与草稿', async () => {
  const { generateRecreation } = await import('../lib/llm.mjs');
  const result = await generateRecreation({
    title: '测试标题',
    sourceUrl: 'https://www.zhihu.com/question/1',
    concepts: [{ term: '主动回忆' }],
    reviewPlan: { progress: { weak: 1 } },
  });
  assert.equal(result.ok, true);
  assert.ok(result.data.understanding.includes('测试标题'));
  assert.ok(result.data.draft.includes('收藏'));
});
