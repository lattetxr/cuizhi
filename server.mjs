import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import express from 'express';
import path from 'node:path';
import {
  getOAuthAppKey,
  getHttpAccessSecret,
  getBakedCredentials,
  readConfig,
} from './lib/config.mjs';
import { generateRecreation, isMockMode } from './lib/llm.mjs';
import { createReviewPlan, applyGrade, packageProgress } from './lib/review.mjs';
import { createPackage, getPackage, listPackages, updatePackage } from './lib/store.mjs';
import { buildAuthorizeUrl, exchangeCode, getSession, createSession, deleteSession, isPublicHttps, createPendingState, verifyState } from './lib/oauth.mjs';
import { callUserApi, USER_ENDPOINTS, fetchOAuthUser, clampLimit, normalizeOffset, normalizePaging } from './lib/zhihuApi.mjs';
import { toHtml, toMarkdown } from './lib/export.mjs';
import { runPipeline, runPipelineFromSource, runPipelineFromSearch, runCoachTurn, previewSearch } from './agents/pipeline.js';
import { fetchHotList, fetchQuota } from './server/lib/zhihu.js';
import { buildCollectionConcepts, buildFavlistFramework, favItemsToAnswers, selectRepresentativeItems } from './server/lib/favlistFramework.mjs';
import { NUOCI_ANSWERS, NUOCI_META } from './server/lib/nuociDataset.js';
import { EXISTENCE_MATCH, EXISTENCE_KEYWORD, EXISTENCE_ANSWER, EXISTENCE_CARDS, EXISTENCE_VISUAL_CARDS, EXISTENCE_COACH_OPENING } from './server/lib/existenceDataset.js';
import { KAOYAN_MATCH, KAOYAN_KEYWORD, KAOYAN_ANSWER, KAOYAN_MAP, KAOYAN_COACH_OPENING } from './server/lib/kaoyanDataset.js';

// 内置示例已通过 scripts/bake-examples.mjs 用真实 LLM 预烘焙（含观点/地图/卡片），
// 首击即零 LLM 耗时、结果稳定；baked 文件缺失时回退到内置卡片/地图的部分 prefill。
const EXISTENCE_PREFILLED = {
  cards: { cards: EXISTENCE_CARDS, review_schedule: { intervals: [1, 3, 7, 21], plan: [] }, source_answer_ids: ['175862602'] },
};
const KAOYAN_PREFILLED = { map: KAOYAN_MAP };

const bakedCache = new Map();
async function loadBaked(name) {
  if (bakedCache.has(name)) return bakedCache.get(name) || null;
  try {
    const file = path.join(config.projectRoot, 'server', 'lib', 'baked', `${name}.json`);
    const data = JSON.parse(await readFile(file, 'utf8'));
    bakedCache.set(name, data);
    return data;
  } catch {
    bakedCache.set(name, null);
    return null;
  }
}

// 炼金管线结果缓存：相同输入二次点击直接命中，稳定且更快
const ALCHEMY_TTL_MS = 60 * 60 * 1000;
function alchemyCacheKey({ url = '', text = '', search = '', goal = '入门', answerIds = null } = {}) {
  const raw = String(search || url || text || '').trim();
  if (!raw) return null;
  const selection = Array.isArray(answerIds)
    ? [...new Set(answerIds.map((id) => String(id)))].sort().join(',').replace(/[^\w,-]/g, '')
    : '';
  return `alchemy:${goal}:${raw}:selection=${selection}`;
}
import { generateVisualCards, sanitizeVisualCards } from './server/lib/visualCards.mjs';
import { cacheGet, cacheSet } from './server/lib/cache.mjs';
// anki.mjs 依赖 node:sqlite（Node v22+），改为动态导入以兼容 v20

const app = express();
const config = await readConfig();
// 预热内置凭证（独立部署、无平台环境变量时从 lib/credentials.json 读取）
await getBakedCredentials();
const publicDir = path.join(config.projectRoot, 'public');
const port = Number(process.env.PORT || config.port || 4173);
const host = process.env.HOST || config.host || '127.0.0.1';

app.use(express.json({ limit: '1mb' }));
app.use(
  express.static(publicDir, {
    etag: true,
    maxAge: 0,
    setHeaders(res, filePath) {
      const ext = path.extname(filePath).toLowerCase();
      if (ext === '.html') {
        // HTML 每次重新校验，保证发布后即时生效
        res.setHeader('Cache-Control', 'public, no-cache');
      } else if (ext === '.css' || ext === '.js' || ext === '.mjs') {
        res.setHeader('Cache-Control', 'public, max-age=3600');
      } else if (['.gif', '.png', '.jpg', '.jpeg', '.webp', '.svg', '.ico', '.woff', '.woff2'].includes(ext)) {
        // 静态图片/字体不经常变动，长缓存让回访瞬时加载
        res.setHeader('Cache-Control', 'public, max-age=604800');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=3600');
      }
    },
  }),
);

