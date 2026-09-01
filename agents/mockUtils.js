const STOP_WORDS = new Set([
  '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一', '一个',
  '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好',
  '自己', '这', '他', '她', '它', '们', '那', '里', '为', '什么', '怎么', '如何',
  '为什么', '可以', '应该', '需要', '想', '做', '用', '把', '被', '让', '给',
  '从', '对', '与', '而', '但', '或', '如果', '因为', '所以', '虽然', '但是',
  '这个', '那个', '这些', '那些', '什么', '怎样', '如何', '为何', '为什么',
]);

export function extractTopic(answers) {
  const isGenericTitle = /^(我的学习内容|未命名|知乎回答|学习包)$/.test(answers[0]?.title || '');
  
  let topic = '';
  if (!isGenericTitle && answers[0]?.title) {
    topic = answers[0].title.replace(/[？?！!。，,\s]+$/, '');
  }
  
  if (!topic) {
    const content = answers[0]?.content || answers[0]?.summary || '';
    const match = content.match(/^(?:如何|怎样|怎么|为什么|为何|什么是|是什么)[^？?！!。，]{2,20}/);
    if (match) {
      topic = match[0].replace(/[？?！!。，,\s]+$/, '');
    }
  }
  
  if (!topic) {
    const content = answers[0]?.content || answers[0]?.summary || '';
    const cleaned = content.replace(/[，。！？、；：""''（）【】《》\s]+/g, ' ').trim();
    topic = cleaned.slice(0, 15) || '这个话题';
  }
  
  return { topic, keywords: [topic] };
}

export function pickIds(answers, count = 2) {
  const ids = answers.map((a) => String(a.answerId));
  const result = [];
  for (let i = 0; i < count; i++) {
    result.push(ids[i % ids.length] || ids[0] || 'answer-1');
  }
  return result;
}
