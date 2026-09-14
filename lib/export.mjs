function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function markdownBlock(title, lines) {
  const body = lines.filter(Boolean).join('\n');
  return body ? `## ${title}\n\n${body}\n` : '';
}


function collectionFrameworkMarkdown(pkg) {
  const framework = pkg.collectionFramework;
  if (!framework) return '';
  const lines = [framework.summary, ''];
  lines.push('### 主题分布');
  for (const category of framework.categories || []) {
    const percent = Math.round((category.ratio || 0) * 100);
    lines.push(`- **${category.name}**：${category.count} 条（${percent}%）`);
    for (const item of (category.items || []).slice(0, 2)) {
      lines.push(`  - [${item.title}](${item.url || '#'}) · ${item.author} · ${item.roleName}`);
    }
  }
  lines.push('', '### 内容角色');
  lines.push((framework.roles || []).map((role) => `${role.name} ${role.count} 条`).join('；'));
  lines.push('', '### 推荐消化路径');
  (framework.path || []).forEach((step, index) => {
    lines.push(`${index + 1}. **${step.title}**（${step.duration}）：${step.action}`);
  });
  return markdownBlock('收藏夹知识框架', lines);
}

function collectionFrameworkHtml(pkg) {
  const framework = pkg.collectionFramework;
  if (!framework) return '';
  const categories = (framework.categories || []).map((category) => `
    <li><strong>${escapeHtml(category.name)}</strong>：${category.count} 条（${Math.round((category.ratio || 0) * 100)}%）
      <ul>${(category.items || []).slice(0, 2).map((item) => `<li><a href="${escapeHtml(item.url || '#')}">${escapeHtml(item.title)}</a> · ${escapeHtml(item.author)} · ${escapeHtml(item.roleName)}</li>`).join('')}</ul>
    </li>`).join('');
  const roles = (framework.roles || []).map((role) => `<span>${escapeHtml(role.name)} ${role.count} 条</span>`).join(' ');
  const path = (framework.path || []).map((step) => `<li><strong>${escapeHtml(step.title)}</strong><br><small>${escapeHtml(step.duration)}</small><p>${escapeHtml(step.action)}</p></li>`).join('');
  return `
  <section>
    <h2>收藏夹知识框架</h2>
    <p>${escapeHtml(framework.summary)}</p>
    <h3>主题分布</h3><ul>${categories}</ul>
    <h3>内容角色</h3><p>${roles}</p>
    <h3>推荐消化路径</h3><ol>${path}</ol>
  </section>`;
}

export function toMarkdown(pkg) {
  const sections = [];
  sections.push(`# ${pkg.title}`);
  sections.push('');
  sections.push(`> ${pkg.summary || ''}`);
  sections.push('');
  if (pkg.sourceUrl) {
    sections.push(`来源：${pkg.sourceUrl}`);
    sections.push('');
  }
  sections.push(collectionFrameworkMarkdown(pkg));
  sections.push(markdownBlock('核心问题', [`${pkg.coreQuestion || ''}`]));
  sections.push(
    markdownBlock(
      '观点光谱',
      (pkg.spectrum || []).map(
        (item) => `- ${item.stance}：${item.view}${item.hint ? `（${item.hint}）` : ''}`,
      ),
    ),
  );
  sections.push(
    markdownBlock(
      '核心概念',
      (pkg.concepts || []).map(
        (item) => `- **${item.term}**：${item.definition}\n  - 例子：${item.example}`,
      ),
    ),
  );
  sections.push(
    markdownBlock(
      '复习卡片',
      (pkg.cards || []).map((card) => `**Q：${card.front}**\n\nA：${card.back}`),
    ),
  );
  sections.push(
    markdownBlock(
      '情景练习',
      (pkg.scenarios || []).map(
        (item) =>
          `**${item.title}**\n${item.prompt}\n${(item.checklist || [])
            .map((check) => `- [ ] ${check}`)
            .join('\n')}`,
      ),
    ),
  );
  sections.push(
    markdownBlock(
      '学习路径',
      (pkg.path || []).map((item) => `- **${item.step}**：${item.action}（${item.duration}）`),
    ),
  );
  if (pkg.recreation) {
    sections.push(markdownBlock('我的理解', [`${pkg.recreation.understanding || ''}`]));
    sections.push(markdownBlock('回答草稿', [`${pkg.recreation.draft || ''}`]));
  }
  return sections.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

export function toHtml(pkg) {
  const cards = (pkg.cards || [])
    .map(
      (card) =>
        `<article class="export-card"><h4>${escapeHtml(card.front)}</h4><p>${escapeHtml(
          card.back,
        )}</p></article>`,
    )
    .join('');
  const concepts = (pkg.concepts || [])
    .map(
      (item) =>
        `<li><strong>${escapeHtml(item.term)}</strong>：${escapeHtml(
          item.definition,
        )}<br><small>例：${escapeHtml(item.example)}</small></li>`,
    )
    .join('');
  const spectrum = (pkg.spectrum || [])
    .map(
      (item) =>
        `<li><strong>${escapeHtml(item.stance)}</strong>：${escapeHtml(item.view)}${
          item.hint ? `<br><small>${escapeHtml(item.hint)}</small>` : ''
        }</li>`,
    )
    .join('');
  const recreation = pkg.recreation
    ? `<section><h3>我的理解</h3><p>${escapeHtml(pkg.recreation.understanding)}</p><h3>回答草稿</h3><p>${escapeHtml(
        pkg.recreation.draft,
      )}</p></section>`
    : '';
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(pkg.title)} - 淬知</title>
  <style>
    body{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;line-height:1.7;color:#1f2933;background:#f7f8fa;margin:0;padding:32px 16px}
    main{max-width:760px;margin:0 auto;background:#fff;border:1px solid #e4e7eb;border-radius:8px;padding:32px}
    h1{margin-top:0}h2{margin-top:32px;border-bottom:1px solid #e4e7eb;padding-bottom:8px}
    li{margin:8px 0}.export-card{border:1px solid #e4e7eb;border-radius:8px;padding:14px;margin:12px 0}
    a{color:#0f766e}blockquote{color:#52606d;border-left:3px solid #0f766e;margin:12px 0;padding:4px 12px}
    section span{display:inline-block;margin:4px 8px 4px 0;padding:3px 9px;border-radius:999px;background:#eef7f6;font-size:13px}
  </style>
</head>
<body><main>
  <h1>${escapeHtml(pkg.title)}</h1>
  <blockquote>${escapeHtml(pkg.summary || '')}</blockquote>
  ${pkg.sourceUrl ? `<p>来源：<a href="${escapeHtml(pkg.sourceUrl)}">${escapeHtml(pkg.sourceUrl)}</a></p>` : ''}
  ${collectionFrameworkHtml(pkg)}
  <h2>核心问题</h2><p>${escapeHtml(pkg.coreQuestion || '')}</p>
  <h2>观点光谱</h2><ul>${spectrum}</ul>
  <h2>核心概念</h2><ul>${concepts}</ul>
  <h2>复习卡片</h2>${cards}
  ${recreation}
</main></body>
</html>`;
}
