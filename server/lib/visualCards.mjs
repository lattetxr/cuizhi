function sourceUrlFor(pkg, ids = []) {
  const wanted = new Set((ids || []).map(String));
  const match = (pkg.sourceAnswers || []).find((answer) =>
    wanted.has(String(answer.answerId)),
  );
  return match?.url || pkg.sourceUrl || '';
}

function applicability(stanceName) {
  const name = String(stanceName || '');
  if (name.includes('加工')) return '适合刚收藏、愿意立即行动的学习者';
  if (name.includes('筛选')) return '适合信息过载、需要控制输入的学习者';
  if (name.includes('工具')) return '适合收藏量大、需要规模化处理的学习者';
  return '适合大多数学习者';
}

export function generateVisualCards(pkg) {
  const cards = [];
  const viewpoint = pkg.viewpoint || {};
  const map = pkg.mapData || {};
  const stances = viewpoint.stances || pkg.spectrum || [];
  const concepts = map.core_concepts || pkg.concepts || [];
  const path = map.learning_path || pkg.path || [];
  const misconceptions = map.misconceptions || [];
  const scenarios = map.application_scenarios || pkg.scenarios || [];

  concepts.slice(0, 5).forEach((concept, index) => {
    const sourceUrl = sourceUrlFor(pkg, concept.source_answer_ids);
    cards.push({
      id: `concept-${index + 1}`,
      type: 'concept',
      stance: '中立',
      color: '#8E8E93',
      front: concept.term,
      back: `一句话定义\n${concept.definition}\n\n例子\n${concept.example || '无'}`,
      sourceUrl,
    });
  });

  const centerConcepts = concepts.slice(0, 3);
  centerConcepts.forEach((concept, index) => {
    const branches = (path.slice(index * 2, index * 2 + 3) || []).map((step, branchIndex) => ({
      label: `${concept.term} · 分支${branchIndex + 1}`,
      detail: `${step.step}：${step.action}（${step.duration}）`,
    }));
    if (branches.length < 3) {
      for (let i = branches.length; i < 3; i += 1) {
        branches.push({
          label: `${concept.term} · 分支${i + 1}`,
          detail: `围绕「${concept.term}」做一次主动回忆与输出。`,
        });
      }
    }
    cards.push({
      id: `mindmap-${index + 1}`,
      type: 'mindmap',
      stance: '知识图谱',
      color: '#0084FF',
      center: concept.term,
      branches,
      front: `思维导图\n${concept.term}`,
      back: branches.map((branch) => `${branch.label}\n${branch.detail}`).join('\n\n'),
      sourceUrl: sourceUrlFor(pkg, concept.source_answer_ids),
    });
  });

  const extraConcepts = concepts.slice(3, 6);
  extraConcepts.forEach((concept, index) => {
    cards.push({
      id: `concept-extra-${index + 1}`,
      type: 'concept',
      stance: '中立',
      color: '#0084FF',
      front: concept.term,
      back: `一句话定义\n${concept.definition}\n\n例子\n${concept.example || '无'}`,
      sourceUrl: sourceUrlFor(pkg, concept.source_answer_ids),
    });
  });

  misconceptions.slice(0, 3).forEach((item, index) => {
    cards.push({
      id: `concept-misconception-${index + 1}`,
      type: 'concept',
      stance: '中立',
      color: '#0084FF',
      front: item.misconception,
      back: `一句话定义\n${item.correction}`,
      sourceUrl: sourceUrlFor(pkg, item.source_answer_ids),
    });
  });

  return cards.slice(0, 16);
}
