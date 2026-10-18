// Graphics benchmark hook for tools/gfx-bench.mjs (dev-only, never shipped): picks a preset in Settings →
// Graphics, starts Practice on Expert and keeps dispatching with the real pointer — it taps the hinted
// vehicle and then its queue platform on the 3D board (located through the game's own projection, as in
// tests/e2e.mjs), so passengers board with spark bursts, vehicles roll off and lamps glow. A finished round
// goes again with Retry.
// Like tests/e2e.mjs it reads the round state (window.__tt) only to choose the move.
export const presets = ['low', 'balanced', 'high', 'ultra'];
export const levels = { low: 0, balanced: 4, high: 10, ultra: 17 };

export async function setPreset(page, preset) {
  await page.waitForFunction(() => !!window.__tt && window.__tt.session.screen === 'title', null, { timeout: 20000 });
  await page.click('#btn-settings2');
  await page.waitForSelector('#screen-settings:not([hidden])');
  await page.locator('#set-quality').scrollIntoViewIfNeeded();
  await page.selectOption('#set-quality', preset);
  await page.waitForFunction((p) => document.body.dataset.gfxPreset === p, preset);
  await page.locator('#btn-settings-close').scrollIntoViewIfNeeded();
  await page.click('#btn-settings-close');
  await page.waitForSelector('#screen-settings', { state: 'hidden' });
}

// The hinted (or first legal) dispatch as screen points: the vehicle, then its queue platform's front.
const nextMove = (page) => page.evaluate(() => {
  const t = window.__tt, s = t.session.state;
  if (!document.getElementById('screen-results').hidden) return { retry: true };
  if (t.session.screen !== 'active' || !s || s.status !== 'active') return null;
  let mv = t.R.hint(s);
  if (!mv) { const la = t.R.legalActions(s); if (!la || !la.length) return null; mv = { v: la[0].vehicle, q: la[0].queue }; }
  const v = t.projectWorld((mv.v - (s.v.length - 1) / 2) * 2.8, 0.6, 5.4);
  const q = t.projectWorld((mv.q - (s.q.length - 1) / 2) * 2.6, 0.09, -3.6);
  return { v: { x: v.x, y: v.y }, q: { x: q.x, y: q.y } };
});

export async function start(page, { mobile } = {}) {
  await page.click('#btn-practice');
  await page.waitForSelector('#screen-setup:not([hidden])');
  await page.click('#setup-difficulty [data-diff="expert"]');
  if (await page.locator('#btn-setup-start').isVisible()) await page.click('#btn-setup-start');
  await page.waitForFunction(() => window.__tt?.session?.screen === 'active', null, { timeout: 20000 });
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  const tap = (p) => (mobile ? page.touchscreen.tap(p.x, p.y) : page.mouse.click(p.x, p.y));
  let open = true;
  page.once('close', () => { open = false; });
  (async () => {
    while (open) {
      try {
        const m = await nextMove(page);
        if (m?.retry) {
          await page.click('#btn-results-retry', { timeout: 3000 });
          await page.waitForFunction(() => window.__tt?.session?.screen === 'active', null, { timeout: 10000 });
        } else if (m) {
          await tap(m.v);
          await page.waitForTimeout(150);
          await tap(m.q);
        }
      } catch (e) { if (!open) return; if (process.env.BENCH_DEBUG) console.error(e.message); }
      await page.waitForTimeout(600).catch(() => {});
    }
  })();
  await page.waitForTimeout(1500);
}
