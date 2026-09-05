import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { getAvailablePort } from '../editor/test-server-helpers.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

async function waitForServer(port, child, output) {
  await Promise.race([
    new Promise((resolve, reject) => {
      const onData = (chunk) => {
        output.value += chunk.toString();
        if (output.value.includes(`http://localhost:${port}`)) resolve();
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.once('exit', (code) => reject(new Error(`PoC server exited with ${code}\n${output.value}`)));
    }),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`PoC server did not start\n${output.value}`)), 10_000);
    }),
  ]);
}

test('edits DOM text and moves mixed scene objects in fallback mode', async () => {
  const port = await getAvailablePort();
  const output = { value: '' };
  const server = spawn(process.execPath, [
    join(REPO_ROOT, 'scripts', 'html-in-canvas-poc.js'),
    '--port',
    String(port),
    '--no-open',
  ], {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let browser;
  try {
    await waitForServer(port, server, output);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(`http://localhost:${port}`, { waitUntil: 'networkidle' });

    await page.waitForFunction(() => window.__htmlInCanvasPoc?.ready === true);
    const initial = await page.evaluate(() => window.__htmlInCanvasPoc.getSnapshot());
    assert.equal(initial.renderer, 'fallback');
    assert.equal(initial.objects.title.text, 'Editable HTML');

    const title = page.locator('#fallback-layer [data-object-id="title"]');
    await title.dblclick();
    await title.locator('h1').fill('Canvas + DOM');
    await page.keyboard.press('Escape');

    const cardBox = await page.locator('#fallback-layer [data-object-id="card"]').boundingBox();
    assert.ok(cardBox, 'card should be visible');
    await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + 24);
    await page.mouse.down();
    await page.mouse.move(cardBox.x + cardBox.width / 2 + 80, cardBox.y + 64, { steps: 4 });
    await page.mouse.up();

    const snapshot = await page.evaluate(() => window.__htmlInCanvasPoc.getSnapshot());
    assert.equal(snapshot.objects.title.text, 'Canvas + DOM');
    assert.equal(snapshot.objects.card.x, 760);
    assert.equal(snapshot.objects.card.y, 320);
    assert.equal(snapshot.canvasShapeCount, 3);
  } finally {
    if (browser) await browser.close();
    server.kill('SIGTERM');
  }
});
