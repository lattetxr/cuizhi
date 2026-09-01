import { execFile } from 'node:child_process';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ignored = new Set(['node_modules', '.data', '.git', 'screenshots', '.env']);

async function listFiles(dir) {
  const entries = await readdir(dir);
  const files = [];
  for (const entry of entries) {
    if (ignored.has(entry)) continue;
    const full = path.join(dir, entry);
    const info = await stat(full);
    if (info.isDirectory()) files.push(...(await listFiles(full)));
    else if (/\.(mjs|js)$/.test(entry)) files.push(full);
  }
  return files;
}

function checkFile(file) {
  return new Promise((resolve) => {
    execFile(process.execPath, ['--check', file], (error) => {
      resolve(error ? { file, error: error.message } : null);
    });
  });
}

async function scanSecrets() {
  const configPath = path.join(root, 'hackathon.config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const forbidden = ['appKey', 'accessSecret', 'accessToken', 'authorizationCode'];
  const hits = [];
  for (const key of forbidden) {
    if (JSON.stringify(config).includes(`"${key}"`)) hits.push(key);
  }

  const textFiles = [];
  async function collectTextFiles(dir) {
    const entries = await readdir(dir);
    for (const entry of entries) {
      if (ignored.has(entry)) continue;
      const full = path.join(dir, entry);
      const info = await stat(full);
      if (info.isDirectory()) await collectTextFiles(full);
      else if (/\.(mjs|js|json|md|html|css|env|example|txt)$/.test(entry)) {
        textFiles.push(full);
      }
    }
  }
  await collectTextFiles(root);

  for (const file of textFiles) {
    const content = await readFile(file, 'utf8');
    const lines = content.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (/^(?:export\s+)?(?:const\s+)?ZHIHU_(?:OAUTH_APP_KEY|ACCESS_SECRET)\s*=\s*[^<"'\s]+/.test(line)) {
        hits.push(`${file}:${index + 1} 出现非空 ZHIHU_ 密钥赋值`);
      }
      if (/\b[0-9a-f]{40}\b/.test(line) && !file.endsWith('package-lock.json')) {
        hits.push(`${file}:${index + 1} 出现疑似 40 位密钥字符串`);
      }
    });
  }
  return hits;
}

const files = await listFiles(root);
const results = await Promise.all(files.map(checkFile));
const errors = results.filter(Boolean);
const secretHits = await scanSecrets();

if (errors.length || secretHits.length) {
  for (const item of errors) console.error(`语法错误：${item.file}\n${item.error}`);
  for (const item of secretHits) console.error(`敏感扫描命中：${item}`);
  process.exit(1);
}

console.log(`check 通过：${files.length} 个文件语法正常，敏感扫描无命中`);
