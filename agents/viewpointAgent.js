import { createAgent } from './agentBase.js';
import { extractTopic, pickIds } from './mockUtils.js';

const system = (ctx) => `你是知乎知识炼金炉的「观点光谱」分析器。你的任务是把一组来源回答按核心立场分类，输出观点光谱，并判断内容类型。

规则：
- 只依据下方「来源回答」中的内容，禁止编造原文没有的观点。
- 回答必须使用 [A1]..[An] 这样的可溯源编号；每个立场、论据的 source_answer_ids 必须引用对应回答的 answerId。
- 至少区分 3 种立场；共识点必须是多个回答共同认可的内容；分歧本质要说明分歧发生在哪个环节。
- content_type 必须判断为以下之一：knowledge（知识科普/方法论，教概念和做法）、debate（观点争议，存在该不该/谁对等立场对立）、exam（备考/考试/时间规划）、collection（收藏夹批量内容）。
- 若 content_type 为 debate，立场必须是恰好 3 个：对立两派 + 中立派，立场名用大众化表述（如「应该裸辞」「不应该裸辞」「中立」这类对立+中立的命名）。
- 输出必须严格符合 viewpoint JSON Schema。`;

const buildUser = (ctx) => `请分析以下 ${ctx.answers.length} 条来源回答：

${ctx.labeledText}

请输出 viewpoint JSON，结构为：
{
  "content_type": "knowledge|debate|exam|collection 之一（knowledge=知识科普/方法论，debate=观点争议，exam=备考/考试/时间规划，collection=收藏夹批量）",
  "summary": "整体观点概括",
  "stances": [
    {"stance_name": "立场名", "stance_summary": "立场概述", "arguments": ["论据1", "论据2"], "source_answer_ids": ["对应的 answerId"]}
  ],
  "consensus": ["共识点"],
  "divergence": "分歧本质",
  "source_answer_ids": ["所有被引用的 answerId"]
}

至少 3 个 stance；每个 stance 至少 1 条论据；source_answer_ids 只能使用上方回答中的 answerId。`;

function detectContentType(answers) {
  const text = answers
    .map((a) => `${a.title || ''}${a.summary || ''}${a.content || ''}`)
    .join(' ');
  if (/考试|备考|期末|冲刺|复习计划|\d+\s*天(后|内)/.test(text)) return 'exam';
  if (/该不该|是不是|正方|反方|支持|反对|争议|裸辞/.test(text)) return 'debate';
  return 'knowledge';
}

function mock(input, ctx) {
  const answers = ctx.answers || [];
  const ids = answers.map((answer) => String(answer.answerId));
  const { topic, keywords } = extractTopic(answers);
  const idOf = (index) => (ids[index % Math.max(1, ids.length)] || ids[0] || 'answer-1');

  const stances = [
    {
      stance_name: `深度理解派`,
      stance_summary: `${topic}需要先深入理解核心概念，不急于行动。`,
      arguments: [
        `理解「${topic}」的本质才能避免表面学习`,
        `用自己的话复述核心观点是检验理解的最好方式`,
      ],
      source_answer_ids: [idOf(0), idOf(1)],
    },
    {
      stance_name: `实践优先派`,
      stance_summary: `${topic}的关键是立即行动，在实践中验证和调整。`,
      arguments: [
        `光想不做永远学不会，${topic}需要动手实践`,
        `先做再优化，比等待完美方案更有效`,
      ],
      source_answer_ids: [idOf(1), idOf(2)],
    },
    {
      stance_name: `工具效率派`,
      stance_summary: `用合适的工具和方法提升${topic}的效率。`,
      arguments: [
        `好的工具能事半功倍，减少重复劳动`,
        `建立系统化的学习流程比零散努力更有效`,
      ],
      source_answer_ids: [idOf(2), idOf(0)],
    },
  ];

  return {
    content_type: detectContentType(answers),
    summary: `关于「${topic}」，回答者形成了三种主要立场：深度理解、实践优先、工具效率。`,
    stances,
    consensus: [
      `${topic}需要主动投入，不能只停留在表面`,
      `持续反馈和调整是提升的关键`,
    ],
    divergence: `分歧在于${topic}的切入点：先理解、先行动、还是先选工具。`,
    source_answer_ids: ids,
  };
}

export const viewpointAgent = createAgent({
  name: 'viewpoint',
  schemaName: 'viewpoint',
  system,
  buildUser,
  mock,
});
