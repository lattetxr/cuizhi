import { viewpointAgent } from './viewpointAgent.js';
import { mapAgent } from './mapAgent.js';
import { cardAgent } from './cardAgent.js';
import { coachAgent } from './coachAgent.js';
import {
  allowedSourceIds,
  buildSourceContext,
  normalizeAnswers,
} from './context.js';
import { fetchContent } from '../server/lib/zhihu.js';

// 管线各阶段的真实进度锚点：前端据此渲染进度条，保证与 LLM 实际耗时一致
export const PIPELINE_PHASES = {
  prepare: { phase: 'prepare', progress: 8, step: 'quench', status: '正在读取来源内容' },
  viewpointMap: { phase: 'viewpoint-map', progress: 42, step: 'forge', status: '正在梳理观点与结构' },
  cards: { phase: 'cards', progress: 72, step: 'solidify', status: '正在生成复习卡片' },
  verify: { phase: 'verify', progress: 88, step: 'verify', status: '正在查漏补缺' },
};

function sanitizeIds(data, allowed) {
  if (Array.isArray(data)) {
    return data.map((item) => sanitizeIds(item, allowed));
  }
  if (data && typeof data === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(data)) {
      if (key === 'source_answer_ids' && Array.isArray(value)) {
        result[key] = value.filter((id) => allowed.has(String(id)));
      } else {
        result[key] = sanitizeIds(value, allowed);
      }
    }
    return result;
  }
  return data;
}

export async function runPipeline({ answers, options = {}, prefilled = {}, onProgress } = {}) {
  const normalized = normalizeAnswers(answers);
  if (!normalized.length) {
    throw new Error('pipeline 至少需要 1 条优质回答');
  }
  const allowed = allowedSourceIds(normalized);
  const emit = (phase) => {
    if (typeof onProgress === 'function') onProgress(phase);
  };
  const degraded = {};
  const notices = [];

  async function runStep(name, agent, input) {
    try {
      const result = await agent.run(input);
      if (!result.ok) throw new Error(result.error || `${name} 生成失败`);
      return sanitizeIds(result.data, allowed);
    } catch (error) {
      degraded[name] = error.message || String(error);
      notices.push(`${name} 已降级为占位结果`);
      const ctx = buildSourceContext(input.answers || normalized);
      return sanitizeIds(
        agent.mock({ ...input, _degraded: true }, ctx),
        allowed,
      );
    }
  }

  // viewpoint 与 map 并行：map 仅把 viewpoint 当作可选上下文（缺省 {}），
  // 两者都只以来源回答为准，并行可省一次 LLM 往返。
  // prefilled 可注入内置结果（如内置数据集的认知地图/卡片），直接跳过对应 LLM 调用。
  const viewpointPromise = prefilled.viewpoint
    ? Promise.resolve(prefilled.viewpoint)
    : runStep('viewpoint', viewpointAgent, { answers: normalized });
  const mapPromise = prefilled.map
    ? Promise.resolve(sanitizeIds(prefilled.map, allowed))
    : runStep('map', mapAgent, {
        answers: normalized,
        viewpoint: prefilled.viewpoint || {},
      });

  emit(PIPELINE_PHASES.viewpointMap);
  const [viewpoint, map] = await Promise.all([viewpointPromise, mapPromise]);
  emit(PIPELINE_PHASES.cards);
  const cards = prefilled.cards
    ? sanitizeIds(prefilled.cards, allowed)
    : await runStep('cards', cardAgent, { answers: normalized, map });
  emit(PIPELINE_PHASES.verify);

  return {
    ok: true,
    degraded,
    notices,
    outputs: {
      viewpoint,
      map,
      cards,
    },
    sourceAnswers: normalized,
  };
}

export async function runPipelineFromSource(questionIdOrUrl, options = {}) {
  const { fetchOptions, onProgress } = options;
  const emit = (phase) => {
    if (typeof onProgress === 'function') onProgress(phase);
  };
  emit(PIPELINE_PHASES.prepare);
  const answers = await fetchContent(questionIdOrUrl, fetchOptions || {});
  const result = await runPipeline({ answers, onProgress });
  return {
    ...result,
    source: {
      demo: answers.demo || false,
      notice: answers.notice || null,
      count: answers.length,
    },
  };
}

export async function runCoachTurn({ answers, messages = [], mode = 'chat' }) {
  const result = await coachAgent.run({ answers, messages, mode });
  if (!result.ok) {
    const ctx = buildSourceContext(answers);
    return {
      ok: true,
      degraded: true,
      data: coachAgent.mock({ answers, messages, mode }, ctx),
      mock: true,
    };
  }
  return result;
}
