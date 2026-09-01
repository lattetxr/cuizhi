import { getLlmConfig } from './config.mjs';

const MOCK_CARDS = [
  {
    id: 'mock-q1',
    type: 'qa',
    front: '这篇内容试图解决的核心问题是什么？',
    back: '它不是在教我们“收藏更多”，而是解决“收藏之后没有消化”的问题：把收藏从囤积行为变成可执行的学习行为。',
  },
  {
    id: 'mock-q2',
    type: 'qa',
    front: '作者给出的核心结论是什么？',
    back: '收藏只是起点。真正有效的学习链路是：先明确问题，再用自己的话提炼，拆成可检验的知识点，最后通过主动回忆和间隔重复完成内化。',
  },
  {
    id: 'mock-q3',
    type: 'qa',
    front: '为什么“反复阅读”不等于“掌握”？',
    back: '反复阅读是被动接收，大脑会误以为熟悉就是理解；主动回忆强迫大脑提取信息，才能暴露哪些地方其实没有真正记住。',
  },
  {
    id: 'mock-q4',
    type: 'qa',
    front: '间隔重复应该怎样安排复习节奏？',
    back: '刚学完遗忘最快，所以第一次复习应尽早，之后按 1、3、7、21 天逐步拉长间隔；薄弱内容提前复习，熟练内容延后复习。',
  },
  {
    id: 'mock-q5',
    type: 'concept',
    front: '费曼技巧',
    back: '尝试用最直白的语言把概念讲给一个零基础的人；讲不清楚的地方，就是自己理解最薄弱的地方。',
  },
  {
    id: 'mock-q6',
    type: 'qa',
    front: '如果只能从这篇内容里带走一点，你会带走什么？',
    back: '把“收藏即拥有”的错觉换成“收藏即待加工”：每次收藏后都追问一句，我打算用它解决什么问题。',
  },
];

function mockPackage({ title, sourceUrl, sourceExcerpt, goal }) {
  return {
    title: title || '未命名内容',
    sourceUrl: sourceUrl || '',
    sourceExcerpt: sourceExcerpt || '',
    goal: goal || '入门',
    coreQuestion: '这篇内容真正想解决的问题是什么，我应该如何把它的方法变成行动？',
    summary:
      '这是一份围绕“把收藏变成可执行学习系统”的学习包：先明确核心问题，再用主动回忆检验理解，最后通过间隔重复和再创作完成知识内化。',
    spectrum: [
      {
        stance: '主张',
        view: '收藏只是输入，不是完成；真正的学习从收藏之后才开始。',
        hint: '对应“收藏瞬间产生已经拥有的错觉”的判断。',
      },
      {
        stance: '方法',
        view: '用“核心问题 + 三句话提炼 + 可检验知识点 + 主动回忆”形成轻量加工链路。',
        hint: '对应从被动囤积转向主动加工的具体路径。',
      },
      {
        stance: '边界',
        view: '再好的方法也需要个人化调整，不同目标和学科适用的节奏不同。',
        hint: '适合作为学习路径的取舍依据。',
      },
    ],
    concepts: [
      {
        term: '收藏错觉',
        definition: '收藏瞬间让人误以为已经拥有知识，实际只是完成了搬运，没有完成理解。',
        example: '收藏一篇学习方法文章后，一个月内没有再打开。',
      },
      {
        term: '主动回忆',
        definition: '不重新阅读资料，而是先尝试从记忆中提取答案，再对照原文校验。',
        example: '合上文章，先回答“作者为什么建议先定义核心问题”。',
      },
      {
        term: '间隔重复',
        definition: '按逐渐拉长的间隔复习，在遗忘临界点唤醒记忆，效率高于集中重复。',
        example: '按 1、3、7、21 天安排同一组卡片的复习。',
      },
      {
        term: '费曼技巧',
        definition: '用最简单的话向零基础的人解释一个概念，讲不通的地方就是薄弱点。',
        example: '把“主动回忆”讲给同学听，发现卡在“为什么提取比阅读更有效”。',
      },
    ],
    cards: MOCK_CARDS,
    scenarios: [
      {
        title: '收藏后的 10 分钟',
        prompt: '你刚刚收藏了一篇高质量回答，接下来 10 分钟你会做什么？',
        checklist: ['先写下它要解决的核心问题', '用自己的话写三句摘要', '拆出两个可检验的知识点'],
      },
      {
        title: '考前复习排序',
        prompt: '离考试还有三天，你有 20 张卡片，其中 5 张一直记不住。你会如何安排？',
        checklist: ['把记不住的 5 张提到今天和明天', '熟练卡片拉长间隔', '每天用主动回忆代替通读'],
      },
      {
        title: '把知识讲给别人',
        prompt: '朋友问你“为什么收藏的内容总是学不进去”，你会怎么回答？',
        checklist: ['用一句话解释收藏错觉', '给出主动回忆和间隔重复两个方法', '举一个自己的例子'],
      },
    ],
    path: [
      {
        step: '第 1 步：粗读定位',
        action: '回答核心问题，写下三句话摘要。',
        duration: '5 分钟',
      },
      {
        step: '第 2 步：拆解卡片',
        action: '把内容拆成 5-8 个可自测的问题。',
        duration: '10 分钟',
      },
      {
        step: '第 3 步：主动回忆',
        action: '合上资料，先回忆再核对，按会/模糊/不会自评。',
        duration: '每天 8 分钟',
      },
      {
        step: '第 4 步：再创作',
        action: '用自己的话写一篇小总结或回答草稿，并标注来源。',
        duration: '15 分钟',
      },
    ],
  };
}

export function extractJson(text) {
  const cleaned = String(text || '')
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('LLM 返回内容不是 JSON');
  return JSON.parse(cleaned.slice(start, end + 1));
}