function asyncRoute(fn) {
  return (req, res) => {
    Promise.resolve(fn(req, res)).catch((error) => {
      console.error('[request failed]', error);
      res.status(500).json({ ok: false, error: '服务暂时不可用，请稍后再试' });
    });
  };
}

function pipelineToPkg({ pipeline, goal, sourceUrl, title, kind = 'pipeline' }) {
  const { viewpoint, map, cards } = pipeline.outputs;
  const pkgCards = cards.cards.map((card) => ({
    id: card.id,
    type: card.type === 'concept' ? 'concept' : 'qa',
    front: card.front,
    back: card.back,
  }));
  const now = Date.now();
  const pkg = {
    id: randomUUID(),
    kind,
    contentType: kind === 'collection' ? 'collection' : (viewpoint.content_type || 'knowledge'),
    createdAt: now,
    updatedAt: now,
    goal,
    title: title || pipeline.sourceAnswers[0]?.title || '知乎回答学习包',
    sourceUrl: sourceUrl || '',
    sourceExcerpt: pipeline.sourceAnswers[0]?.summary || '',
    coreQuestion: viewpoint.summary || '',
    spectrum: (viewpoint.stances || []).map((item) => ({
      stance: item.stance_name,
      view: item.stance_summary,
      hint: item.arguments?.join('；') || '',
    })),
    concepts: (map.core_concepts || []).map((item) => ({
      term: item.term,
      definition: item.definition,
      example: item.example,
    })),
    cards: pkgCards,
    scenarios: (map.application_scenarios || []).map((item) => ({
      title: item.scenario,
      prompt: item.practice,
      checklist: [],
    })),
    path: (map.learning_path || []).map((item) => ({
      step: item.step,
      action: item.action,
      duration: item.duration,
    })),
    reviewPlan: createReviewPlan(pkgCards),
    recreation: null,
    pipeline: true,
    sourceQuery: pipeline.source?.query || '',
    notices: pipeline.source?.demo
      ? ['当前展示示例内容，你可以换个关键词或链接后重新生成']
      : [],
    degraded: pipeline.degraded,
    sourceAnswers: pipeline.sourceAnswers,
    viewpoint: pipeline.outputs.viewpoint,
    mapData: pipeline.outputs.map,
    cardsData: pipeline.outputs.cards,
  };
  pkg.reviewPlan.progress = packageProgress(pkg);
  return pkg;
}


function publicPackageNotices(pkg = {}) {
  const notices = Array.isArray(pkg.notices) ? pkg.notices : [];
  const hasDemoContent = notices.some((notice) => /演示数据|示例内容/.test(String(notice)));
  return hasDemoContent ? ['当前展示示例内容，你可以换个关键词或链接后重新生成'] : [];
}

function presentPackage(pkg) {
  if (!pkg) return pkg;
  const { degraded: _internalDegraded, ...publicPkg } = pkg;
  return {
    ...publicPkg,
    notices: publicPackageNotices(pkg),
    visualCards: publicPkg.contentType === 'collection'
      ? generateVisualCards(publicPkg)
      : sanitizeVisualCards(publicPkg.visualCards || []),
  };
}

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : '';
}

function requireSession(req, res) {
  const session = getSession(readCookie(req, 'cuizhi_oauth'));
  if (!session) {
    res.status(401).json({ ok: false, error: '尚未完成知乎登录' });
    return null;
  }
  return session;
}

const DIRECT_PROFILE = {
  name: '知乎账号',
  avatarUrl: null,
  headline: '授权后可同步你的关注、创作与收藏夹',
  url: null,
};

/**
 * 身份解析：
 * 1) OAuth 已授权用户 -> X-OAuth-Token 代表该用户
 * 2) 未走 OAuth 但服务端配置了 Access Secret -> 直连该凭证所属账号（开发/独立部署）
 */
function resolveIdentity(req, res) {
  const session = getSession(readCookie(req, 'cuizhi_oauth'));
  if (session) {
    return {
      mode: 'oauth',
      accessToken: session.accessToken,
      profile: session.profile || DIRECT_PROFILE,
      stateVerified: Boolean(session.stateVerified),
    };
  }
  const loggedOut = readCookie(req, 'cuizhi_logged_out') === '1';
  const access = getHttpAccessSecret();
  if (access.value && !loggedOut) {
    return { mode: 'direct', accessToken: null, profile: DIRECT_PROFILE, stateVerified: null };
  }
  res.status(401).json({ ok: false, error: '尚未完成知乎登录' });
  return null;
}

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    time: new Date().toISOString(),
    service: 'cuizhi',
    llmMock: isMockMode(),
  });
});

