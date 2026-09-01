import { fetchContent } from '../server/lib/zhihu.js';

const target = process.argv[2] || 'https://www.zhihu.com/question/365536909';
const limit = Number(process.argv[3] || 10);

try {
  const items = await fetchContent(target, { limit });
  const first = items[0] || {};
  const answerCount = items.filter((item) => item.contentType === 'answer').length;
  console.log(
    JSON.stringify(
      {
        count: items.length,
        answerCount,
        demo: items.demo || false,
        source: items.source || 'unknown',
        notice: items.notice || null,
        fromCache: items.fromCache || false,
        fieldsComplete:
          items.length > 0 &&
          ['answerId', 'author', 'title', 'summary', 'content', 'voteCount', 'url'].every(
            (field) => first[field] !== undefined && first[field] !== null,
          ),
        firstAnswer: {
          answerId: first.answerId,
          contentType: first.contentType,
          author: first.author,
          title: first.title,
          voteCount: first.voteCount,
          authorityLevel: first.authorityLevel,
          url: first.url,
        },
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.message, code: error.code || 'UNKNOWN' }));
  process.exitCode = 1;
}