function buildLearningPrompt({ title, sourceUrl, sourceExcerpt, goal }) {
  return `你是知乎知识炼金炉的资深学习设计专家。请把下面的知乎内容炼成一份可执行的学习包，输出严格 JSON，不要输出额外文字。

要求：
- 用中文表达，观点忠于原文，不编造原文没有的结论。
- 观点光谱 spectrum 3 项，每项含 stance/view/hint。
- 核心概念 concepts 3-5 项，每项含 term/definition/example。
- 复习卡片 cards 5-8 项，每项含 id/type(front=qa 或 concept)/front/back。
- 情景练习 scenarios 3 项，每项含 title/prompt/checklist。
- 学习路径 path 3-5 步，每项含 step/action/duration。
- 另输出 title/coreQuestion/summary。

JSON 结构：
{
  "title": "学习包标题",
  "coreQuestion": "核心问题",
  "summary": "一句话总结",
  "spectrum": [{"stance":"主张/方法/边界","view":"观点","hint":"来源提示"}],
  "concepts": [{"term":"概念","definition":"定义","example":"例子"}],
  "cards": [{"id":"q1","type":"qa","front":"问题","back":"答案"}],
  "scenarios": [{"title":"场景","prompt":"任务","checklist":["检查项"]}],
  "path": [{"step":"第 1 步","action":"动作","duration":"时间"}]
}

学习目标：${goal}
标题：${title}
来源链接：${sourceUrl || '无'}

正文：
${sourceExcerpt}`;
}

export async function callLlm(messages, jsonMode = true) {
  const config = getLlmConfig();
  const payload = {
    model: config.model,
    messages,
    temperature: 0.4,
  };
  if (jsonMode) payload.response_format = { type: 'json_object' };
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`LLM 服务返回 ${response.status}`);
  }
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('LLM 返回内容为空');
  return content;
}

export function isMockMode() {
  const config = getLlmConfig();
  return config.mode === 'mock' || !config.apiKey;
}

export async function generateLearningPackage(input) {
  if (isMockMode()) {
    return {
      ok: true,
      mock: true,
      data: mockPackage(input),
    };
  }
  try {
    const content = await callLlm([
      {
        role: 'system',
        content: '你是知识炼金炉，负责把知乎内容转化为结构化学习包。',
      },
      {
        role: 'user',
        content: buildLearningPrompt(input),
      },
    ]);
    const parsed = extractJson(content);
    return {
      ok: true,
      mock: false,
      data: {
        title: parsed.title || input.title || '学习包',
        sourceUrl: input.sourceUrl || '',
        sourceExcerpt: input.sourceExcerpt || '',
        goal: input.goal || '入门',
        coreQuestion: parsed.coreQuestion || '',
        summary: parsed.summary || '',
        spectrum: Array.isArray(parsed.spectrum) ? parsed.spectrum : [],
        concepts: Array.isArray(parsed.concepts) ? parsed.concepts : [],
        cards: Array.isArray(parsed.cards) ? parsed.cards : [],
        scenarios: Array.isArray(parsed.scenarios) ? parsed.scenarios : [],
        path: Array.isArray(parsed.path) ? parsed.path : [],
      },
    };
  } catch (error) {
    return {
      ok: false,
      mock: false,
      error: error.message || 'LLM 生成失败',
    };
  }
}

export async function generateRecreation(pkg) {
  const sourceLine = pkg.sourceUrl ? `来源：${pkg.sourceUrl}` : '';
  if (isMockMode()) {
    const topConcept = pkg.concepts?.[0]?.term || '主动回忆';
    const weakCount = pkg.reviewPlan?.progress?.weak || 0;
    return {
      ok: true,
      mock: true,
      data: {
        understanding: `读完《${pkg.title}》，我的理解是：它解决的不是“如何收藏”，而是“如何让收藏真正变成能力”。收藏只是搬运，理解、复习和再创作才是加工。\n\n我最想带走的方法是把收藏后的 10 分钟变成加工动作：先写核心问题，再用自己的话提炼，再拆成可以自测的知识点。${topConcept}提醒我，反复阅读容易造成“我都会”的错觉，只有主动回忆才能暴露真正的薄弱点。\n\n下一步我会按 1、3、7、21 天的节奏复习，并把薄弱卡片提前；${weakCount > 0 ? `目前有 ${weakCount} 张卡片需要优先处理。` : '当前卡片进度正常。'}`,
        draft: `收藏夹里的内容为什么总在吃灰？因为它被收藏的那一刻，就被当成了“已经拥有”。\n\n我的做法是给收藏加一条加工链路：\n1. 先写下它解决的核心问题；\n2. 用自己的话写三句摘要；\n3. 拆成可以自测的知识点；\n4. 用主动回忆代替反复阅读；\n5. 按 1、3、7、21 天间隔复习。\n\n学习的终点不是记住，而是能用自己的话讲清楚、写出来。${sourceLine}`,
      },
    };
  }
  try {
    const content = await callLlm(
      [
        {
          role: 'system',
          content: '你是擅长费曼表达的知识创作者，把学习包转成“我的理解”和“知乎回答草稿”，保持真实、克制、不夸大。',
        },
        {
          role: 'user',
          content: `请基于下面的学习包生成 JSON：{"understanding":"300 字以内个人理解","draft":"适合发布在知乎的回答草稿，600 字以内，使用自己的话并标注来源"}。\n\n${JSON.stringify(pkg)}`,
        },
      ],
      true,
    );
    const parsed = extractJson(content);
    return {
      ok: true,
      mock: false,
      data: {
        understanding: parsed.understanding || '',
        draft: parsed.draft || '',
      },
    };
  } catch (error) {
    return {
      ok: false,
      mock: false,
      error: error.message || '再创作生成失败',
    };
  }
}
