import { createHash } from 'node:crypto';
import { getHttpAccessSecret, mask } from '../../lib/config.mjs';
import { cacheGet, cacheSet } from './cache.mjs';

const BASE_API = 'https://developer.zhihu.com';
const SEARCH_PATH = '/api/v1/content/zhihu_search';
const HOT_PATH = '/api/v1/content/hot_list';
const QUOTA_PATH = '/api/v1/quota';
const CHAT_PATH = '/v1/chat/completions';

// 单飞：热榜/额度这类「全员共享、配额极小」的请求，并发只打一次
const inflight = new Map();
function dedupe(key, producer) {
  if (inflight.has(key)) return inflight.get(key);
  const promise = Promise.resolve()
    .then(producer)
    .finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}
const DEFAULT_TIMEOUT_MS = 10000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const SAMPLE_CONTENT_NOTICE = '当前展示示例内容，你可以换个关键词或链接后重试';
const SAMPLE_HOT_NOTICE = '暂时无法获取今日热榜，先为你展示示例热榜';
const SAMPLE_FAVORITES_NOTICE = '暂时无法读取收藏夹，先为你展示示例内容';
const ZHIDA_SAMPLE_ANSWER = '我们可以先明确核心问题，再拆分关键概念、补充不同视角和案例，最后整理成可执行的结论。';
const ZHIDA_UNAVAILABLE_ANSWER = '暂时无法获得知乎直答结果，请稍后再试。';

export class ZhihuError extends Error {
  constructor(code, message, { status = 0, retryable = false } = {}) {
    super(message);
    this.name = 'ZhihuError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

let transport = (...args) => fetch(...args);

export function __setTransport(fn) {
  transport = fn;
}

function shouldUseMock() {
  return process.env.CUIZHI_ZHIHU_MODE === 'mock';
}

function hash(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 12);
}

function cloneWithMeta(value, meta) {
  const target = Array.isArray(value) ? [...value] : { ...value };
  if (Array.isArray(value)) {
    for (const key of Object.keys(value)) target[key] = value[key];
  }
  return Object.assign(target, meta);
}

function normalizeLimit(limit, fallback, max) {
  const value = Number(limit);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.floor(value), max);
}

function cleanText(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function classifyError(error, { status = 0, code = null } = {}) {
  if (error instanceof ZhihuError) return error;
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
    return new ZhihuError('NETWORK_TIMEOUT', '知乎接口请求超时', { retryable: true });
  }
  if (code === '20001' || status === 401 || status === 403) {
    return new ZhihuError('AUTH_ERROR', '知乎接口鉴权失败', { status });
  }
  if (code === '30001' || code === '30002' || status === 429) {
    return new ZhihuError('RATE_LIMIT', '知乎接口频率或配额限制', { status, retryable: true });
  }
  if (status === 404) {
    return new ZhihuError('NOT_FOUND', '知乎内容不存在', { status });
  }
  if (status >= 500 || code === '90001') {
    return new ZhihuError('SERVER_ERROR', '知乎服务端错误', { status, retryable: true });
  }
  return new ZhihuError('NETWORK_ERROR', error?.message || '知乎接口网络错误', {
    retryable: true,
  });
}