app.get('/api/oauth/status', asyncRoute(async (req, res) => {
  const appId = String(config.oauth?.appId || '').trim();
  const redirectUri = String(config.oauth?.redirectUri || '').trim();
  const access = getHttpAccessSecret();
  const session = getSession(readCookie(req, 'cuizhi_oauth'));
  const loginAvailable = Boolean(appId) && isPublicHttps(redirectUri);
  let identity;
  if (session) {
    if (!session.profile || (!session.profile.name && !session.profile.avatarUrl)) {
      const profile = await fetchOAuthUser(session.accessToken).catch(() => null);
      if (profile) session.profile = profile;
    }
    identity = {
      mode: 'oauth',
      authorized: true,
      profile: session.profile || DIRECT_PROFILE,
      stateVerified: Boolean(session.stateVerified),
      expiresAt: session.expiresAt ? new Date(session.expiresAt).toISOString() : null,
    };
  } else if (access.value && readCookie(req, 'cuizhi_logged_out') !== '1') {
    identity = { mode: 'direct', authorized: true, profile: DIRECT_PROFILE, stateVerified: null, expiresAt: null };
  } else {
    identity = { mode: 'none', authorized: false, profile: null, stateVerified: null, expiresAt: null };
  }
  res.json({
    ok: true,
    oauth: {
      enabled: config.oauth?.enabled === true,
      waitingForDeploy: !loginAvailable,
      authorized: identity.authorized,
      identity,
    },
  });
}));

app.get('/auth/login', asyncRoute(async (req, res) => {
  const appKey = await getOAuthAppKey(config).catch(() => ({ value: '' }));
  const appId = String(config.oauth?.appId || '').trim();
  const redirectUri = String(config.oauth?.redirectUri || '').trim();
  if (!appId || !isPublicHttps(redirectUri)) {
    res.status(400).json({
      ok: false,
      error: '知乎登录暂不可用，请稍后再试',
      waitingForDeploy: true,
    });
    return;
  }
  if (!appKey.value) {
    res.status(400).json({
      ok: false,
      error: '知乎登录暂不可用，请稍后再试',
    });
    return;
  }
  const state = randomUUID();
  createPendingState(state);
  res.redirect(buildAuthorizeUrl(config, state));
}));

app.get('/auth/callback', asyncRoute(async (req, res) => {
  const code = req.query.authorization_code || req.query.code;
  const state = req.query.state || '';
  const redirectUri = String(config.oauth?.redirectUri || '').trim();
  const appId = String(config.oauth?.appId || '').trim();
  if (!code) {
    res.redirect('/?oauth=failed');
    return;
  }
  if (!appId || !isPublicHttps(redirectUri)) {
    res.redirect('/?oauth=failed');
    return;
  }
  const stateVerification = verifyState(state);
  if (!stateVerification.valid) {
    res.redirect('/?oauth=failed');
    return;
  }
  const appKey = await getOAuthAppKey(config);
  if (!appKey.value) {
    res.redirect('/?oauth=failed');
    return;
  }
  try {
    const { accessToken, expiresIn } = await exchangeCode({
      appId,
      appKey: appKey.value,
      code: String(code),
      redirectUri,
    });
    // /user 没有正式响应 schema：资料失败不阻断登录和正式数据接口
    const profile = await fetchOAuthUser(accessToken).catch(() => null);
    const sessionId = createSession(accessToken, {
      profile,
      stateVerified: stateVerification.verified,
      expiresIn,
    });
    res.cookie('cuizhi_oauth', sessionId, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 24 * 60 * 60 * 1000,
    });
    res.clearCookie('cuizhi_logged_out', { path: '/' });
    res.redirect('/?oauth=success');
  } catch (error) {
    console.error('[zhihu login failed]', error);
    res.redirect('/?oauth=failed');
  }
}));

app.post('/api/oauth/logout', asyncRoute(async (req, res) => {
  const id = readCookie(req, 'cuizhi_oauth');
  if (id) deleteSession(id);
  res.clearCookie('cuizhi_oauth', { path: '/' });
  // 退出后本次浏览器会话不再回退到内置 Access Secret 直连账号
  res.cookie('cuizhi_logged_out', '1', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 12 * 60 * 60 * 1000,
  });
  res.json({ ok: true });
}));

// 关键词搜索预览：先看优质帖子、作者、原文链接与各问题数量比例，再决定炼哪些
app.post('/api/zhihu/search-preview', asyncRoute(async (req, res) => {
  const query = String(req.body?.query || '').trim();
  if (!query) {
    res.status(400).json({ ok: false, error: '请输入要搜索的问题' });
    return;
  }
  const data = await previewSearch(query, { count: 10 });
  res.json({ ok: true, ...data });
}));

