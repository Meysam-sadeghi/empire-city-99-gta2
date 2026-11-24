import { expect, test, type Page } from '@playwright/test';
import {
  attachRuntimeGuards,
  captureVerifiedScreenshot,
  detectRenderBackend,
  waitForGameReady,
} from './helpers/runtime';
import {
  clickCanvasAtOffset,
  enterSpawnedVehicle,
  holdKeys,
  startNewGameViaUI,
  tapKey,
  waitForFrames,
  walkToCoords,
  walkToY,
} from './helpers/input';
import {
  getActiveWeapon,
  getAmmo,
  getMinimapCoords,
  getMissionPill,
  getVehicleDash,
  parseCash,
} from './helpers/hud';
import {
  getSpawnerVehicleIds,
  grantArsenal,
  spawnVehicle,
  teleport,
  toggleGodMode,
} from './helpers/debugPanel';

async function selectWeaponByName(page: Page, nameRe: RegExp) {
  for (let i = 0; i < 12; i++) {
    const w = await getActiveWeapon(page);
    if (nameRe.test(w.name)) return w;
    await tapKey(page, 'KeyE', 50);
    await page.waitForTimeout(80);
  }
  throw new Error(`Weapon matching ${nameRe} not found`);
}

test.describe('Tier 4: End-to-End Scenarios & Visual Screenshot Suite', () => {
  test('T4.1 Title Modes & Active Mission Briefing workflow (captures 01 & 05)', async ({
    page,
  }) => {
    const guards = attachRuntimeGuards(page);
    await page.goto('/');
    await waitForGameReady(page);
    expect(await detectRenderBackend(page)).toBe('webgl');

    // 1) Capture 01_title_modes.png
    await captureVerifiedScreenshot(page, '01_title_modes.png');

    const hasFrenzyBtn = await page
      .getByRole('button', { name: /kill\s*frenzy/i })
      .first()
      .isVisible()
      .catch(() => false);
    const hasFreeRoamBtn = await page
      .getByRole('button', { name: /free\s*roam/i })
      .first()
      .isVisible()
      .catch(() => false);
    const hasNoonBtn = await page
      .getByRole('button', { name: /\bnoon\b/i })
      .first()
      .isVisible()
      .catch(() => false);

    if (hasNoonBtn) {
      await page.getByRole('button', { name: /\bnoon\b/i }).first().click();
    }
    await startNewGameViaUI(page, { mode: 'casual' });

    // Walk South 18m to phone_syn_green at (640, 1554)
    await walkToY(page, 1554, 3, true);
    if ((await getMissionPill(page)) === null) {
      await tapKey(page, 'KeyF', 80);
      await page.waitForTimeout(200);
    }

    const pill = await getMissionPill(page);
    expect(pill).not.toBeNull();
    expect(pill!.title).toMatch(/Protection Money/i);

    // Open [J] Briefing modal if available, capture 05_active_mission_briefing_hud.png
    await tapKey(page, 'KeyJ', 80);
    await page.waitForTimeout(250);
    await captureVerifiedScreenshot(page, '05_active_mission_briefing_hud.png');

    expect(hasFrenzyBtn, 'Title Kill Frenzy Arcade mode button missing').toBe(true);
    expect(hasFreeRoamBtn, 'Title Free Roam mode button missing').toBe(true);
    expect(hasNoonBtn, 'Title Noon lighting selector missing').toBe(true);

    const journalVisible = await page
      .locator('div[data-ui-interactive="true"]')
      .filter({ hasText: /Watch out for Yakuza skimmers/i })
      .isVisible()
      .catch(() => false);
    expect(journalVisible).toBe(true);
    await tapKey(page, 'KeyJ', 80);

    // Save to Slot 2 & verify reload persistence
    await tapKey(page, 'Escape', 60);
    const slot2Row = page.locator('div').filter({ hasText: /^SLOT 2/ }).first();
    await slot2Row.getByRole('button', { name: /^SAVE$/i }).click();
    await page.reload();
    await waitForGameReady(page);
    const loadSlot2 = page.getByRole('button', { name: /SLOT 2/i }).first();
    await expect(loadSlot2).toBeEnabled({ timeout: 4_000 });

    guards.assertClean();
  });

  test('T4.2 On-foot jump over parked car & diverse Midtown traffic driving (captures 02 & 03)', async ({
    page,
  }) => {
    const guards = attachRuntimeGuards(page);
    await page.goto('/');
    await waitForGameReady(page);
    expect(await detectRenderBackend(page)).toBe('webgl');

    const noonBtn = page.getByRole('button', { name: /\bnoon\b/i }).first();
    const hasNoon = await noonBtn.isVisible().catch(() => false);
    if (hasNoon) await noonBtn.click();

    await startNewGameViaUI(page, { mode: 'casual' });

    // Move West to x <= 631 to line up south of starter metro_cab (630, 1530)
    await page.waitForTimeout(800);
    for (let step = 0; step < 10; step++) {
      const pos = await getMinimapCoords(page);
      if (pos.x <= 631) break;
      await holdKeys(page, ['KeyA'], 350);
    }
    await holdKeys(page, ['KeyW'], 600);

    const ammoBefore = await getAmmo(page);
    await page.keyboard.down('KeyW');
    try {
      await tapKey(page, 'Space', 80);
      await page.waitForTimeout(220);
      // 2) Capture 02_on_foot_jump_over_car.png mid-jump!
      await captureVerifiedScreenshot(page, '02_on_foot_jump_over_car.png');
      const deadline = Date.now() + 1_400;
      while (Date.now() < deadline) {
        await page.waitForTimeout(200);
        if ((await getMinimapCoords(page)).y <= 1528) break;
      }
    } finally {
      await page.keyboard.up('KeyW');
    }

    const posAfterJump = await getMinimapCoords(page);
    expect(posAfterJump.y).toBeLessThanOrEqual(1528);
    expect(await getAmmo(page)).toBe(ammoBefore);

    // Teleport to Times Square, settle camera, spawn diverse vehicles with 240ms facing & 400ms spacing
    await teleport(page, 'Times Square');
    await waitForFrames(page, 20);
    await page.waitForTimeout(1_500);

    const availableIds = await getSpawnerVehicleIds(page);
    const preferredShowcase = ['gangster_ztype', 'ice_cream_van', 'mta_bus', 'roadster_gt'];
    const showcaseIds = preferredShowcase.every((id) => availableIds.includes(id))
      ? preferredShowcase
      : ['mobster_v8', 'apex_gt', 'mta_bus', 'empire_freight'];

    for (const vehId of showcaseIds.slice(0, 3)) {
      await holdKeys(page, ['KeyW'], 240);
      await spawnVehicle(page, vehId);
      await holdKeys(page, ['KeyD'], 400);
    }

    await enterSpawnedVehicle(page, showcaseIds[3], 'KeyW');
    await holdKeys(page, ['KeyW', 'KeyD'], 950);

    await captureVerifiedScreenshot(page, '03_driving_diverse_traffic.png');
    const dash = await getVehicleDash(page);
    expect(dash).not.toBeNull();
    for (const id of preferredShowcase) {
      expect(availableIds, `Missing M4 showcase vehicle: ${id}`).toContain(id);
    }
    expect(hasNoon).toBe(true);

    guards.assertClean();
  });

  test('T4.3 Dusk/Night combat, damage & chain-reaction explosions (captures 04)', async ({
    page,
  }) => {
    const guards = attachRuntimeGuards(page);
    await page.goto('/');
    await waitForGameReady(page);
    expect(await detectRenderBackend(page)).toBe('webgl');

    const nightBtn = page.getByRole('button', { name: /neon\s*night|\bnight\b/i }).first();
    const hasNight = await nightBtn.isVisible().catch(() => false);
    if (hasNight) await nightBtn.click();

    await startNewGameViaUI(page, { mode: 'casual' });
    await toggleGodMode(page, true);
    await grantArsenal(page);
    await selectWeaponByName(page, /RPG/i);

    // Cluster 3 vehicles in intersection with 240ms facing & 550ms spacing
    await holdKeys(page, ['KeyW'], 240);
    await spawnVehicle(page, 'mobster_v8');
    await holdKeys(page, ['KeyD'], 550);
    await holdKeys(page, ['KeyW'], 240);
    await spawnVehicle(page, 'dons_stretch');
    await holdKeys(page, ['KeyD'], 550);
    await holdKeys(page, ['KeyW'], 240);
    await spawnVehicle(page, 'empire_freight');

    await walkToCoords(page, 643, 1545, 2, true);
    await holdKeys(page, ['KeyW'], 240);
    await waitForFrames(page, 12);
    const cashBefore = await parseCash(page);

    await clickCanvasAtOffset(page, 0, -140, 260);
    // Capture ~280ms into staggered chain detonation for fireball + debris + night glow
    await page.waitForTimeout(280);
    await captureVerifiedScreenshot(page, '04_combat_chain_explosions.png');

    await expect
      .poll(async () => await parseCash(page), { timeout: 6_000, intervals: [300] })
      .toBeGreaterThanOrEqual(cashBefore + 3_000);
    expect(hasNight).toBe(true);

    guards.assertClean();
  });
});
