#!/usr/bin/env node
// Drive the running Fairview Event Center app over the Chrome DevTools Protocol.
//
//   node .claude/skills/run-fairview/driver.mjs smoke
//   node .claude/skills/run-fairview/driver.mjs eventCenter
//   node .claude/skills/run-fairview/driver.mjs viewer
//   node .claude/skills/run-fairview/driver.mjs urls
//
// Why CDP by hand instead of Playwright: neither playwright nor puppeteer is
// installed here, and `npx playwright` hangs for minutes trying to fetch. Node
// 22 ships a global WebSocket, and Chrome is already on the machine, so the
// whole driver is ~200 lines with no new dependency.
//
// Chrome is launched on demand with its own --user-data-dir; an already-open
// debug port is reused. Screenshots land in .claude/skills/run-fairview/shots/.

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const SHOTS = path.join(HERE, 'shots');
const APP = process.env.APP_URL || 'http://localhost:4500/';
const PORT = 9222;

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  const found = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
  if (!found) throw new Error(`no Chrome/Edge found; tried:\n  ${CHROME_CANDIDATES.join('\n  ')}`);
  return found;
}

async function cdpUp() {
  try {
    const r = await fetch(`http://localhost:${PORT}/json/version`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch { return false; }
}

async function ensureChrome() {
  if (await cdpUp()) return null;
  const exe = findChrome();
  const child = spawn(exe, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    `--remote-debugging-port=${PORT}`,
    '--window-size=1440,2400',
    `--user-data-dir=${path.join(HERE, '.chrome-profile')}`,
    'about:blank'
  ], { detached: true, stdio: 'ignore' });
  child.unref();
  for (let i = 0; i < 60; i++) {
    if (await cdpUp()) return child;
    await sleep(500);
  }
  throw new Error('Chrome did not open its debug port within 30s');
}

// --- minimal CDP client -----------------------------------------------------

class Session {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.consoleErrors = [];
    this.failed = [];
    this.requests = new Map();
    this.bytes = new Map();
    ws.onmessage = (ev) => this.onMessage(JSON.parse(ev.data));
  }

  onMessage(m) {
    if (m.id && this.pending.has(m.id)) {
      const { res, rej } = this.pending.get(m.id);
      this.pending.delete(m.id);
      return m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      this.consoleErrors.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').split('\n')[0]);
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      this.consoleErrors.push('EXCEPTION: ' + (d.exception?.description || d.text).split('\n')[0]);
    }
    if (m.method === 'Network.requestWillBeSent') this.requests.set(m.params.requestId, m.params.request.url);
    if (m.method === 'Network.dataReceived') {
      const url = this.requests.get(m.params.requestId);
      if (url) this.bytes.set(url, (this.bytes.get(url) || 0) + m.params.encodedDataLength);
    }
    if (m.method === 'Network.loadingFailed') {
      const url = this.requests.get(m.params.requestId) || '(unknown)';
      // A <video autoplay loop> issues range requests that get cancelled when
      // the page is torn down. Those are not load failures.
      if (m.params.errorText !== 'net::ERR_ABORTED') this.failed.push({ url, error: m.params.errorText });
    }
    if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) {
      this.failed.push({ url: m.params.response.url, error: `HTTP ${m.params.response.status}` });
    }
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.pending.set(id, { res, rej }));
  }

  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result?.value;
  }

  async shot(name) {
    fs.mkdirSync(SHOTS, { recursive: true });
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(SHOTS, `${name}.png`);
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    return file;
  }
}

async function connect() {
  const targets = await (await fetch(`http://localhost:${PORT}/json`)).json();
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target in Chrome');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('CDP socket failed')); });
  const s = new Session(ws);
  await s.send('Runtime.enable');
  await s.send('Network.enable');
  await s.send('Page.enable');
  return s;
}

// The app is a single component with no router: sections are component state,
// so the venue gallery (under Event Center) cannot be deep-linked. It has to
// be clicked.
async function openEventCenter(s) {
  await s.send('Page.navigate', { url: APP });
  await sleep(6000);
  const clicked = await s.eval(`
    (() => {
      const el = [...document.querySelectorAll('nav a, a, button')]
        .find(e => e.textContent.trim() === 'Event Center');
      if (!el) return 'NOT FOUND';
      el.click();
      return 'ok';
    })()
  `);
  if (clicked !== 'ok') throw new Error('could not find the Event Center nav link');
  await sleep(8000);
}

// --- commands ---------------------------------------------------------------

