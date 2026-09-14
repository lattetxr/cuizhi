import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildFavlistFramework,
  favItemsToAnswers,
  normalizeFavlistItem,
  selectRepresentativeItems,
} from '../server/lib/favlistFramework.mjs';

const items = [
  {
    ContentType: 'answer',
    Url: 'https://www.zhihu.com/question/1/answer/101',
    Title: '如何建立自己的知识体系？用笔记和复习形成闭环',
    Summary: '介绍主动回忆、间隔重复、知识管理和阅读方法。',
    Author: { Name: '学习作者', Url: 'https://www.zhihu.com/people/learner' },
    LikeCount: 120,
    CommentCount: 8,
    FavoriteCount: 40,
  },
  {
    ContentType: 'article',
    Url: 'https://zhuanlan.zhihu.com/p/202',
    Title: 'Python 算法入门：人工智能工程师的编程基础',
    Summary: '通过代码案例理解数据结构、模型和软件开发流程。',
    Author: { Name: '技术作者' },
    LikeCount: 88,
    CommentCount: 3,
    FavoriteCount: 21,
  },
  {
    ContentType: 'answer',
    Url: 'https://www.zhihu.com/question/3/answer/303',
    Title: '产品经理面试该不该裸辞？简历和职业选择经验',
    Summary: '真实职场经历复盘，讨论岗位、晋升、管理和沟通策略。',
    Author: { Name: '职场作者' },
    LikeCount: 56,
    CommentCount: 12,
    FavoriteCount: 9,
  },
  {
    ContentType: 'answer',
    Url: 'https://www.zhihu.com/question/4/answer/404',
    Title: '焦虑情绪如何自我调节？亲密关系和社交压力怎么办',
    Summary: '从心理学角度解释情绪、安全感和自我接纳。',
    Author: { Name: '心理作者' },
    LikeCount: 77,
    CommentCount: 5,
    FavoriteCount: 18,
  },
  {
    ContentType: 'pin',
    Url: 'https://www.zhihu.com/pin/505',
    Title: 'Notion 模板和效率工具清单',
    Summary: '整理软件、自动化工作流、资源模板和插件。',
    Author: { Name: '工具作者' },
    LikeCount: 34,
    CommentCount: 1,
    FavoriteCount: 30,
  },
  {
    ContentType: 'answer',
    Url: 'https://www.zhihu.com/question/6/answer/606',
    Title: '考研英语真题备考冲刺方法',
    Summary: '围绕考试、知识点、复习计划和复试节奏安排时间。',
    Author: { Name: '备考作者' },
    LikeCount: 65,
    CommentCount: 2,
    FavoriteCount: 25,
  },
];

test('收藏夹内容会被规范化为稳定的知识分析对象', () => {
  const item = normalizeFavlistItem(items[0], 0);
  assert.equal(item.id, '101');
  assert.equal(item.author, '学习作者');
  assert.equal(item.contentType, 'answer');
  assert.equal(item.typeLabel, '回答');
  assert.match(item.content, /知识体系/);
});

test('收藏夹框架按主题、内容角色和作者完成分类统计', () => {
  const framework = buildFavlistFramework(items);
  assert.equal(framework.total, 6);
  const categoryKeys = framework.categories.map((category) => category.key);
  for (const key of ['learning', 'technology', 'career', 'psychology', 'tools', 'exam']) {
    assert.ok(categoryKeys.includes(key), `缺少分类 ${key}`);
  }
  assert.ok(framework.roles.length >= 4);
  assert.ok(framework.path.length === 5);
  assert.ok(framework.topAuthors.some((author) => author.name === '学习作者'));
  assert.match(framework.summary, /主题|收藏夹/);
  assert.ok(framework.categories.every((category) => category.ratio > 0 && category.ratio <= 1));
});

test('整夹炼金会跨主题轮选代表内容，避免只按时间顺序取前几条', () => {
  const selected = selectRepresentativeItems(items, 6);
  assert.equal(selected.length, 6);
  assert.equal(new Set(selected.map((item) => item.id)).size, 6);
  const selectedCategories = new Set(selected.map((item) => item.categoryKey));
  assert.ok(selectedCategories.size >= 5);
  const answers = favItemsToAnswers(selected);
  assert.equal(answers.length, 6);
  assert.ok(answers.every((answer) => answer.answerId && answer.title && answer.url));
});

const { toMarkdown, toHtml } = await import('../lib/export.mjs');

test('整夹学习包导出时保留知识框架、分类索引和消化路径', () => {
  const framework = buildFavlistFramework(items);
  const pkg = {
    title: '收藏夹：学习与成长',
    summary: framework.summary,
    collectionFramework: framework,
    spectrum: [],
    concepts: [],
    cards: [],
    scenarios: [],
    path: [],
  };
  const markdown = toMarkdown(pkg);
  assert.match(markdown, /## 收藏夹知识框架/);
  assert.match(markdown, /### 主题分布/);
  assert.match(markdown, /### 推荐消化路径/);
  assert.match(markdown, /学习方法|科技编程|职场成长/);

  const html = toHtml(pkg);
  assert.match(html, /收藏夹知识框架/);
  assert.match(html, /主题分布/);
  assert.match(html, /推荐消化路径/);
});
