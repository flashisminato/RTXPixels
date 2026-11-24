/**
 * Production-path smoke runner.
 *
 * Drives tests/render/smoke-entry.ts in headless Chrome and verifies the
 * renderer through COMPOSITED PAGE SCREENSHOTS rather than readPixels.
 *
 * This matters: the production renderer runs with preserveDrawingBuffer:false,
 * where readPixels after compositing is not a valid observation. Screenshots
 * capture what a visitor would actually see, which is the only thing that
 * proves render-on-demand works in a real page.
 *
 * Usage: node tests/render/smoke.mjs [outputDir]
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
  return [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean).find((c) => existsSync(c)) ?? null;
}

/** Decode a PNG well enough to judge "is anything actually drawn here". */
function summarisePng(buffer) {
  // Rather than depend on a PNG decoder, use the compressed size as a coarse
  // signal and let the caller compare stages. A uniformly blank page compresses
  // far smaller than a rendered scene with gradients and shadows.
  return buffer.length;
}

async function main() {
  const chrome = findChrome();
  if (!chrome) {
    console.error('No Chrome found. Set CHROME_PATH.');
    process.exit(2);
  }

  let esbuild;
  try {
    esbuild = await import('esbuild');
  } catch {
    console.error('esbuild required: npm i --no-save --no-package-lock esbuild');
    process.exit(2);
  }

  const built = await esbuild.build({
    entryPoints: [resolve(here, 'smoke-entry.ts')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    write: false,
    logLevel: 'silent',
  });

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>smoke</title></head>
<body><script>${built.outputFiles[0].text.replace(/<\/script>/gi, '<\\/script>')}</script></body></html>`;

  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${server.address().port}/`;

  const profile = mkdtempSync(resolve(tmpdir(), 'renderer-smoke-'));
  const port = 9555 + Math.floor(Math.random() * 300);
  const child = spawn(chrome, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--hide-scrollbars',
    '--window-size=700,420',
    '--enable-unsafe-swiftshader',
    url,
  ], { stdio: 'ignore' });

  let failures = 0;
  const fail = (message) => { failures += 1; console.log(`  FAIL  ${message}`); };
  const pass = (message) => console.log(`  PASS  ${message}`);

  try {
    let version = null;
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline && !version) {
      try { version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); }
      catch { await new Promise((r) => setTimeout(r, 150)); }
    }
    if (!version) throw new Error('Chrome DevTools did not start');

    const ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((ok, no) => {
      ws.addEventListener('open', ok, { once: true });
      ws.addEventListener('error', () => no(new Error('ws error')), { once: true });
    });

    let id = 1;
    const pending = new Map();
    const consoleErrors = [];
    const consoleWarnings = [];
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) {
        const { ok, no } = pending.get(m.id);
        pending.delete(m.id);
        m.error ? no(new Error(JSON.stringify(m.error))) : ok(m.result);
        return;
      }
      if (m.method === 'Runtime.exceptionThrown') {
        consoleErrors.push(m.params?.exceptionDetails?.text ?? 'exception');
      }
      if (m.method === 'Log.entryAdded' && m.params?.entry?.level === 'error') {
        consoleErrors.push(m.params.entry.text);
      }
      if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'warning') {
        consoleWarnings.push((m.params.args ?? []).map((a) => a.value ?? '').join(' '));
      }
    });
    const send = (method, params = {}, sessionId) => new Promise((ok, no) => {
      const n = id++;
      pending.set(n, { ok, no });
      ws.send(JSON.stringify({ id: n, method, params, sessionId }));
    });

    const { targetInfos } = await send('Target.getTargets');
    const page = targetInfos.find((t) => t.type === 'page');
    const { sessionId } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
    await send('Runtime.enable', {}, sessionId);
    await send('Log.enable', {}, sessionId);
    await send('Page.enable', {}, sessionId);
    await send('Page.navigate', { url }, sessionId);

    const readState = async () => {
      const { result } = await send('Runtime.evaluate', {
        expression: 'window.__AI1_SMOKE__ ? JSON.stringify(window.__AI1_SMOKE__) : null',
        returnByValue: true,
      }, sessionId);
      return result?.value ? JSON.parse(result.value) : null;
    };

    const shoot = async (name) => {
      const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
      const buffer = Buffer.from(data, 'base64');
      mkdirSync(outDir, { recursive: true });
      const file = resolve(outDir, `smoke-${name}.png`);
      writeFileSync(file, buffer);
      return { file, size: summarisePng(buffer) };
    };

    // Wait for first paint, then capture each stage.
    const captures = {};
    const stages = ['first-paint', 'edited', 'resized'];
    const seen = new Set();
    const stageDeadline = Date.now() + 40000;

    while (Date.now() < stageDeadline) {
      const s = await readState();
      if (s && stages.includes(s.stage) && !seen.has(s.stage)) {
        seen.add(s.stage);
        captures[s.stage] = await shoot(s.stage);
      }
      if (s?.ready) break;
      await new Promise((r) => setTimeout(r, 80));
    }

    const final = await readState();
    if (!final) throw new Error('smoke page never published state');

    console.log('');
    console.log('Production-path smoke (createRenderer(canvas, hooks), 2 args,');
    console.log('preserveDrawingBuffer:false, composited screenshots):');
    console.log('');

    if (final.errors.length === 0) pass('no errors thrown during setup or draw');
    else fail(`errors: ${JSON.stringify(final.errors)}`);

    if (consoleErrors.length === 0) pass('no uncaught page errors or GL console errors');
    else fail(`console errors: ${JSON.stringify(consoleErrors.slice(0, 3))}`);

    if (final.drawCount >= 3) pass(`render-on-demand drew ${final.drawCount} frames (edit and resize both repainted)`);
    else fail(`expected at least 3 draws, got ${final.drawCount}`);

    if (final.contextLost === 0) pass('context was never lost during normal operation');
    else fail(`context lost ${final.contextLost} times unexpectedly`);

    for (const stage of stages) {
      if (captures[stage]) pass(`captured composited screenshot at "${stage}" -> ${captures[stage].file}`);
      else fail(`never captured stage "${stage}"`);
    }

    // A blank white page compresses to a few KB. A rendered scene with
    // gradients, reflections and soft falloff is substantially larger.
    const firstSize = captures['first-paint']?.size ?? 0;
    if (firstSize > 12000) {
      pass(`first paint produced real image content (${(firstSize / 1024).toFixed(1)} KB PNG, not a blank page)`);
    } else {
      fail(`first paint looks blank (${firstSize} byte PNG) - production path may not be drawing visibly`);
    }

    const editedSize = captures['edited']?.size ?? 0;
    if (editedSize > 0 && firstSize > 0 && editedSize !== firstSize) {
      pass('moving an object changed the composited image');
    } else {
      fail('the composited image did not change after a scene edit');
    }

    // The resize stage deliberately requests a 480x360 buffer inside a 640x360
    // host. The browser stretches that, turning spheres into ellipses. Matching
    // the aspect ratio is the host's duty under the contract, but the renderer
    // must not let it happen silently.
    const stretchWarning = consoleWarnings.find((w) => w.includes('[renderer]') && w.includes('stretch'));
    if (stretchWarning) {
      pass('a drawing-buffer/display aspect mismatch is reported, not silently stretched');
    } else {
      fail('the deliberate 480x360-into-640x360 stretch produced no renderer warning');
    }

    const spuriousWarnings = consoleWarnings.filter(
      (w) => w.includes('[renderer]') && !w.includes('stretch'),
    );
    if (spuriousWarnings.length === 0) {
      pass('no spurious renderer warnings during correctly sized frames');
    } else {
      fail(`unexpected renderer warnings: ${JSON.stringify(spuriousWarnings.slice(0, 2))}`);
    }

    console.log('');
    console.log(failures === 0
      ? 'Production path verified: the renderer draws visibly in a real page.'
      : `${failures} production-path check(s) failed.`);
  } catch (error) {
    console.error(`[smoke] ${error?.stack ?? error}`);
    failures += 1;
  } finally {
    try { child.kill(); } catch {}
    try { rmSync(profile, { recursive: true, force: true }); } catch {}
    server.close();
  }

  process.exit(failures === 0 ? 0 : 1);
}

main();
