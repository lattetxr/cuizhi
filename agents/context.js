function truncate(value, maxLength) {
  const text = String(value || '');
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

export function buildSourceContext(answers, { maxPerAnswer = 1200, maxTotal = 16000 } = {}) {
  const items = (answers || []).slice(0, 8);
  const sourceMap = {};
  const lines = [];
  let used = 0;
  items.forEach((answer, index) => {
    const label = `[A${index + 1}]`;
    const answerId = String(answer.answerId || answer.id || label);
    sourceMap[label] = answerId;
    const summary = truncate(answer.summary || '', 300);
    const content = truncate(answer.content || answer.summary || '', maxPerAnswer);
    const block = `${label} answerId=${answerId}
作者：${answer.author || '知乎用户'}　赞同：${answer.voteCount ?? 0}　权威度：${answer.authorityLevel ?? 0}
标题：${answer.title || ''}
摘要：${summary}
正文：${content}`;
    const budget = maxTotal - used;
    lines.push(block.slice(0, Math.max(200, budget)));
    used += Math.min(block.length, budget);
    if (used >= maxTotal) return;
  });
  return {
    labeledText: lines.join('\n\n'),
    sourceMap,
    answers: items,
  };
}

export function sourceIdsFromLabels(sourceMap, labels) {
  return [...new Set((labels || []).map((label) => sourceMap[label]).filter(Boolean))];
}

export function allowedSourceIds(answers) {
  return new Set(
    (answers || []).map((answer) => String(answer.answerId || answer.id || '')).filter(Boolean),
  );
}

export function normalizeAnswers(answers) {
  return (answers || []).map((answer, index) => ({
    answerId: String(answer.answerId || answer.id || `answer-${index + 1}`),
    contentType: answer.contentType || 'answer',
    author: answer.author || '知乎用户',
    title: answer.title || '',
    summary: answer.summary || '',
    content: answer.content || answer.summary || '',
    voteCount: Number(answer.voteCount || 0),
    commentCount: Number(answer.commentCount || 0),
    authorityLevel: Number(answer.authorityLevel || 0),
    relevanceScore: Number(answer.relevanceScore || 0),
    url: answer.url || '',
    publishedAt: answer.publishedAt || null,
  }));
}

export function collectSourceIds(data) {
  const ids = new Set();
  const walk = (value) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (Array.isArray(value.source_answer_ids)) {
      value.source_answer_ids.forEach((id) => ids.add(String(id)));
    }
    Object.values(value).forEach(walk);
  };
  walk(data);
  return [...ids];
}
