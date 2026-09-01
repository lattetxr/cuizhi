import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { projectRootPath } from './config.mjs';

const dataDir = path.resolve(
  process.env.CUZHI_DATA_DIR || path.join(projectRootPath(), '.data'),
);
const storeFile = path.join(dataDir, 'store.json');

let cache = null;

async function ensureDir() {
  await mkdir(dataDir, { recursive: true });
}

export async function loadStore() {
  if (cache) return cache;
  await ensureDir();
  try {
    const raw = await readFile(storeFile, 'utf8');
    cache = JSON.parse(raw);
  } catch {
    cache = { packages: [] };
  }
  return cache;
}

export async function saveStore() {
  await ensureDir();
  const tempFile = `${storeFile}.tmp`;
  await writeFile(tempFile, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
  await rename(tempFile, storeFile);
}

export async function createPackage(pkg) {
  const store = await loadStore();
  store.packages.unshift(pkg);
  await saveStore();
  return pkg;
}

export async function updatePackage(id, mutate) {
  const store = await loadStore();
  const index = store.packages.findIndex((item) => item.id === id);
  if (index < 0) return null;
  store.packages[index] = mutate(store.packages[index]);
  await saveStore();
  return store.packages[index];
}

export async function getPackage(id) {
  const store = await loadStore();
  return store.packages.find((item) => item.id === id) || null;
}

export async function listPackages() {
  const store = await loadStore();
  return store.packages.map((pkg) => ({
    id: pkg.id,
    kind: pkg.kind,
    title: pkg.title,
    goal: pkg.goal,
    createdAt: pkg.createdAt,
    updatedAt: pkg.updatedAt,
    progress: pkg.reviewPlan?.progress || null,
    sourceUrl: pkg.sourceUrl || '',
  }));
}
