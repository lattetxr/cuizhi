import assert from 'node:assert/strict';
import test from 'node:test';
import { clearCache } from '../server/lib/cache.mjs';

const {
  extractFromUrl,
  fetchContent,
  fetchFavorites,
  __setTransport,
} = await import('../server/lib/zhihu.js');

const REAL_SECRET = 'fake-secret-for-test';

test.beforeEach(() => {
  clearCache();
  process.env.CUIZHI_ZHIHU_MODE = 'mock';
  process.env.ZHIHU_ACCESS_SECRET = '';
  __setTransport((...args) => fetch(...args));
});

test('extractFromUrl 解析问题与回答 ID', () => {
  assert.deepEqual(extractFromUrl('https://www.zhihu.com/question/365536909'), {
    type: 'question',
    questionId: '365536909',
    answerId: null,
    title: null,
    url: 'https://www.zhihu.com/question/365536909',
  });
  const answer = extractFromUrl(
    'https://www.zhihu.com/question/365536909/answer/2072820345170666976',
  );
  assert.equal(answer.questionId, '365536909');
  assert.equal(answer.answerId, '2072820345170666976');
  assert.equal(extractFromUrl('12345').questionId, '12345');
});

test('Mock fetchContent 返回 ≥5 条且字段完整', async () => {
  const items = await fetchContent('https://www.zhihu.com/question/365536909', { limit: 10 });
  assert.equal(Array.isArray(items), true);
  assert.ok(items.length >= 5);
  assert.equal(items.demo, true);
  assert.match(items.notice, /当前为演示数据/);
  for (const item of items) {
    for (const field of [
      'answerId',
      'author',
      'title',
      'summary',
      'content',
      'voteCount',
      'commentCount',
      'authorityLevel',
      'relevanceScore',
      'url',
      'publishedAt',
    ]) {
      assert.ok(item[field] !== undefined && item[field] !== null, `缺少字段 ${field}`);
    }
  }
});

test('Mock 缓存命中仍保留演示数据标记', async () => {
  const first = await fetchContent('https://www.zhihu.com/question/888888');
  const second = await fetchContent('https://www.zhihu.com/question/888888');
  assert.equal(second.fromCache, true);
  assert.equal(second.demo, true);
  assert.match(second.notice, /当前为演示数据/);
  assert.equal(first.length, second.length);
});

test('断网时真实请求回退 Mock 并提示演示数据', async () => {
  process.env.CUIZHI_ZHIHU_MODE = 'auto';
  process.env.ZHIHU_ACCESS_SECRET = REAL_SECRET;
  __setTransport(() => {
    throw new TypeError('network down');
  });
  const items = await fetchContent('365536909');
  assert.equal(Array.isArray(items), true);
  assert.equal(items.demo, true);
  assert.match(items.notice, /当前为演示数据/);
  assert.match(items.error, /network down/i);
});

test('相同 key 第二次调用命中缓存且不产生网络请求', async () => {
  process.env.CUIZHI_ZHIHU_MODE = 'auto';
  process.env.ZHIHU_ACCESS_SECRET = REAL_SECRET;
  let requestCount = 0;
  __setTransport(async (url) => {
    requestCount += 1;
    const items = Array.from({ length: 5 }, (_, index) => ({
      Title: `回答 ${index}`,
      ContentType: 'Answer',
      ContentID: `answer-${index}`,
      ContentText: '测试摘要内容',
      Url: `https://www.zhihu.com/answer/${index}`,
      CommentCount: index,
      VoteUpCount: 10 + index,
      AuthorName: `作者${index}`,
      AuthorAvatar: '',
      AuthorBadge: '',
      AuthorBadgeText: '',
      EditTime: 1750000000 + index,
      AuthorityLevel: '2',
      RankingScore: 0.9 - index * 0.1,
    }));
    return new Response(
      JSON.stringify({ Code: 0, Message: 'success', Data: { HasMore: false, Items: items } }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  });
  const first = await fetchContent('365536909');
  const second = await fetchContent('365536909');
  assert.equal(requestCount, 1);
  assert.equal(second.fromCache, true);
  assert.equal(first.length, second.length);
});

test('Mock fetchFavorites 返回收藏夹与内容', async () => {
  const result = await fetchFavorites('oauth-token');
  assert.equal(result.demo, true);
  assert.match(result.notice, /当前为演示数据/);
  assert.ok(result.favlists.length >= 1);
  assert.ok(result.favlists[0].contents.length >= 1);
});
