import { createAgent } from './agentBase.js';
import { extractTopic, pickIds } from './mockUtils.js';

const system = (ctx) => `你是知乎知识炼金炉的「复习卡片」设计师。你基于来源回答与认知地图，生成适合主动回忆的间隔重复卡片，并给出 1/3/7/21 天排期。

规则：
- 卡片问题要能脱离原文独立回答，答案不得编造。
- source_answer_ids 必须是 [A1]..[An] 对应的 answerId。
- 输出必须严格符合 cards JSON Schema。`;

const buildUser = (ctx, input) => `来源回答：
${ctx.labeledText}

已有认知地图：
${JSON.stringify(input.map || {}, null, 2)}

请输出 cards JSON，结构为：
{
  "cards": [
    {"id": "card-1", "type": "qa|concept|scenario", "front": "问题或概念名", "back": "答案或解释", "source_answer_ids": ["answerId"]}
  ],
  "review_schedule": {
    "intervals": [1, 3, 7, 21],
    "plan": [{"day": 1, "action": "复习动作", "card_ids": ["card-1"]}]
  },
  "source_answer_ids": ["所有被引用的 answerId"]
}

cards 5-8 张，类型覆盖 qa/concept/scenario；plan 覆盖第 1、3、7、21 天。`;

function mock(input, ctx) {
  const answers = ctx.answers || [];
  const ids = answers.map((answer) => String(answer.answerId));
  const { topic, keywords } = extractTopic(answers);
  const idOf = (index) => (ids[index % Math.max(1, ids.length)] || ids[0] || 'answer-1');

  const cards = [
    {
      id: 'card-1',
      type: 'qa',
      front: `「${topic}」的核心要点是什么？`,
      back: `需要深入理解核心概念，结合实践不断优化方法。`,
      source_answer_ids: [idOf(0)],
    },
    {
      id: 'card-2',
      type: 'concept',
      front: '主动学习',
      back: '主动参与学习过程，通过提问、讨论、实践来深化理解，而非被动接收信息。',
      source_answer_ids: [idOf(1)],
    },
    {
      id: 'card-3',
      type: 'qa',
      front: `为什么${topic}不能只看不做？`,
      back: `只有通过实践才能真正掌握${topic}，光看不练会导致"知道但做不到"。`,
      source_answer_ids: [idOf(2)],
    },
    {
      id: 'card-4',
      type: 'scenario',
      front: `刚开始学习${topic}，不知道从哪开始怎么办？`,
      back: `先定义一个小目标，找一个具体案例开始实践，边做边学。`,
      source_answer_ids: [idOf(0), idOf(1)],
    },
    {
      id: 'card-5',
      type: 'qa',
      front: `如何检验自己是否真正掌握了${topic}？`,
      back: `尝试用自己的话向别人解释，或者在实际场景中应用，看能否解决问题。`,
      source_answer_ids: [idOf(2)],
    },
    {
      id: 'card-6',
      type: 'concept',
      front: '反馈循环',
      back: '通过实践结果调整学习策略，形成"实践-反思-优化"的正向循环。',
      source_answer_ids: [idOf(0)],
    },
  ];

  return {
    cards,
    review_schedule: {
      intervals: [1, 3, 7, 21],
      plan: [
        { day: 1, action: '全部卡片主动回忆，薄弱卡标"不会"', card_ids: cards.map((card) => card.id) },
        { day: 3, action: '复习前 4 张，重点处理薄弱卡', card_ids: cards.slice(0, 4).map((card) => card.id) },
        { day: 7, action: '复习全部卡片并做一次自测', card_ids: cards.map((card) => card.id) },
        { day: 21, action: '输出自己的理解与回答草稿', card_ids: cards.slice(2, 6).map((card) => card.id) },
      ],
    },
    source_answer_ids: ids,
  };
}

export const cardAgent = createAgent({
  name: 'cards',
  schemaName: 'cards',
  system,
  buildUser,
  mock,
});