// 知乎热榜：全员共享一份 24h 缓存（热榜每日额度极小），服务端单飞
app.get('/api/zhihu/hot', asyncRoute(async (req, res) => {
  const limit = Math.min(30, Math.max(1, Number(req.query.limit) || 8));
  const data = await fetchHotList({ limit });
  res.json({
    ok: true,
    demo: Boolean(data.demo),
    notice: data.notice || null,
    items: (data.items || []).slice(0, limit),
  });
}));

// 开放平台剩余额度（60s 缓存，仅用于前端提示，不阻断任何业务）
app.get('/api/zhihu/quota', asyncRoute(async (req, res) => {
  const data = await fetchQuota();
  res.json({ ok: true, ...data });
}));

app.post('/api/alchemy', asyncRoute(async (req, res) => {
  const { url = '', text = '', search = '', goal = '入门', answerIds = null } = req.body || {};
  const hasInput = Boolean(String(search || url || text).trim());
  if (!hasInput) {
    res.status(400).json({ ok: false, error: '请粘贴链接或正文' });
    return;
  }

  // 流式进度响应（NDJSON）：真实管线阶段驱动，前端据此渲染稳定进度条
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-store');
  res.flushHeaders();
  const send = (obj) => res.write(`${JSON.stringify(obj)}\n`);
  const onProgress = (info) => {
    if (info && info.progress) send({ progress: info.progress, step: info.step, status: info.status });
  };
  // 缓存/瞬时命中时补齐完整阶段进度，保证重复炼金的进度条与首次一致
  const sendCannedProgress = () => {
    send({ progress: 4, step: 'quench', status: '正在准备炼金原料' });
    send({ progress: 42, step: 'forge', status: '正在梳理观点与结构' });
    send({ progress: 72, step: 'solidify', status: '正在生成复习卡片' });
    send({ progress: 88, step: 'verify', status: '正在查漏补缺' });
  };

  let sourceUrl = url;
  let pipeline;
  let sampleNote = null;
  let isExistence = false;
  let isKaoyan = false;
  let builtinName = null;

  // 命中缓存则直接复用管线结果（跳过 LLM），二次炼金瞬时完成
  const cacheKey = alchemyCacheKey({ url, text, search, goal, answerIds });
  const cached = cacheKey ? cacheGet(cacheKey) : null;
  if (!cached) {
    send({ progress: 4, step: 'quench', status: '正在准备炼金原料' });
    if (search) {
      const term = String(search).trim();
      if (term.includes('裸辞')) {
        builtinName = 'nuoci';
        pipeline = await runPipeline({
          answers: NUOCI_ANSWERS,
          prefilled: (await loadBaked('nuoci')) || {},
          onProgress,
        });
        pipeline.source = { demo: false, notice: null, count: NUOCI_ANSWERS.length, builtinName: 'nuoci' };
        sampleNote = `样本：${NUOCI_META.count} 条知乎帖子（${NUOCI_META.collectedAt} 采集）`;
      } else if (term.includes(EXISTENCE_KEYWORD)) {
        isExistence = true;
        builtinName = 'existence';
        pipeline = await runPipeline({
          answers: [EXISTENCE_ANSWER],
          prefilled: (await loadBaked('existence')) || EXISTENCE_PREFILLED,
          onProgress,
        });
        pipeline.source = { demo: false, notice: null, count: 1, builtinName: 'existence' };
      } else {
        // 关键词：单次知乎搜索 + 按问题聚合；用户在预览中勾选后只炼所选帖子
        pipeline = await runPipelineFromSearch(term, { answerIds, onProgress });
      }
      sourceUrl = '';
    } else if (url && !text) {
      if (url.includes(EXISTENCE_MATCH)) {
        isExistence = true;
        builtinName = 'existence';
        pipeline = await runPipeline({
          answers: [EXISTENCE_ANSWER],
          prefilled: (await loadBaked('existence')) || EXISTENCE_PREFILLED,
          onProgress,
        });
        pipeline.source = { demo: false, notice: null, count: 1, builtinName: 'existence' };
      } else if (url.includes(KAOYAN_MATCH)) {
        isKaoyan = true;
        builtinName = 'kaoyan';
        pipeline = await runPipeline({
          answers: [KAOYAN_ANSWER],
          prefilled: (await loadBaked('kaoyan')) || KAOYAN_PREFILLED,
          onProgress,
        });
        pipeline.source = { demo: false, notice: null, count: 1, builtinName: 'kaoyan' };
      } else {
        pipeline = await runPipelineFromSource(url, { fetchOptions: { limit: 10 }, onProgress });
      }
    } else if (text) {
      const pasted = String(text).trim();
      if (pasted.includes(EXISTENCE_KEYWORD)) {
        isExistence = true;
        builtinName = 'existence';
        pipeline = await runPipeline({
          answers: [EXISTENCE_ANSWER],
          prefilled: (await loadBaked('existence')) || EXISTENCE_PREFILLED,
          onProgress,
        });
        pipeline.source = { demo: false, notice: null, count: 1, builtinName: 'existence' };
      } else if (pasted.includes(KAOYAN_KEYWORD) || pasted.includes(KAOYAN_MATCH)) {
        isKaoyan = true;
        builtinName = 'kaoyan';
        pipeline = await runPipeline({
          answers: [KAOYAN_ANSWER],
          prefilled: (await loadBaked('kaoyan')) || KAOYAN_PREFILLED,
          onProgress,
        });
        pipeline.source = { demo: false, notice: null, count: 1, builtinName: 'kaoyan' };
      } else {
        pipeline = await runPipeline({
          answers: [
            {
              answerId: 'paste-1',
              author: '我',
              title: '我的学习内容',
              summary: pasted.slice(0, 300),
              content: pasted,
              voteCount: 0,
              authorityLevel: 1,
              url: '',
            },
          ],
          onProgress,
        });
        pipeline.source = { demo: false, notice: null, count: 1 };
      }
    }
    if (cacheKey) cacheSet(cacheKey, pipeline, ALCHEMY_TTL_MS);
  } else {
    pipeline = cached;
    builtinName = pipeline.source?.builtinName || null;
    sendCannedProgress();
  }
  if (builtinName === 'existence') isExistence = true;
  if (builtinName === 'kaoyan') isKaoyan = true;

  send({ progress: 90, step: 'verify', status: '正在整理学习包' });
  const pkg = pipelineToPkg({
    pipeline,
    goal,
    sourceUrl,
    title: isExistence ? '什么是存在主义？' : isKaoyan ? KAOYAN_ANSWER.title : (search ? String(search).trim() : pipeline.sourceAnswers[0]?.title),
  });
  if (sampleNote) pkg.sampleNote = sampleNote;
  if (isExistence) {
    pkg.cardsData = { cards: EXISTENCE_CARDS, review_schedule: { intervals: [1, 3, 7, 21], plan: [] }, source_answer_ids: ['175862602'] };
    pkg.cards = EXISTENCE_CARDS;
    pkg.visualCards = EXISTENCE_VISUAL_CARDS;
    pkg.coachOpening = EXISTENCE_COACH_OPENING;
  }
  if (isKaoyan) {
    pkg.contentType = 'exam';
    pkg.mapData = KAOYAN_MAP;
    pkg.concepts = KAOYAN_MAP.core_concepts.map((item) => ({
      term: item.term,
      definition: item.definition,
      example: item.example,
    }));
    pkg.path = KAOYAN_MAP.learning_path.map((item) => ({
      step: item.step,
      action: item.action,
      duration: item.duration,
    }));
    pkg.scenarios = KAOYAN_MAP.application_scenarios.map((item) => ({
      title: item.scenario,
      prompt: item.practice,
      checklist: [],
    }));
    pkg.coachOpening = KAOYAN_COACH_OPENING;
  }
  await createPackage(pkg);
  send({ ok: true, progress: 100, mock: pipeline.source.demo || false, pkg: presentPackage(pkg) });
  res.end();
}));

