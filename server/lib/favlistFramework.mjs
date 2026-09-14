const CONTENT_TYPE_LABELS = {
  answer: '回答',
  article: '文章',
  zvideo: '视频',
  pin: '想法',
  question: '问题',
};

const CATEGORY_DEFS = [
  {
    key: 'learning',
    name: '学习方法',
    icon: '学',
    color: '#0084FF',
    keywords: ['学习', '记忆', '复习', '阅读', '笔记', '认知', '思维', '知识管理', '自律', '专注', '理解', '提问', '课程', '训练', '学习方法'],
  },
  {
    key: 'exam',
    name: '考试备考',
    icon: '考',
    color: '#5856D6',
    keywords: ['考研', '高考', '中考', '雅思', '托福', '考试', '备考', '证书', '真题', '知识点', '冲刺', '复试', '英语', '数学', '政治'],
  },
  {
    key: 'technology',
    name: '科技编程',
    icon: '技',
    color: '#34C759',
    keywords: ['编程', '代码', '前端', '后端', '算法', '人工智能', 'AI', '互联网', '软件', '数据', '模型', '开源', 'Python', 'JavaScript', '产品经理', '开发'],
  },
  {
    key: 'career',
    name: '职场成长',
    icon: '职',
    color: '#F5A623',
    keywords: ['职场', '工作', '面试', '简历', '晋升', '管理', '创业', '商业', '运营', '职业', '团队', '沟通', '领导', '离职', '岗位'],
  },
  {
    key: 'creation',
    name: '创作表达',
    icon: '创',
    color: '#AF52DE',
    keywords: ['写作', '表达', '演讲', '视频', '自媒体', '文案', '创作', '内容', '故事', '叙事', '输出', '公众号', '短视频', '选题'],
  },
  {
    key: 'psychology',
    name: '心理关系',
    icon: '心',
    color: '#FF2D55',
    keywords: ['心理', '情绪', '焦虑', '压力', '亲密关系', '恋爱', '婚姻', '家庭', '沟通', '自我', '安全感', '性格', '抑郁', '社交'],
  },
  {
    key: 'life',
    name: '生活健康',
    icon: '活',
    color: '#30B0C7',
    keywords: ['健康', '睡眠', '运动', '饮食', '旅行', '家居', '穿搭', '美食', '健身', '养生', '生活', '习惯', '理财', '消费', '看病', '医院', '医疗', '就医'],
  },
  {
    key: 'culture',
    name: '人文社科',
    icon: '文',
    color: '#A2845E',
    keywords: ['历史', '哲学', '社会学', '经济', '政治', '文学', '艺术', '法律', '维权', '退费', '被骗', '证据', '文化', '社会', '国家', '宗教', '科学', '研究'],
  },
  {
    key: 'tools',
    name: '工具效率',
    icon: '效',
    color: '#5AC8FA',
    keywords: ['工具', '软件', '效率', '自动化', 'Excel', 'Notion', '工作流', '模板', '资源', '资源分享', 'App', '插件', 'AI 工具', '网站', '链接', '平台', '导航', '宝藏', '好用', '转载', '盐值'],
  },
];

const FALLBACK_CATEGORY = {
  key: 'inspiration',
  name: '综合灵感',
  icon: '综',
  color: '#8E8E93',
  keywords: [],
};

const ROLE_DEFS = [
  {
    key: 'method',
    name: '方法框架',
    description: '提供可复用的步骤、模型或行动清单',
    keywords: ['方法', '框架', '步骤', '模型', '如何', '怎么', '体系', '策略', '流程', '清单', '原则'],
  },
  {
    key: 'debate',
    name: '观点思辨',
    description: '呈现不同立场、选择标准与争议焦点',
    keywords: ['该不该', '为什么', '是否', '区别', '评价', '争议', '值得', '选择', '反对', '支持', '看法'],
  },
  {
    key: 'case',
    name: '经验案例',
    description: '用真实经历帮助理解概念如何落地',
    keywords: ['经历', '经验', '案例', '故事', '实战', '踩坑', '复盘', '亲测', '体会', '教训', '过程'],
  },
  {
    key: 'resource',
    name: '工具资源',
    description: '沉淀工具、模板、书单或可直接使用的资料',
    keywords: ['工具', '软件', '网站', '模板', '资源', '清单', '书单', '推荐', 'App', '插件', '指南'],
  },
];

