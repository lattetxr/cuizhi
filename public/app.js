const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const EXAMPLES = {
  knowledge: {
    input: 'https://www.zhihu.com/question/19558616/answer/175862602',
  },
  debate: {
    input: '年轻人该不该裸辞',
    search: true,
  },
  exam: {
    input: 'https://zhuanlan.zhihu.com/p/54779494',
  },
};

const TYPE_CONFIG = {
  knowledge: {
    label: '知识科普',
    emoji: '📚',
    pain: '概念记不住、碎片难成体系',
    primary: 'cards',
    folded: ['viewpoint', 'map'],
    coachKept: true,
    guides: {
      cards: '本包以概念阐释为主，用概念卡逐一攻克，今晚开始第一轮复习',
      viewpoint: '这篇内容立场比较一致，快速过一遍共识即可',
      map: '概念之间的联系在这张地图里，可作为查阅手册',
      coach: '概念都过了？和看山对练一轮，检验是否真的掌握',
    },
  },
  debate: {
    label: '观点争议',
    emoji: '💬',
    pain: '信谁的、立场混乱',
    primary: 'viewpoint',
    folded: ['map', 'cards'],
    coachKept: true,
    guides: {
      viewpoint: '这个问题立场分裂，先看分布与共识分歧，再选边去对练',
      map: '从争议中提炼需要掌握的概念，避免被一方带着走',
      cards: '把关键论据炼成卡片，防止被说服之后又反悔',
      coach: '选一个你倾向的立场，看山当反方，3 轮辩下来',
    },
  },
  exam: {
    label: '备考规划',
    emoji: '📝',
    pain: '时间紧、不知道先学什么',
    primary: 'map',
    folded: ['viewpoint', 'cards'],
    coachKept: true,
    guides: {
      map: '时间有限？按这条学习路径逐步推进，薄弱环节优先',
      viewpoint: '共识部分快速扫过即可，别在立场分析上花时间',
      cards: '薄弱卡优先，按 1/3/7/21 节奏推进复习',
      coach: '模拟考试问答，暴露薄弱点',
    },
  },
  collection: {
    label: '收藏夹批量',
    emoji: '📦',
    pain: '收藏吃灰、不会排优先级',
    primary: 'map',
    folded: ['viewpoint', 'cards'],
    coachKept: true,
    guides: {
      map: '几百条收藏不用怕，按这条消化顺序一门一门解决',
      viewpoint: '整夹立场概览，帮你判断哪部分值得优先深入',
      cards: '整夹核心概念卡，可按顺序逐张复习',
      coach: '挑一个最想搞懂的概念，和看山对练检验',
    },
  },
};

const TAB_LABELS = {
  viewpoint: '观点光谱',
  map: '认知地图',
  cards: '复习卡片',
  coach: '看山对练',
};

const state = {
  goal: '入门',
  tab: 'url',
  oauth: null,
  profile: {
    followees: { items: [], offset: '0', end: false, loaded: false, loading: false },
    contents: { items: [], offset: '0', end: false, loaded: false, loading: false },
    favlistsLoaded: false,
    favlists: [],
    favlistInsights: {},
    expandedFavlists: new Set(),
    favlistInsightLoading: new Set(),
  },
  searchPreview: { query: '', items: [], groups: [], selected: new Set(), demo: false, loading: false },
  pkg: null,
  exampleSearch: false,
  exampleSearchKey: null,
  tabName: 'viewpoint',
  viewpointFilter: undefined,
  mapNode: 0,
  visitedMapNodes: new Set(),
  embeddedExpanded: false,
  debateThinking: false,
  review: { pkgId: null, index: 0, flipped: false },
  coach: { messages: [], draft: null, viewpoint: null, round: 1, summary: null },
  visual: {
    pkgId: null,
    cards: [],
    index: 0,
    flipped: false,
    filter: 'concept',
    grades: {},
    completed: false,
  },
};

const CARD_TYPE_LABELS = {
  concept: '概念',
  viewpoint: '观点卡',
  scenario: '情景题',
  compare: '对比卡',
};

const CARD_TYPE_KEYS = ['concept'];

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function api(path, options = {}, timeoutMs = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      ...options,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      console.error(data.error || data.message || `请求失败（${response.status}）`);
      if (data.oauthExpired && typeof refreshOauth === 'function') {
        await refreshOauth();
      }
      throw new Error(data.oauthExpired ? '知乎授权已过期，请重新登录' : '哎呀，出了点小问题，再试一次吧～');
    }
    return data;
  } catch (error) {
    if (error.name === 'AbortError') {
      console.error('请求超时');
      throw new Error('哎呀，出了点小问题，再试一次吧～');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

let toastTimer = null;
function toast(message, duration = 2800) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, duration);
}

function setLoading(button, loading, text) {
  if (!button) return;
  if (loading) {
    button.dataset.originalText = button.textContent;
    button.textContent = text;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
  }
}

function setTab(tab) {
  state.tab = tab;
  $('#urlField').classList.toggle('hidden', tab !== 'url');
  $('#textField').classList.toggle('hidden', tab !== 'text');
  $$('.seg-btn').forEach((btn) => {
    const active = btn.dataset.tab === tab;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
  });
}

function initialOf(name) {
  const text = String(name || '知').trim();
  return text[0] || '知';
}

function avatarHtml(profile, extraClass = '', fallbackText = '') {
  const name = profile?.name || '知乎用户';
  const letter = escapeHtml(fallbackText || initialOf(name));
  const wrapClass = fallbackText ? `avatar-letter ${extraClass}` : extraClass;
  if (profile?.avatarUrl) {
    return `<span class="avatar-wrap ${wrapClass}"><span class="avatar-fallback">${letter}</span><img class="avatar-img" src="${escapeHtml(profile.avatarUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()"></span>`;
  }
  return `<span class="avatar-wrap avatar-letter ${extraClass}">${letter}</span>`;
}

function renderOauth(status) {
  state.oauth = status;
  const oauth = status.oauth || {};
  const identity = oauth.identity || { mode: 'none', profile: null };
  const loginBtn = $('#loginBtn');
  const avatarBtn = $('#userMenuBtn');
  const favHomeBtn = $('#favHomeBtn');

  if (identity.authorized) {
    loginBtn.hidden = identity.mode === 'oauth';
    avatarBtn.hidden = false;
    const displayName = identity.profile?.name || '知乎用户';
    const showTopName = identity.mode === 'oauth' && Boolean(identity.profile?.name);
    avatarBtn.classList.toggle('avatar-user-btn', showTopName);
    avatarBtn.title = showTopName ? displayName : '个人中心';
    avatarBtn.setAttribute('aria-label', showTopName ? `个人中心：${displayName}` : '个人中心');
    avatarBtn.innerHTML = `
      ${avatarHtml(identity.profile, 'avatar-top', '知')}
      ${showTopName ? `<span class="top-user-name">${escapeHtml(displayName)}</span>` : ''}
    `;
    favHomeBtn.textContent = '查看我的收藏夹';
  } else {
    loginBtn.hidden = false;
    avatarBtn.hidden = true;
    favHomeBtn.textContent = '登录知乎 · 导入收藏夹';
  }
  loginBtn.textContent = identity.mode === 'direct' ? '授权知乎账号' : '登录知乎';
  const favAction = $('#favActionBtn');
  if (favAction) favAction.hidden = !identity.authorized;
  renderProfileHeader();
}

function renderProfileHeader() {
  const view = $('#profileView');
  if (!view) return;
  const identity = state.oauth?.oauth?.identity;
  const profile = identity?.profile || { name: '未登录', headline: '' };
  $('#profileName').textContent = profile.name || '知乎用户';
  $('#profileHeadline').textContent = profile.headline || '';
  $('#profileAvatar').innerHTML = avatarHtml(profile, 'avatar-large', '知');
  const modeChip = $('#profileModeChip');
  if (identity?.mode === 'oauth') {
    modeChip.textContent = '知乎授权';
    modeChip.className = 'chip ok';
  } else if (identity?.mode === 'direct') {
    modeChip.textContent = '内容体验';
    modeChip.className = 'chip';
  } else {
    modeChip.textContent = '未登录';
    modeChip.className = 'chip';
  }
  const stateWarn = $('#profileStateWarn');
  if (identity?.mode === 'oauth' && identity.stateVerified === false) {
    stateWarn.textContent = '为保障账号安全，建议重新完成知乎授权';
    stateWarn.hidden = false;
  } else {
    stateWarn.hidden = true;
  }
  $('#profileLoginBtn').hidden = identity?.mode !== 'direct';
  $('#profileLogoutBtn').hidden = identity?.mode !== 'oauth';
}

function showProfile() {
  $('#homeView').hidden = true;
  $('#workspace').hidden = true;
  $('#packagePage').hidden = true;
  $('#skeleton').hidden = true;
  $('#profileView').hidden = false;
  window.scrollTo({ top: 0 });
}