app.post('/api/coach', asyncRoute(async (req, res) => {
  const { packageId, messages = [], mode = 'chat' } = req.body || {};
  const pkg = await getPackage(packageId);
  if (!pkg) {
    res.status(404).json({ ok: false, error: '学习包不存在' });
    return;
  }
  const answers = pkg.sourceAnswers?.length
    ? pkg.sourceAnswers
    : [
        {
          answerId: 'package-1',
          author: '学习包来源',
          title: pkg.title,
          summary: pkg.sourceExcerpt || '',
          content: pkg.sourceExcerpt || '',
          url: pkg.sourceUrl || '',
        },
      ];
  const result = await runCoachTurn({ answers, messages, mode });
  res.json({
    ok: true,
    data: result.data,
    mock: result.mock || false,
    degraded: result.degraded || false,
  });
}));

app.post('/api/pipeline', asyncRoute(async (req, res) => {
  const { url = '', answers = [], limit = 10 } = req.body || {};
  if (answers.length) {
    res.json(await runPipeline({ answers }));
    return;
  }
  if (url) {
    res.json(await runPipelineFromSource(url, { fetchOptions: { limit } }));
    return;
  }
  res.status(400).json({ ok: false, error: '需要提供 url 或 answers' });
}));

app.get('/api/packages', asyncRoute(async (req, res) => {
  res.json({ ok: true, packages: await listPackages() });
}));

