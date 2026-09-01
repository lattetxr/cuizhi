import 'dotenv/config';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPipeline } from '../agents/pipeline.js';
import { validateSchema } from '../agents/schemas.js';
import { isMockMode } from '../lib/llm.mjs';
import { NUOCI_ANSWERS, NUOCI_META } from '../server/lib/nuociDataset.js';
import { EXISTENCE_ANSWER, EXISTENCE_CARDS } from '../server/lib/existenceDataset.js';
import { KAOYAN_ANSWER, KAOYAN_MAP } from '../server/lib/kaoyanDataset.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, 'server', 'lib', 'baked');

const EXISTENCE_CARD_IDS = EXISTENCE_CARDS.map((card) => card.id);
const EXISTENCE_PLAN = [
  { day: 1, action: '全部卡片主动回忆，薄弱卡标「不会」', card_ids: EXISTENCE_CARD_IDS },
  { day: 3, action: '复习前 4 张，重点处理薄弱卡', card_ids: EXISTENCE_CARD_IDS.slice(0, 4) },
  { day: 7, action: '复习全部卡片并做一次自测', card_ids: EXISTENCE_CARD_IDS },
  { day: 21, action: '输出自己的理解与回答草稿', card_ids: EXISTENCE_CARD_IDS.slice(2, 6) },
];
const EXISTENCE_PREFILLED_CARDS = {
  cards: { cards: EXISTENCE_CARDS, review_schedule: { intervals: [1, 3, 7, 21], plan: EXISTENCE_PLAN }, source_answer_ids: ['175862602'] },
};
const KAOYAN_PREFILLED_MAP = { map: KAOYAN_MAP };

const cases = [
  {
    name: 'existence',
    answers: [EXISTENCE_ANSWER],
    prefilled: EXISTENCE_PREFILLED_CARDS,
    // 保留已精修的卡片
    override: { cards: EXISTENCE_PREFILLED_CARDS.cards },
  },
  {
    name: 'kaoyan',
    answers: [KAOYAN_ANSWER],
    prefilled: KAOYAN_PREFILLED_MAP,
    // 保留已精修的认知地图
    override: { map: KAOYAN_MAP },
  },
  {
    name: 'nuoci',
    answers: NUOCI_ANSWERS,
    prefilled: {},
    override: {},
  },
];

await mkdir(outDir, { recursive: true });

for (const c of cases) {
  const started = Date.now();
  process.stdout.write(`烘焙 ${c.name} ...`);
  const result = await runPipeline({ answers: c.answers, prefilled: c.prefilled });
  const outputs = { ...result.outputs, ...c.override };
  // 校验
  for (const key of ['viewpoint', 'map', 'cards']) {
    const check = validateSchema(key, outputs[key]);
    if (!check.valid) {
      console.error(`\n❌ ${c.name}.${key} 未通过 schema 校验：`, check.errors.slice(0, 3));
      process.exit(1);
    }
  }
  const file = path.join(outDir, `${c.name}.json`);
  await writeFile(file, `${JSON.stringify(outputs, null, 2)}\n`, 'utf8');
  console.log(` ✔ 完成（${Date.now() - started}ms）→ ${file}（KB=${(await import('node:fs/promises')).stat(file).then(s => s.size / 1024)}）`);
}

console.log(`\n烘焙完成。LLM 模式：${isMockMode() ? 'Mock' : '真实模型'}`);