async function requestJson(path, {
  method = 'GET',
  query,
  body,
  accessSecret = '',
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retries = 2,
} = {}) {
  const url = new URL(BASE_API + path);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
  }
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await transport(url, {
        method,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${accessSecret}`,
          'X-Request-Timestamp': String(Math.floor(Date.now() / 1000)),
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || (data.Code !== undefined && data.Code !== 0)) {
        const error = classifyError(null, {
          status: response.status,
          code: data.Code,
        });
        if (!error.retryable || attempt >= retries) throw error;
        lastError = error;
      } else {
        return data;
      }
    } catch (error) {
      const classified = classifyError(error);
      if (!classified.retryable || attempt >= retries) throw classified;
      lastError = classified;
    } finally {
      clearTimeout(timer);
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }
  throw lastError || new ZhihuError('NETWORK_ERROR', '知乎接口请求失败');
}

async function fetchPageTitle(url, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await transport(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!response.ok) return '';
    const html = await response.text();
    const og = html.match(/property="og:title"\s+content="([^"]+)"/i);
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const raw = og?.[1] || title?.[1] || '';
    return cleanText(raw.replace(/<[^>]+>/g, '')).slice(0, 120);
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

export function extractFromUrl(input) {
  const value = String(input || '').trim();
  if (/^\d+$/.test(value)) {
    return {
      type: 'question',
      questionId: value,
      answerId: null,
      title: null,
      url: `https://www.zhihu.com/question/${value}`,
    };
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, '');
  const pathname = url.pathname;
  const questionMatch = pathname.match(/^\/question\/(\d+)(?:\/answer\/(\d+))?/);
  if (questionMatch) {
    return {
      type: 'question',
      questionId: questionMatch[1],
      answerId: questionMatch[2] || null,
      title: null,
      url: url.toString(),
    };
  }
  const answerMatch = pathname.match(/^\/answer\/(\d+)/);
  if (answerMatch) {
    return {
      type: 'answer',
      answerId: answerMatch[1],
      questionId: null,
      title: null,
      url: url.toString(),
    };
  }
  if (host === 'zhuanlan.zhihu.com' || host === 'zhihu.com') {
    const articleMatch = pathname.match(/^\/p\/(\d+)/);
    if (articleMatch) {
      return {
        type: 'article',
        articleId: articleMatch[1],
        questionId: null,
        title: null,
        url: url.toString(),
      };
    }
  }
  return {
    type: 'unknown',
    questionId: null,
    answerId: null,
    title: null,
    url: url.toString(),
  };
}

