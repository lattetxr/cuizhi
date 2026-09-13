import assert from 'node:assert/strict';
import test from 'node:test';
import { clearCache } from '../server/lib/cache.mjs';

const { searchForAlchemy, __setTransport } = await import('../server/lib/zhihu.js');

function searchItem({ id, questionId, title, author, votes }) {
  return {
    Title: title,
    ContentType: 'Answer',
    ContentID: id,
    AuthorName: author,
    AuthorSignature: '',
    ContentText: `${title} 的摘要内容`,
    Url: `https://www.zhihu.com/question/${questionId}/answer/${id}`,
    CommentCount: 0,
    VoteUpCount: votes,
    AuthorityLevel: 3,
    RankingScore: 0.9,
  };
}

function makeTransport(items, { onRequest } = {}) {
  return async (url) => {
    onRequest?.(String(url));
    return new Response(
      JSON.stringify({ Code: 0, Message: 'success', Data: { HasMore: false, Items: items } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };
}

test.beforeEach(() => {
  clearCache();
  process.env.CUIZHI_ZHIHU_MODE = 'auto';
  process.env.ZHIHU_ACCESS_SECRET = 'fake-secret-for-test';
  __setTransport((...args) => fetch(...args));
});

test('关键词炼金只调用 1 次 zhihu_search（不再多次猜测取数）', async () => {
  const requests = [];
  __setTransport(makeTransport(
    [
      searchItem({ id: 'a1', questionId: '100', title: '问题1回答A', author: '作者A', votes: 10 }),
      searchItem({ id: 'b1', questionId: '200', title: '问题2回答A', author: '作者B', votes: 5 }),
    ],
    { onRequest: (u) => requests.push(u) },
  ));
  const result = await searchForAlchemy('测试关键词', { limit: 8 });
  const searchCalls = requests.filter((u) => u.includes('/api/v1/content/zhihu_search'));
  assert.equal(searchCalls.length, 1);
  assert.equal(result.demo, false);
  assert.equal(result.questionCount, 2);
});

test('同一问题的多个回答聚合在一组，不同问题轮转取样保证立场多样', async () => {
  __setTransport(makeTransport([
    searchItem({ id: 'q1-a', questionId: '100', title: '问题1高赞', author: '作者1', votes: 100 }),
    searchItem({ id: 'q1-b', questionId: '100', title: '问题1次高', author: '作者2', votes: 90 }),
    searchItem({ id: 'q1-c', questionId: '100', title: '问题1第三', author: '作者3', votes: 80 }),
    searchItem({ id: 'q2-a', questionId: '200', title: '问题2回答', author: '作者4', votes: 1 }),
  ]));
  const result = await searchForAlchemy('争议话题', { limit: 4 });
  assert.equal(result.length, 4);
  // 前两条来自不同问题（第一轮每问题取 1 条）
  assert.notEqual(new URL(result[0].url).pathname, new URL(result[1].url).pathname);
  const questions = new Set(result.map((item) => new URL(item.url).pathname.match(/\/question\/(\d+)/)[1]));
  assert.equal(questions.size, 2);
  // 每条结果都透传了作者与原文链接，供观点挂出处
  for (const item of result) {
    assert.ok(item.url);
    assert.ok(item.author);
  }
});

test('真实搜索 0 条时补充示例内容并给出友好提示', async () => {
  __setTransport(makeTransport([]));
  const result = await searchForAlchemy('不存在的生僻词xyz', { limit: 8 });
  assert.equal(result.demo, true);
  assert.match(result.notice, /示例内容/);
  assert.ok(result.length >= 1);
});
