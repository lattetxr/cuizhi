import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import express from 'express';
import path from 'node:path';
import {
  getOAuthAppKey,
  getHttpAccessSecret,
  mask,
  readConfig,
} from './lib/config.mjs';
import { generateRecreation, isMockMode } from './lib/llm.mjs';
import { createReviewPlan, applyGrade, packageProgress } from './lib/review.mjs';
import { createPackage, getPackage, listPackages, updatePackage } from './lib/store.mjs';
import { buildAuthorizeUrl, exchangeCode, getSession, createSession, deleteSession, isPublicHttps, createPendingState, verifyState } from './lib/oauth.mjs';
import { callUserApi, USER_ENDPOINTS } from './lib/zhihuApi.mjs';
import { toHtml, toMarkdown } from './lib/export.mjs';
import { runPipeline, runPipelineFromSource, runCoachTurn } from './agents/pipeline.js';
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
function alchemyCacheKey({ url = '', text = '', search = '', goal = '入门' } = {}) {
  const raw = String(search || url || text || '').trim();
  if (!raw) return null;
  return `alchemy:${goal}:${raw}`;
}
import { generateVisualCards } from './server/lib/visualCards.mjs';
import { cacheGet, cacheSet } from './server/lib/cache.mjs';
// anki.mjs 依赖 node:sqlite（Node v22+），改为动态导入以兼容 v20

const app = express();
const config = await readConfig();
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
      res.status(500).json({ ok: false, error: error.message || '服务器内部错误' });
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
    notices: pipeline.notices,
    degraded: pipeline.degraded,
    sourceAnswers: pipeline.sourceAnswers,
    viewpoint: pipeline.outputs.viewpoint,
    mapData: pipeline.outputs.map,
    cardsData: pipeline.outputs.cards,
  };
  pkg.reviewPlan.progress = packageProgress(pkg);
  return pkg;
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
  const appKey = await getOAuthAppKey(config).catch(() => ({ value: '', source: null }));
  const access = getHttpAccessSecret();
  const session = getSession(readCookie(req, 'cuizhi_oauth'));
  const waitingForDeploy = !appId || !isPublicHttps(redirectUri);
  res.json({
    ok: true,
    oauth: {
      enabled: config.oauth?.enabled === true,
      appIdSet: Boolean(appId),
      redirectUri: redirectUri || null,
      waitingForDeploy,
      appKeyConfigured: Boolean(appKey.value),
      appKeySource: appKey.source,
      accessSecretConfigured: Boolean(access.value),
      accessSecretSource: access.source,
      accessSecretMasked: mask(access.value),
      authorized: Boolean(session),
    },
    llmMock: isMockMode(),
    note: waitingForDeploy
      ? '本地预览只能体验炼金流程，真实知乎登录需部署到公网 HTTPS 并配置回调'
      : null,
  });
}));

