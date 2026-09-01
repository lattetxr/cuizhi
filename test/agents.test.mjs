import assert from 'node:assert/strict';
import test from 'node:test';

const { runPipeline, runPipelineFromSource, runCoachTurn } = await import('../agents/pipeline.js');
const { validateSchema } = await import('../agents/schemas.js');
const { collectSourceIds } = await import('../agents/context.js');
const { clearCache } = await import('../server/lib/cache.mjs');

const ANSWERS = [
  {
    answerId: 'a1',
    author: '作者一',
    title: '收藏后先加工',
    summary: '收藏后应立即写核心问题并提炼摘要。',
    content: '收藏瞬间会产生已经拥有的错觉。正确做法是收藏后先写核心问题，再用自己的话提炼。',
    voteCount: 100,
    authorityLevel: 4,
    url: 'https://www.zhihu.com/question/1/answer/1',
  },
  {
    answerId: 'a2',
    author: '作者二',
    title: '先筛选再收藏',
    summary: '只收藏当下能用的内容。',
    content: '不能立刻用的内容一律不收藏，给收藏设置处理时限，避免囤积。',
    voteCount: 80,
    authorityLevel: 3,
    url: 'https://www.zhihu.com/question/1/answer/2',
  },
  {
    answerId: 'a3',
    author: '作者三',
    title: '用工具自动化',
    summary: '用 AI 把收藏整理成可检索知识网络。',
    content: '自动摘要、标签与复习计划能降低整理摩擦，把收藏夹变成可被检索调用的知识网络。',
    voteCount: 60,
    authorityLevel: 3,
    url: 'https://www.zhihu.com/question/1/answer/3',
  },
  {
    answerId: 'a4',
    author: '作者四',
    title: '主动回忆',
    summary: '主动回忆比反复阅读更有效。',
    content: '反复阅读是被动接收，主动回忆才暴露真实掌握程度。',
    voteCount: 40,
    authorityLevel: 2,
    url: 'https://www.zhihu.com/question/1/answer/4',
  },
  {
    answerId: 'a5',
    author: '作者五',
    title: '间隔重复',
    summary: '按 1/3/7/21 天安排复习。',
    content: '按 1、3、7、21 天逐渐拉长间隔，薄弱内容提前复习。',
    voteCount: 30,
    authorityLevel: 2,
    url: 'https://www.zhihu.com/question/1/answer/5',
  },
];

test.beforeEach(() => {
  clearCache();
  process.env.CUIZHI_ZHIHU_MODE = 'mock';
  process.env.ZHIHU_ACCESS_SECRET = '';
  process.env.LLM_API_KEY = '';
  process.env.CUZHI_LLM_MODE = 'auto';
});

test('Mock 模式下四个 Agent 输出合法且字段完整', async () => {
  const result = await runPipeline({ answers: ANSWERS });
  assert.equal(result.ok, true);
  assert.deepEqual(result.degraded, {});

  const { viewpoint, map, cards } = result.outputs;
  assert.equal(validateSchema('viewpoint', viewpoint).valid, true);
  assert.equal(validateSchema('map', map).valid, true);
  assert.equal(validateSchema('cards', cards).valid, true);
  assert.ok(viewpoint.stances.length >= 3);
  assert.ok(cards.cards.length >= 5);
  assert.ok(cards.review_schedule.plan.length >= 4);

  const coach = await runCoachTurn({
    answers: ANSWERS,
    messages: [{ role: 'user', content: '请帮我生成理解与草稿' }],
    mode: 'draft',
  });
  assert.equal(coach.ok, true);
  assert.equal(validateSchema('coach', coach.data).valid, true);
  assert.ok(coach.data.reply.length > 0);
  assert.ok(coach.data.understanding.length > 0);
  assert.ok(coach.data.draft.length > 0);
});

test('所有 source_answer_ids 都能对应到输入回答编号', async () => {
  const result = await runPipeline({ answers: ANSWERS });
  const allowed = new Set(ANSWERS.map((answer) => answer.answerId));
  for (const data of Object.values(result.outputs)) {
    for (const id of collectSourceIds(data)) {
      assert.ok(allowed.has(id), `来源编号 ${id} 不在输入回答中`);
    }
  }
});

test('单 Agent 失败时管线降级但输出仍合法', async () => {
  process.env.CUIZHI_ZHIHU_MODE = 'auto';
  process.env.CUZHI_LLM_MODE = 'llm';
  process.env.LLM_API_KEY = 'fake-key';
  process.env.LLM_BASE_URL = 'http://127.0.0.1:9/v1';

  const result = await runPipeline({ answers: ANSWERS });
  assert.equal(result.ok, true);
  assert.ok(Object.keys(result.degraded).length >= 1);
  assert.ok(result.notices.length >= 1);
  assert.equal(validateSchema('viewpoint', result.outputs.viewpoint).valid, true);
  assert.equal(validateSchema('map', result.outputs.map).valid, true);
  assert.equal(validateSchema('cards', result.outputs.cards).valid, true);
});

test('runPipelineFromSource 在无凭证时走 Mock 并保留提示', async () => {
  const result = await runPipelineFromSource('https://www.zhihu.com/question/365536909', {
    fetchOptions: { limit: 5 },
  });
  assert.equal(result.ok, true);
  assert.equal(result.source.demo, true);
  assert.match(result.source.notice, /当前为演示数据/);
  assert.ok(result.source.count >= 5);
  assert.ok(Object.keys(result.outputs).length === 3);
});
