import { expect, test } from '@playwright/test';
import { attachRuntimeGuards, waitForGameReady } from './helpers/runtime';
import {
  clickCanvasAtOffset,
  enterSpawnedVehicle,
  holdKeys,
  holdKeysUntil,
  startNewGameViaUI,
  tapKey,
  walkToCoords,
} from './helpers/input';
import {
  getAmmo,
  getHealthAndArmor,
  getMinimapCoords,
  getPagerText,
  getVehicleDash,
} from './helpers/hud';
import { getTelemetry } from './helpers/debugPanel';

test.describe('Tier 1: Simultaneous Controls, Vehicle Steering & Spacebar Jump', () => {
  test('T1.7 Simultaneous on-foot WASD diagonals move both axes cleanly without dropping input', async ({
    page,
  }) => {
    const guards = attachRuntimeGuards(page);
    await page.goto('/');
    await waitForGameReady(page);
    await startNewGameViaUI(page, { mode: 'casual' });

    // W+D -> North-East (+X, -Y)
    const p0 = await getTelemetry(page);
    await holdKeys(page, ['KeyW', 'KeyD'], 1_100);
    const p1 = await getTelemetry(page);
    expect(p1.x - p0.x).toBeGreaterThanOrEqual(3);
    expect(p0.y - p1.y).toBeGreaterThanOrEqual(3);

    // S+A -> South-West (-X, +Y)
    await holdKeys(page, ['KeyS', 'KeyA'], 1_100);
    const p2 = await getTelemetry(page);
    expect(p1.x - p2.x).toBeGreaterThanOrEqual(3);
    expect(p2.y - p1.y).toBeGreaterThanOrEqual(3);

    // W+A -> North-West (-X, -Y)
    await holdKeys(page, ['KeyW', 'KeyA'], 1_100);
    const p3 = await getTelemetry(page);
    expect(p2.x - p3.x).toBeGreaterThanOrEqual(3);
    expect(p2.y - p3.y).toBeGreaterThanOrEqual(3);

    // S+D -> South-East (+X, +Y)
    await holdKeys(page, ['KeyS', 'KeyD'], 1_100);
    const p4 = await getTelemetry(page);
    expect(p4.x - p3.x).toBeGreaterThanOrEqual(3);
    expect(p4.y - p3.y).toBeGreaterThanOrEqual(3);

    guards.assertClean();
  });

  test('T1.8 Simultaneous Arrow diagonals + Shift sprint move both axes and drain stamina', async ({
    page,
  }) => {
    const guards = attachRuntimeGuards(page);
    await page.goto('/');
    await waitForGameReady(page);
    await startNewGameViaUI(page, { mode: 'casual' });

    const vitalsBefore = await getHealthAndArmor(page);
    expect(vitalsBefore.staminaPct).toBeGreaterThanOrEqual(95);

    const p0 = await getMinimapCoords(page);
    await holdKeys(page, ['ShiftLeft', 'ArrowUp', 'ArrowRight'], 1_600);
    const p1 = await getMinimapCoords(page);
    const vitalsAfter = await getHealthAndArmor(page);

    expect(p1.x - p0.x).toBeGreaterThanOrEqual(4);
    expect(p0.y - p1.y).toBeGreaterThanOrEqual(4);
    expect(vitalsAfter.staminaPct).toBeLessThan(95);

    // Reverse diagonal with ArrowDown + ArrowLeft + Shift
    await holdKeys(page, ['ShiftLeft', 'ArrowDown', 'ArrowLeft'], 1_600);
    const p2 = await getMinimapCoords(page);
    expect(p1.x - p2.x).toBeGreaterThanOrEqual(4);
    expect(p2.y - p1.y).toBeGreaterThanOrEqual(4);

    guards.assertClean();
  });

  test('T1.9 Simultaneous vehicle forward+turn (W+D, W+A, Arrows) accelerates and steers simultaneously', async ({
    page,
  }) => {
    const guards = attachRuntimeGuards(page);
    await page.goto('/');
    await waitForGameReady(page);
    await startNewGameViaUI(page, { mode: 'casual' });

    await enterSpawnedVehicle(page, 'metro_cab', 'KeyW', /Metro Yellow Cab/i);

    const p0 = await getMinimapCoords(page);
    await holdKeysUntil(
      page,
      ['KeyW', 'KeyD'],
      async () => {
        const dash = await getVehicleDash(page);
        const p = await getMinimapCoords(page);
        return (
          dash !== null &&
          dash.speedKmh >= 20 &&
          Math.abs(p.x - p0.x) >= 4 &&
          Math.abs(p.y - p0.y) >= 4
        );
      },
      5_500,
      240
    );
    const dashFwdRight = await getVehicleDash(page);
    const p1 = await getMinimapCoords(page);
    expect(dashFwdRight).not.toBeNull();
    expect(dashFwdRight!.speedKmh).toBeGreaterThanOrEqual(20);
    expect(Math.abs(p1.x - p0.x)).toBeGreaterThanOrEqual(4);
    expect(Math.abs(p1.y - p0.y)).toBeGreaterThanOrEqual(4);

    // Now test ArrowUp + ArrowLeft simultaneously
    await holdKeysUntil(
      page,
      ['ArrowUp', 'ArrowLeft'],
      async () => {
        const dash = await getVehicleDash(page);
        const p = await getMinimapCoords(page);
        return (
          dash !== null &&
          dash.speedKmh >= 15 &&
          Math.abs(p.x - p1.x) >= 3 &&
          Math.abs(p.y - p1.y) >= 3
        );
      },
      5_500,
      240
    );
    const dashFwdLeft = await getVehicleDash(page);
    const p2 = await getMinimapCoords(page);
    expect(dashFwdLeft!.speedKmh).toBeGreaterThanOrEqual(15);
    expect(Math.abs(p2.x - p1.x)).toBeGreaterThanOrEqual(3);
    expect(Math.abs(p2.y - p1.y)).toBeGreaterThanOrEqual(3);

    guards.assertClean();
  });

  test('T1.10 Simultaneous vehicle reverse+turn (S+D, S+A) reverses and steers without deadzone lock', async ({
    page,
  }) => {
    const guards = attachRuntimeGuards(page);
    await page.goto('/');
    await waitForGameReady(page);
    await startNewGameViaUI(page, { mode: 'casual' });

    await enterSpawnedVehicle(page, 'metro_cab', 'KeyW', /Metro Yellow Cab/i);

    const p0 = await getMinimapCoords(page);
    await holdKeysUntil(
      page,
      ['KeyS', 'KeyD'],
      async () => {
        const dash = await getVehicleDash(page);
        const p = await getMinimapCoords(page);
        return (
          dash !== null &&
          dash.speedKmh >= 10 &&
          Math.abs(p.x - p0.x) >= 2.5 &&
          Math.abs(p.y - p0.y) >= 2.5
        );
      },
      5_500,
      240
    );
    const dashRevRight = await getVehicleDash(page);
    const p1 = await getMinimapCoords(page);
    expect(dashRevRight).not.toBeNull();
    expect(dashRevRight!.speedKmh).toBeGreaterThanOrEqual(10);
    expect(Math.abs(p1.x - p0.x)).toBeGreaterThanOrEqual(2.5);
    expect(Math.abs(p1.y - p0.y)).toBeGreaterThanOrEqual(2.5);

    // Settle briefly then reverse + left
    await page.waitForTimeout(300);
    const p2 = await getMinimapCoords(page);
    await holdKeysUntil(
      page,
      ['KeyS', 'KeyA'],
      async () => {
        const dash = await getVehicleDash(page);
        const p = await getMinimapCoords(page);
        return (
          dash !== null &&
          dash.speedKmh >= 10 &&
          Math.abs(p.x - p2.x) >= 2.5 &&
          Math.abs(p.y - p2.y) >= 2.5
        );
      },
      5_500,
      240
    );
    const dashRevLeft = await getVehicleDash(page);
    const p3 = await getMinimapCoords(page);
    expect(dashRevLeft!.speedKmh).toBeGreaterThanOrEqual(10);
    expect(Math.abs(p3.x - p2.x)).toBeGreaterThanOrEqual(2.5);
    expect(Math.abs(p3.y - p2.y)).toBeGreaterThanOrEqual(2.5);

    guards.assertClean();
  });

  test('T1.11 Spacebar jump on foot clears parked metro_cab cleanly without firing weapon', async ({
    page,
  }) => {
    const guards = attachRuntimeGuards(page);
    await page.goto('/');
    await waitForGameReady(page);
    await startNewGameViaUI(page, { mode: 'casual' });

    // Starter metro_cab is at (630, 1530) oriented East-West (width 2.3m N-S).
    // Walk West until x <= 630.5 (aligned south of starter metro_cab).
    for (let step = 0; step < 10; step++) {
      const pos = await getMinimapCoords(page);
      if (pos.x <= 630.5) break;
      await holdKeys(page, ['KeyA'], 300);
    }

    // Baseline without Space: walk North into the parked cab -> must be blocked by its hull
    await holdKeys(page, ['KeyW'], 850);
    const blockedPos = await getTelemetry(page);
    expect(blockedPos.x).toBeGreaterThanOrEqual(627);
    expect(blockedPos.x).toBeLessThanOrEqual(633);
    expect(blockedPos.y).toBeGreaterThanOrEqual(1530);

    const ammoBefore = await getAmmo(page);
    expect(ammoBefore).toBe(90);

    // Now hold W and jump with Spacebar to clear over the parked car
    await page.keyboard.down('KeyW');
    try {
      await page.waitForTimeout(100);
      await tapKey(page, 'Space', 80);
      const deadline = Date.now() + 1_600;
      while (Date.now() < deadline) {
        await page.waitForTimeout(200);
        if ((await getMinimapCoords(page)).y <= 1528) break;
      }
    } finally {
      await page.keyboard.up('KeyW');
    }

    const clearedPos = await getTelemetry(page);
    const ammoAfter = await getAmmo(page);
    const vitals = await getHealthAndArmor(page);

    expect(clearedPos.y).toBeLessThanOrEqual(1528);
    expect(ammoAfter).toBe(ammoBefore);
    expect(vitals.hp).toBeGreaterThan(0);

    guards.assertClean();
  });

  test('T1.12 On-foot weapon fire works via Control, LMB, and KeyX (decoupled from Space)', async ({
    page,
  }) => {
    const guards = attachRuntimeGuards(page);
    await page.goto('/');
    await waitForGameReady(page);
    await startNewGameViaUI(page, { mode: 'casual' });

    const ammo0 = await getAmmo(page);
    expect(ammo0).toBe(90);

    // 1) ControlLeft fires
    await tapKey(page, 'ControlLeft', 220);
    await page.waitForTimeout(200);
    const ammo1 = await getAmmo(page);
    expect(ammo1).toBeLessThan(ammo0);

    // 2) Left mouse button on canvas fires (260ms hold so it never falls between SwiftShader frames)
    await clickCanvasAtOffset(page, 40, -100, 260);
    await page.waitForTimeout(200);
    const ammo2 = await getAmmo(page);
    expect(ammo2).toBeLessThan(ammo1);

    // 3) KeyX fires
    await tapKey(page, 'KeyX', 220);
    await page.waitForTimeout(200);
    const ammo3 = await getAmmo(page);
    expect(ammo3).toBeLessThan(ammo2);

    guards.assertClean();
  });

  test('T1.26 Vehicle Space handbrake drift (no weapon fire) & CapsLock side job toggle', async ({
    page,
  }) => {
    const guards = attachRuntimeGuards(page);
    await page.goto('/');
    await waitForGameReady(page);
    await startNewGameViaUI(page, { mode: 'casual' });

    await enterSpawnedVehicle(page, 'brooklyn_muscle', 'KeyW', /Red Hook Muscle|Brooklyn Muscle/i);

    await holdKeysUntil(
      page,
      ['KeyW'],
      async () => ((await getVehicleDash(page))?.speedKmh ?? 0) >= 40,
      2_800,
      200
    );
    const dashBefore = await getVehicleDash(page);
    expect(dashBefore).not.toBeNull();
    const speedBefore = dashBefore!.speedKmh;
    expect(speedBefore).toBeGreaterThanOrEqual(40);
    const ammoBefore = await getAmmo(page);
    const pBefore = await getMinimapCoords(page);

    // Hold D + Space handbrake drift -> slows/turns cleanly while staying inside car without firing
    await holdKeys(page, ['KeyD', 'Space'], 1_000);
    const dashAfter = await getVehicleDash(page);
    const pAfter = await getMinimapCoords(page);
    expect(dashAfter).not.toBeNull();
    expect(dashAfter!.speedKmh).toBeLessThan(speedBefore - 12);
    expect(await getAmmo(page)).toBe(ammoBefore);
    expect(Math.hypot(pAfter.x - pBefore.x, pAfter.y - pBefore.y)).toBeGreaterThanOrEqual(2);

    // Exit, return to open avenue (640, 1536), board Metro Yellow Cab facing South and toggle Taxi Side Job via CapsLock
    await tapKey(page, 'KeyF', 80);
    await page.waitForTimeout(200);
    await walkToCoords(page, 640, 1536, 3, true, 18);
    await enterSpawnedVehicle(page, 'metro_cab', 'KeyS', /Metro Yellow Cab/i);

    await tapKey(page, 'CapsLock', 100);
    await expect
      .poll(async () => await page.evaluate(() => document.body.innerText), { timeout: 4_000 })
      .toMatch(/TAXI.*L1|TAXI FARE/i);

    await tapKey(page, 'CapsLock', 100);
    await expect
      .poll(async () => await getPagerText(page), { timeout: 4_000 })
      .toMatch(/CANCELLED/i);

    guards.assertClean();
  });
});
