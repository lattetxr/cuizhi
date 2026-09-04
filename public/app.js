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
    filter: 'all',
    grades: {},
    completed: false,
  },
};

let tourStep = 0;

const CARD_TYPE_LABELS = {
  concept: '概念卡',
  viewpoint: '观点卡',
  scenario: '情景题',
  compare: '对比卡',
  mindmap: '思维导图',
};

const CARD_TYPE_KEYS = ['concept', 'mindmap'];

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
      throw new Error('哎呀，出了点小问题，再试一次吧～');
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

function renderOauth(status) {
  state.oauth = status;
  const chip = $('#oauthChip');
  const loginBtn = $('#loginBtn');
  const logoutBtn = $('#logoutBtn');
  const profileBtn = $('#profileBtn');
  const userMenuBtn = $('#userMenuBtn');
  const favAction = $('#favActionBtn');
  const favHomeBtn = $('#favHomeBtn');
  const oauth = status.oauth;

  if (oauth.waitingForDeploy) {
    chip.textContent = '等待部署';
    chip.className = 'chip deploy';
    loginBtn.hidden = false;
    logoutBtn.hidden = false;
    profileBtn.hidden = false;
    userMenuBtn.hidden = true;
    favAction.hidden = true;
    favHomeBtn.hidden = false;
    favHomeBtn.textContent = '登录知乎 · 导入收藏夹';
  } else if (oauth.authorized) {
    chip.textContent = '已授权';
    chip.className = 'chip ok';
    loginBtn.hidden = true;
    logoutBtn.hidden = false;
    profileBtn.hidden = false;
    userMenuBtn.hidden = false;
    favAction.hidden = false;
    favHomeBtn.hidden = false;
    favHomeBtn.textContent = '查看我的收藏';
  } else {
    chip.textContent = oauth.appKeyConfigured ? '可登录' : '等待部署';
    chip.className = oauth.appKeyConfigured ? 'chip' : 'chip deploy';
    loginBtn.hidden = false;
    logoutBtn.hidden = false;
    profileBtn.hidden = false;
    userMenuBtn.hidden = true;
    favAction.hidden = true;
    favHomeBtn.hidden = false;
    favHomeBtn.textContent = '登录知乎 · 导入收藏夹';
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
  $('#homeView').hidden = false;
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

function renderPackage(pkg) {
  state.pkg = pkg;
  $('#homeView').hidden = true;
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
      cards: pkg.visualCards || [],
      index: 0,
      flipped: false,
      filter: 'all',
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
}

function getTypeConfig() {
  const type = state.pkg?.contentType || 'knowledge';
  return TYPE_CONFIG[type] || TYPE_CONFIG.knowledge;
}

function renderTypeBanner() {
  const notice = $('#degradedNotice');
  const cfg = getTypeConfig();
  const banner = document.createElement('div');
  banner.className = 'type-banner';
  banner.innerHTML = `
    <button class="type-badge" id="typeBadge">${cfg.emoji} ${cfg.label} ▾</button>
  `;
  notice.parentNode.insertBefore(banner, notice);
  banner.querySelector('#typeBadge').addEventListener('click', (event) => {
    event.stopPropagation();
    showTypeSwitchMenu(event.currentTarget);
  });
}

function showTypeSwitchMenu(anchor) {
  let menu = $('#typeSwitchMenu');
  if (menu) menu.remove();
  menu = document.createElement('div');
  menu.className = 'type-switch-menu';
  menu.id = 'typeSwitchMenu';
  menu.innerHTML = Object.entries(TYPE_CONFIG)
    .map(
      ([key, cfg]) =>
        `<button data-type-switch="${key}" class="${state.pkg.contentType === key ? 'active' : ''}">${cfg.emoji} ${cfg.label}</button>`,
    )
    .join('');
  document.body.appendChild(menu);
  const rect = anchor.getBoundingClientRect();
  menu.style.top = `${rect.bottom + window.scrollY + 6}px`;
  menu.style.left = `${rect.left + window.scrollX}px`;
  menu.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-type-switch]');
    if (!btn) return;
    state.pkg.contentType = btn.dataset.typeSwitch;
    menu.remove();
    const banner = $('.type-banner');
    if (banner) banner.remove();
    renderTypeBanner();
    applyTypeLayout(true);
  });
  setTimeout(() => {
    document.addEventListener('click', function close(event) {
      if (menu.contains(event.target)) return;
      menu.remove();
      document.removeEventListener('click', close);
    });
  }, 0);
}

