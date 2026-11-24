import { expect, test } from '@playwright/test';
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
  getMinimapCoords,
  getVehicleDash,
  getWantedStars,
  parseCash,
  getMultiplier,
} from './helpers/hud';
import {
  getSpawnerVehicleIds,
  getTelemetry,
  grantArsenal,
  spawnVehicle,
  teleport,
  toggleGodMode,
} from './helpers/debugPanel';

const EXPECTED_22_VEHICLE_IDS = [
  'metro_cab',
  'mobster_v8',
  'apex_gt',
  'brooklyn_muscle',
  'v8_stallion',
  'dons_stretch',
  'nypd_cruiser',
  'nypd_swat',
  'fbi_suv',
  'fdny_medic',
  'fdny_ladder',
  'empire_freight',
  'mta_bus',
  'rhino_apc',
  'city_sedan',
  'compact_bug',
  'gangster_ztype',
  'armored_bank_van',
  'garbage_truck',
  'ice_cream_van',
  'utility_pickup',
  'roadster_gt',
];

async function selectWeaponByName(page: Parameters<typeof getActiveWeapon>[0], nameRe: RegExp) {
  for (let i = 0; i < 12; i++) {
    const w = await getActiveWeapon(page);
    if (nameRe.test(w.name)) return w;
    await tapKey(page, 'KeyE', 50);
    await page.waitForTimeout(80);
  }
  throw new Error(`Weapon matching ${nameRe} not found in inventory`);
}