app.get('/auth/login', asyncRoute(async (req, res) => {
  const appKey = await getOAuthAppKey(config).catch(() => ({ value: '' }));
  const appId = String(config.oauth?.appId || '').trim();
  const redirectUri = String(config.oauth?.redirectUri || '').trim();
  if (!appId || !isPublicHttps(redirectUri)) {
    res.status(400).json({
      ok: false,
      error: '等待部署：需要先配置 App ID 与公网 HTTPS 回调地址',
      waitingForDeploy: true,
    });
    return;
  }
  if (!appKey.value) {
    res.status(400).json({
      ok: false,
      error: 'OAuth App Key 未配置',
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
    res.redirect('/?oauth=failed&reason=no_code');
    return;
  }
  if (!appId || !isPublicHttps(redirectUri)) {
    res.redirect('/?oauth=failed&reason=not_deployed');
    return;
  }
  const stateVerification = verifyState(state);
  if (!stateVerification.valid) {
    const reason = stateVerification.reason === 'missing' ? 'state_missing' : 'state_invalid';
    res.redirect(`/?oauth=failed&reason=${reason}&hint=仅适合临时联调`);
    return;
  }
  const appKey = await getOAuthAppKey(config);
  if (!appKey.value) {
    res.redirect('/?oauth=failed&reason=app_key_missing');
    return;
  }
  try {
    const token = await exchangeCode({
      appId,
      appKey: appKey.value,
      code: String(code),
      redirectUri,
    });
    const sessionId = createSession(token);
    res.cookie('cuizhi_oauth', sessionId, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 24 * 60 * 60 * 1000,
    });
    res.redirect('/?oauth=success');
  } catch (error) {
    res.redirect(`/?oauth=failed&reason=${encodeURIComponent(error.message)}`);
  }
}));

app.post('/api/oauth/logout', asyncRoute(async (req, res) => {
  const id = readCookie(req, 'cuizhi_oauth');
  if (id) deleteSession(id);
  res.clearCookie('cuizhi_oauth', { path: '/' });
  res.json({ ok: true });
}));

app.post('/api/alchemy', asyncRoute(async (req, res) => {
  const { url = '', text = '', search = '', goal = '入门' } = req.body || {};
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
  const cacheKey = alchemyCacheKey({ url, text, search, goal });
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
        pipeline = await runPipelineFromSource(term, { fetchOptions: { limit: 10 }, onProgress });
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
  send({ ok: true, progress: 100, mock: pipeline.source.demo || false, pkg });
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
  res.json({ ok: true, pkg });
}));

app.post('/api/packages/:id/review', asyncRoute(async (req, res) => {
  const { cardId, grade } = req.body || {};
  const updated = await updatePackage(req.params.id, (pkg) => applyGrade(pkg, cardId, grade));
  if (!updated) {
    res.status(404).json({ ok: false, error: '学习包不存在' });
    return;
  }
  res.json({ ok: true, pkg: updated });
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
    res.status(502).json({ ok: false, error: result.error });
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
  const cards = pkg.visualCards;
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
      res.status(500).json({ ok: false, error: `Anki 导出需要 Node.js v22+，当前环境不支持：${e.message}` });
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
    res.type('html').send(toHtml(pkg));
  } else {
    res.type('text/markdown').send(toMarkdown(pkg));
  }
}));

const oauthMeRoutes = [
  ['contents', '/api/me/contents', USER_ENDPOINTS.contents, ['Limit']],
  ['followees', '/api/me/followees', USER_ENDPOINTS.followees, ['Limit']],
  ['favlists', '/api/me/favlists', USER_ENDPOINTS.favlists, ['Limit']],
  ['favlistContents', '/api/me/favlist_contents', USER_ENDPOINTS.favlistContents, ['FavlistUrlToken', 'Limit']],
  ['collections', '/api/me/collections', USER_ENDPOINTS.collections, ['Limit']],
];

for (const [name, route, endpoint, params] of oauthMeRoutes) {
  app.get(route, asyncRoute(async (req, res) => {
    const session = requireSession(req, res);
    if (!session) return;
    const query = {};
    for (const key of params) {
      if (req.query[key] !== undefined) query[key] = req.query[key];
    }
    const data = await callUserApi(endpoint, query, session.accessToken);
    res.json({ ok: true, data });
  }));
}

app.post('/api/favlists/:urlToken/alchemy', asyncRoute(async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  const { urlToken } = req.params;
  const lists = await callUserApi(USER_ENDPOINTS.favlists, { Limit: 50 }, session.accessToken);
  const favlist = (lists.Items || []).find((item) => String(item.UrlToken) === String(urlToken));
  const contents = await callUserApi(
    USER_ENDPOINTS.favlistContents,
    { FavlistUrlToken: urlToken, Limit: 10 },
    session.accessToken,
  );
  const items = contents.Items || [];
  if (!items.length) {
    res.status(422).json({ ok: false, error: '这个收藏夹里还没有可炼金的内容' });
    return;
  }
  const goal = req.body?.goal || '入门';
  const answers = items.map((item, index) => ({
    answerId: String(item.ContentID || item.Url || `fav-${index + 1}`),
    author: item.Author?.Name || '收藏内容',
    title: item.Title || '',
    summary: item.Summary || '',
    content: `${item.Title || ''}\n${item.Summary || ''}`,
    voteCount: Number(item.LikeCount || 0),
    authorityLevel: 2,
    url: item.Url || '',
  }));
  const pipeline = await runPipeline({ answers });
  pipeline.source = { demo: false, notice: null, count: answers.length };
  const pkg = pipelineToPkg({
    pipeline,
    goal,
    sourceUrl: favlist?.Url || '',
    title: `收藏夹：${favlist?.Title || `#${urlToken}`}`,
    kind: 'collection',
  });
  await createPackage(pkg);
  res.json({ ok: true, mock: false, pkg });
}));

app.listen(port, host, () => {
  console.log(`淬知已启动：http://${host}:${port}/`);
  console.log(`LLM 模式：${isMockMode() ? 'Mock（未配置 API Key）' : '真实模型'}`);
});

export { app };