function applyTypeLayout(autoTab) {
  const cfg = getTypeConfig();
  const primary = cfg.primary;
  const allTabs = ['viewpoint', 'map', 'cards', 'coach'];
  const tabBar = $('#tabBar');

  $$('.tab-btn').forEach((btn) => {
    const tab = btn.dataset.tab;
    btn.hidden = false;
    btn.classList.remove('dimmed');
    const oldBadge = btn.querySelector('.rec-badge');
    if (oldBadge) oldBadge.remove();
    if (tab === primary) {
      const badge = document.createElement('span');
      badge.className = 'rec-badge';
      badge.textContent = '✦推荐';
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
  const nodes = steps.slice(0, 6).map((step, index) => ({
    ...step,
    x: MAP_NODES[index].x,
    y: MAP_NODES[index].y,
  }));
  return `
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

function filteredVisualCards() {
  const cards = state.visual.cards || [];
  if (state.visual.filter === 'all') return cards;
  return cards.filter((card) => card.type === state.visual.filter);
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

function mindmapSvg(card) {
  const branches = card.branches || [];
  const count = Math.min(5, branches.length);
  const points = Array.from({ length: count }, (_, index) => {
    const angle = -Math.PI / 2 + (index / Math.max(1, count - 1)) * Math.PI;
    return {
      x: Math.round(200 + Math.cos(angle) * 138),
      y: Math.round(120 + Math.sin(angle) * 88),
    };
  });
  const colors = ['#0066CC', '#0084FF', '#66B2FF', '#B3D9FF', '#0066CC'];
  const curves = points
    .map(
      (point, index) => `
        <path d="M 200 120 C ${Math.round(200 + (point.x - 200) * 0.45)} ${Math.round(
          120 + (point.y - 120) * 0.3,
        )}, ${Math.round(200 + (point.x - 200) * 0.75)} ${Math.round(
          120 + (point.y - 120) * 0.6,
        )}, ${point.x} ${point.y}" fill="none" stroke="${colors[index % colors.length]}" stroke-width="3"/>`,
    )
    .join('');
  const branchesSvg = points
    .map(
      (point, index) =>
        `<g>
          <rect x="${point.x - 58}" y="${point.y - 15}" width="116" height="30" rx="15" fill="${colors[index % colors.length]}"/>
          <text x="${point.x}" y="${point.y + 4}" text-anchor="middle" font-size="11" fill="#fff" font-weight="600">${escapeHtml(
          branches[index]?.label?.split('·')[1]?.trim() || `分支${index + 1}`,
        )}</text>
          <circle cx="${point.x - 36}" cy="${point.y + 26}" r="9" fill="#fff" stroke="${colors[index % colors.length]}"/>
          <circle cx="${point.x}" cy="${point.y + 30}" r="9" fill="#fff" stroke="${colors[index % colors.length]}"/>
          <circle cx="${point.x + 36}" cy="${point.y + 26}" r="9" fill="#fff" stroke="${colors[index % colors.length]}"/>
        </g>`,
    )
    .join('');
  return `
    <svg class="mindmap-canvas" viewBox="0 0 400 240" role="img" aria-label="思维导图">
      ${curves}
      <rect x="150" y="96" width="100" height="48" rx="16" fill="#F5A623"/>
      <text x="200" y="125" text-anchor="middle" font-size="16" font-weight="700" fill="#fff">${escapeHtml(
        card.center || '知识',
      )}</text>
      ${branchesSvg}
    </svg>
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
  if (card.type === 'mindmap') {
    return mindmapSvg(card);
  }
  const lines = String(card.front || '').split('\n');
  if (card.type === 'concept') {
    const title = lines.filter(Boolean).at(-1) || '';
    return `<div class="card-body"><span class="concept-name">${escapeHtml(title)}</span></div>`;
  }
  const title = lines.shift() || '';
  return `
    <div class="card-body">
      <span class="card-title">${escapeHtml(title)}</span>
      ${lines.length ? `<br>${escapeHtml(lines.join('\n'))}` : ''}
    </div>
  `;
}

function visualBack(card) {
  return `
    <div class="card-body">${escapeHtml(card.back || '')}</div>
  `;
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
  const showTour = !localStorage.getItem('cuizhi_tour_done');
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
    ${
      showTour
        ? `
          <div class="tour-overlay" id="tourOverlay">
            <div class="tour-card">
              <h3 id="tourTitle">点击卡片或按空格键翻转</h3>
              <p id="tourDesc">先看正面，回想答案，再翻面核对。</p>
              <div class="tour-dots">
                <span class="tour-dot active"></span>
                <span class="tour-dot"></span>
                <span class="tour-dot"></span>
              </div>
              <button class="button primary" id="tourNextBtn">下一步</button>
            </div>
          </div>`
        : ''
    }
  `;
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
    state.pkg.visualCards = data.cards;
    state.visual = {
      pkgId: state.pkg.id,
      cards: data.cards,
      index: 0,
      flipped: false,
      filter: 'all',
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

async function loadFavlists() {
  const btn = $('#favActionBtn');
  try {
    setLoading(btn, true, '读取中...');
    const data = await api('/api/me/favlists?Limit=50');
    const items = data.data?.Items || [];
    const list = $('#favlistList');
    if (!items.length) {
      list.innerHTML = '<div class="empty-inline">没有可读取的收藏夹</div>';
      return;
    }
    list.innerHTML = items
      .map(
        (item) => `
          <div class="favlist-item">
            <h3>${escapeHtml(item.Title)}</h3>
            <p>${escapeHtml(item.Description || '')}</p>
            <button class="button" data-favlist="${escapeHtml(item.UrlToken)}">整夹炼金</button>
          </div>`,
      )
      .join('');
  } catch (error) {
    toast(error.message);
  } finally {
    setLoading(btn, false);
  }
}

async function alchemizeFavlist(token, button) {
  try {
    setLoading(button, true, '炼金中...');
    const data = await api(`/api/favlists/${encodeURIComponent(token)}/alchemy`, {
      method: 'POST',
      body: JSON.stringify({ goal: state.goal }),
    });
    renderPackage(data.pkg);
    loadHistory();
  } catch (error) {
    toast(error.message);
  } finally {
    setLoading(button, false);
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
  let activeIndex = -1;

  const paintSteps = (index, allDone) => {
    steps.forEach(([step], i) => {
      const el = document.querySelector(`[data-step="${step}"]`);
      if (!el) return;
      el.classList.toggle('active', !allDone && i === index);
      el.classList.toggle('done', allDone || i < index);
    });
  };

  const render = (pct, statusText) => {
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

  render(0, '看山正在准备炼金原料');

  return {
    update(progress, statusText) {
      if (finished) return;
      render(progress, statusText);
    },
    async finish(statusText = '炼金完成，正在整理学习包～') {
      if (finished) return;
      const remain = MIN_SHOW_MS - (Date.now() - startedAt);
      if (remain > 0) {
        await new Promise((resolve) => setTimeout(resolve, remain));
      }
      finished = true;
      paintSteps(steps.length, true);
      render(100, statusText);
    },
  };
}

// 流式读取 /api/alchemy 的 NDJSON：进度行驱动进度条，终行渲染学习包
async function streamAlchemy(payload, progressCtrl) {
  const response = await fetch('/api/alchemy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok || !response.body) {
    let detail = `请求失败（${response.status}）`;
    try {
      const err = await response.json();
      if (err?.error) detail = err.error;
    } catch { /* ignore */ }
    throw new Error(detail);
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
  let payload;
  if (state.exampleSearch && input === EXAMPLES[state.exampleSearchKey]?.input) {
    payload = { search: input };
  } else {
    payload = /^https?:\/\//i.test(input) ? { url: input } : { text: input };
  }
  state.exampleSearch = false;
  state.exampleSearchKey = null;
  const btn = $('#alchemyBtn');
  showAlchemyOverlay();
  setLoading(btn, true, '炼金中...');
  const progress = createAlchemyProgress();
  try {
    const data = await streamAlchemy({ ...payload, goal: state.goal }, progress);
    await progress.finish();
    renderPackage(data.pkg);
    toast(data.pkg.notices?.length ? '已生成，部分模块降级为占位结果' : '炼金完成');
    loadHistory();
  } catch (error) {
    console.error(error);
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

  $('#userMenuBtn').addEventListener('click', (event) => {
    event.stopPropagation();
    const panel = $('#menuPanel');
    panel.hidden = !panel.hidden;
  });

  $('#profileBtn').addEventListener('click', (event) => {
    event.stopPropagation();
    const panel = $('#menuPanel');
    panel.hidden = !panel.hidden;
  });

  document.addEventListener('click', (event) => {
    const panel = $('#menuPanel');
    if (
      !panel.hidden &&
      !event.target.closest('#menuPanel') &&
      !event.target.closest('#userMenuBtn') &&
      !event.target.closest('#profileBtn')
    ) {
      panel.hidden = true;
    }
  });

  $$('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => setPackageTab(btn.dataset.tab));
  });

  $('#backBtn').addEventListener('click', () => {
    state.pkg = null;
    showEmpty();
  });

  $('#loginBtn').addEventListener('click', () => {
    if (state.oauth?.oauth?.waitingForDeploy) {
      toast('等待部署：本地地址无法完成真实知乎登录');
      return;
    }
    window.location.href = '/auth/login';
  });

  $('#favHomeBtn').addEventListener('click', () => {
    if (state.oauth?.oauth?.authorized) {
      loadFavlists();
      return;
    }
    if (state.oauth?.oauth?.waitingForDeploy) {
      toast('等待部署：本地地址无法完成真实知乎登录');
      return;
    }
    window.location.href = '/auth/login';
  });

  $('#logoutBtn').addEventListener('click', async () => {
    await api('/api/oauth/logout', { method: 'POST' });
    await refreshOauth();
    $('#favlistList').innerHTML = '';
    toast('已退出登录');
  });

  $('#favActionBtn').addEventListener('click', loadFavlists);

  $('#favlistList').addEventListener('click', (event) => {
    const button = event.target.closest('[data-favlist]');
    if (button) alchemizeFavlist(button.dataset.favlist, button);
  });

  $('#historyList').addEventListener('click', (event) => {
    const item = event.target.closest('[data-package-id]');
    if (item) openPackage(item.dataset.packageId);
  });

  $('#tabContent').addEventListener('click', (event) => {
    const tourNext = event.target.closest('#tourNextBtn');
    if (tourNext) {
      const overlay = document.querySelector('#tourOverlay');
      tourStep += 1;
      if (tourStep >= 3) {
        localStorage.setItem('cuizhi_tour_done', '1');
        overlay?.remove();
        tourStep = 0;
        return;
      }
      const steps = [
        ['点击卡片或按空格键翻转', '先看正面，回想答案，再翻面核对。'],
        ['翻转后选择掌握程度', '记住、模糊或没记住，都会影响下一次复习安排。'],
        ['左右滑动或方向键切换', '也可以按 1 / 2 / 3 快速评分。'],
      ];
      $('#tourTitle').textContent = steps[tourStep][0];
      $('#tourDesc').textContent = steps[tourStep][1];
      $$('.tour-dot').forEach((dot, index) => {
        dot.classList.toggle('active', index === tourStep);
      });
      if (tourStep === 2) tourNext.textContent = '开始复习';
      return;
    }
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
};

const SCENE_DURATIONS = [3500, 4500, 0, 13000, 5000, 0];
const STATUS_TEXTS = [
  '正在提取核心观点...',
  '正在梳理概念体系...',
  '正在生成复习卡片...',
  '正在准备对练场景...',
];

function initDemoParticles() {
  const container = document.getElementById('demoParticles');
  if (!container) return;
  container.innerHTML = '';
  for (let i = 0; i < 30; i++) {
    const p = document.createElement('div');
    p.className = 'demo-particle';
    p.style.left = Math.random() * 100 + '%';
    p.style.top = Math.random() * 100 + '%';
    p.style.animationDelay = Math.random() * 3 + 's';
    container.appendChild(p);
  }
}

function typeWriter(element, text, speed = 50) {
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
        }, 500);
      }
    }
    type();
  });
}

function switchDemoScene(index) {
  demoState.scene = index;

  $$('.demo-scene-item').forEach((el, i) => {
    el.classList.toggle('active', i === index);
  });

  const total = $$('.demo-scene-item').length;
  const progress = ((index + 1) / total) * 100;
  const fill = $('#demoProgressFill');
  if (fill) fill.style.width = progress + '%';

  switch (index) {
    case 0:
      typeWriter($('#greetText'), '嗨！我是看山，帮你把收藏炼成知识～').then(() => {
        scheduleNextScene(1000);
      }).catch(err => console.error('[demo] scene0 error:', err));
      break;

    case 1:
      typeWriter($('#introTitle'), '收藏会吃灰，炼过才是你的').then(() => {
        return typeWriter($('#introSub'), '把知乎上"收藏后吃灰"的优质内容，炼成可复习、可再创作的学习包');
      }).then(() => {
        scheduleNextScene(1000);
      }).catch(err => console.error('[demo] scene1 error:', err));
      break;

    case 2:
      scheduleNextScene(3000);
      break;

    case 3:
      startAlchemyAnimation();
      break;

    case 4:
      startResultPreview();
      scheduleNextScene(5000);
      break;

    case 5:
      break;
  }
}

function scheduleNextScene(delay) {
  clearTimeout(demoState.sceneTimer);
  demoState.sceneTimer = setTimeout(() => {
    const total = $$('.demo-scene-item').length;
    if (!demoState.paused && demoState.scene < total - 1) {
      switchDemoScene(demoState.scene + 1);
    }
  }, delay);
}

function startAlchemyAnimation() {
  demoState.alchemyStep = 0;
  runAlchemyStep();
}

function runAlchemyStep() {
  if (demoState.alchemyStep >= 4) {
    switchDemoScene(4);
    return;
  }

  $$('.alchemy-p-step').forEach((el, i) => {
    el.classList.remove('active', 'done');
    if (i < demoState.alchemyStep) el.classList.add('done');
    if (i === demoState.alchemyStep) el.classList.add('active');
  });

  $('#demoStatusText').textContent = STATUS_TEXTS[demoState.alchemyStep];

  createAlchemyParticles();

  const lks = $('#alchemyLks');
  if (lks) {
    lks.src = demoState.alchemyStep === 3
      ? '/assets/liukanshan/thinking.gif'
      : '/assets/liukanshan/working.gif';
  }

  demoState.alchemyStep++;
  demoState.timer = setTimeout(runAlchemyStep, 3000);
}

function createAlchemyParticles() {
  const container = document.getElementById('alchemyParticles');
  if (!container) return;

  for (let i = 0; i < 12; i++) {
    const p = document.createElement('div');
    p.className = 'alchemy-particle';
    const startX = Math.random() * 100;
    const startY = Math.random() < 0.5 ? 0 : 100;
    p.style.left = startX + '%';
    p.style.top = startY + '%';
    p.style.animationDelay = (i * 0.1) + 's';
    container.appendChild(p);
    setTimeout(() => p.remove(), 2500);
  }
}

function startResultPreview() {
  const tabs = ['viewpoint', 'map', 'cards', 'coach'];
  let tabIdx = 0;

  function switchTab() {
    if (!demoState.active || demoState.scene !== 4) return;

    $$('.result-tab').forEach((el, i) => {
      el.classList.toggle('active', i === tabIdx);
    });

    const preview = $('#resultPreview');
    if (preview) {
      preview.innerHTML = getPreviewHTML(tabs[tabIdx]);
    }

    tabIdx = (tabIdx + 1) % tabs.length;
    setTimeout(switchTab, 1200);
  }

  switchTab();
}

function getPreviewHTML(tab) {
  const previews = {
    viewpoint: `
      <div style="text-align:center;padding:40px;">
        <div style="display:flex;justify-content:center;gap:40px;margin-bottom:24px;">
          <div style="text-align:center;">
            <div style="font-size:48px;font-weight:700;color:#0084ff;">45%</div>
            <div style="color:#6b7078;margin-top:4px;">支持</div>
          </div>
          <div style="text-align:center;">
            <div style="font-size:48px;font-weight:700;color:#8e8e93;">35%</div>
            <div style="color:#6b7078;margin-top:4px;">中立</div>
          </div>
          <div style="text-align:center;">
            <div style="font-size:48px;font-weight:700;color:#ff3b30;">20%</div>
            <div style="color:#6b7078;margin-top:4px;">质疑</div>
          </div>
        </div>
        <div style="color:#6b7078;font-size:14px;">多立场分布与共识分歧，「信谁的」一眼看懂</div>
      </div>
    `,
    map: `
      <div style="text-align:center;padding:40px;">
        <svg width="300" height="150" viewBox="0 0 300 150">
          <path d="M30,130 Q80,30 150,80 T270,50" stroke="#f5a623" stroke-width="3" fill="none" stroke-dasharray="5,5"/>
          <circle cx="30" cy="130" r="15" fill="#0084ff"/>
          <circle cx="150" cy="80" r="15" fill="#f5a623"/>
          <circle cx="270" cy="50" r="15" fill="#34c759"/>
          <text x="30" y="135" text-anchor="middle" fill="#fff" font-size="12">基础</text>
          <text x="150" y="85" text-anchor="middle" fill="#fff" font-size="12">核心</text>
          <text x="270" y="55" text-anchor="middle" fill="#fff" font-size="12">进阶</text>
        </svg>
        <div style="color:#6b7078;margin-top:16px;font-size:14px;">概念体系 + 学习路径，碎片变体系</div>
      </div>
    `,
    cards: `
      <div style="display:flex;justify-content:center;gap:20px;padding:40px;">
        <div style="width:180px;height:120px;background:#fef4e5;border:2px solid #f5a623;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:600;color:#f5a623;">
          存在先于本质
        </div>
        <div style="width:180px;height:120px;background:#e8f3ff;border:2px solid #0084ff;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:14px;color:#0084ff;padding:12px;text-align:center;">
          人首先存在，然后通过选择定义自己
        </div>
      </div>
      <div style="text-align:center;color:#6b7078;font-size:14px;">概念卡 + 1/3/7/21 天间隔复习</div>
    `,
    coach: `
      <div style="padding:20px;">
        <div style="display:flex;gap:12px;margin-bottom:16px;">
          <img src="/assets/liukanshan/idle.gif" style="width:40px;height:40px;">
          <div style="background:#f2f2f7;padding:12px 16px;border-radius:12px;flex:1;font-size:14px;">
            我认为存在主义强调个体自由是有道理的...
          </div>
        </div>
        <div style="display:flex;gap:12px;justify-content:flex-end;">
          <div style="background:#e8f3ff;padding:12px 16px;border-radius:12px;flex:1;text-align:right;font-size:14px;">
            但这种自由是否过于理想化？在现实社会中...
          </div>
        </div>
        <div style="text-align:center;color:#6b7078;margin-top:16px;font-size:14px;">AI 扮反方 3 轮对练，输出回答草稿</div>
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
    document.body.classList.add('demo-open');

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
  if (btn) btn.textContent = demoState.paused ? '▶' : '⏸';

  if (!demoState.paused) {
    scheduleNextScene(1000);
  } else {
    clearTimeout(demoState.timer);
    clearTimeout(demoState.sceneTimer);
  }
}

function selectDemoInput(type) {
  switchDemoScene(3);
}

function enterAppFromDemo() {
  closeDemo();
}

document.addEventListener('click', (e) => {
  if (e.target.closest('#demoCloseBtn')) {
    closeDemo();
  } else if (e.target.closest('#demoPauseBtn')) {
    toggleDemoPause();
  } else if (e.target.closest('[data-demo-type]')) {
    selectDemoInput(e.target.closest('[data-demo-type]').dataset.demoType);
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
  if (params.get('oauth') === 'success') toast('知乎登录成功');
  if (params.get('oauth') === 'failed') toast('知乎登录未完成，请检查部署与回调配置');
  await refreshOauth();
  await loadHistory();
}

init();
