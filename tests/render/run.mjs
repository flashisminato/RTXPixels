/**
 * Headless GPU test runner for the renderer module.
 *
 * These checks are meaningless without a real WebGL2 implementation, and jsdom
 * cannot run them. So the runner bundles the TypeScript with esbuild, serves it,
 * and drives headless Chrome with a real GPU backend via the DevTools protocol.
 *
 * Usage: node tests/render/run.mjs [--headful] [--keep-open]
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');

const argv = new Set(process.argv.slice(2));
const headful = argv.has('--headful');
const keepOpen = argv.has('--keep-open');

// --- locate Chrome --------------------------------------------------------

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

// --- bundle ---------------------------------------------------------------

async function bundle() {
  let esbuild;
  try {
    esbuild = await import('esbuild');
  } catch {
    console.error(
      'esbuild is required to bundle the renderer tests.\n' +
        'Install it locally:  npm i -D esbuild\n' +
        'or run once without installing:  npx -y esbuild --version',
    );
    process.exit(2);
  }

  const result = await esbuild.build({
    entryPoints: [resolve(here, 'entry.ts')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    write: false,
    sourcemap: 'inline',
    logLevel: 'silent',
  });

  return result.outputFiles[0].text;
}

// --- CDP plumbing ---------------------------------------------------------

async function connectCdp(port) {
  const deadline = Date.now() + 20000;
  let target = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      target = await response.json();
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  if (!target) throw new Error('Chrome did not expose a DevTools endpoint in time');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    ws.addEventListener('open', resolveOpen, { once: true });
    ws.addEventListener('error', () => rejectOpen(new Error('DevTools socket error')), { once: true });
  });

  let nextId = 1;
  const pending = new Map();
  const listeners = [];

  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve: ok, reject: no } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) no(new Error(JSON.stringify(message.error)));
      else ok(message.result);
      return;
    }
    for (const listener of listeners) listener(message);
  });

  const send = (method, params = {}, sessionId) =>
    new Promise((ok, no) => {
      const id = nextId++;
      pending.set(id, { resolve: ok, reject: no });
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });

  return { ws, send, on: (fn) => listeners.push(fn) };
}

// --- main -----------------------------------------------------------------

async function main() {
  const chrome = findChrome();
  if (!chrome) {
    console.error(
      'No Chrome/Chromium/Edge binary found. Set CHROME_PATH to one.\n' +
        'These checks require a real WebGL2 implementation and cannot run under jsdom.',
    );
    process.exit(2);
  }

  console.log(`[run] bundling renderer tests`);
  const script = await bundle();

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Renderer checks</title></head>
<body><script>${script.replace(/<\/script>/gi, '<\\/script>')}</script></body></html>`;

  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const port = server.address().port;
  const pageUrl = `http://127.0.0.1:${port}/`;

  const profile = mkdtempSync(resolve(tmpdir(), 'renderer-render-'));
  const debugPort = 9333 + Math.floor(Math.random() * 500);

  const args = [
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    // Force a real GPU-backed WebGL2 implementation. SwiftShader would also
    // work but must be reported honestly, so the renderer check prints the
    // actual UNMASKED_RENDERER string it ran against.
    '--enable-unsafe-swiftshader',
    '--use-angle=default',
    pageUrl,
  ];
  if (!headful) args.unshift('--headless=new');

  console.log(`[run] launching ${chrome.split('/').pop()} (${headful ? 'headful' : 'headless'})`);
  const child = spawn(chrome, args, { stdio: 'ignore' });

  const cleanup = () => {
    if (!keepOpen) {
      try { child.kill(); } catch {}
      try { rmSync(profile, { recursive: true, force: true }); } catch {}
    }
    server.close();
  };

  let exitCode = 1;
  try {
    const cdp = await connectCdp(debugPort);

    // Attach to the page target.
    const { targetInfos } = await cdp.send('Target.getTargets');
    const page = targetInfos.find((t) => t.type === 'page');
    if (!page) throw new Error('no page target');
    const { sessionId } = await cdp.send('Target.attachToTarget', {
      targetId: page.targetId,
      flatten: true,
    });

    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Page.enable', {}, sessionId);

    cdp.on((message) => {
      if (message.method === 'Runtime.consoleAPICalled' && message.sessionId === sessionId) {
        const text = (message.params.args ?? [])
          .map((a) => (a.value !== undefined ? a.value : a.description ?? ''))
          .join(' ');
        if (text) console.log(`  ${text}`);
      }
    });

    await cdp.send('Page.navigate', { url: pageUrl }, sessionId);

    // Poll for the result the bundle publishes on window.
    const deadline = Date.now() + 120000;
    let payload = null;
    while (Date.now() < deadline) {
      const { result } = await cdp.send(
        'Runtime.evaluate',
        {
          expression: 'window.__AI1_RESULT__ ? JSON.stringify(window.__AI1_RESULT__) : null',
          returnByValue: true,
          awaitPromise: false,
        },
        sessionId,
      );
      if (result?.value) {
        payload = JSON.parse(result.value);
        break;
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    if (!payload) {
      console.error('[run] tests did not report a result within 120s');
      return (exitCode = 1);
    }

    console.log('');
    console.log(`[gpu] ${payload.renderer}`);
    console.log(`[gpu] WebGL2: ${payload.webgl2 ? 'yes' : 'NO'}`);
    console.log('');

    let failed = 0;
    for (const outcome of payload.outcomes) {
      if (outcome.status === 'pass') {
        console.log(`  PASS  ${outcome.name}`);
      } else {
        failed += 1;
        console.log(`  FAIL  ${outcome.name}`);
        console.log(`        ${outcome.detail}`);
      }
    }

    console.log('');
    console.log(`${payload.outcomes.length - failed}/${payload.outcomes.length} checks passed`);

    if (payload.samples) {
      console.log('');
      console.log('Published CPU/GPU comparison samples (sRGB bytes, top-left pixel coords):');
      console.log(JSON.stringify(payload.samples, null, 2));
    }

    exitCode = failed === 0 ? 0 : 1;
  } catch (error) {
    console.error(`[run] ${error?.stack ?? error}`);
    exitCode = 1;
  } finally {
    cleanup();
  }

  process.exit(exitCode);
}

main();
