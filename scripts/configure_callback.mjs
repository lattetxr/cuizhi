#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

async function main() {
  const args = process.argv.slice(2);
  const projectDirIndex = args.indexOf('--project-dir');
  const redirectUriIndex = args.indexOf('--redirect-uri');
  
  if (projectDirIndex === -1 || redirectUriIndex === -1) {
    console.error('Usage: node configure_callback.mjs --project-dir <dir> --redirect-uri <uri>');
    process.exit(1);
  }
  
  const projectDir = args[projectDirIndex + 1] || projectRoot;
  const redirectUri = args[redirectUriIndex + 1];
  
  if (!redirectUri) {
    console.error('Error: --redirect-uri is required');
    process.exit(1);
  }
  
  if (!redirectUri.startsWith('https://')) {
    console.error('Error: redirect-uri must be HTTPS');
    process.exit(1);
  }
  
  const configPath = path.join(projectDir, 'hackathon.config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  
  config.oauth = config.oauth || {};
  config.oauth.redirectUri = redirectUri;
  
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
  console.log(`✓ Updated redirectUri to: ${redirectUri}`);
  console.log(`✓ Config saved to: ${configPath}`);
  console.log('\nNext steps:');
  console.log('1. Update the callback URL in Zhihu Open Platform');
  console.log('2. Redeploy the application');
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
