import { createAgent } from './agentBase.js';
import { extractTopic } from './mockUtils.js';

const system = (ctx) => `你是知乎知识炼金炉的「费曼陪练」。你通过多轮提问帮助用户真正理解来源回答，并支持生成"我的理解"和"知乎回答草稿"。

规则：
- 只使用 [A1]..[An] 对应来源回答中的内容。
- 多轮对话时优先追问概念边界、反例和用户自己的例子。
- mode 为 draft 或用户要求输出时，才填写 understanding 与 draft。
- 当用户完成3轮对话或要求总结时（done=true），必须生成 evaluation 评分。
- 评分指标包括：理解深度、论据使用、批判性思维、表达清晰度、知识迁移。
- 输出必须严格符合 coach JSON Schema。`;

const buildUser = (ctx, input) => {
  const messages = input.messages || [];
  const history = messages
    .map((message) => `${message.role === 'user' ? '用户' : '陪练'}：${message.content}`)
    .join('\n');
  const userMsgCount = messages.filter((m) => m.role === 'user').length;
  const isEnding = input.mode === 'draft' || userMsgCount >= 3;
  
  return `来源回答：
${ctx.labeledText}

对话目标：${input.mode === 'draft' ? '输出我的理解与回答草稿' : '引导用户理解来源内容'}
对话历史：
${history || '（暂无历史，请从"你从这个回答里最想带走的一点是什么"开始提问）'}

${isEnding ? `【重要】对话已结束，请生成总结和评分。
评分指标（每项0-100分）：
1. 理解深度：用户是否真正理解了核心概念，而非表面复述
2. 论据使用：用户是否能引用来源内容支撑观点
3. 批判性思维：用户是否能提出质疑、反例或不同视角
4. 表达清晰度：用户表达是否条理清晰、易于理解
5. 知识迁移：用户能否将概念应用到新场景或举例说明

请输出 coach JSON：
{
  "reply": "结束语，总结本次对练收获",
  "understanding": "用户的理解总结",
  "draft": "知乎回答草稿（如果用户要求）",
  "done": true,
  "source_answer_ids": [],
  "evaluation": {
    "score": 总分(各项平均),
    "metrics": [
      {"name": "理解深度", "score": 分数, "reason": "评分理由"},
      {"name": "论据使用", "score": 分数, "reason": "评分理由"},
      {"name": "批判性思维", "score": 分数, "reason": "评分理由"},
      {"name": "表达清晰度", "score": 分数, "reason": "评分理由"},
      {"name": "知识迁移", "score": 分数, "reason": "评分理由"}
    ],
    "weak_points": ["薄弱点1", "薄弱点2"],
    "suggestions": ["改进建议1", "改进建议2"]
  }
}` : `请输出 coach JSON：
{
  "reply": "本轮回复",
  "understanding": "",
  "draft": "",
  "done": false,
  "source_answer_ids": ["所有被引用的 answerId"]
}`}`;
};

const COACH_RESPONSES = {
  0: [
    '你提到的这个观点很有意思，能具体说说为什么这样认为吗？',
    '这个角度我之前没想过，你能举一个自己遇到的例子吗？',
    '如果让你用一句话总结这个观点的核心，你会怎么说？',
  ],
  1: [
    '你说得对，那有没有什么情况下这个观点可能不成立？',
    '这个方法听起来不错，但实际操作中你觉得最难的部分是什么？',
    '如果要教给一个完全不懂的人，你会怎么解释？',
  ],
  2: [
    '很好！现在你能把前面说的几个点串起来，形成自己的理解吗？',
    '经过这轮讨论，你对这个问题的看法有没有什么变化？',
    '如果现在要写一篇回答，你会怎么组织你的观点？',
  ],
};

