/**
 * Capture real renderer output to PNG for visual review.
 *
 * Numeric checks can pass while the picture is still wrong, so this renders a
 * few representative frames in headless Chrome and writes them to disk. These
 * are renderer evidence captures, not product screenshots: the authored preset
 * and its colours live in src/scene/preset.ts.
 *
 * Usage: node tests/render/capture.mjs [outputDir]
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const outDir = resolve(repoRoot, process.argv[2] ?? 'tests/render/captures');

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean);
  return candidates.find((c) => existsSync(c)) ?? null;
}

async function main() {
  const chrome = findChrome();
  if (!chrome) {
    console.error('No Chrome found. Set CHROME_PATH.');
    process.exit(2);
  }

  const esbuild = await import('esbuild');
  const built = await esbuild.build({
    entryPoints: [resolve(here, 'capture-entry.ts')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    write: false,
    logLevel: 'silent',
  });

  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<script>${built.outputFiles[0].text.replace(/<\/script>/gi, '<\\/script>')}</script>
</body></html>`;

  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${server.address().port}/`;

  const profile = mkdtempSync(resolve(tmpdir(), 'renderer-capture-'));
  const port = 9444 + Math.floor(Math.random() * 400);
  const child = spawn(
    chrome,
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--enable-unsafe-swiftshader',
      url,
    ],
    { stdio: 'ignore' },
  );

  try {
    let version = null;
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline && !version) {
      try {
        version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      } catch {
        await new Promise((r) => setTimeout(r, 150));
      }
    }
    if (!version) throw new Error('Chrome DevTools did not start');

    const ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((ok, no) => {
      ws.addEventListener('open', ok, { once: true });
      ws.addEventListener('error', () => no(new Error('ws error')), { once: true });
    });

    let id = 1;
    const pending = new Map();
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) {
        const { ok, no } = pending.get(m.id);
        pending.delete(m.id);
        m.error ? no(new Error(JSON.stringify(m.error))) : ok(m.result);
      }
    });
    const send = (method, params = {}, sessionId) =>
      new Promise((ok, no) => {
        const n = id++;
        pending.set(n, { ok, no });
        ws.send(JSON.stringify({ id: n, method, params, sessionId }));
      });

    const { targetInfos } = await send('Target.getTargets');
    const page = targetInfos.find((t) => t.type === 'page');
    const { sessionId } = await send('Target.attachToTarget', {
      targetId: page.targetId,
      flatten: true,
    });
    await send('Runtime.enable', {}, sessionId);
    await send('Page.navigate', { url }, sessionId);

    let payload = null;
    const captureDeadline = Date.now() + 60000;
    while (Date.now() < captureDeadline && !payload) {
      const { result } = await send(
        'Runtime.evaluate',
        {
          expression: 'window.__AI1_CAPTURES__ ? JSON.stringify(window.__AI1_CAPTURES__) : null',
          returnByValue: true,
        },
        sessionId,
      );
      if (result?.value) payload = JSON.parse(result.value);
      else await new Promise((r) => setTimeout(r, 200));
    }
    if (!payload) throw new Error('captures were not produced in time');

    mkdirSync(outDir, { recursive: true });
    for (const capture of payload) {
      const base64 = capture.dataUrl.split(',')[1];
      const file = resolve(outDir, `${capture.name}.png`);
      writeFileSync(file, Buffer.from(base64, 'base64'));
      console.log(`wrote ${file}`);
    }
  } finally {
    try { child.kill(); } catch {}
    try { rmSync(profile, { recursive: true, force: true }); } catch {}
    server.close();
  }
}

main();