app.get('/api/packages/:id', asyncRoute(async (req, res) => {
  const pkg = await getPackage(req.params.id);
  if (!pkg) {
    res.status(404).json({ ok: false, error: '学习包不存在' });
    return;
  }
  res.json({ ok: true, pkg: presentPackage(pkg) });
}));

app.post('/api/packages/:id/review', asyncRoute(async (req, res) => {
  const { cardId, grade } = req.body || {};
  const updated = await updatePackage(req.params.id, (pkg) => applyGrade(pkg, cardId, grade));
  if (!updated) {
    res.status(404).json({ ok: false, error: '学习包不存在' });
    return;
  }
  res.json({ ok: true, pkg: presentPackage(updated) });
}));

app.post('/api/packages/:id/recreate', asyncRoute(async (req, res) => {
  const pkg = await getPackage(req.params.id);
  if (!pkg) {
    res.status(404).json({ ok: false, error: '学习包不存在' });
    return;
  }
  if (pkg.recreation) {
    res.json({ ok: true, mock: false, recreation: pkg.recreation });
    return;
  }
  const result = await generateRecreation(pkg);
  if (!result.ok) {
    res.status(502).json({ ok: false, error: '暂时无法完成对练，请稍后再试' });
    return;
  }
  const updated = await updatePackage(pkg.id, (item) => ({
    ...item,
    recreation: result.data,
    updatedAt: Date.now(),
  }));
  res.json({ ok: true, mock: result.mock, recreation: updated.recreation });
}));

app.post('/api/packages/:id/visual-cards', asyncRoute(async (req, res) => {
  const pkg = await getPackage(req.params.id);
  if (!pkg) {
    res.status(404).json({ ok: false, error: '学习包不存在' });
    return;
  }
  const visualCards = generateVisualCards(pkg);
  await updatePackage(pkg.id, (item) => ({
    ...item,
    visualCards,
    updatedAt: Date.now(),
  }));
  res.json({ ok: true, cards: visualCards });
}));

