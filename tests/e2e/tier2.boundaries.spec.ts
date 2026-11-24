import { expect, test, type Page } from '@playwright/test';
import { attachRuntimeGuards, waitForGameReady } from './helpers/runtime';
import {
  clickCanvasAtOffset,
  enterSpawnedVehicle,
  holdKeys,
  holdKeysUntil,
  startNewGameViaUI,
  tapKey,
  waitForFrames,
  walkToCoords,
} from './helpers/input';
import {
  getActiveWeapon,
  getAmmo,
  getHealthAndArmor,
  getMinimapCoords,
  getMissionPill,
  getMissionTimerSec,
  getMultiplier,
  getPagerText,
  getRadioLabel,
  getVehicleDash,
  getWantedStars,
  parseCash,
} from './helpers/hud';
import {
  getTelemetry,
  grantArsenal,
  launchMission,
  setWanted,
  spawnVehicle,
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

test.describe('Tier 2: Boundary & Corner Cases', () => {
  test('T2.1 Standstill steering and rapid forward<->reverse transitions without deadzone stall', async ({
    page,
  }) => {
    const guards = attachRuntimeGuards(page);
    await page.goto('/');
    await waitForGameReady(page);
    await startNewGameViaUI(page, { mode: 'casual' });

    await enterSpawnedVehicle(page, 'metro_cab', 'KeyW', /Metro Yellow Cab/i);

    const d0 = await getVehicleDash(page);
    expect(d0).not.toBeNull();
    expect(d0!.speedKmh).toBe(0);

    const p0 = await getMinimapCoords(page);
    // Immediate W+D from 0 KM/H -> zero pause -> S+A -> W+A
    await holdKeysUntil(
      page,
      ['KeyW', 'KeyD'],
      async () => {
        const p = await getMinimapCoords(page);
        return Math.abs(p.x - p0.x) + Math.abs(p.y - p0.y) >= 2;
      },
      3_400,
      220
    );
    const p1 = await getMinimapCoords(page);
    await holdKeysUntil(
      page,
      ['KeyS', 'KeyA'],
      async () => ((await getVehicleDash(page))?.speedKmh ?? 0) > 0,
      3_400,
      220
    );
    const dRev = await getVehicleDash(page);
    const p2 = await getMinimapCoords(page);
    await holdKeysUntil(
      page,
      ['KeyW', 'KeyA'],
      async () => {
        const d = await getVehicleDash(page);
        const p = await getMinimapCoords(page);
        return d !== null && d.speedKmh > 0 && Math.hypot(p.x - p2.x, p.y - p2.y) >= 1.5;
      },
      3_400,
      220
    );
    const dFwd = await getVehicleDash(page);
    const p3 = await getMinimapCoords(page);

    expect(Math.abs(p1.x - p0.x) + Math.abs(p1.y - p0.y)).toBeGreaterThanOrEqual(2);
    expect(dRev!.speedKmh).toBeGreaterThan(0);
    expect(dFwd!.speedKmh).toBeGreaterThan(0);
    expect(Math.hypot(p3.x - p2.x, p3.y - p2.y)).toBeGreaterThanOrEqual(1.5);

    guards.assertClean();
  });

  test('T2.2 Jump preserves building wall collision while safely clearing long mta_bus', async ({
    page,
  }) => {
    const guards = attachRuntimeGuards(page);
    await page.goto('/');
    await waitForGameReady(page);
    await startNewGameViaUI(page, { mode: 'casual' });

    // Walk North to (640, 1494), then step West into NW block (596, 1492) East face until 2 consecutive < 0.5m deltas
    await walkToCoords(page, 640, 1494, 3, true);
    let prevWallPos = await getTelemetry(page);
    let consecutiveZero = 0;
    for (let step = 0; step < 20; step++) {
      await holdKeys(page, ['KeyA'], 450);
      const cur = await getTelemetry(page);
      const delta = Math.hypot(cur.x - prevWallPos.x, cur.y - prevWallPos.y);
      prevWallPos = cur;
      if (delta < 0.5 && cur.x <= 616) {
        consecutiveZero++;
        if (consecutiveZero >= 2) break;
      } else {
        consecutiveZero = 0;
      }
    }
    expect(consecutiveZero).toBeGreaterThanOrEqual(2);
    const againstWall = await getTelemetry(page);
    expect(againstWall.x).toBeLessThanOrEqual(616);

    // Jump directly West into the solid building wall -> must NOT tunnel through (< 2.0m delta)
    await page.keyboard.down('KeyA');
    try {
      await tapKey(page, 'Space', 80);
      await page.waitForTimeout(1_300);
    } finally {
      await page.keyboard.up('KeyA');
    }
    const afterWallJump = await getTelemetry(page);
    expect(Math.hypot(afterWallJump.x - againstWall.x, afterWallJump.y - againstWall.y)).toBeLessThan(2.0);
    expect(afterWallJump.x).toBeGreaterThanOrEqual(againstWall.x - 1.5);

    // Return to open intersection (640, 1536), spawn long mta_bus (8.6m) ahead and jump across
    await walkToCoords(page, 640, 1536, 3, true);
    await holdKeys(page, ['KeyW'], 240);
    await spawnVehicle(page, 'mta_bus');

    const beforeBusJump = await getTelemetry(page);
    await page.keyboard.down('KeyW');
    try {
      await page.waitForTimeout(550);
      await tapKey(page, 'Space', 80);
      const deadline = Date.now() + 1_600;
      while (Date.now() < deadline) {
        await page.waitForTimeout(200);
        if ((await getMinimapCoords(page)).y <= beforeBusJump.y - 4) break;
      }
    } finally {
      await page.keyboard.up('KeyW');
    }

    const landed = await getTelemetry(page);
    expect(landed.y).toBeLessThanOrEqual(beforeBusJump.y - 4);

    // Confirm player is NOT trapped/soft-locked inside bus OBB: can walk East cleanly
    await holdKeys(page, ['KeyD'], 700);
    const afterWalk = await getTelemetry(page);
    expect(afterWalk.x - landed.x).toBeGreaterThanOrEqual(3);

    guards.assertClean();
  });

  test('T2.3 Chain explosion boundary: adjacent 300 HP mta_bus detonates while 35m distant car survives', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const guards = attachRuntimeGuards(page);
    await page.goto('/');
    await waitForGameReady(page);
    await startNewGameViaUI(page, { mode: 'casual' });

    await toggleGodMode(page, true);
    await grantArsenal(page);
    await selectWeaponByName(page, /RPG/i);

    // Place city_sedan deep inside traffic-free Wall Street Plaza (576, 1606.5), 72m South of (576, 1534)
    await walkToCoords(page, 640, 1534, 2, true, 16);
    await walkToCoords(page, 576, 1534, 3, true, 26);
    await walkToCoords(page, 576, 1614, 2, true, 36);
    await holdKeys(page, ['KeyW'], 240);
    await spawnVehicle(page, 'city_sedan');

    // Return North to y=1536 avenue (576, 1534), spawn metro_cab + adjacent 300 HP mta_bus (550ms spaced: zero overlap, edgeDist <= 4.5m)
    await walkToCoords(page, 576, 1534, 2, true, 36);
    await holdKeys(page, ['KeyW'], 240);
    await spawnVehicle(page, 'metro_cab');
    await holdKeys(page, ['KeyD'], 550);
    await holdKeys(page, ['KeyW'], 240);
    await spawnVehicle(page, 'mta_bus');

    // Back off South to (578, 1546) and fire RPG North into cluster
    await walkToCoords(page, 578, 1546, 2, true, 16);
    await holdKeys(page, ['KeyW'], 240);
    await waitForFrames(page, 12);
    const cashBefore = await parseCash(page);
    await clickCanvasAtOffset(page, 0, -140, 260);

    await expect
      .poll(async () => await parseCash(page), { timeout: 6_000, intervals: [300] })
      .toBeGreaterThanOrEqual(cashBefore + 2_000);

    // Clear wanted heat so pursuing NYPD cruisers do not chase into Wall Street Plaza and overlap city_sedan
    await setWanted(page, 0);

    // Walk South into traffic-free Wall Street Plaza to city_sedan at (576, 1606.5) and enter it to prove it survived undamaged
    await walkToCoords(page, 576, 1606, 1.5, true, 36);
    for (let i = 0; i < 6; i++) {
      const cur = await getVehicleDash(page);
      if (cur && /City\s*Sedan/i.test(cur.name)) break;
      if (cur) {
        await tapKey(page, 'KeyF', 90);
        await page.waitForTimeout(180);
      }
      await tapKey(page, 'KeyF', 90);
      await page.waitForTimeout(200);
      const after = await getVehicleDash(page);
      if (after && /City\s*Sedan/i.test(after.name)) break;
      if (after) {
        await tapKey(page, 'KeyF', 90);
        await page.waitForTimeout(180);
      }
      await holdKeys(page, ['KeyS'], 240);
    }
    const sedanDash = await getVehicleDash(page);
    expect(sedanDash).not.toBeNull();
    expect(sedanDash!.name).toMatch(/City\s*Sedan/i);
    expect(sedanDash!.hpPct).toBe(100);

    guards.assertClean();
  });

  test('T2.4 Enter key focus guard: clicking HUD [R] RADIO then pressing Enter does NOT re-trigger button', async ({
    page,
  }) => {
    const guards = attachRuntimeGuards(page);
    await page.goto('/');
    await waitForGameReady(page);
    await startNewGameViaUI(page, { mode: 'casual' });

    // Enter a car so radio station badge is visible
    await enterSpawnedVehicle(page, 'metro_cab', 'KeyW', /Metro Yellow Cab/i);

    // Click HUD [R] RADIO button (leaves focus if unguarded)
    await page.getByRole('button', { name: /RADIO/i }).click();
    await page.waitForTimeout(150);
    const stationAfterClick = await getRadioLabel(page);
    expect(stationAfterClick).not.toBeNull();

    // Press Enter while playing -> should NOT cycle radio again
    await tapKey(page, 'Enter', 70);
    await page.waitForTimeout(200);
    // Re-enter car if Enter exited it, and check radio did not change on Enter
    if ((await getVehicleDash(page)) === null) {
      await tapKey(page, 'KeyF', 80);
      await page.waitForTimeout(150);
    }
    const stationAfterEnter = await getRadioLabel(page);
    expect(stationAfterEnter).toBe(stationAfterClick);

    guards.assertClean();
  });

  test('T2.5 Ctrl+W and Ctrl+R chords while driving with Dual Uzis do not close/reload tab', async ({
    page,
  }) => {
    const guards = attachRuntimeGuards(page);
    await page.goto('/');
    await waitForGameReady(page);
    await startNewGameViaUI(page, { mode: 'casual' });

    await grantArsenal(page);
    await selectWeaponByName(page, /DUAL\s*UZI/i);
    const ammoBefore = await getAmmo(page);

    await enterSpawnedVehicle(page, 'metro_cab', 'KeyW', /Metro Yellow Cab/i);

    // Hold Ctrl + W (drive + drive-by fire) and Ctrl + R
    await holdKeys(page, ['ControlLeft', 'KeyW'], 600);
    await holdKeys(page, ['ControlLeft', 'KeyR'], 250);

    // Page must remain alive in playing screen with Dual Uzi ammo consumed
    await expect(page.getByRole('button', { name: /\[~\]\s*(?:QA\s*)?DEBUG/i })).toBeVisible();
    expect(await getVehicleDash(page)).not.toBeNull();
    const ammoAfter = await getAmmo(page);
    expect(ammoAfter).toBeLessThan(ammoBefore);

    guards.assertClean();
  });

  test('T2.6 WASTED & BUSTED summary cards and clean state recovery', async ({ page }) => {
    test.setTimeout(90_000);
    const guards = attachRuntimeGuards(page);
    await page.goto('/');
    await waitForGameReady(page);
    await startNewGameViaUI(page, { mode: 'casual' });

    await toggleGodMode(page, false);
    await grantArsenal(page);
    await selectWeaponByName(page, /RPG/i);

    // Walk 55m away from hospital respawn (640, 1536) to (610, 1494) and fire RPG point-blank at wall
    await walkToCoords(page, 610, 1494, 3, true);
    const cashBeforeWasted = await parseCash(page);
    await holdKeys(page, ['KeyA'], 240);
    await waitForFrames(page, 10);
    for (let i = 0; i < 4; i++) {
      const wastedVisible = await page.getByText(/PROCESSED AT EMPIRE GENERAL HOSPITAL/i).isVisible().catch(() => false);
      if (wastedVisible) break;
      await clickCanvasAtOffset(page, -60, 0, 260);
      await page.waitForTimeout(1_500);
    }
    await expect(page.getByText(/PROCESSED AT EMPIRE GENERAL HOSPITAL/i)).toBeVisible({ timeout: 5_000 });
    // Verify M4 WASTED summary card shows penalty breakdown stats (hospital fee / multiplier reset)
    const wastedBody = await page.evaluate(() => document.body.innerText);
    expect(wastedBody).toMatch(/WASTED/i);
    expect(wastedBody).toMatch(/HOSPITAL|PENALTY|MULTIPLIER|FEE/i);

    // Wait for WASTED continue to become enabled (or auto-respawn) and ensure WASTED card is fully dismissed before BUSTED
    const continueBtn = page.getByRole('button', { name: /continue|respawn/i }).first();
    await expect
      .poll(async () => {
        const vis = await page.getByText(/PROCESSED AT EMPIRE GENERAL HOSPITAL/i).isVisible().catch(() => false);
        if (!vis) return 'dismissed';
        if (await continueBtn.isEnabled().catch(() => false)) {
          await continueBtn.click().catch(() => {});
        }
        return 'waiting';
      }, { timeout: 15_000, intervals: [350] })
      .toBe('dismissed');
    await expect.poll(async () => (await getHealthAndArmor(page)).hp, { timeout: 8_000 }).toBe(100);
    expect(await getMultiplier(page)).toBe(1);
    expect(await parseCash(page)).toBeLessThan(cashBeforeWasted);

    // Now trigger BUSTED: 3-star wanted (4 cruisers + 5 cops, 60s combined decay) while standing still
    await setWanted(page, 3);
    await expect.poll(async () => await getWantedStars(page)).toBe(3);

    await expect(page.getByText(/PROCESSED AT MIDTOWN NYPD PRECINCT/i)).toBeVisible({ timeout: 35_000 });
    const bustedBody = await page.evaluate(() => document.body.innerText);
    expect(bustedBody).toMatch(/BUSTED/i);
    expect(bustedBody).toMatch(/BAIL|PRECINCT|PENALTY|CONFISCATED|FEE/i);
    const bustedContinue = page.getByRole('button', { name: /continue|respawn/i }).first();
    await expect
      .poll(async () => {
        const vis = await page.getByText(/PROCESSED AT MIDTOWN NYPD PRECINCT/i).isVisible().catch(() => false);
        if (!vis) return 'dismissed';
        if (await bustedContinue.isEnabled().catch(() => false)) {
          await bustedContinue.click().catch(() => {});
        }
        return 'waiting';
      }, { timeout: 15_000, intervals: [350] })
      .toBe('dismissed');
    await expect.poll(async () => await getWantedStars(page), { timeout: 8_000 }).toBe(0);

    guards.assertClean();
  });

  test('T2.7 M11 Bridge Blockade defense-zone boundary & no bogus 0/5 counter', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const guards = attachRuntimeGuards(page);
    await page.goto('/');
    await waitForGameReady(page);
    await startNewGameViaUI(page, { mode: 'casual' });

    await toggleGodMode(page, true);
    await launchMission(page, 'bro_bridge_blockade');
    await waitForFrames(page, 20);

    const pill = await getMissionPill(page);
    expect(pill).not.toBeNull();
    expect(pill!.title).toMatch(/Bridge Blockade/i);
    // Must NOT display bogus "0/5" counter during defense timer
    expect(pill!.progressText ?? '').not.toMatch(/0\/5/);

    const t1 = await getMissionTimerSec(page);
    expect(t1).not.toBeNull();

    // Center on Manhattan Bridge (1320, 1280), board apex_gt facing East (KeyD onto solid Brooklyn concrete, zero East River!) and drive > 72m out of 65m radius
    await walkToCoords(page, 1320, 1280, 1.5, true);
    await enterSpawnedVehicle(page, 'apex_gt', 'KeyD', /Apex GT/i);
    await holdKeysUntil(
      page,
      ['KeyW'],
      async () => {
        const p = await getMinimapCoords(page);
        return Math.hypot(p.x - 1320, p.y - 1280) > 72;
      },
      12_500,
      200
    );

    const outPos = await getMinimapCoords(page);
    expect(Math.hypot(outPos.x - 1320, outPos.y - 1280)).toBeGreaterThan(68);

    // Wait 2.2s outside zone: timer must pause (tOutAfter === tOutBefore) and HUD/pager must warn to return to bridge
    const tOutBefore = await getMissionTimerSec(page);
    expect(tOutBefore).not.toBeNull();
    await page.waitForTimeout(2_200);
    const t2 = await getMissionTimerSec(page);
    expect(t2).toBe(tOutBefore);
    const outText = `${await getPagerText(page)} ${await page.evaluate(() => document.body.innerText)}`;
    expect(outText).toMatch(/RETURN|BRIDGE|ZONE|PERIMETER/i);

    // Handbrake-stop at ~75m first so forward momentum doesn't carry past 150m, then reverse back inside 55m radius
    await holdKeys(page, ['Space'], 550);
    await holdKeysUntil(
      page,
      ['KeyS'],
      async () => {
        const p = await getMinimapCoords(page);
        return Math.hypot(p.x - 1320, p.y - 1280) <= 55;
      },
      9_500,
      150
    );
    await expect
      .poll(async () => (await getMissionTimerSec(page)) ?? 999, { timeout: 6_000, intervals: [300] })
      .toBeLessThan(t2!);

    guards.assertClean();
  });

  test('T2.8 Finale (King of the Five Boroughs) remains replayable after failure', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const guards = attachRuntimeGuards(page);
    await page.goto('/');
    await waitForGameReady(page);
    await startNewGameViaUI(page, { mode: 'casual' });

    await toggleGodMode(page, false);
    await launchMission(page, 'king_of_five_boroughs');
    await waitForFrames(page, 20);
    expect((await getMissionPill(page))?.title).toMatch(/King of the Five Boroughs/i);

    // Get WASTED to fail Finale by detonating a spawned vehicle point-blank
    await selectWeaponByName(page, /RPG/i);
    await holdKeys(page, ['KeyW'], 240);
    await spawnVehicle(page, 'metro_cab');
    await holdKeys(page, ['KeyW'], 600);
    for (let i = 0; i < 4; i++) {
      if (await page.getByText(/WASTED/i).first().isVisible()) break;
      await clickCanvasAtOffset(page, 0, -70, 120);
      await page.waitForTimeout(1_500);
    }
    await expect(page.getByText(/WASTED/i).first()).toBeVisible({ timeout: 5_000 });
    const continueBtn = page.getByRole('button', { name: /continue|respawn/i }).first();
    if (await continueBtn.isEnabled().catch(() => false)) {
      await continueBtn.click().catch(() => {});
    }
    await expect.poll(async () => (await getHealthAndArmor(page)).hp, { timeout: 8_000 }).toBe(100);
    expect(await getMissionPill(page)).toBeNull();

    // Verify Finale can be re-triggered cleanly after failure
    await launchMission(page, 'king_of_five_boroughs');
    expect((await getMissionPill(page))?.title).toMatch(/King of the Five Boroughs/i);

    guards.assertClean();
  });
});
