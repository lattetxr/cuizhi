// 性能检查：素材体积、预烘焙可用性、内置示例炼金耗时与流式步骤
// 用法：npm run perf（需本地服务在 4173 端口，可用 CUIZHI_URL 覆盖）
import { readFile, stat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BASE = process.env.CUIZHI_URL || 'http://127.0.0.1:4173';
let failures = 0;

const fail = (msg) => { failures += 1; console.error('  ❌', msg); };
const ok = (msg) => console.log('  ✔', msg);

// 1) 动画素材体积与分辨率（首页首屏友好度 + 保证高清无马赛克）
// 素材为 320x320 高清 GIF（刘看山 IP 动画），全量无损优化后约 5.3MB；
// 实际加载靠懒加载 + 7d 静态缓存，首屏只命中其中 1-2 个文件。
const assetsDir = path.join(root, 'public', 'assets', 'liukanshan');
const files = (await readdir(assetsDir)).filter((f) => f.endsWith('.gif'));
let total = 0;
const per = [];
const GIF_MAX = 1.1 * 1024 * 1024; // 单个高清动画 ≤ ~1.1MB
const TOTAL_MAX = 6 * 1024 * 1024; // 6 个高清动画合计 ≤ 6MB
let dimsOk = true;
for (const f of files) {
  const st = await stat(path.join(assetsDir, f));
  total += st.size;
  per.push(`${f}=${(st.size / 1024).toFixed(0)}KB`);
  if (st.size > GIF_MAX) fail(`${f} ${(st.size / 1024).toFixed(0)}KB 超过单文件 ${Math.round(GIF_MAX / 1024)}KB`);
  // GIF 尺寸位于文件头偏移 6-9（小端 uint16）
  const head = await readFile(path.join(assetsDir, f)).then((b) => b.subarray(0, 10));
  const w = head[6] | (head[7] << 8);
  const h = head[8] | (head[9] << 8);
  if (w !== 320 || h !== 320) {
    dimsOk = false;
    fail(`${f} 分辨率 ${w}x${h} ≠ 320x320（可能被降采样，会产生边缘马赛克）`);
  }
}
console.log(`素材 GIF：${per.join(' ')} 合计=${(total / 1024).toFixed(0)}KB`);
if (dimsOk) ok('全部 GIF 保持 320x320 高清分辨率');
if (total > TOTAL_MAX) {
  fail(`GIF 合计 ${(total / 1024).toFixed(0)}KB 超过 ${Math.round(TOTAL_MAX / 1024 / 1024)}MB 预算`);
} else {
  ok(`GIF 合计 ${(total / 1024).toFixed(0)}KB ≤ ${Math.round(TOTAL_MAX / 1024 / 1024)}MB`);
}

// 2) 预烘焙文件可用性
const bakedDir = path.join(root, 'server', 'lib', 'baked');
for (const name of ['existence', 'kaoyan', 'nuoci']) {
  try {
    const data = JSON.parse(await readFile(path.join(bakedDir, `${name}.json`), 'utf8'));
    if (!data.viewpoint || !data.map || !data.cards) {
      fail(`baked/${name}.json 缺少 viewpoint/map/cards 之一`);
    } else {
      ok(`baked/${name}.json 可解析且结构完整`);
    }
  } catch (error) {
    fail(`baked/${name}.json 不可用：${error.message}`);
  }
}

// 3) 内置示例炼金耗时与流式步骤（服务未启动时跳过）
const health = await fetch(`${BASE}/api/health`).then((r) => r.ok).catch(() => false);
if (!health) {
  console.log('\n（未检测到本地服务，跳过网络耗时测试。启动 `npm start` 后重跑 `npm run perf`）');
} else {
  const cases = [
    ['存在主义', { search: '存在主义' }],
    ['裸辞', { search: '年轻人该不该裸辞' }],
    ['考研', { url: 'https://zhuanlan.zhihu.com/p/54779494' }],
  ];
  for (const [name, payload] of cases) {
    const t0 = Date.now();
    const steps = [];
    let gotFinal = false;
    let bodyText = '';
    try {
      const res = await fetch(`${BASE}/api/alchemy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, goal: '入门' }),
      });
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          bodyText += line + '\n';
          try {
            const m = JSON.parse(line);
            if (m.progress != null) steps.push(m.progress);
            if (m.ok === true) gotFinal = true;
          } catch { /* skip malformed */ }
        }
      }
      const ms = Date.now() - t0;
      if (!gotFinal) {
        fail(`${name}：未收到 ok 终行 body=${bodyText.slice(0, 200)}`);
      } else if (ms > 500) {
        fail(`${name}：耗时 ${ms}ms > 500ms（命中烘焙应 <500ms）`);
      } else if (steps.length < 3) {
        fail(`${name}：流式步骤不足 steps=${JSON.stringify(steps)}`);
      } else {
        ok(`${name}：${ms}ms steps=${JSON.stringify(steps)}`);
      }
    } catch (error) {
      fail(`${name}：${error.message}`);
    }
  }
}

if (failures) {
  console.error(`\n性能检查未通过（${failures} 项问题）`);
  process.exit(1);
}
console.log('\n性能检查通过');