const KNOWLEDGE_ROLE = {
  key: 'concept',
  name: '核心知识',
  description: '解释关键概念、背景知识与基础原理',
};

function clean(value) {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function idFromUrl(url, fallback = 'fav-content') {
  const raw = String(url || '').trim();
  if (!raw) return fallback;
  try {
    const parsed = new URL(raw);
    const segments = parsed.pathname.split('/').filter(Boolean);
    const last = segments.at(-1);
    if (last && /^[A-Za-z0-9_-]+$/.test(last)) return last;
    return `${segments.join('-') || fallback}`;
  } catch {
    return raw.replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 80) || fallback;
  }
}

function scoreText(text, keywords, titleWeight = 3) {
  const source = String(text || '');
  let score = 0;
  for (const keyword of keywords) {
    if (!keyword) continue;
    const lowerSource = source.toLowerCase();
    const lowerKeyword = keyword.toLowerCase();
    let index = lowerSource.indexOf(lowerKeyword);
    while (index >= 0) {
      score += index < 80 ? titleWeight : 1;
      index = lowerSource.indexOf(lowerKeyword, index + lowerKeyword.length);
    }
  }
  return score;
}

export function normalizeFavlistItem(item = {}, index = 0) {
  const title = clean(item.Title);
  const summary = clean(item.Summary);
  const url = String(item.Url || '').trim();
  const contentType = String(item.ContentType || '').toLowerCase() || 'other';
  const author = clean(item.Author?.Name || item.AuthorName || '知乎用户');
  return {
    id: String(item.ContentID || item.ContentId || item.Id || item.id || idFromUrl(url, `fav-${index + 1}`)),
    title: title || '未命名收藏',
    summary,
    content: `${title}\n${summary}`,
    url,
    contentType,
    typeLabel: CONTENT_TYPE_LABELS[contentType] || '内容',
    author,
    authorUrl: item.Author?.Url || '',
    likeCount: Number(item.LikeCount || 0),
    commentCount: Number(item.CommentCount || 0),
    favoriteCount: Number(item.FavoriteCount || 0),
    createdAt: Number(item.CreatedAt || 0),
    favTime: Number(item.FavTime || 0),
  };
}

function detectCategory(item) {
  const text = `${item.title}\n${item.summary}`;
  let best = FALLBACK_CATEGORY;
  let bestScore = 0;
  for (const category of CATEGORY_DEFS) {
    const score = scoreText(text, category.keywords);
    if (score > bestScore) {
      best = category;
      bestScore = score;
    }
  }
  return { ...best, score: bestScore };
}

function detectRole(item) {
  const title = item.title;
  const byKey = (key) => ROLE_DEFS.find((role) => role.key === key) || KNOWLEDGE_ROLE;
  if (/该不该|是否|值得|区别|争议|支持|反对|怎么选/.test(title)) return byKey('debate');
  if (/工具|软件|网站|模板|资源|清单|插件|App/i.test(title)) return byKey('resource');
  if (/经历|经验|案例|故事|实战|踩坑|复盘|亲测/.test(`${title} ${item.summary}`)) return byKey('case');
  if (/如何|怎么|方法|步骤|框架|模型|策略|体系|流程/.test(title)) return byKey('method');

  const text = `${item.title}\n${item.summary}`;
  let best = KNOWLEDGE_ROLE;
  let bestScore = 0;
  for (const role of ROLE_DEFS) {
    const score = scoreText(text, role.keywords, 4);
    if (score > bestScore) {
      best = role;
      bestScore = score;
    }
  }
  if (bestScore === 0 && (item.contentType === 'zvideo' || item.contentType === 'pin')) return byKey('case');
  return best;
}

function rankScore(item) {
  return item.likeCount + item.commentCount * 2 + item.favoriteCount * 1.5 + Math.min(item.summary.length / 80, 6);
}

