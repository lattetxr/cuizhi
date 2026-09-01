const MAX_SOURCE_LENGTH = 14000;

export const SAMPLE_SOURCE = {
  title: '如何让收藏夹不再吃灰：把收藏变成可执行的学习系统',
  url: 'https://www.zhihu.com/question/365536909',
  text: `收藏夹吃灰的本质，是我们在收藏的瞬间产生了“我已经拥有了”的错觉。我们以为把文章存下来，知识就属于自己，实际上只是把它从眼前挪到了一个再也打不开的角落。

真正有效的做法，是把收藏当成待消化的输入，而不是完成的学习。收藏之后，应该立刻进入一条轻量的加工链路：先回答“这篇文章解决什么问题”，再用自己的话写三句话摘要，然后拆出两到三个可以被检验的知识点，最后安排一次主动回忆。

主动回忆比反复阅读更有效。看书时觉得“我都会”，合上书却想不起来，是因为阅读是被动接收，而回忆是主动提取。卡片学习、自我提问、费曼讲解，都是把知识从“见过”变成“能用”的方式。

间隔重复则解决遗忘。大脑在刚学完时遗忘最快，所以第一次复习应该安排在一天以内，之后是三天、七天、二十一天。越薄弱的内容越要提前复习，已经掌握的内容则可以拉长间隔，把有限的时间留给真正记不住的部分。

学习的终点不是记住，而是再创造。当你能够用自己的话把知识讲清楚，能够回答一个陌生人的追问，能够把它写进自己的回答里，这条内容才真正变成了你的能力。收藏只是起点，理解、复习、输出才是炼金的过程。`,
};

function decodeEntities(text) {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTitle(html) {
  const og = html.match(/property="og:title"\s+content="([^"]+)"/i);
  if (og) return decodeEntities(og[1]).trim();
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (title) return decodeEntities(stripHtml(title[1]));
  return '知乎内容';
}

async function fetchUrlText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!response.ok) throw new Error(`页面返回 ${response.status}`);
    const html = await response.text();
    const article = html.match(/<article[\s\S]*?<\/article>/i)?.[0] || html;
    const text = decodeEntities(stripHtml(article)).slice(0, MAX_SOURCE_LENGTH);
    if (text.length < 40) throw new Error('未能从页面提取正文');
    return { title: extractTitle(html), text, sourceUrl: url };
  } finally {
    clearTimeout(timer);
  }
}

export async function resolveSource({ url = '', text = '' }) {
  const pasted = String(text || '').trim();
  if (pasted.length >= 40) {
    return {
      title: '粘贴内容',
      text: pasted.slice(0, MAX_SOURCE_LENGTH),
      sourceUrl: String(url || '').trim(),
    };
  }
  if (url && /^https?:\/\//i.test(url)) {
    return fetchUrlText(url);
  }
  throw new Error('请粘贴正文或输入有效链接');
}

export function summarizeSource(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length > 120 ? `${clean.slice(0, 120)}...` : clean;
}
