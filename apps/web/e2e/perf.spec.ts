import { expect, test } from '@playwright/test';
import { FakeApi, NOW, fontsReady } from './helpers';

/*
 * Speed (§9.11): a card dragged across a 500-card board keeps up with the screen. This runs
 * on its own after the other tests (the "perf" project), so they don't take its CPU.
 */

test.use({ viewport: { width: 1440, height: 900 } });

test('a 500-card board drags at 60 fps', async ({ page }) => {
  const api = new FakeApi();
  const boardId = api.kanban.seedLargeBoard(500);
  await api.install(page);
  await page.clock.setFixedTime(NOW);
  await page.goto(`/b/${boardId}`);
  await fontsReady(page);
  await expect(page.locator('[data-kb-card]')).toHaveCount(500);
  const box = (await page.locator('[data-kb-card="big-0"]').boundingBox())!;
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 10, from.y + 10, { steps: 2 });
  await expect(page.locator('[data-kb-placeholder]')).toHaveCount(1);
  const heads = page.locator('[data-kb-column-head]');
  const target = (await heads.nth(3).boundingBox())!;

  // The times of the frames the browser draws while the card goes over three columns of 100
  // cards, up and down, so the placeholder keeps moving.
  await page.evaluate(() => {
    const w = window as unknown as { frames_: number[] };
    w.frames_ = [];
    const tick = (t: number) => {
      w.frames_.push(t);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const steps = 90;
  for (let i = 1; i <= steps; i++) {
    const x = from.x + ((target.x + 40 - from.x) * i) / steps;
    const y = from.y + Math.abs(Math.sin(i / 9)) * 560;
    await page.mouse.move(x, y);
    await page.waitForTimeout(16);
  }
  const frames = await page.evaluate(() => (window as unknown as { frames_: number[] }).frames_);
  await page.mouse.up();
  await expect(page.locator('[data-kb-placeholder]')).toHaveCount(0);

  // Headless browsers also draw a frame for each input event, so counting frames says little:
  // what counts is that frames don't run long. At 60 fps a frame has 16.7 ms; 95 in 100 may
  // take at most two.
  const gaps = frames.slice(1).map((t, i) => t - frames[i]!);
  const sorted = [...gaps].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)]!;
  console.log(`500 cards: ${gaps.length} frames, 95th percentile ${p95.toFixed(1)} ms`);
  expect(p95).toBeLessThanOrEqual(34);
});