const MOCK_ANSWERS = [
  {
    answerId: 'mock-answer-1',
    contentType: 'answer',
    author: '林间有风',
    title: '如何高效地学习一个领域的知识？',
    summary: '先定义要解决的问题，再用自己的话复述，最后通过主动回忆检验掌握程度。',
    content:
      '高效学习的起点不是找更多资料，而是明确要解决什么问题。把收藏当成待消化的输入，先回答“这篇文章解决什么问题”，再用三句话写摘要，拆成可检验的知识点，最后安排主动回忆。',
    voteCount: 1284,
    commentCount: 86,
    authorityLevel: 4,
    relevanceScore: 0.97,
    url: 'https://www.zhihu.com/question/365536909/answer/mock-1',
    publishedAt: '2026-05-01T08:00:00.000Z',
  },
  {
    answerId: 'mock-answer-2',
    contentType: 'answer',
    author: '阿澈的笔记',
    title: '如何高效地学习一个领域的知识？',
    summary: '用“问题 → 概念 → 案例 → 输出”四步法把长文变成可执行的学习路径。',
    content:
      '把一篇长回答变成学习路径需要四步：先写核心问题，再拆核心概念，补充真实案例，最后完成一次输出。输出可以是总结、卡片或回答草稿，完成输出才算真正内化。',
    voteCount: 956,
    commentCount: 64,
    authorityLevel: 3,
    relevanceScore: 0.94,
    url: 'https://www.zhihu.com/question/365536909/answer/mock-2',
    publishedAt: '2026-04-12T09:30:00.000Z',
  },
  {
    answerId: 'mock-answer-3',
    contentType: 'answer',
    author: '认知科学家',
    title: '为什么收藏的内容总是学不进去？',
    summary: '收藏瞬间产生的拥有感会关闭继续学习的动机，需要用行动拆解收藏。',
    content:
      '收藏的瞬间，大脑会误以为“我已经拥有它”，因此不再有继续加工的动机。正确做法是给收藏设置一个轻量加工动作：摘要、提问、卡片，任何一项都能打破囤积惯性。',
    voteCount: 732,
    commentCount: 41,
    authorityLevel: 3,
    relevanceScore: 0.91,
    url: 'https://www.zhihu.com/question/365536909/answer/mock-3',
    publishedAt: '2026-03-20T14:15:00.000Z',
  },
  {
    answerId: 'mock-answer-4',
    contentType: 'answer',
    author: '备考自习室',
    title: '如何让复习更有效？',
    summary: '主动回忆比反复阅读更有效，间隔重复比一次性冲刺更持久。',
    content:
      '复习的关键不是重读，而是先回忆再核对。用“会 / 模糊 / 不会”自评每一张卡片，让薄弱内容提前出现，熟练内容按 1、3、7、21 天拉长间隔，时间会花在最该花的地方。',
    voteCount: 518,
    commentCount: 29,
    authorityLevel: 2,
    relevanceScore: 0.88,
    url: 'https://www.zhihu.com/question/365536909/answer/mock-4',
    publishedAt: '2026-02-08T18:00:00.000Z',
  },
  {
    answerId: 'mock-answer-5',
    contentType: 'answer',
    author: '费曼练习生',
    title: '如何判断自己真的理解了？',
    summary: '能用最简单的话讲给零基础的人，才是真正理解的标志。',
    content:
      '检验理解的黄金标准是费曼技巧：尝试把概念讲给一个完全不了解的人。如果中间卡住，说明这里就是薄弱点；讲通之后，再把理解写成自己的回答，完成从消费者到创作者的转变。',
    voteCount: 403,
    commentCount: 18,
    authorityLevel: 2,
    relevanceScore: 0.85,
    url: 'https://www.zhihu.com/question/365536909/answer/mock-5',
    publishedAt: '2026-01-15T11:00:00.000Z',
  },
  {
    answerId: 'mock-answer-6',
    contentType: 'answer',
    author: '数字花园园丁',
    title: '收藏夹应该怎样管理？',
    summary: '把收藏夹当成待加工队列，而不是永久仓库，每周安排一次消化。',
    content:
      '收藏夹吃灰的解法不是更复杂的分类，而是把收藏夹当成“待加工队列”。每周固定时间处理一批：写下核心问题、提炼摘要、生成卡片，处理完的内容要么进入复习，要么果断删除。',
    voteCount: 326,
    commentCount: 12,
    authorityLevel: 2,
    relevanceScore: 0.82,
    url: 'https://www.zhihu.com/question/365536909/answer/mock-6',
    publishedAt: '2025-12-01T06:45:00.000Z',
  },
];

function mockAnswerList() {
  return MOCK_ANSWERS.map((item) => ({ ...item }));
}

function mapSearchItems(items) {
  const answers = [];
  const others = [];
  for (const item of items || []) {
    const mapped = {
      answerId: String(item.ContentID || ''),
      contentType: String(item.ContentType || '').toLowerCase(),
      author: item.AuthorName || '知乎用户',
      title: cleanText(item.Title) || '',
      summary: cleanText(item.ContentText) || '',
      content: cleanText(item.ContentText) || '',
      voteCount: Number(item.VoteUpCount || 0),
      commentCount: Number(item.CommentCount || 0),
      authorityLevel: Number(item.AuthorityLevel || 0),
      relevanceScore: Number(item.RankingScore || 0.5),
      url: item.Url || '',
      publishedAt: item.EditTime ? new Date(Number(item.EditTime) * 1000).toISOString() : null,
    };
    if (String(item.ContentType || '').toLowerCase() === 'answer') answers.push(mapped);
    else others.push(mapped);
  }
  const compositeScore = (item) =>
    (item.contentType === 'answer' ? 10000 : 0) +
    item.voteCount +
    item.authorityLevel * 25 +
    item.relevanceScore * 60;
  const ranked = [...answers, ...others].sort((a, b) => {
    return compositeScore(b) - compositeScore(a);
  });
  return ranked;
}

