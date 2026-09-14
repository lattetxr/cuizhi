import assert from 'node:assert/strict';
import test from 'node:test';

process.env.CUIZHI_ZHIHU_MODE = 'mock';

const { generateVisualCards, normalizeConceptTerm, sanitizeVisualCards } = await import('../server/lib/visualCards.mjs');
const {
  buildFavlistFramework,
  favItemsToAnswers,
  selectRepresentativeItems,
} = await import('../server/lib/favlistFramework.mjs');

const SOURCE_ANSWERS = [
  {
    answerId: 'recall',
    author: '学习作者',
    title: '主动回忆为什么比反复阅读更有效？',
    summary: '主动回忆、间隔重复和反馈调整是高效学习的核心。',
    url: 'https://www.zhihu.com/question/1/answer/recall',
  },
  {
    answerId: 'python',
    author: '技术作者',
    title: 'Python 算法入门：人工智能工程师的编程基础',
    summary: '通过代码、数据结构和模型训练理解编程基础。',
    url: 'https://www.zhihu.com/question/2/answer/python',
  },
  {
    answerId: 'exam',
    author: '备考作者',
    title: '考研英语真题备考冲刺方法',
    summary: '围绕考试、知识点和复习计划安排冲刺节奏。',
    url: 'https://www.zhihu.com/question/3/answer/exam',
  },
];

const COLLECTION_ITEMS = [
  {
    id: 'python',
    Title: 'Python 算法入门：人工智能工程师的编程基础',
    Summary: '通过代码案例理解数据结构、模型和软件开发流程。',
    Url: 'https://www.zhihu.com/question/2/answer/python',
    Author: { Name: '技术作者' },
    LikeCount: 88,
  },
  {
    id: 'exam',
    Title: '考研英语真题备考冲刺方法',
    Summary: '围绕考试、知识点、复习计划和复试节奏安排时间。',
    Url: 'https://www.zhihu.com/question/3/answer/exam',
    Author: { Name: '备考作者' },
    LikeCount: 65,
  },
  {
    id: 'learning',
    Title: '如何建立自己的知识体系？用笔记和复习形成闭环',
    Summary: '介绍主动回忆、间隔重复、知识管理和阅读方法。',
    Url: 'https://www.zhihu.com/question/1/answer/learning',
    Author: { Name: '学习作者' },
    LikeCount: 120,
  },
  {
    id: 'tools',
    Title: 'Notion 模板和效率工具清单',
    Summary: '整理软件、自动化工作流、资源模板和插件。',
    Url: 'https://www.zhihu.com/question/4/answer/tools',
    Author: { Name: '工具作者' },
    LikeCount: 34,
  },
];

test('可视化复习卡片只保留短概念，不再生成思维导图', () => {
  const pkg = {
    title: '测试学习包',
    sourceUrl: 'https://www.zhihu.com/question/1',
    sourceAnswers: SOURCE_ANSWERS,
    mapData: {
      core_concepts: [
        {
          term: '主动回忆',
          definition: '主动回忆是合上讲义后凭记忆提取知识的过程，它比反复阅读更容易暴露理解漏洞，也能让大脑在后续复习中优先巩固薄弱位置。',
          example: '读完一节内容后，不看原文，在白纸上写出三个关键概念。',
          source_answer_ids: ['recall'],
        },
        {
          term: '如何建立自己的知识体系？',
          definition: '知识体系不是把资料堆在一起，而是按主题、问题和使用场景建立连接，并通过持续输出修正结构。',
          example: '把新笔记放进“问题—方法—案例”的固定结构中。',
          source_answer_ids: ['recall'],
        },
        {
          term: '间隔重复为什么有效？',
          definition: '间隔重复利用遗忘临界点安排复习，用更少次数把短期记忆转化为稳定提取的长期记忆。',
          example: '在学完当天、第三天和第七天分别回忆同一组概念。',
          source_answer_ids: ['recall'],
        },
        {
          term: '这是一个包含多个分句和解释的超长句子，不应该显示成概念',
          definition: '无效概念。',
          source_answer_ids: ['recall'],
        },
        {
          term: '主动回忆',
          definition: '重复概念应去重。',
          source_answer_ids: ['recall'],
        },
      ],
    },
  };

  const cards = generateVisualCards(pkg);
  assert.ok(cards.length >= 3 && cards.length <= 8, `数量 ${cards.length}`);
  assert.deepEqual([...new Set(cards.map((card) => card.type))], ['concept']);
  assert.ok(!cards.some((card) => card.type === 'mindmap' || card.branches));

  for (const card of cards) {
    assert.equal(card.front, card.term);
    assert.ok(card.front.length <= 12, `${card.front} 不是短概念`);
    assert.doesNotMatch(card.front, /[。！？!?；;：:]/);
    assert.doesNotMatch(card.front, /^(如何|怎么|怎样|为什么|是否|该不该|能不能)/);
    assert.match(card.back, /概念解释/);
    assert.ok(card.definition.length >= 20);
  }

  assert.deepEqual(cards.map((card) => card.term), ['主动回忆', '知识体系', '间隔重复']);
  assert.equal(cards[0].sourceUrl, SOURCE_ANSWERS[0].url);
});

