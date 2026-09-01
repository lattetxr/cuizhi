import assert from 'node:assert/strict';
import test from 'node:test';

process.env.CUIZHI_ZHIHU_MODE = 'mock';

const { runPipeline } = await import('../agents/pipeline.js');
const { generateVisualCards } = await import('../server/lib/visualCards.mjs');

const ANSWERS = Array.from({ length: 5 }, (_, index) => ({
  answerId: `a${index + 1}`,
  author: `作者${index + 1}`,
  title: `回答 ${index + 1}`,
  summary: '收藏不是学习，主动回忆和间隔重复才是。',
  content: '收藏后先写核心问题，再用自己的话提炼，拆成卡片，最后安排主动回忆与间隔重复。',
  voteCount: 10 + index,
  authorityLevel: 2,
  url: `https://www.zhihu.com/question/1/answer/${index + 1}`,
}));

test('可视化复习卡片仅含概念卡与思维导图卡', async () => {
  const pipeline = await runPipeline({ answers: ANSWERS });
  const pkg = {
    title: '测试学习包',
    sourceUrl: 'https://www.zhihu.com/question/1',
    sourceAnswers: pipeline.sourceAnswers,
    viewpoint: pipeline.outputs.viewpoint,
    mapData: pipeline.outputs.map,
    cardsData: pipeline.outputs.cards,
  };
  const cards = generateVisualCards(pkg);
  assert.ok(cards.length >= 8 && cards.length <= 16, `数量 ${cards.length}`);
  const types = new Set(cards.map((card) => card.type));
  assert.deepEqual([...types].sort(), ['concept', 'mindmap']);
  for (const card of cards) {
    assert.ok(card.id && card.front && card.back);
    assert.ok(card.color);
  }
});
