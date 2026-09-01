import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const screenshotsDir = path.join(root, 'screenshots');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const debugPort = 9333;
const appUrl = process.env.CUIZHI_URL || 'http://127.0.0.1:4173/';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForHttp(url, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // retry
    }
    await sleep(250);
  }
  throw new Error(`等待 ${url} 超时`);
}

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
    this.ws.onmessage = (message) => {
      const data = JSON.parse(message.data);
      if (data.id && this.pending.has(data.id)) {
        const { resolve, reject } = this.pending.get(data.id);
        this.pending.delete(data.id);
        if (data.error) reject(new Error(data.error.message));
        else resolve(data.result);
        return;
      }
      if (data.method) this.events.push(data);
    };
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || '页面脚本执行失败');
    }
    return result.result?.value;
  }

  async waitEvent(method, timeoutMs = 15000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const index = this.events.findIndex((event) => event.method === method);
      if (index >= 0) return this.events.splice(index, 1)[0];
      await sleep(100);
    }
    throw new Error(`等待事件 ${method} 超时`);
  }

  close() {
    this.ws.close();
  }
}

async function getPageWs() {
  await waitForHttp(`http://127.0.0.1:${debugPort}/json/list`);
  const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
  const targets = await response.json();
  const page = targets.find((target) => target.type === 'page');
  if (!page) throw new Error('没有可用的页面 Target');
  return page.webSocketDebuggerUrl;
}

async function screenshot(cdp, file) {
  const result = await cdp.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(file, Buffer.from(result.data, 'base64'));
}

async function layoutViolations(cdp) {
  return cdp.eval(`(() => {
    const issues = [];
    const docWidth = document.documentElement.scrollWidth;
    if (docWidth > window.innerWidth + 1) {
      issues.push('页面横向溢出: ' + docWidth + ' / ' + window.innerWidth);
    }
    document.querySelectorAll('button, .chip, .seg-btn, .chip-btn').forEach((el) => {
      if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1) {
        issues.push('元素文字溢出: ' + (el.className || el.tagName) + ' ' + el.textContent.trim().slice(0, 20));
      }
    });
    document.querySelectorAll('main *').forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && (rect.right > window.innerWidth + 1 || rect.left < -1)) {
        issues.push('元素越出视口: ' + (el.className || el.tagName));
      }
    });
    return issues;
  })()`);
}

async function assertLayout(cdp) {
  const issues = await layoutViolations(cdp);
  if (issues.length) {
    throw new Error('布局问题：' + issues.slice(0, 8).join('；'));
  }
}

async function setViewport(cdp, width, height, mobile = false) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 2,
    mobile,
  });
}