test('旧版可视化卡片会过滤思维导图和非概念句', () => {
  const cards = sanitizeVisualCards([
    { id: 'c1', type: 'concept', front: '什么是费曼学习法？', back: '通过教别人来检验自己是否真正理解。' },
    { id: 'm1', type: 'mindmap', front: '思维导图', branches: [{ label: '分支' }] },
    { id: 'c2', type: 'concept', front: '这是一整句不适合放在卡片正面的解释文字', back: '应过滤' },
  ]);
  assert.deepEqual(cards.map((card) => card.front), ['费曼学习法']);
});

test('概念词会从问题和引导语中提炼成短名词', () => {
  assert.equal(normalizeConceptTerm('1. 什么是费曼学习法？'), '费曼学习法');
  assert.equal(normalizeConceptTerm('如何建立自己的知识体系？'), '知识体系');
  assert.equal(normalizeConceptTerm('间隔重复为什么有效？'), '间隔重复');
  assert.equal(normalizeConceptTerm('主动回忆：合上讲义后复述'), '主动回忆');
  assert.equal(normalizeConceptTerm('存在先于本质'), '存在先于本质');
});

test('整夹复习概念来自收藏夹主题矿脉而不是普通单篇内容', () => {
  const framework = buildFavlistFramework(COLLECTION_ITEMS);
  const selected = selectRepresentativeItems(COLLECTION_ITEMS, 6);
  const sourceAnswers = favItemsToAnswers(selected);
  const cards = generateVisualCards({
    title: '收藏夹：学习与成长',
    contentType: 'collection',
    collectionFramework: framework,
    sourceAnswers,
    concepts: [{ term: '普通单篇概念', definition: '不应被整夹卡片使用' }],
  });

  assert.ok(cards.length >= 3);
  assert.deepEqual([...new Set(cards.map((card) => card.type))], ['concept']);
  assert.ok(cards.every((card) => card.stance === '整夹概念'));
  assert.ok(cards.some((card) => card.term === '科技编程'));
  assert.ok(cards.some((card) => card.term === '考试备考'));
  assert.ok(!cards.some((card) => card.term.includes('普通单篇')));
  for (const card of cards) {
    assert.match(card.definition, /知识矿脉/);
    assert.match(card.definition, /篇收藏/);
    assert.match(card.back, /代表收藏/);
  }
});

test('旧收藏夹记录也会基于代表回答重建主题概念', () => {
  const sourceAnswers = favItemsToAnswers(selectRepresentativeItems(COLLECTION_ITEMS, 6));
  const cards = generateVisualCards({
    title: '旧收藏夹学习包',
    contentType: 'collection',
    sourceAnswers,
    concepts: [{ term: '旧的单篇泛化概念', definition: '不应继续沿用' }],
  });

  assert.ok(cards.length >= 2);
  assert.ok(cards.every((card) => card.type === 'concept' && card.stance === '整夹概念'));
  assert.ok(cards.some((card) => ['科技编程', '考试备考', '学习方法', '工具效率'].includes(card.term)));
  assert.ok(cards.every((card) => card.front.length <= 8));
});