app.get('/api/packages/:id/export-cards', asyncRoute(async (req, res) => {
  const pkg = await getPackage(req.params.id);
  if (!pkg) {
    res.status(404).json({ ok: false, error: '学习包不存在' });
    return;
  }
  const cards = pkg.contentType === 'collection'
    ? generateVisualCards(pkg)
    : sanitizeVisualCards(pkg.visualCards || []);
  if (!cards?.length) {
    res.status(400).json({ ok: false, error: '请先生成可视化复习卡片' });
    return;
  }
  const format = req.query.format === 'anki' ? 'anki' : 'md';
  if (format === 'anki') {
    try {
      const { createAnkiApkg } = await import('./server/lib/anki.mjs');
      const apkg = createAnkiApkg(cards);
      res.setHeader('Content-Disposition', `attachment; filename="cuizhi-${pkg.id}.apkg"`);
      res.type('application/octet-stream').send(Buffer.from(apkg));
    } catch (e) {
      res.status(500).json({ ok: false, error: '当前环境暂不支持 Anki 导出，请先使用 Markdown 格式' });
    }
    return;
  }
  const markdown = `# ${pkg.title} · 可视化复习卡片\n\n${cards
    .map(
      (card, index) =>
        `## ${index + 1}. ${card.type}\n\n**正面**\n${card.front}\n\n**背面**\n${card.back}\n\n来源：${card.sourceUrl || '无'}\n`,
    )
    .join('\n')}\n`;
  res.setHeader('Content-Disposition', `attachment; filename="cuizhi-cards-${pkg.id}.md"`);
  res.type('text/markdown').send(markdown);
}));

app.get('/api/packages/:id/export', asyncRoute(async (req, res) => {
  const pkg = await getPackage(req.params.id);
  if (!pkg) {
    res.status(404).json({ ok: false, error: '学习包不存在' });
    return;
  }
  const format = req.query.format === 'html' ? 'html' : 'md';
  const filename = `cuizhi-${pkg.id}.${format === 'html' ? 'html' : 'md'}`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  if (format === 'html') {
    res.type('html').send(toHtml(presentPackage(pkg)));
  } else {
    res.type('text/markdown').send(toMarkdown(presentPackage(pkg)));
  }
}));

app.get('/api/me/contents', asyncRoute(async (req, res) => {
  const identity = resolveIdentity(req, res);
  if (!identity) return;
  const limit = clampLimit(req.query.Limit, 20);
  const offset = normalizeOffset(req.query.Offset);
  const contentType = ['all', 'answer', 'article', 'zvideo', 'pin', 'question'].includes(req.query.ContentType)
    ? req.query.ContentType
    : 'all';
  const sortField = req.query.SortField === 'like_count' ? 'like_count' : 'ts';
  const sortOrder = req.query.SortOrder === 'asc' ? 'asc' : 'desc';
  const data = await callUserApi(
    USER_ENDPOINTS.contents,
    { Offset: offset, Limit: limit, ContentType: contentType, SortField: sortField, SortOrder: sortOrder },
    identity.accessToken,
  );
  res.json({
    ok: true,
    identity: { mode: identity.mode, profile: identity.profile, stateVerified: identity.stateVerified },
    data,
    paging: normalizePaging(data.Paging, { offset, limit }),
  });
}));

app.get('/api/me/followees', asyncRoute(async (req, res) => {
  const identity = resolveIdentity(req, res);
  if (!identity) return;
  const limit = clampLimit(req.query.Limit, 20);
  const offset = normalizeOffset(req.query.Offset);
  const data = await callUserApi(
    USER_ENDPOINTS.followees,
    { Offset: offset, Limit: limit },
    identity.accessToken,
  );
  res.json({
    ok: true,
    identity: { mode: identity.mode, profile: identity.profile, stateVerified: identity.stateVerified },
    data,
    paging: normalizePaging(data.Paging, { offset, limit }),
  });
}));

app.get('/api/me/favlists', asyncRoute(async (req, res) => {
  const identity = resolveIdentity(req, res);
  if (!identity) return;
  const limit = clampLimit(req.query.Limit, 20);
  const data = await callUserApi(USER_ENDPOINTS.favlists, { Limit: limit }, identity.accessToken);
  res.json({
    ok: true,
    identity: { mode: identity.mode, profile: identity.profile, stateVerified: identity.stateVerified },
    data,
  });
}));

app.get('/api/me/favlist_contents', asyncRoute(async (req, res) => {
  const identity = resolveIdentity(req, res);
  if (!identity) return;
  const urlToken = String(req.query.FavlistUrlToken || '').trim();
  if (!urlToken) {
    res.status(400).json({ ok: false, error: '收藏夹信息缺失，请返回后重试' });
    return;
  }
  const limit = clampLimit(req.query.Limit, 20);
  const offset = normalizeOffset(req.query.Offset);
  const data = await callUserApi(
    USER_ENDPOINTS.favlistContents,
    { FavlistUrlToken: urlToken, Offset: offset, Limit: limit },
    identity.accessToken,
  );
  res.json({
    ok: true,
    identity: { mode: identity.mode, profile: identity.profile, stateVerified: identity.stateVerified },
    data,
    paging: normalizePaging(data.Paging, { offset, limit }),
  });
}));

app.get('/api/me/collections', asyncRoute(async (req, res) => {
  const identity = resolveIdentity(req, res);
  if (!identity) return;
  const limit = clampLimit(req.query.Limit, 20);
  const data = await callUserApi(USER_ENDPOINTS.collections, { Limit: limit }, identity.accessToken);
  res.json({
    ok: true,
    identity: { mode: identity.mode, profile: identity.profile, stateVerified: identity.stateVerified },
    data,
  });
}));

const favlistContentCache = new Map();
const FAVLIST_CONTENT_CACHE_TTL_MS = 90_000;
const FAVLIST_CONTENT_CACHE_LIMIT = 20;

function readFavlistContentCache(key) {
  const cached = favlistContentCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.at > FAVLIST_CONTENT_CACHE_TTL_MS) {
    favlistContentCache.delete(key);
    return null;
  }
  return cached.value;
}

function writeFavlistContentCache(key, value) {
  if (favlistContentCache.size >= FAVLIST_CONTENT_CACHE_LIMIT) {
    favlistContentCache.delete(favlistContentCache.keys().next().value);
  }
  favlistContentCache.set(key, { at: Date.now(), value });
}

async function fetchFavlistContentsBatched(accessToken, urlToken, maxItems = 200) {
  const pageSize = 50;
  const target = Math.min(200, Math.max(1, Number(maxItems) || 200));
  const identityKey = accessToken || '__direct__';
  const cacheKey = `${identityKey}\u0000${urlToken}\u0000${target}`;
  const cached = readFavlistContentCache(cacheKey);
  if (cached) return { ...cached, cached: true };

  const items = [];
  const seen = new Set();
  let offset = '0';
  let paging = null;

  while (items.length < target) {
    const data = await callUserApi(
      USER_ENDPOINTS.favlistContents,
      { FavlistUrlToken: urlToken, Offset: offset, Limit: pageSize },
      accessToken,
    );
    for (const item of data.Items || []) {
      const key = String(item.ContentID || item.Url || `${offset}-${items.length}`);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item);
      if (items.length >= target) break;
    }
    paging = normalizePaging(data.Paging, { offset, limit: pageSize });
    if (paging.isEnd || !paging.nextOffset || paging.nextOffset === offset) break;
    offset = paging.nextOffset;
  }

  const result = {
    items,
    paging,
    truncated: items.length >= target && !paging?.isEnd,
  };
  if (items.length) writeFavlistContentCache(cacheKey, result);
  return { ...result, cached: false };
}

app.get('/api/me/favlists/:urlToken/insight', asyncRoute(async (req, res) => {
  const identity = resolveIdentity(req, res);
  if (!identity) return;
  const { urlToken } = req.params;
  const maxItems = Math.min(200, Math.max(1, Number.parseInt(req.query.Limit, 10) || 200));
  const { items, paging, truncated } = await fetchFavlistContentsBatched(
    identity.accessToken,
    urlToken,
    maxItems,
  );
  if (!items.length) {
    res.status(422).json({ ok: false, error: '这个收藏夹里还没有可分析的内容' });
    return;
  }
  const framework = buildFavlistFramework(items);
  if (truncated) {
    framework.summary += ' 本次优先梳理最近 200 条收藏，先生成最值得消化的知识骨架。';
  }
  res.json({
    ok: true,
    favlist: {
      UrlToken: urlToken,
      Title: '收藏夹',
      Url: `https://www.zhihu.com/collection/${urlToken}`,
    },
    framework,
    paging,
    truncated,
  });
}));