function buildPath(categories, roleCounts) {
  const top = categories.slice(0, 3);
  const firstName = top[0]?.name || '核心主题';
  const secondName = top[1]?.name || '相关主题';
  const practiceCount = roleCounts.case || 0;
  return [
    {
      step: '第 1 步 · 看全景',
      title: `先建立「${firstName}」主线`,
      action: `先浏览该主题下点赞和收藏数较高的内容，用一句话写出这个收藏夹真正想解决的问题，再把内容按“概念、方法、案例”放到对应位置。`,
      duration: '20 分钟',
    },
    {
      step: '第 2 步 · 搭骨架',
      title: `补齐「${secondName}」关联知识`,
      action: `打开第二主题中的代表内容，只摘录定义、适用边界和关键步骤，把它和主线主题之间的关系连起来，避免收藏内容停留在互不相关的碎片。`,
      duration: '35 分钟',
    },
    {
      step: '第 3 步 · 做对照',
      title: '比较不同观点与适用场景',
      action: `挑出观点思辨类内容，分别记录其前提、论据和代价，再标注哪些建议适合自己当前阶段，哪些只适合特定人群或环境。`,
      duration: '30 分钟',
    },
    {
      step: '第 4 步 · 去实践',
      title: practiceCount ? '用真实案例完成一次练习' : '主动补一个实践案例',
      action: practiceCount
        ? `选择收藏夹中的经验案例，照着作者的步骤做一次小练习，并记录成功条件、失败原因和下一步调整。`
        : `围绕主线找一个真实问题套用方法，完成一次小练习，再用结果反推自己还没理解的概念。`,
      duration: '45 分钟',
    },
    {
      step: '第 5 步 · 再输出',
      title: '生成卡片并安排复习',
      action: `把核心概念做成问答卡，把方法做成行动清单，在当天、第 3 天和第 7 天各回忆一次，能用自己的话讲清楚后再进入下一批收藏。`,
      duration: '25 分钟',
    },
  ];
}

function buildSummary(categories, total) {
  const top = categories.slice(0, 3).map((category) => category.name);
  if (!total) return '这个收藏夹暂时没有可分析的内容。';
  if (top.length === 1) {
    return `这个收藏夹主要围绕「${top[0]}」展开，适合先沉淀核心概念，再通过案例和复习卡片把收藏转化成可调用的知识。`;
  }
  return `最近收藏主要分布在「${top.join('」「')}」等方向。系统会先按主题搭建骨架，再区分方法、观点、案例和工具资源，帮助你看清整个收藏夹的知识结构。`;
}

