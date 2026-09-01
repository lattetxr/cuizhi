import { createAgent } from './agentBase.js';
import { extractTopic, pickIds } from './mockUtils.js';

const system = (ctx) => `你是知乎知识炼金炉的「认知地图」构建器。你基于来源回答和观点光谱，输出核心概念、学习路径、常见误区与应用场景。

规则：
- 只使用来源回答与观点光谱中的内容，禁止编造。
- 所有 source_answer_ids 必须是 [A1]..[An] 对应的 answerId。
- 学习路径要能直接执行，误区要纠正具体说法，场景要贴近学生与职场新人。
- 输出必须严格符合 map JSON Schema。`;

const buildUser = (ctx, input) => `来源回答：
${ctx.labeledText}

已有观点光谱：
${JSON.stringify(input.viewpoint || {}, null, 2)}

请输出 map JSON，结构为：
{
  "core_concepts": [{"term": "概念", "definition": "定义", "example": "例子", "source_answer_ids": ["answerId"]}],
  "learning_path": [{"step": "第 1 步", "action": "动作", "duration": "预计时间", "source_answer_ids": ["answerId"]}],
  "misconceptions": [{"misconception": "误区", "correction": "纠正", "source_answer_ids": ["answerId"]}],
  "application_scenarios": [{"scenario": "场景", "practice": "做法", "source_answer_ids": ["answerId"]}],
  "source_answer_ids": ["所有被引用的 answerId"]
}

core_concepts 至少 3 个，learning_path 至少 3 步，misconceptions 至少 2 个，application_scenarios 至少 2 个。`;

function mock(input, ctx) {
  const answers = ctx.answers || [];
  const ids = answers.map((answer) => String(answer.answerId));
  const { topic, keywords } = extractTopic(answers);
  const idOf = (index) => (ids[index % Math.max(1, ids.length)] || ids[0] || 'answer-1');

  return {
    core_concepts: [
      {
        term: topic,
        definition: `关于「${topic}」的核心知识和方法论。`,
        example: `在实际场景中应用${topic}的方法。`,
        source_answer_ids: [idOf(0)],
      },
      {
        term: '主动学习',
        definition: '主动参与学习过程，而非被动接收信息。',
        example: `通过提问、讨论、实践来深化对${topic}的理解。`,
        source_answer_ids: [idOf(1)],
      },
      {
        term: '反馈循环',
        definition: '通过实践结果调整学习策略。',
        example: `在${topic}的实践中不断复盘和优化方法。`,
        source_answer_ids: [idOf(2)],
      },
    ],
    learning_path: [
      {
        step: '第 1 步：明确目标',
        action: `定义你在${topic}上想达到的具体目标。`,
        duration: '5 分钟',
        source_answer_ids: [idOf(0)],
      },
      {
        step: '第 2 步：获取核心知识',
        action: `从来源回答中提取${topic}的关键要点。`,
        duration: '10 分钟',
        source_answer_ids: [idOf(1)],
      },
      {
        step: '第 3 步：动手实践',
        action: `找一个具体场景尝试应用${topic}的方法。`,
        duration: '30 分钟',
        source_answer_ids: [idOf(2)],
      },
      {
        step: '第 4 步：复盘优化',
        action: `总结实践中的收获和不足，调整后续策略。`,
        duration: '10 分钟',
        source_answer_ids: [idOf(0)],
      },
    ],
    misconceptions: [
      {
        misconception: `${topic}看一遍就能掌握。`,
        correction: `${topic}需要反复实践和思考才能真正内化。`,
        source_answer_ids: [idOf(0)],
      },
      {
        misconception: `${topic}有标准答案。`,
        correction: `${topic}因人而异，需要找到适合自己的方法。`,
        source_answer_ids: [idOf(1)],
      },
    ],
    application_scenarios: [
      {
        scenario: `学习${topic}的日常练习`,
        practice: `每天花15分钟实践${topic}的核心方法，记录进展。`,
        source_answer_ids: [idOf(2)],
      },
      {
        scenario: `团队协作中应用${topic}`,
        practice: `与同事讨论${topic}的实践经验，互相学习。`,
        source_answer_ids: [idOf(0)],
      },
    ],
    source_answer_ids: ids,
  };
}

export const mapAgent = createAgent({
  name: 'map',
  schemaName: 'map',
  system,
  buildUser,
  mock,
});