test.describe('Tier 1: Pedestrian Run-Over, Collision Damage, Chain Explosions & 22 Vehicles', () => {
  test('T1.13 Pedestrian run-over kills award cash, multiplier, and wanted star escalation', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const guards = attachRuntimeGuards(page);
    await page.goto('/');
    await waitForGameReady(page);
    await startNewGameViaUI(page, { mode: 'casual' });

    await toggleGodMode(page, true);
    await teleport(page, 'Central Park');
    await waitForFrames(page, 18);
    await expect
      .poll(async () => (await getTelemetry(page)).peds, { timeout: 22_000, intervals: [600] })
      .toBeGreaterThanOrEqual(14);

    // Spawn cab facing East along y=256 park drive and sweep Central Park ped ring keeping y >= 210 (away from y=123 north wall)
    await enterSpawnedVehicle(page, 'metro_cab', 'KeyD', /Metro Yellow Cab/i);

    const startCash = await parseCash(page);
    const waypoints: [number, number][] = [
      [705, 256],
      [705, 210],
      [585, 210],
      [585, 315],
      [705, 315],
      [740, 225],
      [640, 210],
      [740, 325],
      [600, 325],
      [600, 215],
      [720, 260],
      [600, 225],
      [720, 300],
      [585, 260],
    ];
    let curr = await getMinimapCoords(page);
    await holdKeys(page, ['KeyW'], 220);
    let next = await getMinimapCoords(page);
    let heading = Math.atan2(next.y - curr.y, next.x - curr.x);
    curr = next;

    for (const [wx, wy] of waypoints) {
      if ((await getMultiplier(page)) >= 2 && (await getWantedStars(page)) >= 1) break;
      for (let step = 0; step < 14; step++) {
        if ((await getMultiplier(page)) >= 2 && (await getWantedStars(page)) >= 1) break;
        if (Math.hypot(wx - curr.x, wy - curr.y) <= 18) break;
        const desired = Math.atan2(wy - curr.y, wx - curr.x);
        let diff = desired - heading;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        const keys = ['KeyW'];
        if (diff > 0.2) keys.push('KeyD');
        else if (diff < -0.2) keys.push('KeyA');
        const prev = curr;
        await holdKeys(page, keys, 320);
        curr = await getMinimapCoords(page);
        if (Math.hypot(curr.x - prev.x, curr.y - prev.y) >= 0.7) {
          heading = Math.atan2(curr.y - prev.y, curr.x - prev.x);
        } else {
          await holdKeys(page, ['KeyS', diff >= 0 ? 'KeyA' : 'KeyD'], 300);
          curr = await getMinimapCoords(page);
        }
      }
    }

    const endCash = await parseCash(page);
    const wanted = await getWantedStars(page);
    const mult = await getMultiplier(page);

    expect(endCash).toBeGreaterThanOrEqual(startCash + 150);
    expect(wanted).toBeGreaterThanOrEqual(1);
    expect(mult).toBeGreaterThanOrEqual(2);

    guards.assertClean();
  });

  test('T1.14 Vehicle wall collision reduces HP and progresses through damage feedback stages', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const guards = attachRuntimeGuards(page);
    await page.goto('/');
    await waitForGameReady(page);
    await startNewGameViaUI(page, { mode: 'casual' });

    // Move to open North lane (640, 1494) and spawn metro_cab facing straight West at NW block East face
    await walkToCoords(page, 640, 1494, 3, true);
    await enterSpawnedVehicle(page, 'metro_cab', 'KeyA', /Metro Yellow Cab/i);

    const initialDash = await getVehicleDash(page);
    expect(initialDash).not.toBeNull();
    expect(initialDash!.hpPct).toBe(100);

    // Ram straight West into building wall repeatedly for high deltaV impacts
    let seenDented = false;
    let lowestHp = 100;

    for (let ram = 0; ram < 5; ram++) {
      await holdKeys(page, ['KeyW'], 1_800);
      const dash = await getVehicleDash(page);
      if (!dash) break; // wrecked & ejected
      lowestHp = Math.min(lowestHp, dash.hpPct);
      if (dash.hpPct < 60) seenDented = true;
      if (dash.hpPct < 55) break;
      await holdKeys(page, ['KeyS'], 900);
    }

    expect(lowestHp).toBeLessThan(95);
    expect(seenDented || lowestHp < 60).toBe(true);

    guards.assertClean();
  });

  test('T1.15 Vehicle-to-vehicle collision damages both the ramming car and the target vehicle', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const guards = attachRuntimeGuards(page);
    await page.goto('/');
    await waitForGameReady(page);
    await startNewGameViaUI(page, { mode: 'casual' });

    // Enter traffic-free Wall Street Plaza (576, 1600), spawn compact_bug North (~1592.5), back straight South (KeyS only!) so X is 100% locked
    await walkToCoords(page, 576, 1536, 3, true);
    await walkToCoords(page, 576, 1600, 1.5, true);
    await holdKeys(page, ['KeyW'], 240);
    await spawnVehicle(page, 'compact_bug');

    await holdKeys(page, ['KeyS'], 2_800);
    await enterSpawnedVehicle(page, 'apex_gt', 'KeyW', /Apex GT/i);

    const rammerBefore = await getVehicleDash(page);
    expect(rammerBefore?.name).toMatch(/Apex GT/i);
    expect(rammerBefore?.hpPct).toBe(100);

    // Accelerate straight North into compact_bug until solid impact damage (< 90% HP) registers
    await holdKeysUntil(
      page,
      ['KeyW'],
      async () => ((await getVehicleDash(page))?.hpPct ?? 100) < 90,
      4_500,
      180
    );
    const rammerAfter = await getVehicleDash(page);
    expect(rammerAfter).not.toBeNull();
    expect(rammerAfter!.hpPct).toBeLessThan(95);

    // Exit apex_gt, walk North past its 6.2m entry radius to compact_bug, enter it and verify its HP also dropped
    await tapKey(page, 'KeyF', 90);
    await page.waitForTimeout(200);
    await holdKeys(page, ['KeyW'], 1_100);
    for (let attempt = 0; attempt < 10; attempt++) {
      const cur = await getVehicleDash(page);
      if (cur && /Micro\s*Bug/i.test(cur.name)) break;
      if (cur) {
        await tapKey(page, 'KeyF', 90);
        await page.waitForTimeout(180);
        await holdKeys(page, ['KeyW'], 900);
      }
      await tapKey(page, 'KeyF', 90);
      await page.waitForTimeout(200);
      const d = await getVehicleDash(page);
      if (d && /Micro\s*Bug/i.test(d.name)) break;
      await holdKeys(page, ['KeyW'], 450);
    }
    const targetDash = await getVehicleDash(page);
    expect(targetDash).not.toBeNull();
    expect(targetDash!.name).toMatch(/Micro\s*Bug/i);
    expect(targetDash!.hpPct).toBeLessThan(100);

    guards.assertClean();
  });

  test('T1.16 Staggered chain-reaction explosions destroy clustered 140-300 HP vehicles', async ({
    page,
  }) => {
    const guards = attachRuntimeGuards(page);
    await page.goto('/');
    await waitForGameReady(page);
    await startNewGameViaUI(page, { mode: 'casual' });

    await toggleGodMode(page, true);
    await grantArsenal(page);
    await selectWeaponByName(page, /RPG/i);

    // Cluster 3 high-HP vehicles side-by-side North of player with 550ms spacing (no Rapier overlap, edgeDist <= 4.5m)
    await holdKeys(page, ['KeyW'], 240);
    await spawnVehicle(page, 'mobster_v8'); // 140 HP
    await holdKeys(page, ['KeyD'], 550);
    await holdKeys(page, ['KeyW'], 240);
    await spawnVehicle(page, 'dons_stretch'); // 180 HP
    await holdKeys(page, ['KeyD'], 550);
    await holdKeys(page, ['KeyW'], 240);
    await spawnVehicle(page, 'mta_bus'); // 300 HP

    // Step back South-Center for safe RPG shot
    await walkToCoords(page, 644, 1545, 2, true);
    await holdKeys(page, ['KeyW'], 240);
    await waitForFrames(page, 12);
    const cashBefore = await parseCash(page);

    // Fire RPG straight North into the cluster
    await clickCanvasAtOffset(page, 0, -140, 120);

    // All 3 clustered vehicles (140, 180, 300 HP) must detonate and award >= $3,000 combined
    await expect
      .poll(async () => await parseCash(page), { timeout: 6_000, intervals: [300] })
      .toBeGreaterThanOrEqual(cashBefore + 3_000);
    // Walk to cluster center and confirm none of the 3 vehicles remain intact/enterable
    await walkToCoords(page, 644, 1529, 2, true);
    await tapKey(page, 'KeyF', 80);
    expect(await getVehicleDash(page)).toBeNull();

    guards.assertClean();
  });

  test('T1.17 Expanded 22-vehicle roster is available in spawner and functional in gameplay', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const guards = attachRuntimeGuards(page);
    await page.goto('/');
    await waitForGameReady(page);
    await startNewGameViaUI(page, { mode: 'casual' });

    const ids = await getSpawnerVehicleIds(page);
    for (const expectedId of EXPECTED_22_VEHICLE_IDS) {
      expect(ids, `Missing vehicle ID in spawner: ${expectedId}`).toContain(expectedId);
    }
    expect(ids.length).toBeGreaterThanOrEqual(22);

    // Spawn and enter representative new & special vehicles along open East-West road (y = 1536)
    for (const [spawnX, walkKey, id, namePattern] of [
      [580, 'KeyA', 'gangster_ztype', /z-?type/i],
      [550, 'KeyA', 'ice_cream_van', /mister\s*frosty|ice\s*cream/i],
      [665, 'KeyD', 'armored_bank_van', /bullion|bank|armored/i],
      [695, 'KeyD', 'rhino_apc', /tank|rhino/i],
    ] as const) {
      await walkToCoords(page, spawnX, 1536, 1.2, true, 16);
      await enterSpawnedVehicle(page, id, walkKey, namePattern);
      if (id === 'rhino_apc') {
        await tapKey(page, 'ControlLeft', 120);
        await page.waitForTimeout(200);
      }
      await tapKey(page, 'KeyF', 80);
      await page.waitForTimeout(150);
    }

    guards.assertClean();
  });

  test('T1.18 District traffic spawns and is encounterable across boroughs', async ({ page }) => {
    const guards = attachRuntimeGuards(page);
    await page.goto('/');
    await waitForGameReady(page);
    await startNewGameViaUI(page, { mode: 'casual' });

    for (const dist of ['Times Square', 'Brooklyn Crusher', 'Financial Dist.']) {
      await teleport(page, dist);
      await expect
        .poll(async () => (await getTelemetry(page)).vehicles, { timeout: 8_000 })
        .toBeGreaterThanOrEqual(3);
    }

    guards.assertClean();
  });
});