export function buildFavlistFramework(rawItems = []) {
  const items = Array.isArray(rawItems) ? rawItems.map(normalizeFavlistItem) : [];
  const categoryMap = new Map();
  const roleMap = new Map(Object.values(ROLE_DEFS).concat(KNOWLEDGE_ROLE).map((role) => [role.key, { ...role, count: 0 }]));
  const typeMap = new Map();
  const authorMap = new Map();

  for (const item of items) {
    item.engagement = rankScore(item);
    const category = detectCategory(item);
    item.categoryKey = category.key;
    item.categoryName = category.name;
    if (!categoryMap.has(category.key)) {
      categoryMap.set(category.key, {
        key: category.key,
        name: category.name,
        icon: category.icon,
        color: category.color,
        count: 0,
        score: 0,
        items: [],
      });
    }
    const categoryBucket = categoryMap.get(category.key);
    categoryBucket.count += 1;
    categoryBucket.score += item.engagement + category.score;
    categoryBucket.items.push(item);

    const role = detectRole(item);
    item.roleKey = role.key;
    item.roleName = role.name;
    const roleBucket = roleMap.get(role.key) || { ...role, count: 0 };
    roleBucket.count += 1;
    roleMap.set(role.key, roleBucket);

    const typeBucket = typeMap.get(item.contentType) || {
      key: item.contentType,
      name: item.typeLabel,
      count: 0,
    };
    typeBucket.count += 1;
    typeMap.set(item.contentType, typeBucket);

    const authorBucket = authorMap.get(item.author) || { name: item.author, url: item.authorUrl, count: 0, engagement: 0 };
    authorBucket.count += 1;
    authorBucket.engagement += item.engagement;
    authorMap.set(item.author, authorBucket);
  }

  const total = items.length;
  const withRatio = (item) => ({ ...item, ratio: total ? item.count / total : 0 });
  const categories = [...categoryMap.values()]
    .map((category) => ({
      ...withRatio(category),
      items: [...category.items].sort((a, b) => b.engagement - a.engagement).slice(0, 8),
    }))
    .sort((a, b) => b.count - a.count || b.score - a.score);
  const roles = [...roleMap.values()].filter((role) => role.count > 0).map(withRatio).sort((a, b) => b.count - a.count);
  const contentTypes = [...typeMap.values()].map(withRatio).sort((a, b) => b.count - a.count);
  const topAuthors = [...authorMap.values()].sort((a, b) => b.count - a.count || b.engagement - a.engagement).slice(0, 5);

  const roleCounts = Object.fromEntries(roles.map((role) => [role.key, role.count]));
  const sourceItems = [...items].sort((a, b) => b.engagement - a.engagement);
  return {
    total,
    summary: buildSummary(categories, total),
    categories,
    roles,
    contentTypes,
    topAuthors,
    topItems: sourceItems.slice(0, 5),
    stats: {
      total,
      authors: authorMap.size,
      likes: items.reduce((sum, item) => sum + item.likeCount, 0),
      comments: items.reduce((sum, item) => sum + item.commentCount, 0),
      favorites: items.reduce((sum, item) => sum + item.favoriteCount, 0),
    },
    path: buildPath(categories, roleCounts),
  };
}

export function selectRepresentativeItems(rawItems = [], limit = 12) {
  const framework = buildFavlistFramework(rawItems);
  const queues = framework.categories.map((category) => [...category.items]);
  const picked = [];
  const seen = new Set();
  let progressed = true;
  while (picked.length < limit && progressed) {
    progressed = false;
    for (const queue of queues) {
      if (picked.length >= limit) break;
      const item = queue.shift();
      if (!item) continue;
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      picked.push(item);
      progressed = true;
    }
  }
  return picked.sort((a, b) => framework.categories.findIndex((category) => category.key === a.categoryKey) - framework.categories.findIndex((category) => category.key === b.categoryKey) || b.engagement - a.engagement);
}

export function favItemsToAnswers(items = []) {
  return items.map((item, index) => ({
    answerId: String(item.id || `fav-${index + 1}`),
    author: item.author || '收藏内容',
    title: item.title || '',
    summary: item.summary || '',
    content: item.content || `${item.title || ''}\n${item.summary || ''}`,
    voteCount: Number(item.likeCount || 0),
    authorityLevel: 2,
    url: item.url || '',
  }));
}

export function buildCollectionConcepts(framework, representativeItems = [], limit = 6) {
  const selectedIds = new Set((representativeItems || []).map((item) => String(item.id)));
  return (framework.categories || [])
    .slice(0, limit)
    .map((category, index) => {
      const selectedInCategory = category.items.filter((item) => selectedIds.has(String(item.id)));
      const representatives = (selectedInCategory.length ? selectedInCategory : category.items).slice(0, 2);
      const roleCount = new Map();
      for (const item of category.items) {
        if (!item.roleName) continue;
        roleCount.set(item.roleName, (roleCount.get(item.roleName) || 0) + 1);
      }
      const roles = [...roleCount.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([name]) => name);
      const percent = Math.round(category.ratio * 100);
      const roleText = roles.length ? `，内容以${roles.join('、')}为主` : '';
      const definition =
        `这是整夹第 ${index + 1} 条知识矿脉，共有 ${category.count} 篇收藏归入这里，约占 ${percent}%${roleText}。` +
        `复习时先讲清它解决什么问题，再结合下方代表收藏复述要点，并迁移到自己的学习或工作场景。`;
      return {
        term: category.name,
        definition,
        example: representatives[0]?.title || category.name,
        source_answer_ids: representatives[0]?.id ? [String(representatives[0].id)] : [],
      };
    });
}