export async function fetchContent(questionIdOrUrl, { limit = 10 } = {}) {
  const parsed = extractFromUrl(questionIdOrUrl);
  const questionId = parsed?.questionId || String(questionIdOrUrl || '');
  const cacheKey = `zhihu:content:${hash(questionId || questionIdOrUrl)}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cloneWithMeta(cached, { fromCache: true });

  const access = getHttpAccessSecret();
  const forceMock = shouldUseMock() || !access.value;
  if (forceMock) {
    const items = mockAnswerList();
    return cacheSet(
      cacheKey,
      cloneWithMeta(items, {
        demo: true,
        source: 'mock',
        notice: SAMPLE_CONTENT_NOTICE,
      }),
      CACHE_TTL_MS,
    );
  }

  try {
    const looksLikeUrl = /^https?:\/\//i.test(String(questionIdOrUrl || ''));
    // 标题抓取只给 2.5 秒：它只是搜索 Query 的增强，不能挤占 20 秒炼金预算。
    const title = parsed?.title || (looksLikeUrl ? await fetchPageTitle(parsed.url, 2500) : '');
    const query = title
      ? title
      : looksLikeUrl && parsed?.url
        ? parsed.url
        : parsed?.type === 'answer'
          ? `知乎回答 ${parsed.answerId}`
          : `知乎问题 ${questionId}`;

    // 链接炼金同样只消耗 1 次搜索配额；多 Query 串行猜测会同时拖慢速度并放大配额消耗。
    const collected = new Map();
    const data = await requestJson(SEARCH_PATH, {
      query: { Query: query, Count: normalizeLimit(limit, 10, 10) },
      accessSecret: access.value,
      timeoutMs: 6000,
      retries: 0,
    });
    for (const item of mapSearchItems(data.Data?.Items || [])) {
      if (!collected.has(item.answerId)) collected.set(item.answerId, item);
    }
    const items = [...collected.values()]
      .sort((a, b) => {
        const scoreA =
          (a.contentType === 'answer' ? 10000 : 0) +
          a.voteCount +
          a.authorityLevel * 25 +
          a.relevanceScore * 60;
        const scoreB =
          (b.contentType === 'answer' ? 10000 : 0) +
          b.voteCount +
          b.authorityLevel * 25 +
          b.relevanceScore * 60;
        return scoreB - scoreA;
      })
      .slice(0, normalizeLimit(limit, 10, 10));
    return cacheSet(
      cacheKey,
      cloneWithMeta(items, {
        demo: false,
        source: 'zhihu',
        notice: null,
        query,
      }),
      CACHE_TTL_MS,
    );
  } catch (error) {
    const items = mockAnswerList();
    return cacheSet(
      cacheKey,
      cloneWithMeta(items, {
        demo: true,
        source: 'mock',
        notice: SAMPLE_CONTENT_NOTICE,
      }),
      CACHE_TTL_MS,
    );
  }
}

export async function fetchFavorites(accessToken, { limit = 20, contentsPerList = 10 } = {}) {
  const cacheKey = `zhihu:favorites:${hash(accessToken || 'anonymous')}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cloneWithMeta(cached, { fromCache: true });

  const access = getHttpAccessSecret();
  const forceMock = shouldUseMock() || !access.value || !accessToken;
  if (forceMock) {
    const result = {
      favlists: [
        {
          urlToken: 'mock-fav-1',
          title: '学习系统',
          url: 'https://www.zhihu.com/collection/mock-1',
          description: '关于学习方法和知识管理的收藏',
          contents: [
            {
              title: '如何高效地学习一个领域的知识？',
              summary: '用问题、概念、案例和输出四步完成学习闭环。',
              url: 'https://www.zhihu.com/question/365536909',
              favTime: 1785000000,
            },
            {
              title: '收藏夹吃灰的解法',
              summary: '把收藏夹当作待加工队列，每周安排一次消化。',
              url: 'https://www.zhihu.com/question/365536909/answer/mock-3',
              favTime: 1784900000,
            },
          ],
        },
        {
          urlToken: 'mock-fav-2',
          title: '职业入门',
          url: 'https://www.zhihu.com/collection/mock-2',
          description: '面向职场新人的入门资料',
          contents: [
            {
              title: '产品经理入门路径',
              summary: '从岗位知识地图开始，用面试题检验掌握程度。',
              url: 'https://www.zhihu.com/question/mock-2',
              favTime: 1784000000,
            },
          ],
        },
      ],
    };
    return cacheSet(
      cacheKey,
      cloneWithMeta(result, {
        demo: true,
        source: 'mock',
        notice: SAMPLE_FAVORITES_NOTICE,
      }),
      CACHE_TTL_MS,
    );
  }

  try {
    const listsData = await requestJson('/api/v1/user/favlists', {
      query: { Limit: normalizeLimit(limit, 20, 50) },
      accessSecret: access.value,
    });
    const lists = (listsData.Data?.Items || []).slice(0, 5);
    const favlists = [];
    for (const list of lists) {
      const contentsData = await requestJson('/api/v1/user/favlist_contents', {
        query: {
          FavlistUrlToken: list.UrlToken,
          Limit: normalizeLimit(contentsPerList, 10, 50),
        },
        accessSecret: access.value,
      });
      favlists.push({
        urlToken: String(list.UrlToken || ''),
        title: list.Title || '',
        url: list.Url || '',
        description: list.Description || '',
        contents: (contentsData.Data?.Items || []).map((item) => ({
          title: item.Title || '',
          summary: item.Summary || '',
          url: item.Url || '',
          contentType: item.ContentType || '',
          favTime: Number(item.FavTime || 0),
        })),
      });
    }
    const result = { favlists };
    return cacheSet(
      cacheKey,
      cloneWithMeta(result, {
        demo: false,
        source: 'zhihu',
        notice: null,
      }),
      CACHE_TTL_MS,
    );
  } catch (error) {
    const result = {
      favlists: [
        {
          urlToken: 'mock-fav-1',
          title: '学习系统',
          url: 'https://www.zhihu.com/collection/mock-1',
          description: '关于学习方法和知识管理的收藏',
          contents: [
            {
              title: '如何高效地学习一个领域的知识？',
              summary: '用问题、概念、案例和输出四步完成学习闭环。',
              url: 'https://www.zhihu.com/question/365536909',
              favTime: 1785000000,
            },
          ],
        },
      ],
    };
    return cacheSet(
      cacheKey,
      cloneWithMeta(result, {
        demo: true,
        source: 'mock',
        notice: SAMPLE_FAVORITES_NOTICE,
      }),
      CACHE_TTL_MS,
    );
  }
}