const commands = {
  async smoke(s) {
    await openEventCenter(s);
    const stats = await s.eval(`
      (() => {
        const imgs = [...document.querySelectorAll('img')];
        return {
          cards: document.querySelectorAll('article').length,
          imgCount: imgs.length,
          brokenImgs: imgs.filter(i => i.complete && i.naturalWidth === 0).map(i => (i.currentSrc||i.src).split('/').pop()),
          missingAlt: imgs.filter(i => !(i.getAttribute('alt')||'').trim()).length,
          horizontalOverflow: document.body.scrollWidth > window.innerWidth
        };
      })()
    `);
    const file = await s.shot('event-center');
    return { stats, screenshot: file, consoleErrors: s.consoleErrors, failedRequests: s.failed };
  },

  async eventCenter(s) {
    return commands.smoke(s);
  },

  // The one place photo descriptions surface. Guards the descriptions.json ->
  // manifest -> openMedia -> viewer chain end to end.
  async viewer(s) {
    await openEventCenter(s);
    const opened = await s.eval(`
      (() => {
        const el = document.querySelector('article img, article video');
        if (!el) return 'NO CARD';
        el.click();
        return (el.currentSrc || el.src).split('/').pop();
      })()
    `);
    await sleep(4000);
    const viewer = await s.eval(`
      (() => {
        const v = document.querySelector('.media-viewer');
        if (!v) return { open: false };
        const img = v.querySelector('img');
        return {
          open: true,
          title: v.querySelector('.media-viewer-caption h3')?.textContent.trim() ?? null,
          description: v.querySelector('.media-viewer-description')?.textContent.trim() ?? null,
          alt: img?.getAttribute('alt') ?? null,
          imgBroken: img ? (img.complete && img.naturalWidth === 0) : null
        };
      })()
    `);
    const file = await s.shot('viewer');
    return { clicked: opened, viewer, screenshot: file, consoleErrors: s.consoleErrors, failedRequests: s.failed };
  },

  // What a first-time visitor actually pays for the landing page. The hero is
  // an autoplaying drone clip served straight from the bucket, so it is very
  // easy for it to quietly become the heaviest thing on the site.
  async hero(s) {
    await s.send('Page.navigate', { url: APP });
    await sleep(12000);
    const video = await s.eval(`
      (() => {
        const v = document.querySelector('.hero-image video');
        if (!v) return { present: false };
        return {
          present: true,
          src: (v.currentSrc || v.src).split('/').pop(),
          poster: v.getAttribute('poster'),
          preload: v.getAttribute('preload'),
          readyState: v.readyState,
          paused: v.paused,
          currentTime: Number(v.currentTime.toFixed(2)),
          duration: Number.isFinite(v.duration) ? Number(v.duration.toFixed(1)) : null,
          bufferedSec: v.buffered.length ? Number(v.buffered.end(0).toFixed(1)) : 0,
          error: v.error ? v.error.code : null
        };
      })()
    `);
    const heavy = [...s.bytes.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([url, n]) => ({ kb: Math.round(n / 1024), url: url.split('/').pop() }));
    const total = [...s.bytes.values()].reduce((a, b) => a + b, 0);
    return {
      video,
      totalKbDownloaded: Math.round(total / 1024),
      heaviestRequests: heavy,
      screenshot: await s.shot('hero'),
      consoleErrors: s.consoleErrors,
      failedRequests: s.failed
    };
  },

  // Infinite scroll on the catalogue: scroll to the bottom repeatedly and
  // check the card count actually grows, then that it stops at the total.
  async scroll(s) {
    await openEventCenter(s);
    const counts = [];
    const read = () => s.eval(`
      (() => {
        const m = (document.querySelector('.catalogue-count')||{}).textContent || '';
        return { cards: document.querySelectorAll('.product-card').length, status: m.trim(),
                 hasButton: !!document.querySelector('.catalogue-more-button'),
                 atEnd: !!document.querySelector('.catalogue-end') };
      })()
    `);
    counts.push(await read());
    for (let i = 0; i < 20; i++) {
      await s.eval(`window.scrollTo(0, document.body.scrollHeight)`);
      await sleep(1200);
      const now = await read();
      if (now.cards === counts[counts.length - 1].cards && !now.hasButton) { counts.push(now); break; }
      counts.push(now);
      if (now.atEnd) break;
    }
    return {
      firstBatch: counts[0],
      afterScrolling: counts[counts.length - 1],
      growth: counts.map((c) => c.cards),
      screenshot: await s.shot('scroll'),
      consoleErrors: s.consoleErrors,
      failedRequests: s.failed
    };
  },

  // No browser needed: HEAD every manifest entry. This is what catches a
  // rename that moved the file but not the reference.
  async urls() {
    const res = await fetch(new URL('assets/gallery/gallery-manifest.json', APP));
    if (!res.ok) throw new Error(`manifest fetch failed: HTTP ${res.status}`);
    const items = await res.json();
    const bad = [];
    const queue = [...items];
    await Promise.all(Array.from({ length: 12 }, async () => {
      while (queue.length) {
        const item = queue.shift();
        try {
          const r = await fetch(item.image, { method: 'HEAD' });
          if (!r.ok) { bad.push(`[HTTP ${r.status}] ${item.image}`); continue; }
          const ct = r.headers.get('content-type') || '';
          const want = item.mediaType === 'video' ? 'video' : 'image';
          if (!ct.startsWith(want)) bad.push(`[${ct} but mediaType=${item.mediaType}] ${item.image}`);
        } catch (e) {
          bad.push(`[${e.message}] ${item.image}`);
        }
      }
    }));
    return {
      checked: items.length,
      described: items.filter((i) => i.description).length,
      failures: bad.length,
      bad
    };
  }
};

// --- main -------------------------------------------------------------------

const cmd = process.argv[2] || 'smoke';
if (!commands[cmd]) {
  console.error(`unknown command "${cmd}". try: ${Object.keys(commands).join(', ')}`);
  process.exit(2);
}

const needsBrowser = cmd !== 'urls';
let session;
try {
  if (needsBrowser) {
    await ensureChrome();
    session = await connect();
  }
  const result = await commands[cmd](session);
  console.log(JSON.stringify(result, null, 2));

  const problems =
    (result.failedRequests?.length || 0) +
    (result.failures || 0) +
    (result.stats?.brokenImgs?.length || 0);
  if (problems) {
    console.error(`\n${problems} problem(s) found.`);
    process.exitCode = 1;
  }
} catch (e) {
  console.error('DRIVER FAILED:', e.message);
  process.exitCode = 1;
} finally {
  session?.ws.close();
}