function evaluateConversation(messages, topic) {
  const userMessages = messages.filter((m) => m.role === 'user').map((m) => m.content);
  const fullText = userMessages.join(' ');
  
  const hasCoreConcept = /核心|本质|关键|根本|原因/.test(fullText);
  const hasExample = /比如|例如|举例|像是|就像|举个/.test(fullText);
  const hasCritique = /但是|不过|然而|反面|质疑|不同意|反而/.test(fullText);
  const hasStructure = /第一|首先|其次|另外|总结|总的来说/.test(fullText);
  const hasTransfer = /应用|实践|实际|场景|情况|比如在/.test(fullText);
  
  const scores = {
    '理解深度': hasCoreConcept ? 75 : 55,
    '论据使用': hasExample ? 80 : 50,
    '批判性思维': hasCritique ? 85 : 45,
    '表达清晰度': hasStructure ? 80 : 60,
    '知识迁移': hasTransfer ? 75 : 45,
  };
  
  if (userMessages.length >= 3) {
    Object.keys(scores).forEach((key) => {
      scores[key] = Math.min(100, scores[key] + 10);
    });
  }
  
  const totalScore = Math.round(Object.values(scores).reduce((a, b) => a + b, 0) / 5);
  
  return {
    score: totalScore,
    metrics: Object.entries(scores).map(([name, score]) => ({
      name,
      score,
      reason: getMetricReason(name, score, fullText),
    })),
    weak_points: getWeakPoints(scores),
    suggestions: getSuggestions(scores, topic),
  };
}

function getMetricReason(name, score, text) {
  const reasons = {
    '理解深度': score >= 70
      ? '能够抓住核心概念进行阐述'
      : '建议更深入地探讨问题的本质原因',
    '论据使用': score >= 70
      ? '能用具体例子支撑观点'
      : '建议多引用来源内容或举具体例子',
    '批判性思维': score >= 70
      ? '能提出不同视角或质疑'
      : '建议尝试从反面思考或提出质疑',
    '表达清晰度': score >= 70
      ? '表达条理清晰，易于理解'
      : '建议使用"首先、其次、总结"等结构化表达',
    '知识迁移': score >= 70
      ? '能将概念应用到实际场景'
      : '建议多联系实际场景或举例说明',
  };
  return reasons[name] || '';
}

function getWeakPoints(scores) {
  const weak = [];
  if (scores['理解深度'] < 65) weak.push('核心概念理解不够深入');
  if (scores['论据使用'] < 65) weak.push('缺少具体论据支撑');
  if (scores['批判性思维'] < 65) weak.push('缺乏质疑和多角度思考');
  if (scores['表达清晰度'] < 65) weak.push('表达结构可以更清晰');
  if (scores['知识迁移'] < 65) weak.push('与实际场景的联系不够');
  return weak.length ? weak : ['整体表现不错，继续保持'];
}

function getSuggestions(scores, topic) {
  const suggestions = [];
  if (scores['理解深度'] < 70) suggestions.push(`尝试用自己的话解释「${topic}」的核心原理`);
  if (scores['论据使用'] < 70) suggestions.push('引用来源中的具体观点来支撑你的论述');
  if (scores['批判性思维'] < 70) suggestions.push('思考这个观点可能不成立的情况');
  if (scores['知识迁移'] < 70) suggestions.push('举一个自己或身边人的实际例子');
  return suggestions.length ? suggestions : ['可以尝试写一篇完整的回答来巩固理解'];
}

function mock(input, ctx) {
  const answers = ctx.answers || [];
  const ids = answers.map((answer) => String(answer.answerId));
  const { topic } = extractTopic(answers);
  const messages = input.messages || [];
  const userMessages = messages.filter((m) => m.role === 'user');
  const round = userMessages.length;
  const latest = userMessages.at(-1)?.content || '';
  const wantsDraft = input.mode === 'draft' || /写草稿|生成草稿|输出草稿|写回答|生成回答|总结一下|帮我总结|输出总结/.test(latest);

  if (wantsDraft || round >= 3) {
    const evaluation = evaluateConversation(messages, topic);
    return {
      reply: `非常好！你已经深入思考了「${topic}」这个话题。通过这次对练，你对核心概念有了更清晰的理解。`,
      understanding: `关于「${topic}」，我的核心理解是：需要先深入理解本质，然后在实践中不断验证和调整，同时借助合适的工具提升效率。`,
      draft: `在「${topic}」这个话题上，我认为关键在于找到适合自己的方法。不是照搬别人的经验，而是理解底层逻辑后，结合自己的实际情况进行调整。通过主动实践、及时反馈、持续优化，才能真正掌握。`,
      done: true,
      source_answer_ids: ids,
      evaluation,
    };
  }

  const responsePool = COACH_RESPONSES[Math.min(round, 2)];
  const reply = responsePool[round % responsePool.length];

  return {
    reply: `关于「${topic}」，${reply}`,
    understanding: '',
    draft: '',
    done: false,
    source_answer_ids: ids,
  };
}

export const coachAgent = createAgent({
  name: 'coach',
  schemaName: 'coach',
  system,
  buildUser,
  mock,
});
