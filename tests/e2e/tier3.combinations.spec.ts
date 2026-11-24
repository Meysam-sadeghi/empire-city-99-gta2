import { expect, test, type Page } from '@playwright/test';
import {
  analyzePngBuffer,
  attachRuntimeGuards,
  waitForGameReady,
} from './helpers/runtime';
import {
  aimCanvasAtOffset,
  clickCanvasAtOffset,
  enterSpawnedVehicle,
  holdKeys,
  holdKeysUntil,
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
  getMultiplier,
  getPagerText,
  getVehicleDash,
  getWantedStars,
  parseCash,
} from './helpers/hud';
import {
  addDebugCash,
  getTelemetry,
  grantArsenal,
  setWanted,
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

async function driveToCoords(
  page: Page,
  targetX: number,
  targetY: number,
  toleranceM = 11,
  maxSteps = 60
): Promise<void> {
  let prev = await getMinimapCoords(page);
  await holdKeys(page, ['KeyW'], 220);
  let curr = await getMinimapCoords(page);
  let heading = Math.atan2(curr.y - prev.y, curr.x - prev.x);
  if (Math.hypot(curr.x - prev.x, curr.y - prev.y) < 0.5) heading = 0;

  for (let step = 0; step < maxSteps; step++) {
    const dist = Math.hypot(targetX - curr.x, targetY - curr.y);
    if (dist <= toleranceM) return;

    const desired = Math.atan2(targetY - curr.y, targetX - curr.x);
    let diff = desired - heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;

    const keys = ['KeyW'];
    if (diff > 0.18) keys.push('KeyD');
    else if (diff < -0.18) keys.push('KeyA');

    const stepMs = dist > 45 ? 360 : dist > 20 ? 240 : 160;
    prev = curr;
    await holdKeys(page, keys, stepMs);
    curr = await getMinimapCoords(page);

    if (Math.hypot(curr.x - prev.x, curr.y - prev.y) >= 0.8) {
      heading = Math.atan2(curr.y - prev.y, curr.x - prev.x);
    } else {
      await holdKeys(page, ['KeyS', diff >= 0 ? 'KeyA' : 'KeyD'], 350);
      prev = curr;
      await holdKeys(page, ['KeyW'], 240);
      curr = await getMinimapCoords(page);
      if (Math.hypot(curr.x - prev.x, curr.y - prev.y) >= 0.6) {
        heading = Math.atan2(curr.y - prev.y, curr.x - prev.x);
      }
    }
  }
}

test.describe('Tier 3: Cross-Feature Combinations', () => {
  test('T3.1 Driving + drive-by shooting simultaneously (W+D+Ctrl + mouse sweep)', async ({
    page,
  }) => {
    const guards = attachRuntimeGuards(page);
    await page.goto('/');
    await waitForGameReady(page);
    await startNewGameViaUI(page, { mode: 'casual' });

    await grantArsenal(page);
    await selectWeaponByName(page, /DUAL\s*UZI/i);
    const ammoBefore = await getAmmo(page);

    await enterSpawnedVehicle(page, 'apex_gt', 'KeyW', /Apex GT/i);

    const p0 = await getMinimapCoords(page);
    await aimCanvasAtOffset(page, 140, -90);
    await holdKeysUntil(
      page,
      ['KeyW', 'KeyD', 'ControlLeft'],
      async () => {
        const d = await getVehicleDash(page);
        const p = await getMinimapCoords(page);
        const a = await getAmmo(page);
        return (
          d !== null &&
          d.speedKmh >= 25 &&
          Math.abs(p.x - p0.x) >= 3 &&
          Math.abs(p.y - p0.y) >= 3 &&
          a < ammoBefore
        );
      },
      3_400,
      220
    );
    const dash = await getVehicleDash(page);
    const p1 = await getMinimapCoords(page);
    const ammoAfter = await getAmmo(page);

    expect(dash).not.toBeNull();
    expect(dash!.speedKmh).toBeGreaterThanOrEqual(25);
    expect(Math.abs(p1.x - p0.x)).toBeGreaterThanOrEqual(3);
    expect(Math.abs(p1.y - p0.y)).toBeGreaterThanOrEqual(3);
    expect(ammoAfter).toBeLessThan(ammoBefore);

    guards.assertClean();
  });

  test('T3.2 Neon Night lighting + headlights + chain explosion brightness flash', async ({
    page,
  }) => {
    const guards = attachRuntimeGuards(page);
    await page.goto('/');
    await waitForGameReady(page);
    await startNewGameViaUI(page, { mode: 'casual', lighting: 'night' });

    await toggleGodMode(page, true);
    await grantArsenal(page);
    await selectWeaponByName(page, /RPG/i);

    // Spawn 2 adjacent vehicles with 240ms facing & 550ms spacing (no Rapier overlap)
    await holdKeys(page, ['KeyW'], 240);
    await spawnVehicle(page, 'metro_cab');
    await holdKeys(page, ['KeyD'], 550);
    await holdKeys(page, ['KeyW'], 240);
    await spawnVehicle(page, 'mobster_v8');

    await holdKeys(page, ['KeyS'], 1_300);
    await holdKeys(page, ['KeyW'], 240);
    await waitForFrames(page, 12);
    const nightBaselineBuf = await page.locator('#game-canvas-container canvas').screenshot();
    const nightBaseline = await analyzePngBuffer(nightBaselineBuf);

    const cashBefore = await parseCash(page);
    await clickCanvasAtOffset(page, 0, -140, 260);
    await page.waitForTimeout(250);
    const flashBuf = await page.locator('#game-canvas-container canvas').screenshot();
    const flashStats = await analyzePngBuffer(flashBuf);

    await expect
      .poll(async () => await parseCash(page), { timeout: 6_000, intervals: [300] })
      .toBeGreaterThanOrEqual(cashBefore + 2_000);
    expect(flashStats.meanLuma).toBeGreaterThan(nightBaseline.meanLuma);

    guards.assertClean();
  });

  test('T3.3 Wanted escalation (3★) + collision damage + Little Italy Pay n Spray repair & clear', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const guards = attachRuntimeGuards(page);
    await page.goto('/');
    await waitForGameReady(page);
    await startNewGameViaUI(page, { mode: 'casual' });

    await toggleGodMode(page, true);

    // Stand at (648, 1494) so spawning West puts 6.2m dons_stretch cleanly at (640.5, 1494) in open lane, well clear of NW wall
    await walkToCoords(page, 648, 1494, 2, true, 16);
    await enterSpawnedVehicle(page, 'dons_stretch', 'KeyA', /Syndicate Limo/i);

    // Damage car against NW block East face until < 80% HP (stop with > 55% HP remaining)
    for (let i = 0; i < 9; i++) {
      await holdKeys(page, ['KeyW'], 1_700);
      const dash = await getVehicleDash(page);
      if (dash && dash.hpPct < 80) break;
      await holdKeys(page, ['KeyS'], 850);
    }
    const damagedDash = await getVehicleDash(page);
    expect(damagedDash).not.toBeNull();
    expect(damagedDash!.hpPct).toBeLessThan(80);

    // Reverse straight East to x >= 644 (ample room to turn South without clipping NW block) -> (640, 1536)
    await holdKeysUntil(
      page,
      ['KeyS'],
      async () => (await getMinimapCoords(page)).x >= 644,
      3_200,
      200
    );
    await driveToCoords(page, 640, 1536, 12, 24);
    expect(await getVehicleDash(page)).not.toBeNull();

    // Escalate to 3★ wanted while on open avenue and head to Little Italy Pay 'n' Spray (384, 1728)
    await setWanted(page, 3);
    expect(await getWantedStars(page)).toBe(3);

    const cashBeforeSpray = await parseCash(page);
    expect(cashBeforeSpray).toBeGreaterThanOrEqual(500);

    // Drive West/South to Little Italy Pay 'n' Spray (384, 1728)
    await driveToCoords(page, 512, 1536, 13, 35);
    await driveToCoords(page, 384, 1536, 13, 35);
    await driveToCoords(page, 384, 1728, 12, 90);
    await expect.poll(async () => (await getVehicleDash(page))?.hpPct ?? 0, { timeout: 3_000 }).toBe(100);

    const repairedDash = await getVehicleDash(page);
    expect(repairedDash).not.toBeNull();
    expect(repairedDash!.hpPct).toBe(100);
    expect(await getWantedStars(page)).toBe(0);
    expect(await parseCash(page)).not.toBe(cashBeforeSpray);
    expect(await getPagerText(page)).toMatch(/PAY 'N' SPRAY/i);

    guards.assertClean();
  });

  test('T3.4 Active mission + run-over multiplier combo + checkpoint progression', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const guards = attachRuntimeGuards(page);
    await page.goto('/');
    await waitForGameReady(page);
    await startNewGameViaUI(page, { mode: 'casual' });

    await toggleGodMode(page, true);

    // Trigger Mission #1 at phone_syn_green (640, 1554)
    await walkToY(page, 1554, 3, true);
    if ((await getMissionPill(page)) === null) {
      await tapKey(page, 'KeyF', 80);
    }
    await expect.poll(async () => (await getMissionPill(page))?.title ?? '').toMatch(/Protection Money/i);

    // Board Mobster V8 at (640, 1520)
    await walkToY(page, 1522, 3, true);
    await tapKey(page, 'KeyF', 90);
    await expect.poll(async () => (await getVehicleDash(page))?.name ?? '').toMatch(/Mobster V8/i);

    // Run over peds across Central Park's 34-106m ped spawn ring using smooth 280ms steps so Mobster V8 stays intact
    const startCash = await parseCash(page);
    await teleport(page, 'Central Park');
    await waitForFrames(page, 18);
    await expect
      .poll(async () => (await getTelemetry(page)).peds, { timeout: 22_000, intervals: [600] })
      .toBeGreaterThanOrEqual(14);

    let currCp = await getMinimapCoords(page);
    await holdKeys(page, ['KeyW'], 220);
    const nextCp = await getMinimapCoords(page);
    let headingCp = Math.atan2(nextCp.y - currCp.y, nextCp.x - currCp.x);
    currCp = nextCp;

    // Follow Mobster V8's East heading (0) along pond-free Central Park drives & NE grass ring with controlled 175ms pulses
    for (const [wx, wy] of [
      [705, 256],
      [705, 195],
      [575, 195],
      [575, 315],
      [705, 315],
      [740, 220],
      [640, 195],
      [740, 325],
      [600, 325],
      [600, 205],
      [720, 260],
      [600, 220],
      [720, 300],
      [580, 260],
      [680, 200],
      [680, 320],
    ] as const) {
      if ((await getMultiplier(page)) >= 2 && (await parseCash(page)) > startCash) break;
      for (let step = 0; step < 18; step++) {
        if ((await getMultiplier(page)) >= 2 && (await parseCash(page)) > startCash) break;
        if ((await getVehicleDash(page)) === null) break;
        if (Math.hypot(wx - currCp.x, wy - currCp.y) <= 18) break;
        const desired = Math.atan2(wy - currCp.y, wx - currCp.x);
        let diff = desired - headingCp;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        const keys = ['KeyW'];
        if (diff > 0.2) keys.push('KeyD');
        else if (diff < -0.2) keys.push('KeyA');
        const prev = currCp;
        await holdKeys(page, keys, 320);
        currCp = await getMinimapCoords(page);
        if (Math.hypot(currCp.x - prev.x, currCp.y - prev.y) >= 0.6) {
          headingCp = Math.atan2(currCp.y - prev.y, currCp.x - prev.x);
        } else {
          await holdKeys(page, ['KeyS', diff >= 0 ? 'KeyA' : 'KeyD'], 280);
          currCp = await getMinimapCoords(page);
        }
      }
    }

    expect(await getMultiplier(page)).toBeGreaterThanOrEqual(2);
    expect(await parseCash(page)).toBeGreaterThan(startCash);

    // Teleport back to Financial Dist. and hit Checkpoint 1 at (512, 1536)
    await teleport(page, 'Financial Dist.');
    await driveToCoords(page, 512, 1536, 13, 35);
    await expect.poll(async () => (await getMissionPill(page))?.progressText ?? '').toMatch(/1\/3|2\/3/);

    guards.assertClean();
  });

  test('T3.5 Classic 99 $10K Chapel save gate & in-world Kill Frenzy skull pickup', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const guards = attachRuntimeGuards(page);
    await page.goto('/');
    await waitForGameReady(page);
    await startNewGameViaUI(page, { mode: 'classic' });

    await toggleGodMode(page, true);
    const startCash = await parseCash(page);
    expect(startCash).toBe(2_500);

    // Drive metro_cab East to St. Jude Sanctuary Chapel at (768, 1536)
    await enterSpawnedVehicle(page, 'metro_cab', 'KeyW', /Metro Yellow Cab/i);
    await driveToCoords(page, 768, 1536, 10, 40);
    await tapKey(page, 'KeyF', 80); // exit onto foot inside chapel radius

    // Walk into chapel center (768, 1536) with < $10,000 -> must NOT save or deduct cash
    await walkToCoords(page, 768, 1536, 3, true, 14);
    await expect
      .poll(async () => await getPagerText(page), { timeout: 10_000, intervals: [400] })
      .toMatch(/CHAPEL SAVE COSTS \$10,000/i);
    expect(await parseCash(page)).toBe(startCash);

    // Grant +$100,000, step into chapel center -> deducts $10,000 & saves!
    await addDebugCash(page);
    const cashAfterDebug = await parseCash(page);
    await walkToCoords(page, 768, 1536, 2, true, 10);
    await expect
      .poll(async () => await getPagerText(page), { timeout: 6_000 })
      .toMatch(/SAVED AT SANCTUARY CHAPEL/i);
    expect(await parseCash(page)).toBe(cashAfterDebug - 10_000);

    // Board cab and drive West to kf_1_little_italy skull at (448, 1600)
    await enterSpawnedVehicle(page, 'metro_cab', 'KeyW', /Metro Yellow Cab/i);
    await driveToCoords(page, 640, 1536, 13, 35);
    await driveToCoords(page, 512, 1536, 13, 35);
    await driveToCoords(page, 448, 1536, 13, 30);
    await driveToCoords(page, 448, 1600, 10, 35);
    await tapKey(page, 'KeyF', 80);
    await walkToCoords(page, 448, 1600, 1.2, true, 20);

    // Verify Little Italy Torch Kill Frenzy activates with FLAMER & 0/20 counter
    await expect
      .poll(async () => await page.evaluate(() => document.body.innerText), { timeout: 6_000 })
      .toMatch(/LITTLE ITALY TORCH|0\/20/i);
    const w = await getActiveWeapon(page);
    expect(w.name).toMatch(/FLAMER/i);

    guards.assertClean();
  });
});