export async function searchZhihu(query, { count = 10 } = {}) {
  const cacheKey = `zhihu:search:${hash(query)}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cloneWithMeta(cached, { fromCache: true });
  const access = getHttpAccessSecret();
  if (shouldUseMock() || !access.value) {
    return cacheSet(cacheKey, { demo: true, notice: SAMPLE_CONTENT_NOTICE, items: mockAnswerList() });
  }
  try {
    const data = await requestJson(SEARCH_PATH, {
      query: { Query: query, Count: normalizeLimit(count, 10, 10) },
      accessSecret: access.value,
      timeoutMs: 6000,
      retries: 0,
    });
    return cacheSet(cacheKey, {
      demo: false,
      items: mapSearchItems(data.Data?.Items || []),
    });
  } catch (error) {
    return cacheSet(cacheKey, {
      demo: true,
      notice: SAMPLE_CONTENT_NOTICE,
      items: mockAnswerList(),
    });
  }
}

export const FALLBACK_HOT_TOPICS = [
  { title: '年轻人如何建立长期学习系统？', summary: '方法、节奏与复盘机制', url: 'https://www.zhihu.com/search?type=content&q=%E5%B9%B4%E8%BD%BB%E4%BA%BA%E5%A6%82%E4%BD%95%E5%BB%BA%E7%AB%8B%E9%95%BF%E6%9C%9F%E5%AD%A6%E4%B9%A0%E7%B3%BB%E7%BB%9F' },
  { title: '第一份工作应该优先看成长还是薪资？', summary: '职业选择中的短期收益与长期复利', url: 'https://www.zhihu.com/search?type=content&q=%E7%AC%AC%E4%B8%80%E4%BB%BD%E5%B7%A5%E4%BD%9C%20%E6%88%90%E9%95%BF%20%E8%96%AA%E8%B5%84' },
  { title: 'AI 工具会怎样改变普通人的工作方式？', summary: '效率工具、岗位变化与可迁移能力', url: 'https://www.zhihu.com/search?type=content&q=AI%20%E5%B7%A5%E5%85%B7%20%E5%B7%A5%E4%BD%9C%E6%96%B9%E5%BC%8F' },
  { title: '怎样判断一个行业是否值得进入？', summary: '需求、周期、壁垒与个人匹配度', url: 'https://www.zhihu.com/search?type=content&q=%E6%80%8E%E6%A0%B7%E5%88%A4%E6%96%AD%E4%B8%80%E4%B8%AA%E8%A1%8C%E4%B8%9A%E6%98%AF%E5%90%A6%E5%80%BC%E5%BE%97%E8%BF%9B%E5%85%A5' },
  { title: '收藏了很多内容却学不进去怎么办？', summary: '从信息囤积到主动加工和输出', url: 'https://www.zhihu.com/search?type=content&q=%E6%94%B6%E8%97%8F%E5%BE%88%E5%A4%9A%E5%8D%B4%E5%AD%A6%E4%B8%8D%E8%BF%9B%E5%8E%BB' },
  { title: '备考时间紧张，如何安排复习优先级？', summary: '目标拆分、真题驱动与间隔复习', url: 'https://www.zhihu.com/search?type=content&q=%E5%A4%87%E8%80%83%E6%97%B6%E9%97%B4%E7%B4%A7%E5%BC%A0%20%E5%A6%82%E4%BD%95%E5%A4%8D%E4%B9%A0' },
];

function fallbackHotList(reason = SAMPLE_HOT_NOTICE, ttlMs = 5 * 60 * 1000) {
  return cacheSet(
    'zhihu:hot',
    { demo: true, notice: reason, quotaExhausted: reason.includes('额度'), items: FALLBACK_HOT_TOPICS },
    ttlMs,
  );
}

export async function fetchHotList(options = {}) {
  return dedupe('hot', () => fetchHotListInner(options));
}

async function fetchHotListInner({ limit = 20 } = {}) {
  const cacheKey = 'zhihu:hot';
  const cached = cacheGet(cacheKey);
  if (cached) return cloneWithMeta(cached, { fromCache: true });
  const access = getHttpAccessSecret();
  if (shouldUseMock() || !access.value) {
    return fallbackHotList(SAMPLE_HOT_NOTICE);
  }

  // 热榜 API 每日额度极小（当前账号仅 2 次）。额度为 0 时不再消耗请求，直接给可点击的示例议题。
  const quota = await fetchQuota();
  const hotQuota = (quota.items || []).find((item) => item.APIID === 'hot_list');
  if (hotQuota && Number(hotQuota.RemainingQuota || 0) <= 0) {
    return fallbackHotList('今日知乎热榜额度已用完，先为你展示可开炼的示例议题');
  }

  try {
    const data = await requestJson(HOT_PATH, {
      query: { Limit: normalizeLimit(limit, 20, 30) },
      accessSecret: access.value,
      timeoutMs: 6000,
      retries: 0,
    });
    const items = (data.Data?.Items || []).map((item) => ({
      title: item.Title || '',
      url: item.Url || '',
      thumbnailUrl: item.ThumbnailUrl || '',
      summary: item.Summary || '',
    })).filter((item) => item.title);
    if (!items.length) return fallbackHotList('今日热榜暂时为空，先为你展示示例议题');
    return cacheSet(cacheKey, { demo: false, notice: null, items }, CACHE_TTL_MS);
  } catch (error) {
    const reason = error?.code === 'RATE_LIMIT'
      ? '今日知乎热榜额度已用完，先为你展示可开炼的示例议题'
      : SAMPLE_HOT_NOTICE;
    return fallbackHotList(reason);
  }
}

export async function zhidaAnswer(messages, { model = 'zhida-fast-1p5' } = {}) {
  const access = getHttpAccessSecret();
  if (shouldUseMock() || !access.value) {
    return {
      demo: true,
      notice: null,
      answer: ZHIDA_SAMPLE_ANSWER,
    };
  }
  try {
    const data = await requestJson(CHAT_PATH, {
      method: 'POST',
      body: { model, messages, stream: false },
      accessSecret: access.value,
    });
    return {
      demo: false,
      answer: data?.choices?.[0]?.message?.content || '',
    };
  } catch (error) {
    return {
      demo: true,
      notice: ZHIDA_UNAVAILABLE_ANSWER,
      answer: ZHIDA_UNAVAILABLE_ANSWER,
    };
  }
}

export async function credentialSummary() {
  const access = getHttpAccessSecret();
  return {
    accessSecretConfigured: Boolean(access.value),
    accessSecretMasked: mask(access.value),
    source: access.source,
    mode: shouldUseMock() || !access.value ? 'mock' : 'real',
  };
}

// ========== 关键词炼金：单次知乎搜索 + 按问题聚合（省配额、保立场多样性） ==========

function questionKeyFromUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const question = u.pathname.match(/^\/question\/(\d+)/);
    if (question) return `q:${question[1]}`;
    const answer = u.pathname.match(/^\/answer\/(\d+)/);
    if (answer) return `a:${answer[1]}`;
    const article = u.pathname.match(/^\/p\/(\d+)/);
    if (article) return `p:${article[1]}`;
    const pin = u.pathname.match(/^\/pin\/(\d+)/);
    if (pin) return `pin:${pin[1]}`;
    const video = u.pathname.match(/^\/zvideo\/(\w+)/);
    if (video) return `zv:${video[1]}`;
    return u.pathname || rawUrl;
  } catch {
    return `x:${hash(String(rawUrl))}`;
  }
}

/**
 * 关键词炼金的取数入口：只打 1 次 zhihu_search（searchZhihu 内带 24h 缓存），
 * 再按「所属问题」分组并轮转取样，保证观点光谱尽量来自不同问题/作者。
 * 返回数组（与 fetchContent 兼容，挂 demo/notice 等元信息）。
 */
export async function searchForAlchemy(query, { limit = 8, answerIds = null } = {}) {
  const term = String(query || '').trim();
  const result = await searchZhihu(term, { count: 10 });
  const items = Array.isArray(result.items) ? result.items : [];

  const groups = new Map();
  for (const item of items) {
    const key = questionKeyFromUrl(item.url || `${item.answerId}`);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  // 用户在预览中勾选了具体帖子：只炼所选内容（预览与炼金共用同一份缓存结果）
  if (Array.isArray(answerIds) && answerIds.length) {
    const wanted = new Set(answerIds.map(String));
    const selected = items.filter((item) => wanted.has(String(item.answerId)));
    if (selected.length) {
      return Object.assign(selected, {
        demo: Boolean(result.demo),
        notice: result.notice || null,
        source: result.demo ? 'mock' : 'zhihu',
        query: term,
        count: selected.length,
        questionCount: new Set(selected.map((item) => questionKeyFromUrl(item.url || item.answerId))).size,
      });
    }
  }

  const target = Math.min(normalizeLimit(limit, 8, 10), 10);
  const queues = [...groups.values()];
  const pointers = queues.map(() => 0);
  const picked = [];
  const seen = new Set();
  let progressed = true;
  // 第一轮每个问题取 1 条（立场多样），之后再回头补同问题的其他回答
  while (picked.length < target && progressed) {
    progressed = false;
    for (let i = 0; i < queues.length; i += 1) {
      if (picked.length >= target) break;
      const queue = queues[i];
      if (pointers[i] < queue.length) {
        const item = queue[pointers[i]];
        pointers[i] += 1;
        const id = String(item.answerId);
        if (seen.has(id)) continue;
        seen.add(id);
        picked.push(item);
        progressed = true;
      }
    }
  }

  let demo = Boolean(result.demo);
  let notice = result.notice || null;
  if (picked.length === 0) {
    // 真实搜索 0 条时补充示例内容，保证学习包生成流程可继续。
    picked.push(...mockAnswerList().slice(0, 5));
    demo = true;
    notice = notice || SAMPLE_CONTENT_NOTICE;
  }
  return Object.assign(picked, {
    demo,
    notice,
    source: demo ? 'mock' : 'zhihu',
    query: term,
    count: picked.length,
    questionCount: groups.size,
  });
}

// ========== 关键词搜索预览：优质帖子 + 按问题聚合的数量比例 ==========

function displayQuestionTitle(item) {
  return String(item.title || '')
    .replace(/\s*-\s*知乎\s*$/, '')
    .trim();
}

/**
 * 输入问题后先预览：1 次 zhihu_search（24h 缓存），
 * 返回按质量排序的帖子与「所属问题 → 帖子数量」的比例分布。
 */
export async function previewSearch(query, { count = 10 } = {}) {
  const term = String(query || '').trim();
  const result = await searchZhihu(term, { count });
  const items = Array.isArray(result.items) ? result.items : [];

  const groupMap = new Map();
  for (const item of items) {
    const key = questionKeyFromUrl(item.url || `${item.answerId}`);
    if (!groupMap.has(key)) {
      groupMap.set(key, {
        key,
        title: displayQuestionTitle(item) || '相关问题',
        sampleUrl: item.url || '',
        count: 0,
        authors: [],
        votes: 0,
      });
    }
    const group = groupMap.get(key);
    group.count += 1;
    group.votes += Number(item.voteCount || 0);
    if (item.author && !group.authors.includes(item.author)) group.authors.push(item.author);
  }
  const groups = [...groupMap.values()]
    .sort((a, b) => b.count - a.count || b.votes - a.votes)
    .map((group) => ({
      ...group,
      ratio: items.length ? group.count / items.length : 0,
    }));

  return {
    demo: Boolean(result.demo),
    notice: result.notice || null,
    query: term,
    total: items.length,
    items,
    groups,
  };
}

/**
 * 开放平台剩余额度（60s 短缓存 + 单飞）。失败不阻断业务，只返回空数组。
 */
export async function fetchQuota() {
  const cacheKey = 'zhihu:quota';
  const cached = cacheGet(cacheKey);
  if (cached) return cloneWithMeta(cached, { fromCache: true });
  return dedupe('quota', async () => {
    const hit = cacheGet(cacheKey);
    if (hit) return hit;
    const access = getHttpAccessSecret();
    if (shouldUseMock() || !access.value) {
      return { configured: false, items: [] };
    }
    try {
      const data = await requestJson(QUOTA_PATH, {
        accessSecret: access.value,
        timeoutMs: 8000,
        retries: 0,
      });
      return cacheSet(
        cacheKey,
        { configured: true, items: data.Data || [] },
        60 * 1000,
      );
    } catch (error) {
      return { configured: true, items: [], error: error.code || 'QUOTA_ERROR' };
    }
  });
}