app.post('/api/favlists/:urlToken/alchemy', asyncRoute(async (req, res) => {
  const identity = resolveIdentity(req, res);
  if (!identity) return;
  const { urlToken } = req.params;
  const goal = req.body?.goal || '入门';
  const maxItems = Math.min(200, Math.max(1, Number.parseInt(req.body?.limit, 10) || 200));
  const { items: rawItems, truncated } = await fetchFavlistContentsBatched(
    identity.accessToken,
    urlToken,
    maxItems,
  );
  const favlist = {
    UrlToken: urlToken,
    Title: String(req.body?.title || '收藏夹'),
    Url: String(req.body?.url || `https://www.zhihu.com/collection/${urlToken}`),
  };
  if (!rawItems.length) {
    res.status(422).json({ ok: false, error: '这个收藏夹里还没有可炼金的内容' });
    return;
  }

  const framework = buildFavlistFramework(rawItems);
  if (truncated) {
    framework.summary += ' 本次优先梳理最近 200 条收藏，先生成最值得消化的知识骨架。';
  }
  const representativeItems = selectRepresentativeItems(rawItems, 12);
  const answers = favItemsToAnswers(representativeItems);

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-store');
  res.flushHeaders();
  const send = (obj) => res.write(`${JSON.stringify(obj)}
`);
  const onProgress = (info) => {
    if (info?.progress) send({ progress: info.progress, step: info.step, status: info.status });
  };

  try {
    send({ progress: 6, step: 'quench', status: `正在梳理 ${framework.total} 条收藏的知识结构` });
    send({ progress: 12, step: 'quench', status: `已选出 ${answers.length} 条代表内容` });
    const pipeline = await runPipeline({ answers, onProgress });
    pipeline.source = {
      demo: false,
      notice: null,
      count: rawItems.length,
      selectedCount: answers.length,
      framework,
    };
    const pkg = pipelineToPkg({
      pipeline,
      goal,
      sourceUrl: favlist?.Url || '',
      title: `收藏夹：${favlist?.Title || `#${urlToken}`}`,
      kind: 'collection',
    });
    pkg.contentType = 'collection';
    pkg.collectionFramework = framework;
    // 整夹复习卡只从“收藏夹知识框架”的主题矿脉取概念，不能沿用普通单篇生成的泛化概念。
    const collectionConcepts = buildCollectionConcepts(framework, representativeItems);
    pkg.mapData = {
      ...pkg.mapData,
      core_concepts: collectionConcepts,
    };
    pkg.concepts = collectionConcepts.map(({ term, definition, example }) => ({ term, definition, example }));
    pkg.visualCards = generateVisualCards(pkg);
    pkg.collectionMeta = {
      urlToken,
      analyzedCount: rawItems.length,
      selectedCount: answers.length,
      truncated,
      title: favlist?.Title || '收藏夹',
      url: favlist?.Url || '',
    };
    await createPackage(pkg);
    send({ ok: true, progress: 100, mock: false, pkg: presentPackage(pkg) });
    res.end();
  } catch (error) {
    console.error('[favlist alchemy failed]', error);
    send({ ok: false, error: '收藏夹炼金暂时没有成功，请稍后再试' });
    res.end();
  }
}));

app.listen(port, host, () => {
  console.log(`淬知已启动：http://${host}:${port}/`);
  console.log(`LLM 模式：${isMockMode() ? 'Mock（未配置 API Key）' : '真实模型'}`);
});

export { app };