async function openProfile(scrollTarget = null) {
  showProfile();
  renderProfileHeader();
  if (!state.profile.followees.loaded) loadFollowees();
  if (!state.profile.favlistsLoaded) loadFavlists();
  // 创作列表稍后请求，避免并发触发知乎 QPS 限流
  if (!state.profile.contents.loaded) setTimeout(loadContents, 350);
  if (scrollTarget) {
    setTimeout(() => document.querySelector(scrollTarget)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  }
}

function closeProfile() {
  $('#profileView').hidden = true;
  if (state.pkg) {
    $('#homeView').hidden = true;
    $('#workspace').hidden = false;
    $('#packagePage').hidden = false;
  } else {
    showEmpty();
  }
}

function resetProfileData() {
  state.profile = {
    followees: { items: [], offset: '0', end: false, loaded: false, loading: false },
    contents: { items: [], offset: '0', end: false, loaded: false, loading: false },
    favlistsLoaded: false,
    favlists: [],
    favlistInsights: {},
    expandedFavlists: new Set(),
    favlistInsightLoading: new Set(),
  };
  $('#followeeList').innerHTML = '';
  $('#profileContentList').innerHTML = '';
  $('#favlistList').innerHTML = '<div class="empty-inline">登录后读取收藏夹</div>';
  $('#followTotal').textContent = '';
  $('#contentTotal').textContent = '';
  $('#loadMoreFollowBtn').hidden = true;
  $('#loadMoreContentBtn').hidden = true;
}

const CONTENT_TYPE_LABELS = {
  answer: '回答',
  article: '文章',
  zvideo: '视频',
  pin: '想法',
  question: '问题',
};

function formatZhihuTime(seconds) {
  if (!seconds) return '';
  return new Date(Number(seconds) * 1000).toLocaleDateString();
}

function renderFollowees() {
  const bucket = state.profile.followees;
  const list = $('#followeeList');
  if (!bucket.items.length) {
    list.innerHTML = '<div class="empty-inline">暂未关注任何人</div>';
  } else {
    list.innerHTML = bucket.items.map((item) => `
      <a class="followee-item" href="${escapeHtml(item.Url)}" target="_blank" rel="noopener noreferrer">
        ${avatarHtml({ name: item.Fullname, avatarUrl: item.AvatarUrl }, 'avatar-small')}
        <div class="followee-info">
          <strong>${escapeHtml(item.Fullname || '知乎用户')}</strong>
          <span>${escapeHtml(item.Headline || '暂无介绍')}</span>
          <em>${Number(item.FollowerCount || 0).toLocaleString()} 粉丝</em>
        </div>
      </a>`).join('');
  }
  const btn = $('#loadMoreFollowBtn');
  btn.hidden = bucket.end || !bucket.items.length;
  btn.disabled = bucket.loading;
  btn.textContent = bucket.loading ? '加载中...' : '加载更多';
  $('#followTotal').textContent = bucket.items.length ? `已显示 ${bucket.items.length} 人` : '';
}

async function loadFollowees() {
  const bucket = state.profile.followees;
  if (bucket.loading || bucket.end) return;
  bucket.loading = true;
  renderFollowees();
  try {
    const data = await api(`/api/me/followees?Limit=12&Offset=${encodeURIComponent(bucket.offset)}`);
    const items = data.data?.Items || [];
    bucket.items.push(...items);
    bucket.end = data.paging?.isEnd ?? true;
    bucket.offset = data.paging?.nextOffset ?? null;
    bucket.loaded = true;
    renderFollowees();
  } catch (error) {
    $('#followeeList').innerHTML = `<div class="empty-inline">${escapeHtml(error.message)}</div>`;
  } finally {
    bucket.loading = false;
    renderFollowees();
  }
}

function renderContents() {
  const bucket = state.profile.contents;
  const list = $('#profileContentList');
  if (!bucket.items.length) {
    list.innerHTML = '<div class="empty-inline">还没有创作内容</div>';
  } else {
    list.innerHTML = bucket.items.map((item) => `
      <a class="content-item" href="${escapeHtml(item.Url)}" target="_blank" rel="noopener noreferrer">
        <div class="content-item-head">
          <span class="content-type-badge">${escapeHtml(CONTENT_TYPE_LABELS[item.ContentType] || item.ContentType || '内容')}</span>
          <h3>${escapeHtml(item.Title || '无标题内容')}</h3>
        </div>
        <p>${escapeHtml(item.Summary || '')}</p>
        <div class="content-meta">
          <span>${formatZhihuTime(item.CreatedAt)}</span>
          <span>赞 ${Number(item.LikeCount || 0)} · 评论 ${Number(item.CommentCount || 0)} · 收藏 ${Number(item.FavoriteCount || 0)}</span>
        </div>
      </a>`).join('');
  }
  const btn = $('#loadMoreContentBtn');
  btn.hidden = bucket.end || !bucket.items.length;
  btn.disabled = bucket.loading;
  btn.textContent = bucket.loading ? '加载中...' : '加载更多';
  $('#contentTotal').textContent = bucket.items.length ? `已显示 ${bucket.items.length} 条` : '';
}

async function loadContents() {
  const bucket = state.profile.contents;
  if (bucket.loading || bucket.end) return;
  bucket.loading = true;
  renderContents();
  try {
    const data = await api(`/api/me/contents?ContentType=all&Limit=10&Offset=${encodeURIComponent(bucket.offset)}`);
    const items = data.data?.Items || [];
    bucket.items.push(...items);
    bucket.end = data.paging?.isEnd ?? true;
    bucket.offset = data.paging?.nextOffset ?? null;
    bucket.loaded = true;
    renderContents();
  } catch (error) {
    $('#profileContentList').innerHTML = `<div class="empty-inline">${escapeHtml(error.message)}</div>`;
  } finally {
    bucket.loading = false;
    renderContents();
  }
}

async function refreshOauth() {
  try {
    renderOauth(await api('/api/oauth/status'));
  } catch (error) {
    toast(error.message);
  }
}

function showEmpty() {
  $('#workspace').hidden = true;
  $('#packagePage').hidden = true;
  $('#skeleton').hidden = true;
  $('#profileView').hidden = true;
  $('#searchPreview').hidden = true;
  $('#homeView').hidden = false;
  $$('.type-banner').forEach((banner) => banner.remove());
  $('#typeSwitchMenu')?.remove();
  $('#tabContent').innerHTML = '';
  closePackageGuide();
}

function setPackageTab(name) {
  state.tabName = name;
  $$('.tab-btn').forEach((btn) => {
    const active = btn.dataset.tab === name;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
  });
  renderTab();
}

function collectionFrameworkHtml(pkg) {
  const framework = pkg.collectionFramework;
  if (!framework) return '';
  const selectedCount = pkg.collectionMeta?.selectedCount || pkg.sourceAnswers?.length || 0;
  return `
    <section class="collection-framework-card package-card">
      <div class="cf-hero">
        <div>
          <span class="cf-kicker">整夹知识框架 · 认知地图</span>
          <h3>先掌握收藏夹骨架，再按路径逐步消化</h3>
          <p>${escapeHtml(framework.summary)}</p>
        </div>
        <div class="cf-stat-grid">
          <span><strong>${framework.total}</strong><em>已梳理</em></span>
          <span><strong>${selectedCount}</strong><em>精选炼金</em></span>
          <span><strong>${framework.categories.length}</strong><em>主题分区</em></span>
          <span><strong>${framework.topAuthors.length}</strong><em>代表作者</em></span>
        </div>
      </div>
      <div class="cf-content-grid">
        <div class="cf-block">
          <h4>主题分布</h4>
          <div class="cf-category-list">
            ${framework.categories.map((category) => categoryBarHtml(category, framework.total, false)).join('')}
          </div>
          <h4>内容形态</h4>
          <div class="cf-role-list large">
            ${framework.contentTypes.map((type) => `<span>${escapeHtml(type.name)}<em>${type.count}</em></span>`).join('')}
          </div>
          <h4>代表作者</h4>
          <div class="cf-author-list">
            ${framework.topAuthors.map((author) => `<span>${escapeHtml(author.name)}<em>${author.count} 篇</em></span>`).join('')}
          </div>
        </div>
        <div class="cf-block">
          <h4>内容角色</h4>
          <div class="cf-role-list large">
            ${framework.roles.map((role) => `<span title="${escapeHtml(role.description)}">${escapeHtml(role.name)}<em>${role.count}</em></span>`).join('')}
          </div>
          <h4>推荐消化路径</h4>
          <ol class="cf-path-list">
            ${framework.path.map((step) => `<li><strong>${escapeHtml(step.title)}</strong><p>${escapeHtml(step.action)}</p><small>${escapeHtml(step.duration)}</small></li>`).join('')}
          </ol>
        </div>
      </div>
      <h4>分类内容索引</h4>
      <div class="cf-index-grid">
        ${framework.categories.map((category) => `
          <article class="cf-index-card">
            <header>
              <span class="cf-index-icon" style="background:${escapeHtml(category.color)}">${escapeHtml(category.icon)}</span>
              <div>
                <strong>${escapeHtml(category.name)}</strong>
                <em>${category.count} 条 · ${Math.round(category.ratio * 100)}%</em>
              </div>
            </header>
            <ul>
              ${category.items.slice(0, 3).map((item) => `
                <li>
                  <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a>
                  <small>${escapeHtml(item.typeLabel)} · ${escapeHtml(item.author)} · ▲ ${Number(item.likeCount || 0).toLocaleString()}</small>
                </li>`).join('')}
            </ul>
          </article>`).join('')}
      </div>
    </section>`;
}
function renderPackage(pkg) {
  state.pkg = pkg;
  $('#homeView').hidden = true;
  $('#profileView').hidden = true;
  $('#workspace').hidden = false;
  $('#skeleton').hidden = true;
  $('#packagePage').hidden = false;
  $('#pkgTitle').textContent = pkg.title || '学习包';
  $('#pkgMeta').textContent = [
    pkg.kind === 'collection' ? '收藏夹学习包' : '知乎学习包',
    pkg.goal,
    new Date(pkg.createdAt || Date.now()).toLocaleString(),
  ].join(' · ');
  $('#exportMdBtn').href = `/api/packages/${pkg.id}/export?format=md`;
  $('#exportHtmlBtn').href = `/api/packages/${pkg.id}/export?format=html`;
  const notice = $('#degradedNotice');
  if (pkg.notices?.length) {
    notice.hidden = false;
    notice.textContent = pkg.notices.join('；');
  } else {
    notice.hidden = true;
    notice.textContent = '';
  }
  if (state.review.pkgId !== pkg.id) {
    state.review = { pkgId: pkg.id, index: 0, flipped: false };
  }
  if (state.coach.pkgId !== pkg.id) {
    state.coach = { pkgId: pkg.id, messages: [], draft: null, viewpoint: null, round: 1, summary: null };
  }
  if (state.visual.pkgId !== pkg.id) {
    state.visual = {
      pkgId: pkg.id,
      cards: normalizeVisualCards(pkg.visualCards || []),
      index: 0,
      flipped: false,
      filter: 'concept',
      grades: {},
      completed: false,
    };
  }
  state.viewpointFilter = undefined;
  state.mapNode = 0;
  state.visitedMapNodes = new Set([0]);
  state.tabName = getTypeConfig().primary;
  state.embeddedExpanded = false;
  renderTypeBanner();
  applyTypeLayout(true);
  maybeShowPackageGuide();
}

function getTypeConfig() {
  const type = state.pkg?.contentType || 'knowledge';
  return TYPE_CONFIG[type] || TYPE_CONFIG.knowledge;
}

function renderTypeBanner() {
  // 功能页顶部不展示类型胶囊、下拉框或额外推荐提示，只保留唯一推荐页签。
  $$('.type-banner').forEach((banner) => banner.remove());
  $('#typeSwitchMenu')?.remove();
}

function applyTypeLayout(autoTab) {
  const cfg = getTypeConfig();
  const primary = cfg.primary;
  const allTabs = ['viewpoint', 'map', 'cards', 'coach'];
  const tabBar = $('#tabBar');

  $$('.tab-btn').forEach((btn) => {
    const tab = btn.dataset.tab;
    const isRecommended = tab === primary;
    // v32：推荐功能之外，其余功能页签也全部显示
    btn.hidden = false;
    btn.classList.toggle('dimmed', false);
    btn.querySelectorAll('.rec-badge').forEach((badge) => badge.remove());
    if (isRecommended) {
      const badge = document.createElement('span');
      badge.className = 'rec-badge';
      badge.textContent = '推荐';
      btn.appendChild(badge);
    }
  });

  // 推荐功能放在第一个
  const primaryBtn = $$('.tab-btn').find((btn) => btn.dataset.tab === primary);
  const firstTabBtn = tabBar.querySelector('.tab-btn');
  if (primaryBtn && firstTabBtn && primaryBtn !== firstTabBtn) {
    tabBar.insertBefore(primaryBtn, firstTabBtn);
  }

  // 不再折叠，隐藏"更多"按钮
  const moreBtn = $('#tabMoreBtn');
  const panel = $('#tabMorePanel');
  moreBtn.hidden = true;
  panel.hidden = true;

  if (autoTab && !allTabs.includes(state.tabName)) {
    setPackageTab(primary);
    return;
  }
  setPackageTab(state.tabName);
}

function renderTab() {
  const content = $('#tabContent');
  const cfg = getTypeConfig();
  const guide = cfg.guides?.[state.tabName];
  const guideHtml = guide ? `<div class="tab-guide">${cfg.emoji} ${escapeHtml(guide)}</div>` : '';
  if (state.tabName === 'viewpoint') content.innerHTML = guideHtml + renderViewpoint();
  if (state.tabName === 'map') content.innerHTML = guideHtml + renderMap();
  if (state.tabName === 'cards') content.innerHTML = guideHtml + renderCards();
  if (state.tabName === 'coach') content.innerHTML = guideHtml + renderCoach();
  if (state.tabName === 'coach') {
    const log = $('.chat-log');
    if (log) log.scrollTop = log.scrollHeight;
  }
  if (state.tabName === 'cards') bindVisualSwipe();
}

function representatives(pkg, sourceIds) {
  const ids = new Set((sourceIds || []).map(String));
  return (pkg.sourceAnswers || [])
    .filter((answer) => ids.has(String(answer.answerId)))
    .map((answer) => answer.author)
    .filter(Boolean);
}

function sourceAnswerMap(pkg) {
  const map = new Map();
  for (const answer of pkg.sourceAnswers || []) {
    map.set(String(answer.answerId), answer);
  }
  return map;
}

function stanceSourceLinks(pkg, sourceIds) {
  const map = sourceAnswerMap(pkg);
  const links = [];
  for (const id of new Set((sourceIds || []).map(String))) {
    const answer = map.get(id);
    if (answer?.url) {
      links.push(
        `<a class="stance-source-link" href="${escapeHtml(answer.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(answer.author || '原文')} ↗</a>`,
      );
    }
  }
  if (!links.length) return '';
  return `<div class="stance-sources"><strong>原始回答</strong><span>${links.slice(0, 3).join('')}</span></div>`;
}

function renderSourceReferences(pkg) {
  const answers = (pkg.sourceAnswers || []).filter((answer) => answer.url || answer.author);
  if (!answers.length) return '';
  return `
    <div class="source-references">
      <h3 class="section-title">参考来源（${answers.length} 条知乎内容）</h3>
      <div class="source-list">
        ${answers
          .slice(0, 10)
          .map((answer) => `
            <a class="source-item" href="${escapeHtml(answer.url || '#')}" ${answer.url ? 'target="_blank" rel="noopener noreferrer"' : ''}>
              <span class="source-author">${escapeHtml(answer.author || '知乎用户')}</span>
              <span class="source-title">${escapeHtml(answer.title || '知乎内容')}</span>
              <span class="source-meta">${Number(answer.voteCount || 0).toLocaleString()} 赞同</span>
            </a>`)
          .join('')}
      </div>
      <p class="sample-note">观点与卡片均基于知乎搜索摘要生成，完整内容请以原文为准。</p>
    </div>`;
}

function applicability(stanceName) {
  const name = String(stanceName || '');
  if (name.includes('加工')) return '适合刚收藏、愿意立即行动的学习者';
  if (name.includes('筛选')) return '适合信息过载、需要控制输入的学习者';
  if (name.includes('工具')) return '适合收藏量大、需要规模化处理的学习者';
  return '适合大多数学习者';
}

function generateCardsButton() {
  return `
    <button class="button" data-action="generate-cards">
      <img class="lks-img lks-mini" src="/assets/liukanshan/playful.gif?v=2" alt="" loading="lazy" decoding="async">
      生成复习卡片
    </button>
  `;
}

function miniReviewCard(card) {
  const term =
    card.type === 'concept'
      ? String(card.front || '').split('\n').filter(Boolean).at(-1) || card.front
      : card.center || card.front;
  return `
    <button class="mini-review-card" data-embedded-card="${escapeHtml(card.id)}">
      <span class="mini-tag">概念卡</span>
      <span class="mini-name">${escapeHtml(term)}</span>
      <span class="mini-foot">
        <span>来源</span>
        <img class="lks-img lks-mini" src="/assets/liukanshan/playful.gif?v=2" alt="" loading="lazy" decoding="async">
      </span>
      <span class="mini-back">${escapeHtml(card.back || '')}</span>
    </button>
  `;
}

function renderEmbeddedCards() {
  const cards = state.visual.cards || [];
  const visible = state.embeddedExpanded
    ? cards
    : cards.filter((card) => card.type === 'concept').slice(0, 3);
  return `
    <div class="embedded-cards" id="embeddedCards">
      <div class="embedded-head">
        <h3>复习卡片</h3>
        <span class="count-pill">${cards.length} 张</span>
        <button class="button ghost" data-action="toggle-embedded">${state.embeddedExpanded ? '收起' : '展开全部'}</button>
      </div>
      ${
        cards.length
          ? `<div class="embedded-scroll">${visible.map(miniReviewCard).join('')}</div>`
          : '<p class="muted-line">点击上方“生成复习卡片”创建</p>'
      }
    </div>
  `;
}

function renderViewpoint() {
  const pkg = state.pkg;
  const data = pkg.viewpoint;
  const rawStances = data?.stances || (pkg.spectrum || []).map((item, index) => ({
    stance_name: item.stance,
    stance_summary: item.view,
    arguments: item.hint ? [item.hint] : [],
    source_answer_ids: [pkg.sourceAnswers?.[index]?.answerId].filter(Boolean),
  }));
  const stanceColors = ['#0066CC', '#0084FF', '#66B2FF', '#B3D9FF', '#005BB5', '#0077E6'];
  const stances = rawStances.map((stance, index) => ({
    ...stance,
    color: stanceColors[index % stanceColors.length],
    count: Math.max(1, (stance.source_answer_ids || []).length),
  }));
  const total = stances.reduce((sum, item) => sum + item.count, 0) || stances.length;
  let cursor = 0;
  const stops = stances
    .map((stance) => {
      const from = (cursor / total) * 100;
      cursor += stance.count;
      const to = (cursor / total) * 100;
      return `${stance.color} ${from}% ${to}%`;
    })
    .join(', ');
  const filtered = state.viewpointFilter !== undefined
    ? stances.filter((_, index) => index === state.viewpointFilter)
    : stances;
  return `
    <div class="package-card">
      <div class="section-toolbar">
        <span class="section-title">观点光谱</span>
        <button class="float-generate" data-action="generate-cards">
          <img class="lks-img lks-mini" src="/assets/liukanshan/playful.gif?v=2" alt="" loading="lazy" decoding="async">
          生成复习卡片
        </button>
      </div>
      <div class="viewpoint-summary">${escapeHtml(data?.summary || pkg.coreQuestion || '')}</div>
      ${pkg.sampleNote ? `<p class="sample-note">${escapeHtml(pkg.sampleNote)}</p>` : ''}
      <div class="donut-layout">
        <div class="donut-chart" style="background: conic-gradient(${stops});">
          <div class="donut-hole">
            <span>知识分布</span>
          </div>
        </div>
        <div class="donut-legend">
          ${stances
            .map(
              (stance, index) => `
                <button class="legend-item ${state.viewpointFilter === index ? 'active' : ''}" data-stance-filter="${index}">
                  <span class="legend-dot" style="background:${stance.color}"></span>
                  ${escapeHtml(stance.stance_name)}
                  <em>${stance.count}</em>
                </button>`,
            )
            .join('')}
        </div>
      </div>
      <h3 class="section-title">知识分布</h3>
      <div class="stance-list">
        ${filtered.map((item, index) => stanceCard(item, pkg, index)).join('')}
      </div>
      ${
        data
          ? `
            <div class="consensus-box">
              <strong>共识点</strong>
              <ul>${(data.consensus || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
            </div>
            <div class="divergence-box">
              <strong>分歧本质</strong>
              <p>${escapeHtml(data.divergence || '')}</p>
            </div>`
          : ''
      }
      ${renderSourceReferences(pkg)}
    </div>
  `;
}

function stanceCard(item, pkg, index) {
  const people = representatives(pkg, item.source_answer_ids);
  const argumentsList = item.arguments || [];
  const visibleArguments = argumentsList.slice(0, 2);
  const extraArguments = argumentsList.slice(2);
  return `
    <div class="stance-card">
      <button class="stance-head" data-collapse="stance-${index}">
        <strong>${escapeHtml(item.stance_name)}</strong>
        <span class="stance-people">
          ${
            people.length
              ? `<span class="stance-avatar">${escapeHtml(people[0].slice(0, 1))}</span>${escapeHtml(
                  people[0],
                )}`
              : '<span>暂无</span>'
          }
        </span>
      </button>
      <div class="stance-body" id="stance-${index}">
        <div class="core-claim">${escapeHtml(item.stance_summary || '')}</div>
        <div class="stance-row"><strong>核心论据</strong></div>
        <ul class="argument-list">
          ${visibleArguments.map((arg) => `<li>${escapeHtml(arg)}</li>`).join('')}
          ${
            extraArguments.length
              ? `<li class="extra-args hidden" data-extra-args="${index}">${extraArguments
                  .map((arg) => `<div class="extra-arg">${escapeHtml(arg)}</div>`)
                  .join('')}</li>`
              : ''
          }
        </ul>
        ${
          extraArguments.length
            ? `<button class="button ghost" data-args-collapse="${index}">展开更多论据（${extraArguments.length}）</button>`
            : ''
        }
        ${stanceSourceLinks(pkg, item.source_answer_ids)}
        <div class="stance-apply">适用条件：${escapeHtml(applicability(item.stance_name))}</div>
      </div>
    </div>
  `;
}

const MAP_PATH = 'M 40 170 C 150 40, 240 210, 360 90 S 560 190, 720 60';
const MAP_NODES = [
  { x: 40, y: 170 },
  { x: 150, y: 60 },
  { x: 240, y: 200 },
  { x: 360, y: 90 },
  { x: 560, y: 180 },
  { x: 720, y: 60 },
];

function pathDetail(node, index) {
  const pkg = state.pkg;
  const concepts = pkg.mapData?.core_concepts || pkg.concepts || [];
  const stances = pkg.viewpoint?.stances || [];
  const source = pkg.sourceAnswers?.[index]?.url || pkg.sourceUrl || '';
  return `
    <div class="path-detail-card">
      <h4>${escapeHtml(node.step || '')}</h4>
      <p>${escapeHtml(node.action || '')} · ${escapeHtml(node.duration || '')}</p>
      <div class="path-detail-row">
        <strong>核心概念</strong>
        <span>${escapeHtml(concepts[index]?.term || concepts[0]?.term || '主动回忆')}：${escapeHtml(
          concepts[index]?.definition || concepts[0]?.definition || '',
        )}</span>
      </div>
      <div class="path-detail-row">
        <strong>关键论点</strong>
        <span>${escapeHtml(stances[index]?.stance_summary || stances[0]?.stance_summary || '')}</span>
      </div>
      <div class="path-detail-row">
        <strong>学习建议</strong>
        <span>${escapeHtml(node.action || '')}</span>
      </div>
      ${
        source
          ? `<a class="path-source" href="${escapeHtml(source)}" target="_blank" rel="noopener">来源回答链接</a>`
          : ''
      }
    </div>
  `;
}

function renderMap() {
  const pkg = state.pkg;
  const data = pkg.mapData;
  const steps = data?.learning_path || pkg.path || [];
  const frameworkHtml = pkg.collectionFramework ? collectionFrameworkHtml(pkg) : '';
  const nodes = steps.slice(0, 6).map((step, index) => ({
    ...step,
    x: MAP_NODES[index].x,
    y: MAP_NODES[index].y,
  }));
  return `
    ${frameworkHtml}
    <div class="package-card map-card">
      <div class="section-toolbar">
        <span class="section-title">学习路径</span>
        <button class="float-generate" data-action="generate-cards">
          <img class="lks-img lks-mini" src="/assets/liukanshan/playful.gif?v=2" alt="" loading="lazy" decoding="async">
          生成复习卡片
        </button>
      </div>
      <div class="map-stage">
        <svg class="map-svg" viewBox="0 0 800 240" aria-label="学习路径">
          <path d="${MAP_PATH}" fill="none" stroke="#B3D9FF" stroke-width="5" stroke-linecap="round"/>
          <path class="map-progress" d="${MAP_PATH}" fill="none" stroke="#F5A623" stroke-width="5" stroke-linecap="round"/>
          ${nodes
            .map(
              (node, index) => `
                <g class="footprint" style="animation-delay:${index * 0.9}s">
                  <circle cx="${node.x}" cy="${node.y}" r="6" fill="#F5A623" opacity="0.35"/>
                  <circle cx="${node.x - 4}" cy="${node.y - 6}" r="3" fill="#F5A623" opacity="0.35"/>
                  <circle cx="${node.x + 4}" cy="${node.y - 6}" r="3" fill="#F5A623" opacity="0.35"/>
                </g>
                <circle class="map-node" data-map-node="${index}" data-map-x="${node.x}" data-map-y="${node.y}" data-map-step="${escapeHtml(node.step)}" data-map-action="${escapeHtml(node.action)}" data-map-duration="${escapeHtml(node.duration)}" cx="${node.x}" cy="${node.y}" r="18" fill="#fff" stroke="#0084FF" stroke-width="3"/>
                <text x="${node.x}" y="${node.y + 4}" text-anchor="middle" font-size="11" fill="#0066CC">${index + 1}</text>`,
            )
            .join('')}
        </svg>
        <img class="map-runner" src="/assets/liukanshan/playful.gif?v=2" alt="" style="offset-path: path('${MAP_PATH}')" loading="lazy" decoding="async">
        <div id="mapPopup" class="map-popup" hidden></div>
      </div>
      <div class="path-timeline">
        ${nodes
          .map(
            (node, index) => `
              <button class="path-node ${state.mapNode === index ? 'current' : ''} ${
                state.visitedMapNodes.has(index) ? 'visited' : ''
              }" data-path-node="${index}">
                <span class="path-index">${index + 1}</span>
                <span class="path-label">${escapeHtml(
                  ['入门概念', '核心观点', '实战应用', '常见误区', '查漏补缺', '输出复盘'][index] || node.step,
                )}</span>
              </button>`,
          )
          .join('')}
      </div>
      <div class="path-detail">${pathDetail(nodes[state.mapNode] || nodes[0], state.mapNode)}</div>
    </div>
  `;
}

function weakCards(pkg) {
  const records = pkg.reviewPlan?.cards || [];
  return records
    .map((record) => {
      const card = (pkg.cards || []).find((item) => item.id === record.id);
      const last = record.reviews?.at(-1);
      return { record, card, last };
    })
    .filter((item) => item.card && item.last && item.last.grade !== 'good');
}

function normalizeConceptTerm(value) {
  let text = String(value || '')
    .replace(/^#+\s*/, '')
    .replace(/^[\d一二三四五六七八九十]+[.、\s\-—）)]*\s*/, '')
    .replace(/[*_`"“”]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  text = text.split(/[。！？!?；;：:]/)[0].trim();
  text = text.split(/是指|就是指|指的是|就是|在于/)[0].trim();
  text = text.replace(/^(.+?)(为什么|为何)(.+)$/, '$1');
  text = text.replace(/^(.+?)(是否|该不该|能不能|可不可以|有没有)(.+)$/, '$1');

  text = text
    .replace(/^(关于|对于|有关|针对)\s*/, '')
    .replace(/^(什么是|何为|何谓|如何理解|怎样理解|怎么理解|该如何理解)\s*/, '')
    .replace(/^(如何|怎么|怎样|为什么|为何|是否|该不该|能不能|可不可以|有没有|有哪些)/, '')
    .replace(/^(才能|该|应该|应当|可以|能够|有效|科学|快速|系统地?)\s*/, '')
    .replace(/^(请\s*)?(你|我们|大家)?\s*(解释|说明|分析|谈谈|讲一讲|说说|聊聊|理解|掌握|学会|了解|建立|构建|搭建|形成|提升|提高|做好|运用|使用|利用)\s*/, '')
    .replace(/^自己的?|自身的?/, '')
    .replace(/(的)?(核心概念|基本概念|基础概念|概念释义|名词解释|概念|定义|含义|内涵|基本原理|基础知识)$/, '')
    .replace(/(有效|有用|重要|必要|靠谱|值得)$/, '')
    .replace(/[？?。！!，,、\s]+$/g, '')
    .trim();

  return text;
}

function isConceptTerm(value) {
  const term = normalizeConceptTerm(value);
  if (!term || /[。！？!?；;：:]/.test(term) || term.length > 12) return false;
  if (/^(如何|怎么|怎样|为什么|为何|是否|该不该|能不能|可不可以|有没有|有哪些)/.test(term)) return false;
  if (/^(我|你|他|她|它|我们|你们|他们|这|那|这个|那个)/.test(term)) return false;
  return Boolean(term);
}

function normalizeVisualCards(cards = []) {
  return cards
    .filter((card) => card?.type === 'concept')
    .map((card) => ({ ...card, front: normalizeConceptTerm(card.term || card.front) }))
    .filter((card) => isConceptTerm(card.front));
}

function filteredVisualCards() {
  return normalizeVisualCards(state.visual.cards || []);
}

function visualEmpty() {
  return `
    <div class="package-card visual-empty">
      <img class="lks-img lks-sleepy" src="/assets/liukanshan/sleepy.gif?v=2" alt="" loading="lazy" decoding="async">
      <h3>还没有复习卡片</h3>
      <p>去认知地图或观点光谱页，点击"生成复习卡片"一键创建</p>
      <button class="button primary" data-action="go-map">去生成卡片</button>
    </div>
  `;
}

function visualCompletion() {
  const total = Object.keys(state.visual.grades).length;
  return `
    <div class="package-card visual-empty">
      <img class="lks-img lks-sleepy" src="/assets/liukanshan/sleepy.gif?v=2" alt="" loading="lazy" decoding="async">
      <p>今天的知识都消化完啦～</p>
      <p class="package-meta">本轮已评分 ${total} 张卡片</p>
      <div class="toolbar">
        <button class="button" data-action="restart-visual">再复习一轮</button>
        <button class="button ghost" data-action="go-coach">和看山对练</button>
      </div>
    </div>
  `;
}

function visualFront(card) {
  if (card.type === 'compare') {
    return `
      <div class="compare-front">
        <div class="compare-side left">${escapeHtml(card.left)}</div>
        <div class="compare-vs">VS</div>
        <div class="compare-side right">${escapeHtml(card.right)}</div>
      </div>
    `;
  }
  const term = normalizeConceptTerm(card.term || card.front);
  return `
    <div class="card-body concept-front-body">
      <span class="concept-eyebrow">概念</span>
      <strong class="concept-name">${escapeHtml(term)}</strong>
      <span class="concept-front-hint">先在心里解释一遍，再点击翻面</span>
    </div>
  `;
}

function conceptBackSections(card) {
  if (card.definition) {
    const exampleLabel = state.pkg?.contentType === 'collection' ? '代表收藏' : '生活化例子';
    return `
      <section class="concept-back-section">
        <span class="concept-section-label">概念解释</span>
        <p>${escapeHtml(card.definition)}</p>
      </section>
      ${card.example ? `
        <section class="concept-back-section">
          <span class="concept-section-label">${exampleLabel}</span>
          <p>${escapeHtml(card.example)}</p>
        </section>` : ''}
    `;
  }
  return String(card.back || '')
    .split(new RegExp('\\n{2,}'))
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block, index) => {
      const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
      const first = lines[0] || '';
      const rest = lines.slice(1);
      const label = index === 0 ? '概念解释' : (['例子', '代表收藏', '生活化例子'].includes(first) ? first.replace('例子', '生活化例子') : '补充说明');
      const text = ['例子', '代表收藏', '生活化例子'].includes(first) ? rest.join('\n') : (rest.length ? rest.join('\n') : block);
      return `<section class="concept-back-section"><span class="concept-section-label">${escapeHtml(label)}</span><p>${escapeHtml(text)}</p></section>`;
    })
    .join('');
}

function visualBack(card) {
  return `<div class="card-body concept-back-body">${conceptBackSections(card)}</div>`;
}

function calendarHTML() {
  const cells = Array.from({ length: 21 }, (_, index) => {
    const day = index + 1;
    let cls = [1, 3, 7, 21].includes(day) ? 'high' : 'unlit';
    if (day === 1) cls += ' today';
    return `<div class="calendar-cell ${cls}">${day}</div>`;
  }).join('');
  return `
    <aside class="calendar">
      <h4>21 天复习日历</h4>
      <div class="calendar-grid">${cells}</div>
    </aside>
  `;
}

function renderCards() {
  if (!state.visual.cards?.length) return visualEmpty();
  const cards = filteredVisualCards();
  if (state.visual.completed || !cards.length) return visualCompletion();
  const card = cards[Math.min(state.visual.index, cards.length - 1)];
  state.visual.flipped = false;
  const progress = Math.round(((state.visual.index + 1) / cards.length) * 100);
  const typeLabel = CARD_TYPE_LABELS[card.type] || card.type;
  return `
    <div class="package-card visual-review">
      <div class="visual-main">
        <div class="visual-filter">
          ${CARD_TYPE_KEYS.map(
            (key) =>
              `<button class="filter-btn ${state.visual.filter === key ? 'active' : ''}" data-filter="${key}">${
                key === 'all' ? '全部' : CARD_TYPE_LABELS[key]
              }</button>`,
          ).join('')}
        </div>
        <div class="visual-stage">
          <button id="visualFlipBtn" class="visual-card ${state.visual.flipped ? 'is-flipped' : ''}" aria-pressed="false">
            <div class="visual-card-inner">
              <div class="visual-face">
                <div class="card-tag-row">
                  <span class="card-tag">${escapeHtml(typeLabel)}</span>
                  <span class="card-source">${escapeHtml(card.stance || '')}</span>
                </div>
                ${visualFront(card)}
                <div class="card-footer">
                  <img class="lks-img lks-playful" src="/assets/liukanshan/playful.gif?v=2" alt="" loading="lazy" decoding="async">
                  <span>空格或点击翻面 · 方向键切换</span>
                </div>
              </div>
              <div class="visual-face back">
                <div class="card-tag-row">
                  <span class="card-tag">参考答案</span>
                  ${card.sourceUrl ? `<a class="card-source" href="${escapeHtml(card.sourceUrl)}" target="_blank" rel="noopener">来源链接</a>` : '<span></span>'}
                </div>
                ${visualBack(card)}
                <div class="card-footer">
                  <img class="lks-img lks-playful ${state.visual.justCelebrated ? 'grade-celebrate' : ''}" src="/assets/liukanshan/playful.gif?v=2" alt="" loading="lazy" decoding="async">
                  <span>评分后自动下一张</span>
                </div>
              </div>
            </div>
          </button>
        </div>
        <div class="visual-meta">
          <span><strong>第 ${state.visual.index + 1} / ${cards.length} 张</strong> · ${progress}% · ${typeLabel}</span>
          <span>已评分 ${Object.keys(state.visual.grades).length}</span>
        </div>
        <div class="visual-progress"><div class="visual-progress-bar" style="width:${progress}%"></div></div>
        <div id="visualGradeBar" class="grade-bar hidden">
          <button class="button success" data-visual-grade="good">✓ 记住了</button>
          <button class="button warning" data-visual-grade="hard">~ 有点模糊</button>
          <button class="button danger" data-visual-grade="again">× 没记住</button>
        </div>
        <div class="shortcut-hint">空格翻转 · ← → 切换 · 1/2/3 评分</div>
      </div>
      ${calendarHTML()}
    </div>
  `;
}

function maybeShowPackageGuide() {
  try {
    if (localStorage.getItem('cuizhi_package_guide_done_v2') === '1') return;
  } catch {}
  openPackageGuide(false);
}

function openPackageGuide(markRead = true) {
  const modal = $('#guideModal');
  if (!modal) return;
  const collectionTip = $('#guideCollectionTip');
  if (collectionTip) collectionTip.hidden = state.pkg?.contentType !== 'collection';
  modal.hidden = false;
  document.body.classList.add('guide-open');
  if (markRead) {
    try { localStorage.setItem('cuizhi_package_guide_done_v2', '1'); } catch {}
  }
}

function closePackageGuide() {
  const modal = $('#guideModal');
  if (!modal) return;
  modal.hidden = true;
  document.body.classList.remove('guide-open');
}

function downloadText(filename, text, type = 'text/plain') {
  const blob = new Blob([text], { type });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function visualMarkdown() {
  const cards = state.visual.cards || [];
  return `# ${state.pkg.title} · 可视化复习卡片\n\n${cards
    .map(
      (card, index) =>
        `## ${index + 1}. ${CARD_TYPE_LABELS[card.type] || card.type}\n\n**正面**\n${card.front}\n\n**背面**\n${card.back}\n\n来源：${card.sourceUrl || '无'}\n`,
    )
    .join('\n')}\n`;
}

function visualSvg(card) {
  const lines = String(card.back || '').split('\n');
  const text = lines
    .slice(0, 12)
    .map((line, index) => `<text x="30" y="${80 + index * 22}" font-size="15" fill="#1A1A1A">${escapeHtml(line)}</text>`)
    .join('');
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="480" height="320" viewBox="0 0 480 320">
      <rect width="480" height="320" rx="16" fill="#FFFFFF" stroke="#E5E5E5"/>
      <rect x="20" y="20" width="110" height="28" rx="14" fill="${escapeHtml(card.color || '#8E8E93')}"/>
      <text x="75" y="39" text-anchor="middle" font-size="13" fill="#FFFFFF">${escapeHtml(
        CARD_TYPE_LABELS[card.type] || card.type,
      )}</text>
      <text x="30" y="72" font-size="24" font-weight="600" fill="#1A1A1A">${escapeHtml(
        String(card.front).split('\n')[0] || '',
      )}</text>
      ${text}
    </svg>
  `;
}

async function generateVisualCardsFromPkg() {
  if (!state.pkg) return;
  const button = document.querySelector('[data-action="generate-cards"]');
  try {
    setLoading(button, true, '生成中...');
    const data = await api(`/api/packages/${state.pkg.id}/visual-cards`, { method: 'POST' });
    const visualCards = normalizeVisualCards(data.cards);
    state.pkg.visualCards = visualCards;
    state.visual = {
      pkgId: state.pkg.id,
      cards: visualCards,
      index: 0,
      flipped: false,
      filter: 'concept',
      grades: {},
      completed: false,
    };
    setPackageTab('cards');
    toast(`已生成 ${data.cards.length} 张可视化复习卡片`);
  } catch (error) {
    toast(error.message);
  } finally {
    setLoading(button, false);
  }
}

function gradeVisualCard(grade) {
  const cards = filteredVisualCards();
  const card = cards[state.visual.index];
  if (!card) return;
  state.visual.grades[card.id] = grade;
  state.visual.justCelebrated = grade === 'good';
  if (state.visual.index >= cards.length - 1) {
    state.visual.completed = true;
    renderTab();
    return;
  }
  state.visual.index += 1;
  state.visual.flipped = false;
  renderTab();
}

function moveVisualCard(delta) {
  const cards = filteredVisualCards();
  if (!cards.length || state.visual.completed) return;
  state.visual.index = Math.max(0, Math.min(cards.length - 1, state.visual.index + delta));
  state.visual.flipped = false;
  renderTab();
}

function bindVisualSwipe() {
  const card = document.querySelector('#visualFlipBtn');
  if (!card) return;
  let startX = null;
  card.addEventListener('pointerdown', (event) => {
    startX = event.clientX;
  });
  card.addEventListener('pointerup', (event) => {
    if (startX === null) return;
    const delta = event.clientX - startX;
    if (Math.abs(delta) > 60) {
      moveVisualCard(delta < 0 ? 1 : -1);
    }
    startX = null;
  });
}

function exportVisualMarkdown() {
  downloadText(`cuizhi-cards-${state.pkg.id}.md`, visualMarkdown(), 'text/markdown');
}

function exportVisualSvg() {
  const cards = filteredVisualCards();
  const card = cards[state.visual.index] || state.visual.cards[0];
  if (card) downloadText(`cuizhi-card-${card.id}.svg`, visualSvg(card), 'image/svg+xml');
}

function exportVisualPdf() {
  window.print();
}

function exportVisualAnki() {
  const link = document.createElement('a');
  link.href = `/api/packages/${state.pkg.id}/export-cards?format=anki`;
  link.download = `cuizhi-${state.pkg.id}.apkg`;
  link.click();
}

function aiPoints(text) {
  const lines = String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return lines
    .map((line) => {
      const match = line.match(/^(\d+[\.、])\s*(.*)$/);
      if (match) {
        return `<div class="ai-point"><strong>${escapeHtml(match[1])}</strong><span>${escapeHtml(
          match[2],
        )}</span></div>`;
      }
      return `<p class="ai-paragraph">${escapeHtml(line)}</p>`;
    })
    .join('');
}

function debateSourceLink(pkg, viewpoint) {
  const author = representatives(pkg, viewpoint.source_answer_ids)[0] || '匿名答主';
  const source = (pkg.sourceAnswers || []).find((answer) =>
    (viewpoint.source_answer_ids || []).includes(String(answer.answerId)),
  )?.url;
  return source
    ? `<a class="ai-source" href="${escapeHtml(source)}" target="_blank" rel="noopener">——来自答主@${escapeHtml(
        author,
      )}</a>`
    : '';
}

function renderCoach() {
  const pkg = state.pkg;
  const stances = pkg.viewpoint?.stances || [];
  if (!stances.length) {
    return `
      <div class="package-card visual-empty">
        <img class="lks-img lks-idle" src="/assets/liukanshan/idle.gif?v=2" alt="" loading="lazy" decoding="async">
        <h3>先去炼金一个知乎问题，再来对练吧～</h3>
        <button class="button primary" data-action="go-home">去炼金</button>
      </div>
    `;
  }
  if (!state.coach.viewpoint) {
    const colors = ['#0066CC', '#0084FF', '#66B2FF', '#B3D9FF'];
    return `
      <div class="package-card">
        <div class="coach-hero">
          <img class="lks-img coach-hero-lks" src="/assets/liukanshan/playful.gif?v=2" alt="刘看山" loading="lazy" decoding="async">
          <div class="coach-hero-text">
            <h3>我是看山，挑一个观点开始对练吧</h3>
            <p>我会代入答主的立场，陪你把这个观点辩明白～</p>
          </div>
          <span class="scroll-hint">可左右滑动</span>
        </div>
        <div class="debate-options">
          ${stances
            .slice(0, 5)
            .map(
              (stance, index) => `
                <button class="debate-option" data-debate-view="${index}">
                  <span class="debate-bar" style="background:${colors[index % colors.length]}"></span>
                  <span class="debate-summary">${escapeHtml(stance.stance_summary)}</span>
                  <span class="debate-author">${escapeHtml(
                    representatives(pkg, stance.source_answer_ids)[0] || '匿名答主',
                  )}</span>
                  <span class="debate-start">开始对练</span>
                </button>`,
            )
            .join('')}
        </div>
      </div>
    `;
  }
  if (state.coach.summary) {
    const summary = state.coach.summary;
    const metrics = summary.metrics || [];
    const weakPoints = summary.weak_points || summary.weak || [];
    const suggestions = summary.suggestions || [];
    const overallScore = summary.score || 0;
    
    return `
      <div class="package-card debate-summary-card">
        <h3>对练完成</h3>
        <div class="score-overview">
          <div class="score-circle">
            <span class="score-number">${Math.round(overallScore / 10)}</span>
            <span class="score-total">/10</span>
          </div>
          <div class="score-label">综合评分</div>
        </div>
        
        <div class="metrics-section">
          <h4>评分详情</h4>
          <div class="metrics-grid">
            ${metrics.map((m) => `
              <div class="metric-item">
                <div class="metric-header">
                  <span class="metric-name">${escapeHtml(m.name)}</span>
                  <span class="metric-score">${m.score}分</span>
                </div>
                <div class="metric-bar">
                  <div class="metric-fill" style="width: ${m.score}%"></div>
                </div>
                <div class="metric-reason">${escapeHtml(m.reason)}</div>
              </div>
            `).join('')}
          </div>
        </div>
        
        ${weakPoints.length ? `
          <div class="weak-section">
            <h4>薄弱环节</h4>
            <div class="weak-list">
              ${weakPoints.map((item) => `<div class="weak-item">${escapeHtml(item)}</div>`).join('')}
            </div>
          </div>
        ` : ''}
        
        ${suggestions.length ? `
          <div class="suggestions-section">
            <h4>改进建议</h4>
            <div class="suggestions-list">
              ${suggestions.map((item) => `<div class="suggestion-item">${escapeHtml(item)}</div>`).join('')}
            </div>
          </div>
        ` : ''}
        
        ${state.coach.draft?.understanding ? `
          <div class="understanding-section">
            <h4>我的理解</h4>
            <p>${escapeHtml(String(state.coach.draft.understanding).slice(0, 120))}${String(state.coach.draft.understanding).length > 120 ? '…' : ''}</p>
          </div>
        ` : ''}
        
        <button class="button" data-action="generate-cards">生成复习卡片</button>
        <div class="output-loop">
          <span>把你的理解导出成回答草稿，回流知乎</span>
          <button class="button" data-action="export-draft">导出我的理解与草稿</button>
        </div>
      </div>
    `;
  }
  const messages = state.coach.messages || [];
  const viewpoint = state.coach.viewpoint;
  return `
    <div class="package-card">
      <div class="debate-top">
        <span>当前观点：${escapeHtml(viewpoint.stance_name)}</span>
        <span class="debate-progress">对练进度：第 ${state.coach.round} 轮/共 3 轮</span>
      </div>
      <div class="debate-flow">
        ${messages
          .map((msg) =>
            msg.role === 'user'
              ? `
                <div class="debate-user">
                  <span class="user-avatar-sm">我</span>
                  <div class="user-block">${escapeHtml(msg.content)}</div>
                </div>`
              : `
                <div class="debate-ai">
                  <img class="lks-img lks-idle" src="/assets/liukanshan/idle.gif?v=2" alt="" loading="lazy" decoding="async">
                  <div class="ai-block">
                    <span class="ai-name">看山</span>
                    ${aiPoints(msg.content)}
                    ${debateSourceLink(pkg, viewpoint)}
                  </div>
                </div>`,
          )
          .join('')}
        ${
          state.debateThinking
            ? `<div class="debate-ai"><img class="lks-img lks-idle" src="/assets/liukanshan/idle.gif?v=2" alt="" loading="lazy" decoding="async"><div class="ai-block"><span class="ai-name">看山</span><div class="thinking-dots"><span></span><span></span><span></span></div></div></div>`
            : ''
        }
        <div class="debate-input">
          <textarea id="coachInput" rows="2" placeholder="说出你的反驳或追问……"></textarea>
          <button id="coachSendBtn" class="circle-send" aria-label="发送">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4Z"/></svg>
          </button>
        </div>
      </div>
    </div>
  `;
}

async function submitGrade(grade) {
  const pkg = state.pkg;
  const card = pkg.cards[state.review.index];
  try {
    const data = await api(`/api/packages/${pkg.id}/review`, {
      method: 'POST',
      body: JSON.stringify({ cardId: card.id, grade }),
    });
    state.pkg = data.pkg;
    state.review.index += 1;
    renderTab();
    loadHistory();
  } catch (error) {
    toast(error.message);
  }
}

const RATIO_COLORS = ['#0066CC', '#0084FF', '#66B2FF', '#F5A623', '#AF52DE', '#34C759', '#FF6B35', '#5AC8FA'];
let searchPreviewTimer = null;
let searchPreviewSeq = 0;

function isHttpInput(value) {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function isBakedKeyword(value) {
  const term = String(value || '').trim();
  // 内置路演样本继续使用预烘焙数据，避免示例点击意外消耗真实 zhihu_search 配额。
  return term.includes('裸辞') || term.includes('存在主义');
}

function scheduleSearchPreview(keyword) {
  clearTimeout(searchPreviewTimer);
  const panel = $('#searchPreview');
  const term = String(keyword || '').trim();
  if (!term || isHttpInput(term) || term.length < 2 || isBakedKeyword(term)) {
    searchPreviewSeq += 1;
    panel.hidden = true;
    return;
  }
  // 知乎搜索日配额很小：用户停止输入 700ms 后只发 1 次请求，服务端还会做 24h 精确缓存。
  searchPreviewTimer = setTimeout(() => {
    openSearchPreview(term);
  }, 700);
}

async function openSearchPreview(keyword) {
  const term = String(keyword || '').trim();
  if (!term || isHttpInput(term) || isBakedKeyword(term)) return;
  const panelAlreadyVisible = !$('#searchPreview').hidden;
  if (panelAlreadyVisible && state.searchPreview.query === term && state.searchPreview.items.length) return;

  const panel = $('#searchPreview');
  const list = $('#previewList');
  const btn = $('#alchemyBtn');
  const seq = ++searchPreviewSeq;
  panel.hidden = false;
  list.innerHTML = '<div class="empty-inline">正在查找知乎相关优质内容…</div>';
  $('#ratioBar').innerHTML = '';
  $('#ratioLegend').innerHTML = '';
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  setLoading(btn, true, '搜索中...');
  try {
    const data = await api('/api/zhihu/search-preview', {
      method: 'POST',
      body: JSON.stringify({ query: term }),
    });
    if (seq !== searchPreviewSeq) return;
    state.searchPreview = {
      query: data.query || term,
      items: data.items || [],
      groups: data.groups || [],
      selected: new Set((data.items || []).slice(0, 8).map((item) => String(item.answerId))),
      demo: Boolean(data.demo),
      notice: data.notice || '',
      loading: false,
    };
    renderSearchPreview();
  } catch (error) {
    if (seq !== searchPreviewSeq) return;
    $('#ratioBar').innerHTML = '';
    $('#ratioLegend').innerHTML = '';
    list.innerHTML = `<div class="empty-inline">${escapeHtml(error.message)}</div>`;
  } finally {
    if (seq === searchPreviewSeq) setLoading(btn, false);
  }
}

function renderSearchPreview() {
  const preview = state.searchPreview;
  $('#previewMeta').textContent = `共 ${preview.items.length} 条 · 来自 ${preview.groups.length} 个问题 · 按质量排序`;
  const notice = $('#previewNotice');
  if (preview.notice || preview.demo) {
    notice.hidden = false;
    notice.textContent = preview.notice || '当前展示示例内容，你可以换个关键词后重试';
  } else {
    notice.hidden = true;
  }

  // 按所属问题的数量比例渲染堆叠条与图例
  const bar = $('#ratioBar');
  const legend = $('#ratioLegend');
  if (preview.groups.length && preview.items.length) {
    bar.innerHTML = preview.groups.map((group, index) => {
      const color = RATIO_COLORS[index % RATIO_COLORS.length];
      return `<i style="width:${group.ratio * 100}%;background:${color}" title="${escapeHtml(group.title)} ${group.count} 条"></i>`;
    }).join('');
    legend.innerHTML = preview.groups.map((group, index) => {
      const color = RATIO_COLORS[index % RATIO_COLORS.length];
      const pct = Math.round(group.ratio * 100);
      const link = group.sampleUrl
        ? `<a href="${escapeHtml(group.sampleUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(group.title)}</a>`
        : escapeHtml(group.title);
      return `<span class="ratio-item"><b style="background:${color}"></b>${link}<em>${group.count} 条 · ${pct}%</em></span>`;
    }).join('');
  } else {
    bar.innerHTML = '';
    legend.innerHTML = '';
  }

  const list = $('#previewList');
  list.innerHTML = preview.items.map((item) => {
    const id = String(item.answerId);
    const checked = preview.selected.has(id) ? 'checked' : '';
    const typeLabel = { answer: '回答', article: '文章', zvideo: '视频', pin: '想法', question: '问题' }[item.contentType] || '内容';
    return `
      <label class="preview-item" data-preview-id="${escapeHtml(id)}">
        <input type="checkbox" ${checked} data-preview-check="${escapeHtml(id)}">
        <span class="preview-body">
          <span class="preview-line1">
            <span class="preview-type">${escapeHtml(typeLabel)}</span>
            <a class="preview-title" href="${escapeHtml(item.url || '#')}" target="_blank" rel="noopener noreferrer" data-preview-link>${escapeHtml(item.title || '知乎内容')}</a>
          </span>
          <span class="preview-summary">${escapeHtml(item.summary || item.content || '')}</span>
          <span class="preview-foot">
            <span class="preview-author">作者：${escapeHtml(item.author || '知乎用户')}</span>
            <span class="preview-votes">▲ ${Number(item.voteCount || 0).toLocaleString()} 赞同</span>
          </span>
        </span>
      </label>`;
  }).join('');
  updatePreviewSelection();
}

function updatePreviewSelection() {
  const count = state.searchPreview.selected.size;
  const btn = $('#previewRunBtn');
  btn.disabled = count === 0;
  btn.textContent = count ? `用选中的 ${count} 条内容开炼` : '请至少选择 1 条';
}

async function loadHotList() {
  const box = $('#hotList');
  const hint = $('#hotHint');
  const quotaNote = $('#hotQuotaNote');
  if (!box) return;
  try {
    const data = await api('/api/zhihu/hot?limit=8');
    const items = data.items || [];
    box.classList.remove('hot-list-placeholder');
    if (quotaNote) {
      quotaNote.hidden = false;
      quotaNote.textContent = data.notice || (data.demo ? '当前为示例议题，点击仍可直接开炼' : '热榜内容会定时更新，点击议题即可开炼');
    }
    if (!items.length) {
      box.classList.add('hot-list-placeholder');
      box.innerHTML = '<div class="empty-inline">今日热榜暂时为空，请稍后再试</div>';
      if (hint) hint.textContent = '';
      if (quotaNote) quotaNote.textContent = data.notice || '知乎热榜接口暂时没有返回内容';
      return;
    }
    box.innerHTML = items
      .map(
        (item, index) => `
          <button class="hot-item" data-hot-query="${escapeHtml(item.title)}" title="${escapeHtml(item.summary || item.title)}">
            <span class="hot-rank">${index + 1}</span>
            <span class="hot-text">
              <strong>${escapeHtml(item.title)}</strong>
              <small>${escapeHtml(item.summary || '点击用这个议题开炼')}</small>
            </span>
          </button>`,
      )
      .join('');
    if (hint) {
      hint.textContent = data.demo ? '示例热榜' : '来自知乎热榜';
    }
  } catch (error) {
    box.classList.add('hot-list-placeholder');
    box.innerHTML = '<div class="empty-inline">热榜暂时没有加载成功，可直接输入关键词</div>';
  }
}

function alchemizeKeyword(keyword) {
  const input = $('#sourceInput');
  input.value = keyword;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  startAlchemy();
}

async function loadHistory() {
  try {
    const data = await api('/api/packages');
    state.history = data.packages || [];
    const list = $('#historyList');
    if (!state.history.length) {
      list.innerHTML = '<div class="empty-inline">还没有学习包</div>';
      return;
    }
    list.innerHTML = state.history
      .slice(0, 8)
      .map(
        (item) => `
          <div class="history-item" data-package-id="${escapeHtml(item.id)}">
            <h3>${escapeHtml(item.title)}</h3>
            <p>${escapeHtml(item.goal)} · ${item.kind === 'collection' ? '收藏夹' : '单篇'}</p>
            <div class="history-meta">
              <span>${new Date(item.createdAt).toLocaleString()}</span>
              <span>${item.progress?.reviewed ?? 0}/${item.progress?.total ?? 0}</span>
            </div>
          </div>`,
      )
      .join('');
  } catch (error) {
    toast(error.message);
  }
}

async function openPackage(id) {
  $('#homeView').hidden = true;
  $('#profileView').hidden = true;
  $('#workspace').hidden = false;
  $('#packagePage').hidden = true;
  $('#skeleton').hidden = false;
  try {
    const data = await api(`/api/packages/${id}`);
    renderPackage(data.pkg);
  } catch (error) {
    $('#skeleton').hidden = true;
    $('#workspace').hidden = true;
    $('#homeView').hidden = false;
    toast(error.message);
  }
}

function categoryBarHtml(category, total, compact = false) {
  const percent = total ? Math.round(category.ratio * 100) : 0;
  return `
    <div class="cf-category-row" title="${escapeHtml(category.name)} ${category.count} 条">
      <div class="cf-category-label">
        <span class="cf-category-dot" style="background:${escapeHtml(category.color)}"></span>
        <b>${escapeHtml(category.name)}</b>
        <em>${category.count} 条 · ${percent}%</em>
      </div>
      <div class="cf-category-track"><i style="width:${percent}%;background:${escapeHtml(category.color)}"></i></div>
    </div>`;
}

function renderFavlistFrameworkPreview(framework, compact = true) {
  const categories = framework.categories.slice(0, compact ? 5 : 8);
  const roles = framework.roles.slice(0, 5);
  const topItems = framework.topItems.slice(0, compact ? 2 : 5);
  return `
    <div class="fav-framework" aria-label="收藏夹知识框架预览">
      <p>${escapeHtml(framework.summary)}</p>
      <div class="cf-category-list">
        ${categories.map((category) => categoryBarHtml(category, framework.total, true)).join('')}
      </div>
      <div class="cf-role-list">
        ${roles.map((role) => `<span>${escapeHtml(role.name)}<em>${role.count}</em></span>`).join('')}
      </div>
      <div class="cf-mini-path">
        ${framework.path.slice(0, 3).map((step, index) => `<span><b>${index + 1}</b>${escapeHtml(step.title)}</span>`).join('')}
      </div>
      <div class="cf-source-list">
        ${topItems.map((item) => `
          <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">
            <span>${escapeHtml(item.typeLabel)}</span>
            <strong>${escapeHtml(item.title)}</strong>
            <em>${escapeHtml(item.author)}</em>
          </a>`).join('')}
      </div>
    </div>`;
}

function renderFavlists(items) {
  const list = $('#favlistList');
  list.innerHTML = items.map((item) => {
    const token = String(item.UrlToken || '');
    const loaded = state.profile.favlistInsights[token];
    const expanded = state.profile.expandedFavlists.has(token);
    const loading = state.profile.favlistInsightLoading.has(token);
    return `
      <article class="favlist-item favlist-rich">
        <div class="favlist-main">
          <div class="favlist-title-row">
            <span class="favlist-folder">夹</span>
            <div>
              <h3>${escapeHtml(item.Title || '未命名收藏夹')}</h3>
              <p>${escapeHtml(item.Description || '把这个收藏夹整理成可学习、可复习的知识框架。')}</p>
            </div>
          </div>
          ${expanded && loaded ? renderFavlistFrameworkPreview(loaded.framework) : ''}
          <div class="favlist-actions">
            <button class="button ghost" data-favlist-insight="${escapeHtml(token)}" ${loading ? 'disabled' : ''}>
              ${loading ? '正在梳理…' : expanded ? '收起知识框架' : '预览知识框架'}
            </button>
            <button class="button primary" data-favlist="${escapeHtml(token)}">✨ 整夹炼金</button>
          </div>
        </div>
      </article>`;
  }).join('');
}

async function loadFavlistInsight(token) {
  if (!token || state.profile.favlistInsightLoading.has(token)) return;
  state.profile.favlistInsightLoading.add(token);
  renderFavlists(state.profile.favlists);
  try {
    const data = await api(`/api/me/favlists/${encodeURIComponent(token)}/insight?Limit=200`);
    state.profile.favlistInsights[token] = data;
    state.profile.expandedFavlists.add(token);
  } catch (error) {
    state.profile.expandedFavlists.delete(token);
    toast(error.message);
  } finally {
    state.profile.favlistInsightLoading.delete(token);
    renderFavlists(state.profile.favlists);
  }
}

async function toggleFavlistInsight(token) {
  if (!token) return;
  if (state.profile.expandedFavlists.has(token)) {
    state.profile.expandedFavlists.delete(token);
    renderFavlists(state.profile.favlists);
    return;
  }
  if (state.profile.favlistInsights[token]) {
    state.profile.expandedFavlists.add(token);
    renderFavlists(state.profile.favlists);
    return;
  }
  await loadFavlistInsight(token);
}

async function loadFavlists() {
  const btn = $('#favActionBtn');
  const list = $('#favlistList');
  try {
    setLoading(btn, true, '读取中...');
    const data = await api('/api/me/favlists?Limit=50');
    const items = data.data?.Items || [];
    state.profile.favlistsLoaded = true;
    state.profile.favlists = items;
    state.profile.favlistInsights = {};
    state.profile.expandedFavlists = new Set();
    if (!items.length) {
      list.innerHTML = '<div class="empty-inline">还没有可读取的收藏夹，先在知乎收藏几篇好内容吧</div>';
      return;
    }
    renderFavlists(items);
  } catch (error) {
    if (list) list.innerHTML = '<div class="empty-inline">收藏夹暂时没有读取成功，请稍后再试</div>';
    toast(error.message);
  } finally {
    setLoading(btn, false);
  }
}

async function alchemizeFavlist(token, button) {
  const btn = button || $('#alchemyBtn');
  showAlchemyOverlay();
  setLoading(btn, true, '炼金中...');
  const progress = createAlchemyProgress();
  try {
    const favlist = state.profile.favlists.find((item) => String(item.UrlToken) === String(token));
    const data = await streamAlchemy(
      {
        goal: state.goal,
        limit: 200,
        title: favlist?.Title || '收藏夹',
        url: favlist?.Url || '',
      },
      progress,
      `/api/favlists/${encodeURIComponent(token)}/alchemy`,
    );
    await progress.finish();
    $('#searchPreview').hidden = true;
    renderPackage(data.pkg);
    toast('整夹炼金完成');
    loadHistory();
  } catch (error) {
    progress.cancel();
    showEmpty();
    toast(error.message);
  } finally {
    hideAlchemyOverlay();
    setLoading(btn, false);
  }
}

function showAlchemyOverlay() {
  $('#alchemyOverlay').hidden = false;
  $('#alchemyStatus').textContent = '看山正在帮你提炼精华～';
  $('#alchemyBar').style.width = '0%';
  $('#alchemyPercent').textContent = '0%';
  $$('.alchemy-step').forEach((step) => {
    step.classList.remove('active', 'done');
  });
}

function hideAlchemyOverlay() {
  $('#alchemyOverlay').hidden = true;
}

// 炼金进度控制器：由服务端 NDJSON 流式阶段驱动；瞬时响应时补最小展示时长，避免一闪而过
function createAlchemyProgress() {
  const steps = [
    ['quench', '看山正在提取核心'],
    ['forge', '看山正在梳理结构'],
    ['solidify', '看山正在生成卡片'],
    ['verify', '看山正在查漏补缺'],
  ];
  const startedAt = Date.now();
  const MIN_SHOW_MS = 900;
  let finished = false;
  let cancelled = false;
  let activeIndex = -1;
  let displayed = 0;
  let ceiling = 34;
  let lastPaint = 0;

  const paintSteps = (index, allDone) => {
    steps.forEach(([step], i) => {
      const el = document.querySelector(`[data-step="${step}"]`);
      if (!el) return;
      el.classList.toggle('active', !allDone && i === index);
      el.classList.toggle('done', allDone || i < index);
    });
  };

  const paint = (pct, statusText) => {
    const clamped = Math.max(0, Math.min(100, Math.round(pct)));
    $('#alchemyBar').style.width = `${clamped}%`;
    $('#alchemyPercent').textContent = `${clamped}%`;
    const index = finished ? steps.length : Math.min(steps.length - 1, Math.floor(clamped / 25));
    if (index !== activeIndex) {
      activeIndex = index;
      paintSteps(index, finished);
    }
    if (statusText) $('#alchemyStatus').textContent = statusText;
  };

  const render = (pct, statusText) => {
    const anchor = Math.max(0, Math.min(100, Number(pct) || 0));
    if (!finished && anchor >= displayed) displayed = anchor;
    if (anchor <= 8) ceiling = 34;
    else if (anchor <= 42) ceiling = 66;
    else if (anchor <= 72) ceiling = 84;
    else if (anchor <= 88) ceiling = 96;
    else ceiling = 99;
    paint(displayed, statusText);
  };

  // 模型并发生成时，服务端只需要发送阶段锚点；前端在两个锚点间平滑逼近，
  // 既不假装已经完成，也避免用户看到进度条长时间停在同一个百分比。
  const timer = setInterval(() => {
    if (finished || cancelled) return;
    const now = Date.now();
    if (now - lastPaint < 120) return;
    lastPaint = now;
    const gap = ceiling - displayed;
    if (gap > 0) {
      displayed = Math.min(ceiling, displayed + Math.max(0.25, gap * 0.045));
      paint(displayed);
    }
  }, 120);

  render(0, '看山正在准备炼金原料');

  return {
    update(progress, statusText) {
      if (finished || cancelled) return;
      render(progress, statusText);
    },
    cancel() {
      cancelled = true;
      clearInterval(timer);
    },
    async finish(statusText = '炼金完成，正在整理学习包～') {
      if (finished) return;
      const remain = MIN_SHOW_MS - (Date.now() - startedAt);
      if (remain > 0) {
        await new Promise((resolve) => setTimeout(resolve, remain));
      }
      finished = true;
      clearInterval(timer);
      paintSteps(steps.length, true);
      displayed = 100;
      paint(100, statusText);
    },
  };
}

// 流式读取 /api/alchemy 的 NDJSON：进度行驱动进度条，终行渲染学习包
async function streamAlchemy(payload, progressCtrl, path = '/api/alchemy') {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok || !response.body) {
    await response.body?.cancel?.().catch(() => {});
    throw new Error('炼金暂时没有成功，请稍后再试');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result = null;
  const handleLine = (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch { return; }
    if (msg.progress != null) progressCtrl.update(msg.progress, msg.status);
    if (msg.ok === true) result = msg;
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    lines.forEach(handleLine);
  }
  handleLine(buffer); // 末尾无换行的残片也要消费
  if (!result) throw new Error('炼金返回异常，请稍后再试～');
  return result;
}

async function startAlchemy() {
  const input = $('#sourceInput').value.trim();
  if (!input) {
    toast('先把知乎链接或内容贴进来吧～');
    return;
  }
  if (isHttpInput(input)) {
    await runAlchemy({ url: input });
  } else if (isBakedKeyword(input)) {
    await runAlchemy({ search: input });
  } else if (
    !$('#searchPreview').hidden &&
    state.searchPreview.query === input &&
    state.searchPreview.items.length
  ) {
    // 预览已经展开时，顶部主按钮尊重用户当前勾选，直接生成学习包。
    const ids = [...state.searchPreview.selected];
    if (ids.length) await runAlchemy({ search: input, answerIds: ids });
    else await openSearchPreview(input);
  } else {
    // 非链接一律作为问题关键词：先抓优质帖子预览（作者/原文/比例），勾选后再炼金
    await openSearchPreview(input);
  }
}

async function runAlchemy(payload) {
  const btn = $('#alchemyBtn');
  showAlchemyOverlay();
  setLoading(btn, true, '炼金中...');
  const progress = createAlchemyProgress();
  try {
    const data = await streamAlchemy({ ...payload, goal: state.goal }, progress);
    await progress.finish();
    $('#searchPreview').hidden = true;
    renderPackage(data.pkg);
    toast('炼金完成');
    loadHistory();
  } catch (error) {
    console.error(error);
    progress.cancel();
    showEmpty();
    toast(error.message);
  } finally {
    hideAlchemyOverlay();
    setLoading(btn, false);
  }
}

function startDebate(index) {
  const stances = state.pkg.viewpoint?.stances || [];
  const viewpoint = stances[index];
  if (!viewpoint) return;
  state.coach.viewpoint = viewpoint;
  
  const args = viewpoint.arguments || [];
  const firstArg = args[0] || '你的依据是什么？';
  const opener = state.pkg.coachOpening || `我来挑战一下「${viewpoint.stance_name}」这个观点。${firstArg}，但我觉得具体情况可能更复杂，你怎么看？`;
  
  state.coach.messages = [{ role: 'assistant', content: opener }];
  state.coach.round = 1;
  state.coach.summary = null;
  renderTab();
}

async function sendCoach(message) {
  if (!message?.trim()) return;
  state.coach.messages.push({ role: 'user', content: message.trim() });
  state.debateThinking = true;
  renderTab();
  const sendBtn = $('#coachSendBtn');
  try {
    if (sendBtn?.classList.contains('circle-send')) {
      sendBtn.disabled = true;
    } else {
      setLoading(sendBtn, true, '思考中…');
    }
    const data = await api('/api/coach', {
      method: 'POST',
      body: JSON.stringify({
        packageId: state.pkg.id,
        messages: state.coach.messages,
        mode: 'chat',
      }),
    });
    state.coach.messages.push({ role: 'assistant', content: data.data.reply });
    const userMessages = state.coach.messages.filter((msg) => msg.role === 'user').length;
    state.coach.round = userMessages + 1;
    if (data.data.evaluation) {
      state.coach.summary = data.data.evaluation;
      state.coach.draft = {
        understanding: data.data.understanding || '',
        draft: data.data.draft || '',
      };
    } else if (userMessages >= 3) {
      state.coach.summary = {
        score: 70,
        metrics: [
          { name: '理解深度', score: 70, reason: '基本理解核心概念' },
          { name: '论据使用', score: 65, reason: '能举例说明' },
          { name: '批判性思维', score: 60, reason: '有不同视角' },
          { name: '表达清晰度', score: 75, reason: '表达较清晰' },
          { name: '知识迁移', score: 60, reason: '能联系实际' },
        ],
        weak_points: ['可以更深入地质疑观点', '例子可以更具体'],
        suggestions: ['尝试从反面思考问题', '多举一些实际例子'],
      };
      state.coach.draft = {
        understanding: data.data.understanding || '',
        draft: data.data.draft || '',
      };
    }
    renderTab();
  } catch (error) {
    toast(error.message);
  } finally {
    state.debateThinking = false;
    renderTab();
    if (sendBtn?.classList.contains('circle-send')) {
      sendBtn.disabled = false;
    } else {
      setLoading(sendBtn, false);
    }
  }
}

function downloadDraft() {
  const draft = state.coach.draft;
  if (!draft) return;
  const content = `# 我的理解\n\n${draft.understanding || ''}\n\n# 回答草稿\n\n${draft.draft || ''}\n`;
  const blob = new Blob([content], { type: 'text/markdown' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `cuizhi-draft-${state.pkg.id}.md`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function fillExample(key) {
  const ex = EXAMPLES[key];
  if (!ex) return;
  state.exampleSearch = Boolean(ex.search);
  state.exampleSearchKey = ex.search ? key : null;
  const input = $('#sourceInput');
  input.value = ex.input;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  input.classList.remove('flash');
  const alchemyBtn = $('#alchemyBtn');
  alchemyBtn.classList.remove('flash');
  void input.offsetWidth;
  input.classList.add('flash');
  alchemyBtn.classList.add('flash');
  setTimeout(() => {
    input.classList.remove('flash');
    alchemyBtn.classList.remove('flash');
  }, 1600);
  input.focus();
}

function bindEvents() {
  $$('.example-card').forEach((btn) => {
    btn.addEventListener('click', () => {
      fillExample(btn.dataset.example);
    });
  });

  $('#tabMoreBtn').addEventListener('click', (event) => {
    event.stopPropagation();
    $('#tabMorePanel').hidden = !$('#tabMorePanel').hidden;
  });

  $('#tabMorePanel').addEventListener('click', (event) => {
    const btn = event.target.closest('[data-tab]');
    if (!btn) return;
    $('#tabMorePanel').hidden = true;
    setPackageTab(btn.dataset.tab);
  });

  $('#alchemyBtn').addEventListener('click', startAlchemy);
  $('#sourceInput').addEventListener('input', (event) => {
    scheduleSearchPreview(event.target.value);
  });
  $('#sourceInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      clearTimeout(searchPreviewTimer);
      startAlchemy();
    }
  });

  const hotList = $('#hotList');
  if (hotList) {
    hotList.addEventListener('click', (event) => {
      if (event.target.closest('#hotLoadBtn')) {
        loadHotList();
        return;
      }
      const item = event.target.closest('[data-hot-query]');
      if (item) alchemizeKeyword(item.dataset.hotQuery);
    });
  }

  const previewList = $('#previewList');
  if (previewList) {
    previewList.addEventListener('change', (event) => {
      const checkbox = event.target.closest('[data-preview-check]');
      if (!checkbox) return;
      const id = checkbox.dataset.previewCheck;
      if (checkbox.checked) state.searchPreview.selected.add(id);
      else state.searchPreview.selected.delete(id);
      updatePreviewSelection();
    });
    // 点链接不被勾选拦截
    previewList.addEventListener('click', (event) => {
      if (event.target.closest('[data-preview-link]')) event.stopPropagation();
    });
  }
  $('#previewSelectAll')?.addEventListener('click', () => {
    state.searchPreview.selected = new Set(state.searchPreview.items.map((item) => String(item.answerId)));
    renderSearchPreview();
  });
  $('#previewClear')?.addEventListener('click', () => {
    state.searchPreview.selected = new Set();
    renderSearchPreview();
  });
  $('#previewRunBtn')?.addEventListener('click', () => {
    const ids = [...state.searchPreview.selected];
    if (!ids.length) return;
    runAlchemy({ search: state.searchPreview.query, answerIds: ids });
  });

  $('#userMenuBtn').addEventListener('click', () => {
    openProfile();
  });

  $('#profileBackBtn').addEventListener('click', closeProfile);
  $('#loadMoreFollowBtn').addEventListener('click', () => loadFollowees());
  $('#loadMoreContentBtn').addEventListener('click', () => loadContents());
  $('#profileLogoutBtn').addEventListener('click', async () => {
    await api('/api/oauth/logout', { method: 'POST' });
    resetProfileData();
    await refreshOauth();
    toast('已退出登录');
  });

  $$('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => setPackageTab(btn.dataset.tab));
  });

  $('#backBtn').addEventListener('click', () => {
    state.pkg = null;
    showEmpty();
  });

  $('#packageGuideBtn')?.addEventListener('click', () => openPackageGuide(false));
  $('#guideCloseBtn')?.addEventListener('click', closePackageGuide);
  $('#guideGotItBtn')?.addEventListener('click', () => {
    try { localStorage.setItem('cuizhi_package_guide_done_v2', '1'); } catch {}
    closePackageGuide();
  });
  $('#guideModal')?.addEventListener('click', (event) => {
    if (event.target === event.currentTarget || event.target.closest('[data-guide-close]')) closePackageGuide();
  });

  $('#loginBtn').addEventListener('click', () => {
    if (state.oauth?.oauth?.waitingForDeploy) {
      toast('知乎登录暂不可用，请稍后再试');
      return;
    }
    window.location.href = '/auth/login';
  });

  $('#favHomeBtn').addEventListener('click', () => {
    const oauth = state.oauth?.oauth;
    if (oauth?.identity?.authorized) {
      openProfile('.profile-panel-favlists');
      return;
    }
    if (oauth?.waitingForDeploy) {
      toast('知乎登录暂不可用，请稍后再试');
      return;
    }
    window.location.href = '/auth/login';
  });

  $('#favActionBtn').addEventListener('click', loadFavlists);

  $('#favlistList').addEventListener('click', (event) => {
    const insightButton = event.target.closest('[data-favlist-insight]');
    if (insightButton) {
      toggleFavlistInsight(insightButton.dataset.favlistInsight);
      return;
    }
    const button = event.target.closest('[data-favlist]');
    if (button) alchemizeFavlist(button.dataset.favlist, button);
  });

  $('#historyList').addEventListener('click', (event) => {
    const item = event.target.closest('[data-package-id]');
    if (item) openPackage(item.dataset.packageId);
  });

  $('#tabContent').addEventListener('click', (event) => {
    const collapse = event.target.closest('[data-collapse]');
    if (collapse) {
      const body = document.getElementById(collapse.dataset.collapse);
      if (body) body.classList.toggle('hidden');
      return;
    }
    const argsCollapse = event.target.closest('[data-args-collapse]');
    if (argsCollapse) {
      const extra = document.querySelector(`[data-extra-args="${argsCollapse.dataset.argsCollapse}"]`);
      if (extra) {
        const hidden = extra.classList.toggle('hidden');
        argsCollapse.textContent = hidden
          ? `展开更多论据（${extra.children.length}）`
          : '收起论据';
      }
      return;
    }
    const stanceFilter = event.target.closest('[data-stance-filter]');
    if (stanceFilter) {
      const index = Number(stanceFilter.dataset.stanceFilter);
      state.viewpointFilter = state.viewpointFilter === index ? undefined : index;
      renderTab();
      return;
    }
    const debateView = event.target.closest('[data-debate-view]');
    if (debateView) {
      startDebate(Number(debateView.dataset.debateView));
      return;
    }
    const mapTarget = event.target.closest('[data-map-node], [data-path-node]');
    if (mapTarget) {
      const index = Number(mapTarget.dataset.mapNode ?? mapTarget.dataset.pathNode);
      state.mapNode = index;
      state.visitedMapNodes.add(index);
      const runner = document.querySelector('.map-runner');
      const nodes = $$('[data-map-node]');
      if (runner && nodes.length > 1) {
        runner.style.animation = 'none';
        runner.style.offsetDistance = `${(index / (nodes.length - 1)) * 100}%`;
      }
      const popup = document.querySelector('#mapPopup');
      if (popup) {
        popup.innerHTML = `
          <strong>${escapeHtml(mapTarget.dataset.mapStep || '')}</strong>
          <p>${escapeHtml(mapTarget.dataset.mapAction || '')}</p>
          <span>${escapeHtml(mapTarget.dataset.mapDuration || '')}</span>`;
        popup.hidden = false;
        popup.style.left = `${(Number(mapTarget.dataset.mapX || 0) / 800) * 100}%`;
        popup.style.top = `${(Number(mapTarget.dataset.mapY || 0) / 240) * 100}%`;
      }
      renderTab();
      return;
    }
    const filter = event.target.closest('[data-filter]');
    if (filter) {
      state.visual.filter = filter.dataset.filter;
      state.visual.index = 0;
      state.visual.flipped = false;
      state.visual.completed = false;
      renderTab();
      return;
    }
    const visualFlip = event.target.closest('#visualFlipBtn');
    if (visualFlip) {
      state.visual.flipped = !state.visual.flipped;
      visualFlip.classList.toggle('is-flipped', state.visual.flipped);
      const gradeBar = $('#visualGradeBar');
      if (gradeBar) gradeBar.classList.toggle('hidden', !state.visual.flipped);
      visualFlip.setAttribute('aria-pressed', String(state.visual.flipped));
      return;
    }
    const visualGrade = event.target.closest('[data-visual-grade]');
    if (visualGrade) {
      gradeVisualCard(visualGrade.dataset.visualGrade);
      return;
    }
    const toggleEmbedded = event.target.closest('[data-action="toggle-embedded"]');
    if (toggleEmbedded) {
      state.embeddedExpanded = !state.embeddedExpanded;
      renderTab();
      return;
    }
    const embeddedCard = event.target.closest('[data-embedded-card]');
    if (embeddedCard) {
      embeddedCard.classList.toggle('flipped');
      return;
    }
    const action = event.target.closest('[data-action]');
    if (!action) return;
    const actionName = action.dataset.action;
    if (actionName === 'generate-cards') generateVisualCardsFromPkg();
    if (actionName === 'go-home') {
      showEmpty();
      $('#sourceInput').focus();
    }
    if (actionName === 'go-map') setPackageTab('map');
    if (actionName === 'go-coach') setPackageTab('coach');
    if (actionName === 'restart-visual') {
      state.visual.index = 0;
      state.visual.completed = false;
      state.visual.flipped = false;
      state.visual.grades = {};
      renderTab();
    }
    if (actionName === 'export-markdown') exportVisualMarkdown();
    if (actionName === 'export-svg') exportVisualSvg();
    if (actionName === 'export-pdf') exportVisualPdf();
    if (actionName === 'export-anki') exportVisualAnki();
    if (actionName === 'export-draft') downloadDraft();
    if (actionName === 'switch-tab') setPackageTab(action.dataset.target);
  });

  $('#tabContent').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && event.target.id === 'coachInput') {
      event.preventDefault();
      const message = event.target.value;
      event.target.value = '';
      sendCoach(message, 'chat');
      return;
    }
    if (state.tabName === 'cards' && state.visual.cards?.length && !['INPUT', 'TEXTAREA'].includes(event.target.tagName)) {
      if (event.key === '1') gradeVisualCard('good');
      if (event.key === '2') gradeVisualCard('hard');
      if (event.key === '3') gradeVisualCard('again');
      if (event.key === ' ') {
        event.preventDefault();
        state.visual.flipped = !state.visual.flipped;
        const flip = document.querySelector('#visualFlipBtn');
        if (flip) {
          flip.classList.toggle('is-flipped', state.visual.flipped);
          const gradeBar = $('#visualGradeBar');
          if (gradeBar) gradeBar.classList.toggle('hidden', !state.visual.flipped);
        }
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        moveVisualCard(1);
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        moveVisualCard(-1);
      }
    }
  });

  $('#tabContent').addEventListener('click', (event) => {
    const send = event.target.closest('#coachSendBtn');
    if (send) {
      const input = $('#coachInput');
      const message = input.value;
      input.value = '';
      sendCoach(message, 'chat');
    }
    const draft = event.target.closest('#coachDraftBtn');
    if (draft) sendCoach('请生成我的理解与回答草稿', 'draft');
  });
}

function enterApp() {
  document.body.classList.remove('welcome-mode');
  $('#welcomeView').remove();
  try {
    sessionStorage.setItem('cuizhi_welcome_seen', '1');
  } catch {}
}

// ========== 演示弹窗 ==========
const demoState = {
  active: false,
  paused: false,
  scene: 0,
  alchemyStep: 0,
  timer: null,
  sceneTimer: null,
  typewriterTimer: null,
  resultTimer: null,
};

const DEMO_RESULT_TABS = ['map', 'viewpoint', 'cards', 'coach'];
const DEMO_TAB_DURATION = 2200;

function initDemoParticles() {
  const container = document.getElementById('demoParticles');
  if (!container) return;
  container.innerHTML = '';
  for (let i = 0; i < 36; i++) {
    const p = document.createElement('div');
    p.className = 'demo-particle';
    p.style.left = Math.random() * 100 + '%';
    p.style.top = Math.random() * 100 + '%';
    p.style.animationDelay = Math.random() * 3 + 's';
    container.appendChild(p);
  }
}

function typeWriter(element, text, speed = 42) {
  return new Promise(resolve => {
    if (!element) { resolve(); return; }
    clearTimeout(demoState.typewriterTimer);
    let i = 0;
    element.innerHTML = '';
    const cursor = document.createElement('span');
    cursor.className = 'typewriter-cursor';

    function type() {
      if (i < text.length) {
        element.textContent += text.charAt(i);
        i++;
        demoState.typewriterTimer = setTimeout(type, speed);
      } else {
        element.appendChild(cursor);
        setTimeout(() => {
          cursor.remove();
          resolve();
        }, 420);
      }
    }
    type();
  });
}

function switchDemoScene(index) {
  demoState.scene = index;
  clearTimeout(demoState.resultTimer);

  $$('.demo-scene-item').forEach((el, i) => {
    el.classList.toggle('active', i === index);
  });

  const total = $$('.demo-scene-item').length;
  const progress = ((index + 1) / total) * 100;
  const fill = $('#demoProgressFill');
  if (fill) fill.style.width = progress + '%';

  switch (index) {
    case 0:
      typeWriter($('#greetText'), '我是矿工看山，今天帮你把整个收藏夹挖出知识金矿！', 38)
        .then(() => scheduleNextScene(900))
        .catch(err => console.error('[demo] scene0 error:', err));
      break;

    case 1:
      typeWriter($('#introTitle'), '授权整个收藏夹，先筛选高价值矿石', 30)
        .then(() => typeWriter($('#introSub'), '看山不会只按时间取前几条，而是跨主题挑选代表回答，并保留知乎原文链接、作者与赞同信息。', 18))
        .then(() => scheduleNextScene(2300))
        .catch(err => console.error('[demo] scene1 error:', err));
      break;

    case 2:
      scheduleNextScene(7600);
      break;

    case 3:
      scheduleNextScene(7000);
      break;

    case 4:
      startResultPreview();
      scheduleNextScene(DEMO_RESULT_TABS.length * DEMO_TAB_DURATION + 700);
      break;

    case 5:
      break;
  }
}

function scheduleNextScene(delay) {
  clearTimeout(demoState.sceneTimer);
  demoState.sceneTimer = setTimeout(() => {
    const total = $$('.demo-scene-item').length;
    if (demoState.active && !demoState.paused && demoState.scene < total - 1) {
      switchDemoScene(demoState.scene + 1);
    }
  }, delay);
}

function startResultPreview() {
  let tabIdx = 0;
  const preview = $('#resultPreview');

  function renderTab() {
    if (!demoState.active || demoState.paused || demoState.scene !== 4) return;

    const tab = DEMO_RESULT_TABS[tabIdx];
    $$('.result-tab').forEach((el) => {
      el.classList.toggle('active', el.dataset.tab === tab);
    });

    if (preview) {
      preview.innerHTML = getPreviewHTML(tab);
    }

    tabIdx = (tabIdx + 1) % DEMO_RESULT_TABS.length;
    demoState.resultTimer = setTimeout(renderTab, DEMO_TAB_DURATION);
  }

  renderTab();
}

function getPreviewHTML(tab) {
  const previews = {
    map: `
      <div class="pv-map">
        <section class="pv-panel">
          <h4>整夹知识框架</h4>
          <p class="pv-panel-sub">按主题占比重建收藏夹骨架，而不是把文章简单堆在一起</p>
          <div class="pv-bar-row">
            <div class="pv-bar-head"><span>AI 产品判断</span><b>38 篇</b></div>
            <div class="pv-bar"><i style="width:82%"></i></div>
          </div>
          <div class="pv-bar-row">
            <div class="pv-bar-head"><span>用户洞察方法</span><b>32 篇</b></div>
            <div class="pv-bar"><i style="width:70%"></i></div>
          </div>
          <div class="pv-bar-row">
            <div class="pv-bar-head"><span>学习与复盘</span><b>31 篇</b></div>
            <div class="pv-bar"><i style="width:66%"></i></div>
          </div>
          <div class="pv-bar-row">
            <div class="pv-bar-head"><span>职业能力迁移</span><b>27 篇</b></div>
            <div class="pv-bar"><i style="width:58%"></i></div>
          </div>
        </section>
        <section class="pv-panel">
          <h4>推荐消化路径</h4>
          <p class="pv-panel-sub">先建立全局框架，再进入观点、卡片和输出训练</p>
          <div class="pv-steps">
            <div class="pv-step"><b>1</b><div><strong>建立骨架</strong><span>理解四个主题之间如何互相支撑</span></div></div>
            <div class="pv-step"><b>2</b><div><strong>比较分歧</strong><span>同题保留不同立场与代表回答</span></div></div>
            <div class="pv-step"><b>3</b><div><strong>间隔复习</strong><span>关键概念进入 1/3/7/21 天计划</span></div></div>
            <div class="pv-step"><b>4</b><div><strong>对练输出</strong><span>看山扮演反方，逼出完整回答草稿</span></div></div>
          </div>
        </section>
      </div>
    `,
    viewpoint: `
      <div class="pv-spectrum">
        <article class="pv-stance support">
          <div class="pv-stance-head"><span>支持落地</span><b>45%</b></div>
          <p>“先验证高频任务和替代成本，再判断模型能力是否带来真实留存。”</p>
          <cite>产品老陈 · 1.2k 赞同 · 知乎原文</cite>
        </article>
        <article class="pv-stance neutral">
          <div class="pv-stance-head"><span>谨慎中立</span><b>35%</b></div>
          <p>“技术演示和长期使用是两件事，小规模试点能降低误判风险。”</p>
          <cite>AI 转型笔记 · 786 赞同 · 知乎原文</cite>
        </article>
        <article class="pv-stance doubt">
          <div class="pv-stance-head"><span>提出质疑</span><b>20%</b></div>
          <p>“如果流程没有闭环，单点提效很容易被接入成本和信任成本抵消。”</p>
          <cite>一线研发周野 · 642 赞同 · 知乎原文</cite>
        </article>
      </div>
    `,
    cards: `
      <div class="pv-cards">
        <div class="pv-flashcard front">价值验证三角</div>
        <div class="pv-flashcard back">从高频任务、替代成本、复用频次三个信号判断一个 AI 功能是否值得持续投入。</div>
        <div class="pv-schedule">
          自动进入间隔复习
          <span>1 天</span><span>3 天</span><span>7 天</span><span>21 天</span>
        </div>
      </div>
    `,
    coach: `
      <div class="pv-coach">
        <div class="pv-message ai">
          <span class="miner-mascot miner-xs pv-mini">
            <img src="/assets/liukanshan/idle.gif" alt="">
            <span class="miner-helmet" aria-hidden="true"><i></i></span>
          </span>
          <div class="pv-bubble">如果用户只在第一次觉得新奇，四周后不再回来，这个功能还应该继续投入吗？</div>
        </div>
        <div class="pv-message user">
          <span class="pv-user-dot">我</span>
          <div class="pv-bubble">不一定立刻砍掉，应先拆成任务频次、替代成本和留存缺口三个指标继续验证。</div>
        </div>
        <div class="pv-message ai">
          <span class="miner-mascot miner-xs pv-mini">
            <img src="/assets/liukanshan/thinking.gif" alt="">
            <span class="miner-helmet" aria-hidden="true"><i></i></span>
          </span>
          <div class="pv-bubble">很好，再补一个反例：什么情况下“低频次”也可能成立？三轮对练后自动整理成回答草稿。</div>
        </div>
      </div>
    `,
  };
  return previews[tab] || '';
}

function openDemo() {
  try {
    demoState.active = true;
    demoState.paused = false;
    demoState.scene = 0;
    demoState.alchemyStep = 0;

    const modal = document.getElementById('demoModal');
    if (!modal) {
      console.error('[demo] #demoModal not found in DOM');
      return;
    }
    modal.hidden = false;
    modal.classList.remove('demo-paused');
    document.body.classList.add('demo-open');
    const pauseBtn = $('#demoPauseBtn');
    if (pauseBtn) {
      pauseBtn.textContent = '⏸';
      pauseBtn.title = '暂停';
    }

    initDemoParticles();
    switchDemoScene(0);
  } catch (err) {
    console.error('[demo] openDemo failed:', err);
  }
}

function closeDemo() {
  demoState.active = false;
  clearTimeout(demoState.timer);
  clearTimeout(demoState.sceneTimer);
  clearTimeout(demoState.typewriterTimer);
  const modal = document.getElementById('demoModal');
  if (modal) modal.hidden = true;
  document.body.classList.remove('demo-open');
}

function toggleDemoPause() {
  demoState.paused = !demoState.paused;
  const btn = $('#demoPauseBtn');
  const modal = $('#demoModal');
  if (btn) {
    btn.textContent = demoState.paused ? '▶' : '⏸';
    btn.title = demoState.paused ? '继续' : '暂停';
  }
  if (modal) modal.classList.toggle('demo-paused', demoState.paused);

  clearTimeout(demoState.timer);
  clearTimeout(demoState.sceneTimer);
  clearTimeout(demoState.resultTimer);

  if (!demoState.paused) {
    if (demoState.scene === 4) {
      startResultPreview();
      scheduleNextScene(DEMO_RESULT_TABS.length * DEMO_TAB_DURATION + 700);
    } else {
      scheduleNextScene(700);
    }
  }
}

function enterAppFromDemo() {
  closeDemo();
  enterApp();
}

document.addEventListener('click', (e) => {
  if (e.target.closest('#demoCloseBtn')) {
    closeDemo();
  } else if (e.target.closest('#demoPauseBtn')) {
    toggleDemoPause();
  } else if (e.target.closest('#ctaBtn')) {
    enterAppFromDemo();
  }
});

function setupWelcome() {
  const welcome = $('#welcomeView');
  if (!welcome) return;
  const force = new URLSearchParams(window.location.search).get('welcome') === '1';
  let seen = false;
  try {
    seen = sessionStorage.getItem('cuizhi_welcome_seen') === '1';
  } catch {}
  if (!force && seen) {
    welcome.remove();
    return;
  }
  document.body.classList.add('welcome-mode');
  $('#wlStartBtn').addEventListener('click', enterApp);
  $('#wlBottomBtn').addEventListener('click', enterApp);
  $('#wlSkipBtn').addEventListener('click', enterApp);
  $('#wlDemoBtn').addEventListener('click', () => {
    openDemo();
  });
}

async function init() {
  setupWelcome();
  bindEvents();
  hideAlchemyOverlay();
  const params = new URLSearchParams(window.location.search);
  if (params.get('oauth') === 'success') {
    toast('知乎登录成功', 4200);
  }
  if (params.get('oauth') === 'failed') toast('知乎登录暂未完成，请稍后再试');
  await refreshOauth();
  await loadHistory();
}

init();
