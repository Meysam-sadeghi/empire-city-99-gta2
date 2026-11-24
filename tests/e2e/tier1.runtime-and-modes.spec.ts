import { expect, test } from '@playwright/test';
import {
  analyzePngBuffer,
  attachRuntimeGuards,
  detectRenderBackend,
  waitForGameReady,
} from './helpers/runtime';
import { enterSpawnedVehicle, holdKeys, startNewGameViaUI, tapKey } from './helpers/input';
import { getActiveWeapon, getMinimapCoords, getMissionPill, getPagerText, getRadioLabel, parseCash } from './helpers/hud';
import { addDebugCash, getTelemetry } from './helpers/debugPanel';

test.describe('Tier 1: Runtime Health, Modes, Lighting & Audio', () => {
  test('T1.1 Runtime & static asset health (0 errors, 0 404s, 0 external requests, non-blank canvas)', async ({
    page,
  }) => {
    const guards = attachRuntimeGuards(page);
    await page.goto('/');
    await waitForGameReady(page);

    const backend = await detectRenderBackend(page);
    expect(['webgl', 'canvas2d']).toContain(backend);

    const titlePng = await page.locator('#game-canvas-container canvas').screenshot();
    const titleStats = await analyzePngBuffer(titlePng);
    expect(titleStats.lumaStdDev).toBeGreaterThan(2.0);
    expect(titleStats.nonBlackRatio).toBeGreaterThan(0.05);

    await startNewGameViaUI(page, { mode: 'casual' });
    await page.waitForTimeout(600);

    const telem = await getTelemetry(page);
    expect(telem.fps).toBeGreaterThan(0);
    expect(telem.drawCalls).toBeGreaterThan(0);

    // Cycle Pause -> Playing -> Map -> Playing -> Journal (if present)
    await tapKey(page, 'Escape');
    await expect(page.getByRole('heading', { name: /^PAUSED$/i })).toBeVisible();
    await tapKey(page, 'Escape');
    await expect(page.getByRole('button', { name: /\[~\]\s*(?:QA\s*)?DEBUG/i })).toBeVisible();

    await tapKey(page, 'Tab');
    await expect(page.getByRole('heading', { name: /FIVE BOROUGHS MAP/i })).toBeVisible();
    await tapKey(page, 'Tab');
    await expect(page.getByRole('button', { name: /\[~\]\s*(?:QA\s*)?DEBUG/i })).toBeVisible();

    const playPng = await page.locator('#game-canvas-container canvas').screenshot();
    const playStats = await analyzePngBuffer(playPng);
    expect(playStats.lumaStdDev).toBeGreaterThan(2.0);
    expect(playStats.nonBlackRatio).toBeGreaterThan(0.05);

    guards.assertClean();
  });

  test('T1.2 Title game modes selection (Story, Kill Frenzy Arcade, Free Roam)', async ({ page }) => {
    test.setTimeout(45_000);
    const guards = attachRuntimeGuards(page);
    await page.goto('/');
    await waitForGameReady(page);

    await expect(page.getByRole('button', { name: /story|casual/i }).first()).toBeVisible({ timeout: 3_000 });
    await expect(page.getByRole('button', { name: /classic/i }).first()).toBeVisible({ timeout: 3_000 });
    await expect(page.getByRole('button', { name: /kill\s*frenzy/i }).first()).toBeVisible({ timeout: 3_000 });
    await expect(page.getByRole('button', { name: /free\s*roam/i }).first()).toBeVisible({ timeout: 3_000 });

    // Launch Kill Frenzy Arcade -> must activate Kill Frenzy HUD challenge
    await startNewGameViaUI(page, { mode: 'frenzy' });
    await expect(page.getByRole('button', { name: /\[~\]\s*(?:QA\s*)?DEBUG/i })).toBeVisible();
    await expect
      .poll(async () => await page.evaluate(() => document.body.innerText), { timeout: 4_000 })
      .toMatch(/KILL FRENZY/i);
    const frenzyBody = await page.evaluate(() => document.body.innerText);
    expect(frenzyBody).toMatch(/\d+\/\d+/);

    // Return to title and launch Free Roam -> sandbox perks (bonus cash/arsenal/free roam state, no forced frenzy)
    await tapKey(page, 'Escape');
    await page.getByRole('button', { name: /RETURN TO TITLE SCREEN/i }).click();
    await waitForGameReady(page);
    await startNewGameViaUI(page, { mode: 'freeroam' });
    await expect(page.getByRole('button', { name: /\[~\]\s*(?:QA\s*)?DEBUG/i })).toBeVisible();
    const freeCash = await parseCash(page);
    const freePager = await getPagerText(page);
    const w0 = await getActiveWeapon(page);
    await tapKey(page, 'KeyE', 60);
    await page.waitForTimeout(100);
    const w1 = await getActiveWeapon(page);
    const hasSandboxPerk =
      freeCash > 2_500 || w1.name !== w0.name || /FREE\s*ROAM/i.test(freePager);
    expect(hasSandboxPerk).toBe(true);
    expect(await getMissionPill(page)).toBeNull();

    guards.assertClean();
  });

  test('T1.3 Lighting modes (Noon, Dusk, Neon Night, Cycle) & KeyT quick-cycling produce measurable luminance delta', async ({
    page,
  }) => {
    test.setTimeout(45_000);
    const guards = attachRuntimeGuards(page);
    await page.goto('/');
    await waitForGameReady(page);

    await startNewGameViaUI(page, { mode: 'casual', lighting: 'noon' });
    await page.waitForTimeout(500);
    const noonPng = await page.locator('#game-canvas-container canvas').screenshot();
    const noonStats = await analyzePngBuffer(noonPng);

    // Cycle via KeyT until Neon Night
    let nightPng: Uint8Array | null = null;
    let bestNightLuma = noonStats.meanLuma;
    for (let i = 0; i < 4; i++) {
      await tapKey(page, 'KeyT');
      await page.waitForTimeout(450);
      const buf = await page.locator('#game-canvas-container canvas').screenshot();
      const stats = await analyzePngBuffer(buf);
      if (stats.meanLuma < bestNightLuma) {
        bestNightLuma = stats.meanLuma;
        nightPng = buf;
      }
    }

    expect(nightPng).not.toBeNull();
    expect(noonStats.meanLuma).toBeGreaterThan(bestNightLuma + 10);

    // Verify Dusk lighting sits strictly between Noon and Neon Night
    await tapKey(page, 'Escape');
    await page.getByRole('button', { name: /RETURN TO TITLE SCREEN/i }).click();
    await waitForGameReady(page);
    await startNewGameViaUI(page, { mode: 'casual', lighting: 'dusk' });
    await page.waitForTimeout(500);
    const duskPng = await page.locator('#game-canvas-container canvas').screenshot();
    const duskStats = await analyzePngBuffer(duskPng);
    expect(noonStats.meanLuma).toBeGreaterThan(duskStats.meanLuma + 4);
    expect(duskStats.meanLuma).toBeGreaterThan(bestNightLuma + 4);

    // Verify Cycle mode launches cleanly and KeyT cycling stays error-free
    await tapKey(page, 'Escape');
    await page.getByRole('button', { name: /RETURN TO TITLE SCREEN/i }).click();
    await waitForGameReady(page);
    await startNewGameViaUI(page, { mode: 'casual', lighting: 'cycle' });
    await tapKey(page, 'KeyT');
    await page.waitForTimeout(250);

    guards.assertClean();
  });

  test('T1.4 Control mode switch (Tank rotates without translating; Directional translates East on D)', async ({
    page,
  }) => {
    const guards = attachRuntimeGuards(page);
    await page.goto('/');
    await waitForGameReady(page);

    await startNewGameViaUI(page, { mode: 'casual', control: 'tank' });
    const p0 = await getMinimapCoords(page);

    // Tank mode: holding D only rotates in place
    await holdKeys(page, ['KeyD'], 650);
    const p1 = await getMinimapCoords(page);
    expect(Math.abs(p1.x - p0.x)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(p1.y - p0.y)).toBeLessThanOrEqual(1.5);

    // Holding W translates along rotated heading
    await holdKeys(page, ['KeyW'], 750);
    const p2 = await getMinimapCoords(page);
    expect(Math.hypot(p2.x - p1.x, p2.y - p1.y)).toBeGreaterThanOrEqual(2.5);

    // Switch to Directional in Pause menu
    await tapKey(page, 'Escape');
    const toggleBtn = page.getByRole('button', { name: /(?:Foot\s*)?Move:/i });
    await expect(toggleBtn).toContainText(/TANK/i);
    await toggleBtn.click();
    await expect(toggleBtn).toContainText(/DIRECTIONAL/i);
    await page.getByRole('button', { name: /RESUME GAME/i }).click();

    const p3 = await getMinimapCoords(page);
    await holdKeys(page, ['KeyD'], 700);
    const p4 = await getMinimapCoords(page);
    expect(p4.x - p3.x).toBeGreaterThanOrEqual(3);

    guards.assertClean();
  });

  test('T1.5 Headless Web Audio resilience, radio cycling (KeyR), and mute toggle (KeyM)', async ({
    page,
  }) => {
    const guards = attachRuntimeGuards(page);
    await page.goto('/');
    await waitForGameReady(page);
    await startNewGameViaUI(page, { mode: 'casual' });

    // Spawn a vehicle right ahead, walk into it, and enter with KeyF
    await enterSpawnedVehicle(page, 'metro_cab', 'KeyW', /Metro Yellow Cab/i);

    const radio1 = await getRadioLabel(page);
    expect(radio1).not.toBeNull();
    await tapKey(page, 'KeyR');
    await page.waitForTimeout(150);
    const radio2 = await getRadioLabel(page);
    expect(radio2).not.toBeNull();
    expect(radio2).not.toEqual(radio1);

    await tapKey(page, 'KeyM');
    await tapKey(page, 'Escape');
    const audioBtn = page.getByRole('button', { name: /Audio:/i });
    await expect(audioBtn).toContainText(/MUTED/i);
    await audioBtn.click();
    await expect(audioBtn).toContainText(/ON/i);

    guards.assertClean();
  });

  test('T1.6 Multi-slot localStorage save and load preserves cash and world coordinates across reload', async ({
    page,
  }) => {
    const guards = attachRuntimeGuards(page);
    await page.goto('/');
    await waitForGameReady(page);
    await startNewGameViaUI(page, { mode: 'casual' });

    await addDebugCash(page);
    await holdKeys(page, ['KeyS'], 1_000);
    const savedCash = await parseCash(page);
    const savedCoords = await getMinimapCoords(page);
    expect(savedCash).toBeGreaterThanOrEqual(102_500);

    await tapKey(page, 'Escape');
    const slot1Row = page.locator('div').filter({ hasText: /^SLOT 1/ }).first();
    await slot1Row.getByRole('button', { name: /^SAVE$/i }).click();

    // Reload browser and load Slot 1 from Title Screen
    await page.reload();
    await waitForGameReady(page);
    const loadSlot1Btn = page.getByRole('button', { name: /SLOT 1/i }).first();
    await expect(loadSlot1Btn).toBeEnabled({ timeout: 4_000 });
    await loadSlot1Btn.click();

    await page.getByRole('button', { name: /\[~\]\s*(?:QA\s*)?DEBUG/i }).waitFor({ state: 'visible', timeout: 8_000 });
    const loadedCash = await parseCash(page);
    const loadedCoords = await getMinimapCoords(page);

    expect(loadedCash).toBe(savedCash);
    expect(Math.abs(loadedCoords.x - savedCoords.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(loadedCoords.y - savedCoords.y)).toBeLessThanOrEqual(2);

    guards.assertClean();
  });
});
