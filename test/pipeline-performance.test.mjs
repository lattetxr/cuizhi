import assert from 'node:assert/strict';
import test from 'node:test';

process.env.LLM_API_KEY = 'fake-key-for-pipeline-performance-test';
process.env.CUZHI_LLM_MODE = 'auto';

const { runPipeline } = await import('../agents/pipeline.js');

const answers = [
  {
    answerId: 'answer-perf-1',
    author: '性能测试作者',
    title: '如何验证并发炼金？',
    summary: '核心是让观点、地图和卡片三个模型请求同时开始，而不是串行等待。',
    content: '核心是让观点、地图和卡片三个模型请求同时开始，从而把总耗时压缩到最慢的一次请求。',
    voteCount: 100,
    authorityLevel: 3,
    url: 'https://www.zhihu.com/question/1/answer/1',
  },
];

function viewpoint() {
  return {
    content_type: 'knowledge',
    summary: '这是一个用于验证观点光谱并发耗时的完整摘要。',
    stances: Array.from({ length: 3 }, (_, index) => ({
      stance_name: `立场${index + 1}`,
      stance_summary: `这是第 ${index + 1} 种立场的完整概述，包含前提、论证和适用边界。`,
      arguments: ['这是一条能够独立支撑立场的完整论据。'],
      source_answer_ids: ['answer-perf-1'],
    })),
    consensus: ['各方都认可主动加工比单纯收藏更重要。'],
    divergence: '分歧主要发生在学习顺序和实践成本之间，需要根据目标取舍。',
    source_answer_ids: ['answer-perf-1'],
  };
}

function mapOutput() {
  return {
    core_concepts: Array.from({ length: 3 }, (_, index) => ({
      term: `概念${index + 1}`,
      definition: `这是概念 ${index + 1} 的完整定义，说明其含义、重要性和边界。`,
      example: '在阅读一篇长回答后先写下核心问题，再尝试主动回忆。',
      source_answer_ids: ['answer-perf-1'],
    })),
    learning_path: Array.from({ length: 3 }, (_, index) => ({
      step: `第 ${index + 1} 步`,
      action: '先完成一个可检查的小动作，并用自己的话复述结果，确认不是机械摘抄。',
      duration: '10 分钟',
      source_answer_ids: ['answer-perf-1'],
    })),
    misconceptions: [
      { misconception: '收藏就是学会', correction: '收藏只完成资料搬运，必须通过复述和主动回忆才能形成理解。', source_answer_ids: ['answer-perf-1'] },
      { misconception: '卡片越多越好', correction: '卡片应围绕核心问题和薄弱环节设计，过多重复卡片会降低复习效率。', source_answer_ids: ['answer-perf-1'] },
    ],
    application_scenarios: [
      { scenario: '阅读长回答', practice: '读完后用三句话写出问题、结论和行动，再决定是否生成复习卡片。', source_answer_ids: ['answer-perf-1'] },
      { scenario: '考前复习', practice: '先主动回忆，再把答不上来的概念做成卡片，并安排间隔复习。', source_answer_ids: ['answer-perf-1'] },
    ],
    source_answer_ids: ['answer-perf-1'],
  };
}

function cards() {
  return {
    cards: Array.from({ length: 5 }, (_, index) => ({
      id: `card-${index + 1}`,
      type: index % 2 === 0 ? 'qa' : 'concept',
      front: `测试问题 ${index + 1}`,
      back: `这是一张内容完整的复习卡答案，先给结论，再解释原因，并给出可操作做法。`,
      source_answer_ids: ['answer-perf-1'],
    })),
    review_schedule: {
      intervals: [1, 3, 7, 21],
      plan: [1, 3, 7, 21].map((day) => ({
        day,
        action: '主动回忆并标记掌握程度',
        card_ids: ['card-1', 'card-2', 'card-3', 'card-4', 'card-5'],
      })),
    },
    source_answer_ids: ['answer-perf-1'],
  };
}

test('观点、地图、卡片三路生成并发执行，避免串行拖慢炼金', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    const system = body.messages[0]?.content || '';
    await new Promise((resolve) => setTimeout(resolve, 200));
    const data = system.includes('观点光谱')
      ? viewpoint()
      : system.includes('认知地图')
        ? mapOutput()
        : cards();
    return new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify(data) } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };
  const startedAt = Date.now();
  const result = await runPipeline({ answers });
  const elapsed = Date.now() - startedAt;
  globalThis.fetch = originalFetch;

  assert.equal(result.ok, true);
  assert.equal(result.outputs.viewpoint.stances.length, 3);
  assert.equal(result.outputs.map.core_concepts.length, 3);
  assert.equal(result.outputs.cards.cards.length, 5);
  assert.ok(elapsed < 600, `三路并发应小于 600ms，实际 ${elapsed}ms`);
});
