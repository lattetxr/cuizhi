import { callLlm, extractJson, isMockMode } from '../../lib/llm.mjs';
import { validateSchema } from '../../agents/schemas.js';

export { isMockMode };

export async function callStructuredJson({
  system,
  user,
  schemaName,
  mockData,
  maxRepairRetries = 1,
}) {
  if (isMockMode()) {
    return {
      ok: true,
      mock: true,
      data: typeof mockData === 'function' ? mockData() : mockData,
    };
  }
  let currentUser = user;
  for (let attempt = 0; attempt <= maxRepairRetries; attempt += 1) {
    const content = await callLlm(
      [
        { role: 'system', content: system },
        { role: 'user', content: currentUser },
      ],
      true,
    );
    let parsed;
    try {
      parsed = extractJson(content);
    } catch (error) {
      if (attempt < maxRepairRetries) {
        currentUser = `${user}\n\n上次输出不是合法 JSON：${error.message}。请只输出符合 schema 的 JSON。`;
        continue;
      }
      return { ok: false, mock: false, error: error.message };
    }
    const check = validateSchema(schemaName, parsed);
    if (check.valid) {
      return { ok: true, mock: false, data: parsed };
    }
    if (attempt < maxRepairRetries) {
      const detail = check.errors
        .map((item) => `${item.instancePath || '/'} ${item.message}`)
        .slice(0, 6)
        .join('；');
      currentUser = `${user}\n\n上次输出未通过 JSON Schema 校验：${detail}。请严格按 schema 重新输出，只返回 JSON。`;
    } else {
      return {
        ok: false,
        mock: false,
        error: `${schemaName} 输出未通过 JSON Schema 校验`,
        errors: check.errors,
      };
    }
  }
  return { ok: false, mock: false, error: `${schemaName} 生成失败` };
}
