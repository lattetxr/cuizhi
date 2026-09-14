import {
  buildCollectionConcepts,
  buildFavlistFramework,
  selectRepresentativeItems,
} from './favlistFramework.mjs';

const SENTENCE_MARKS = /[。！？!?；;：:]/;
const QUESTION_PREFIX = /^(如何|怎么|怎样|为什么|为何|是否|该不该|能不能|可不可以|有没有|有哪些)/;
const GENERIC_SUFFIX = /(的)?(核心概念|基本概念|基础概念|概念释义|名词解释|概念|定义|含义|内涵|基本原理|基础知识)$/;

function sourceUrlFor(pkg, ids = []) {
  const wanted = new Set((ids || []).map(String));
  const match = (pkg.sourceAnswers || []).find((answer) => wanted.has(String(answer.answerId)));
  return match?.url || pkg.sourceUrl || '';
}

export function normalizeConceptTerm(value) {
  let text = String(value || '')
    .replace(/^#+\s*/, '')
    .replace(/^[\d一二三四五六七八九十]+[.、\s\-—）)]*\s*/, '')
    .replace(/[*_`"“”]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // “主动回忆：……”“费曼学习法是指……”只保留前面的名词性概念。
  text = text.split(/[。！？!?；;：:]/)[0].trim();
  text = text.split(/是指|就是指|指的是|就是|在于/)[0].trim();
  text = text.replace(/^(.+?)(为什么|为何)(.+)$/, '$1');
  text = text.replace(/^(.+?)(是否|该不该|能不能|可不可以|有没有)(.+)$/, '$1');

  text = text
    .replace(/^(关于|对于|有关|针对)\s*/, '')
    .replace(/^(什么是|何为|何谓|如何理解|怎样理解|怎么理解|该如何理解)\s*/, '')
    .replace(QUESTION_PREFIX, '')
    .replace(/^(才能|该|应该|应当|可以|能够|有效|科学|快速|系统地?)\s*/, '')
    .replace(/^(请\s*)?(你|我们|大家)?\s*(解释|说明|分析|谈谈|讲一讲|说说|聊聊|理解|掌握|学会|了解|建立|构建|搭建|形成|提升|提高|做好|运用|使用|利用)\s*/, '')
    .replace(/^自己的?|自身的?/, '')
    .replace(/(有效|有用|重要|必要|靠谱|值得)$/, '')
    .replace(GENERIC_SUFFIX, '')
    .replace(/[？?。！!，,、\s]+$/g, '')
    .trim();

  return text;
}

function usableConceptTerm(value) {
  const raw = String(value || '').trim();
  const candidates = [raw, normalizeConceptTerm(raw)];
  for (const candidate of candidates) {
    const term = normalizeConceptTerm(candidate);
    if (!term || SENTENCE_MARKS.test(term)) continue;
    if (term.length > 12) continue;
    if (QUESTION_PREFIX.test(term)) continue;
    if (/(有效|有用|重要|必要|靠谱|值得|怎么办|怎么做)$/.test(term) && term.length > 6) continue;
    if (/^(我|你|他|她|它|我们|你们|他们|这|那|这个|那个)/.test(term)) continue;
    return term;
  }
  return '';
}

function buildBack(concept, exampleLabel) {
  const definition = String(concept.definition || '').replace(/\s+/g, ' ').trim();
  const example = String(concept.example || '').replace(/\s+/g, ' ').trim();
  const lines = ['概念解释', definition];
  if (example) lines.push('', exampleLabel, example);
  return lines.join('\n');
}

export function generateVisualCards(pkg) {
  const map = pkg.mapData || {};
  const sourceAnswers = pkg.sourceAnswers || [];
  let concepts = map.core_concepts || pkg.concepts || [];
  const isCollection = pkg.contentType === 'collection';

  if (isCollection) {
    if (pkg.collectionFramework) {
      const representatives = sourceAnswers.map((answer) => ({ id: answer.answerId }));
      concepts = buildCollectionConcepts(pkg.collectionFramework, representatives);
    } else if (sourceAnswers.length) {
      // 兼容整夹框架上线前保存的旧收藏夹：基于该夹代表回答重建主题，
      // 不再沿用普通单篇内容生成的泛化概念。
      const rawItems = sourceAnswers.map((answer) => ({
        id: answer.answerId,
        Title: answer.title,
        Summary: answer.summary || answer.content || '',
        Url: answer.url,
        Author: { Name: answer.author },
        LikeCount: answer.voteCount,
      }));
      const framework = buildFavlistFramework(rawItems);
      concepts = buildCollectionConcepts(framework, selectRepresentativeItems(rawItems, 6));
    }
  }

  const seen = new Set();
  return concepts
    .map((concept, index) => {
      const term = usableConceptTerm(concept.term || concept.front || concept.name);
      const definition = String(concept.definition || '').replace(/\s+/g, ' ').trim();
      if (!term || !definition || seen.has(term)) return null;
      seen.add(term);
      const exampleLabel = isCollection ? '代表收藏' : '生活化例子';
      const enrichedConcept = { ...concept, definition, example: concept.example };
      const sourceUrl = sourceUrlFor(pkg, concept.source_answer_ids);
      return {
        id: `concept-${index + 1}`,
        type: 'concept',
        stance: isCollection ? '整夹概念' : '核心概念',
        color: '#F5A623',
        front: term,
        term,
        definition,
        example: String(concept.example || '').trim(),
        exampleLabel,
        back: buildBack(enrichedConcept, exampleLabel),
        sourceUrl,
      };
    })
    .filter(Boolean)
    .slice(0, 8);
}

export function sanitizeVisualCards(cards = []) {
  const seen = new Set();
  return cards
    .filter((card) => card?.type === 'concept')
    .map((card) => {
      const term = usableConceptTerm(card.term || card.front || card.name);
      const explanation = String(card.definition || card.back || '').trim();
      if (!term || !explanation || seen.has(term)) return null;
      seen.add(term);
      return { ...card, front: term, term, definition: card.definition || '' };
    })
    .filter(Boolean)
    .slice(0, 8);
}