async function main() {
  await mkdir(screenshotsDir, { recursive: true });
  const chrome = spawn(chromePath, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    `--remote-debugging-port=${debugPort}`,
    '--user-data-dir=/tmp/cuizhi-chrome-profile',
    'about:blank',
  ]);

  const consoleErrors = [];
  let cdp = null;
  try {
    const wsUrl = await getPageWs();
    cdp = new CdpClient(wsUrl);
    await cdp.open();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Network.enable');
    const originalPush = cdp.events.push.bind(cdp.events);
    cdp.events.push = (event) => {
      if (
        event.method === 'Runtime.exceptionThrown' ||
        (event.method === 'Log.entryAdded' && ['error', 'warning'].includes(event.params?.entry?.level)) ||
        (event.method === 'Runtime.consoleAPICalled' && event.params?.type === 'error')
      ) {
        consoleErrors.push(event);
      }
      return originalPush(event);
    };

    await setViewport(cdp, 1280, 900, false);
    await cdp.send('Page.navigate', { url: appUrl });
    await cdp.waitEvent('Page.loadEventFired');
    await cdp.eval(`
      window.__errors = [];
      window.addEventListener('error', (event) => window.__errors.push(event.message));
      window.addEventListener('unhandledrejection', (event) => window.__errors.push(String(event.reason)));
    `);
    await sleep(700);
    await screenshot(cdp, path.join(screenshotsDir, 'desktop-home.png'));
    await assertLayout(cdp);
    await cdp.eval(`localStorage.setItem('cuizhi_tour_done', '1')`);
    const overlayHidden = await cdp.eval(
      `getComputedStyle(document.querySelector('#alchemyOverlay')).display === 'none' && getComputedStyle(document.querySelector('#skeleton')).display === 'none'`,
    );
    if (!overlayHidden) throw new Error('首页不应显示炼金遮罩或骨架屏');

    await cdp.eval(`document.querySelector('[data-example="exam"]').click()`);
    await cdp.eval(`document.querySelector('#alchemyBtn').click()`);
    await cdp.waitEvent('Page.loadEventFired').catch(() => {});
    for (let i = 0; i < 40; i += 1) {
      const visible = await cdp.eval(`!document.querySelector('#packagePage').hidden`);
      if (visible) break;
      await sleep(200);
    }
    await sleep(500);
    await screenshot(cdp, path.join(screenshotsDir, 'desktop-package.png'));
    await assertLayout(cdp);

    await cdp.eval(`document.querySelector('[data-tab="viewpoint"]').click()`);
    await sleep(300);
    const donutExists = await cdp.eval(`Boolean(document.querySelector('.donut-chart'))`);
    if (!donutExists) throw new Error('观点光谱未展示环形饼图');
    const stanceCount = await cdp.eval(`document.querySelectorAll('.stance-card').length`);
    if (stanceCount < 3) throw new Error('观点光谱未展示至少 3 个立场');
    await cdp.eval(`document.querySelector('[data-tab="map"]').click()`);
    for (let i = 0; i < 20; i += 1) {
      const hasMap = await cdp.eval(`Boolean(document.querySelector('.map-stage'))`);
      if (hasMap) break;
      await sleep(200);
    }
    const mapRunner = await cdp.eval(`Boolean(document.querySelector('.map-runner'))`);
    const mapNodes = await cdp.eval(`document.querySelectorAll('.map-node').length`);
    const mapHtmlLength = await cdp.eval(`document.querySelector('#tabContent').innerHTML.length`);
    if (!mapRunner || mapNodes < 3) {
      const snippet = await cdp.eval(`document.querySelector('#tabContent').innerHTML.slice(0, 500)`);
      const pageErrors = await cdp.eval(`(window.__errors || []).join(' | ')`);
      const activeTab = await cdp.eval(`document.querySelector('.tab-btn.active')?.dataset.tab`);
      throw new Error(`认知地图未展示动态路径与节点 runner=${mapRunner} nodes=${mapNodes} html=${mapHtmlLength} active=${activeTab} errors=${pageErrors} snippet=${snippet}`);
    }

    await cdp.eval(`document.querySelector('[data-tab="map"]').click()`);
    const pathTimeline = await cdp.eval(`Boolean(document.querySelector('.path-timeline'))`);
    const pathDetail = await cdp.eval(`Boolean(document.querySelector('.path-detail-card'))`);
    if (!pathTimeline || !pathDetail) throw new Error('认知地图未展示路径时间线与详情卡');
    await cdp.eval(`document.querySelector('[data-action="generate-cards"]').click()`);
    for (let i = 0; i < 20; i += 1) {
      const visible = await cdp.eval(`Boolean(document.querySelector('#visualFlipBtn'))`);
      if (visible) break;
      await sleep(200);
    }
    const activeTab = await cdp.eval(`document.querySelector('.tab-btn.active')?.dataset.tab`);
    if (activeTab !== 'cards') throw new Error(`生成后未进入复习卡片页：${activeTab}`);
    await sleep(400);
    await screenshot(cdp, path.join(screenshotsDir, 'desktop-review.png'));
    await assertLayout(cdp);
    await cdp.eval(`document.querySelector('#visualFlipBtn').click()`);
    await sleep(600);
    await screenshot(cdp, path.join(screenshotsDir, 'desktop-review-flipped.png'));
    await assertLayout(cdp);

    await cdp.eval(`document.querySelector('[data-tab="coach"]').click()`);
    await sleep(300);
    const debateOptions = await cdp.eval(`document.querySelectorAll('.debate-option').length`);
    if (debateOptions < 3) throw new Error('看山对练未展示至少 3 个可对练观点');
    const debateStartButtons = await cdp.eval(`document.querySelectorAll('.debate-start').length`);
    if (debateStartButtons < 3) throw new Error('看山对练卡片缺少开始按钮');
    await cdp.eval(`document.querySelector('[data-debate-view="0"]').click()`);
    await sleep(300);
    const debateFlow = await cdp.eval(`Boolean(document.querySelector('.debate-flow'))`);
    if (!debateFlow) throw new Error('看山对练未进入问答流界面');
    await cdp.eval(`const input = document.querySelector('#coachInput'); input.value = '请反驳我'; document.querySelector('#coachSendBtn').click();`);
    for (let i = 0; i < 20; i += 1) {
      const hasAi = await cdp.eval(`Boolean(document.querySelector('.ai-block'))`);
      if (hasAi) break;
      await sleep(200);
    }
    await sleep(300);
    await screenshot(cdp, path.join(screenshotsDir, 'desktop-coach.png'));
    await assertLayout(cdp);

    await setViewport(cdp, 390, 844, true);
    await cdp.send('Page.navigate', { url: appUrl });
    await cdp.waitEvent('Page.loadEventFired');
    await sleep(700);
    await screenshot(cdp, path.join(screenshotsDir, 'mobile-home.png'));
    await assertLayout(cdp);
    await cdp.eval(`localStorage.setItem('cuizhi_tour_done', '1')`);
    await cdp.eval(`document.querySelector('[data-example="exam"]').click()`);
    await cdp.eval(`document.querySelector('#alchemyBtn').click()`);
    for (let i = 0; i < 40; i += 1) {
      const visible = await cdp.eval(`!document.querySelector('#packagePage').hidden`);
      if (visible) break;
      await sleep(200);
    }
    await sleep(500);
    await screenshot(cdp, path.join(screenshotsDir, 'mobile-package.png'));
    await assertLayout(cdp);

    if (consoleErrors.length) {
      console.error('控制台错误：', JSON.stringify(consoleErrors.slice(0, 5), null, 2));
      process.exitCode = 1;
    } else {
      console.log('浏览器验收通过：桌面/移动端截图完成，无控制台错误，布局检查通过');
    }
  } finally {
    cdp?.close();
    chrome.kill('SIGTERM');
  }
}

main().catch((error) => {
  console.error('浏览器验收失败：', error.message);
  process.exitCode = 1;
});
