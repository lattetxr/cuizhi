import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

let cachedConfig = null;

function execFileResult(file, args) {
  return new Promise((resolve) => {
    execFile(file, args, { maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        stdout: stdout?.toString().trim() || '',
        stderr: stderr?.toString().trim() || '',
      });
    });
  });
}

export async function readConfig() {
  if (cachedConfig) return cachedConfig;
  const raw = await readFile(path.join(projectRoot, 'hackathon.config.json'), 'utf8');
  cachedConfig = JSON.parse(raw);
  cachedConfig.projectRoot = projectRoot;
  return cachedConfig;
}

export function getLlmConfig() {
  return {
    baseUrl: (process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
    apiKey: process.env.LLM_API_KEY || '',
    model: process.env.LLM_MODEL || 'gpt-4o-mini',
    mode: process.env.CUZHI_LLM_MODE || 'auto',
  };
}

export async function readKeychain(service, account) {
  if (process.platform !== 'darwin') return '';
  const result = await execFileResult('/usr/bin/security', [
    'find-generic-password',
    '-s',
    service,
    '-a',
    account,
    '-w',
  ]);
  return result.ok ? result.stdout : '';
}

export async function getOAuthAppKey(config) {
  const fromEnv = process.env.ZHIHU_OAUTH_APP_KEY || '';
  if (fromEnv) return { value: fromEnv, source: 'env' };
  const fromKeychain = await readKeychain(
    config.oauth?.credentialService || 'zhihu-hackathon',
    config.oauth?.credentialAccount || 'oauth-app-key',
  );
  return fromKeychain
    ? { value: fromKeychain, source: 'keychain' }
    : { value: '', source: null };
}

export async function getAccessSecret() {
  const fromEnv = process.env.ZHIHU_ACCESS_SECRET || '';
  if (fromEnv) return { value: fromEnv, source: 'env' };
  const fromKeychain = await readKeychain('zhihu-cli', 'access-secret');
  return fromKeychain
    ? { value: fromKeychain, source: 'keychain' }
    : { value: '', source: null };
}

export function getHttpAccessSecret() {
  const fromEnv = process.env.ZHIHU_ACCESS_SECRET || '';
  return fromEnv
    ? { value: fromEnv, source: 'env' }
    : { value: '', source: null };
}

export function mask(value) {
  if (!value) return '';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export function projectRootPath() {
  return projectRoot;
}
