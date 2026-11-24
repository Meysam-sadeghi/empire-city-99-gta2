import { expect, test, type Page } from '@playwright/test';
import { attachRuntimeGuards, waitForGameReady } from './helpers/runtime';
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
  getGpsInfo,
  getMinimapCoords,
  getMissionPill,
  getPagerText,
  getRespect,
  getVehicleDash,
  getWantedStars,
  parseCash,
} from './helpers/hud';
import {
  grantArsenal,
  launchMission,
  teleport,
  toggleGodMode,
} from './helpers/debugPanel';

async function selectWeaponByName(page: Page, nameRe: RegExp) {
  for (let i = 0; i < 12; i++) {
    const w = await getActiveWeapon(page);
    if (nameRe.test(w.name)) return w;
    await tapKey(page, 'KeyE', 60);
    await page.waitForTimeout(80);
  }
  throw new Error(`Weapon matching ${nameRe} not found`);
}

function angleToKeys(angleRad: number): string[] {
  const keys: string[] = [];
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  if (c > 0.38) keys.push('KeyD');
  else if (c < -0.38) keys.push('KeyA');
  if (s > 0.38) keys.push('KeyS');
  else if (s < -0.38) keys.push('KeyW');
  if (keys.length === 0) keys.push(Math.abs(c) >= Math.abs(s) ? (c >= 0 ? 'KeyD' : 'KeyA') : s >= 0 ? 'KeyS' : 'KeyW');
  return keys;
}

/**
 * Opaque-box closed-loop driver using only HUD minimap coordinates.
 */
async function driveToCoords(
  page: Page,
  targetX: number,
  targetY: number,
  toleranceM = 13,
  maxSteps = 45
): Promise<void> {
  // Kick off briefly to measure initial heading
  let prev = await getMinimapCoords(page);
  await holdKeys(page, ['KeyW'], 220);
  let curr = await getMinimapCoords(page);
  let heading = Math.atan2(curr.y - prev.y, curr.x - prev.x);
  if (Math.hypot(curr.x - prev.x, curr.y - prev.y) < 0.5) {
    heading = 0;
  }

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

    const moved = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    if (moved >= 0.8) {
      heading = Math.atan2(curr.y - prev.y, curr.x - prev.x);
    } else {
      // Unstick if bumped into curb/wall
      await holdKeys(page, ['KeyS', diff >= 0 ? 'KeyA' : 'KeyD'], 350);
      prev = curr;
      await holdKeys(page, ['KeyW'], 250);
      curr = await getMinimapCoords(page);
      if (Math.hypot(curr.x - prev.x, curr.y - prev.y) >= 0.6) {
        heading = Math.atan2(curr.y - prev.y, curr.x - prev.x);
      }
    }
  }
}

test.describe('Tier 1: Missions, Payphones, HUD & Minimap', () => {
  test('T1.19 Payphone proximity prompt, untruncated PagerTicker & Mission Briefing ([J] Journal)', async ({
    page,
  }) => {
    const guards = attachRuntimeGuards(page);
    await page.goto('/');
    await waitForGameReady(page);
    await startNewGameViaUI(page, { mode: 'casual' });

    // Pause at (640, 1545) (~9m North of phone_syn_green at 640, 1554): outside 5.5m auto-trigger, inside 14m prompt
    await walkToCoords(page, 640, 1545, 2, true);
    await expect
      .poll(async () => await getPagerText(page), { timeout: 10_000, intervals: [400] })
      .toMatch(/PAYPHONE.*ANSWER|ANSWER.*PAYPHONE/i);

    // Walk South into phone_syn_green at (640, 1554) to trigger Protection Money
    await walkToY(page, 1554, 3, true);
    if ((await getMissionPill(page)) === null) {
      await tapKey(page, 'KeyF', 80);
      await page.waitForTimeout(200);
    }

    const pill = await getMissionPill(page);
    expect(pill).not.toBeNull();
    expect(pill!.title).toMatch(/Protection Money/i);

    // Verify PagerTicker shows multi-word briefing without CSS ellipsis clipping
    const pagerCheck = await page.evaluate(() => {
      const badge = Array.from(document.querySelectorAll('span')).find(
        (s) => s.textContent?.trim() === 'PAGER 99'
      );
      const textEl = (badge?.nextElementSibling ?? badge?.parentElement) as HTMLElement | null;
      if (!textEl) return { text: '', clipped: true };
      const style = window.getComputedStyle(textEl);
      const clipped = style.textOverflow === 'ellipsis' && textEl.scrollWidth > textEl.clientWidth + 2;
      return { text: textEl.textContent?.trim() ?? '', clipped };
    });
    expect(pagerCheck.text.length).toBeGreaterThanOrEqual(30);
    expect(pagerCheck.clipped).toBe(false);

    // Open Mission Briefing / Journal modal via KeyJ
    await tapKey(page, 'KeyJ', 80);
    const modal = page
      .locator('div[data-ui-interactive="true"]')
      .filter({ hasText: /Protection Money/i })
      .first();
    await expect(modal).toBeVisible({ timeout: 3_000 });
    await expect(modal).toContainText(/Watch out for Yakuza skimmers/i);

    await tapKey(page, 'KeyJ', 80);
    guards.assertClean();
  });

  test('T1.20 Complete Mission #1 (Protection Money) end-to-end with cash, respect & map updates', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const guards = attachRuntimeGuards(page);
    await page.goto('/');
    await waitForGameReady(page);
    await startNewGameViaUI(page, { mode: 'casual' });

    await toggleGodMode(page, true);
    await grantArsenal(page);
    const startCash = await parseCash(page);

    // Trigger Mission #1 at phone_syn_green (640, 1554)
    await walkToY(page, 1554, 3, true);
    if ((await getMissionPill(page)) === null) {
      await tapKey(page, 'KeyF', 80);
    }
    await expect.poll(async () => (await getMissionPill(page))?.title ?? '').toMatch(/Protection Money/i);

    // Walk North to spawned Mobster V8 at (640, 1520) and enter it
    await walkToY(page, 1522, 3, true);
    await tapKey(page, 'KeyF', 90);
    await expect.poll(async () => (await getVehicleDash(page))?.name ?? '').toMatch(/Mobster V8/i);

    // Drive checkpoints along the 128m street grid with intermediate waypoints
    await driveToCoords(page, 512, 1536, 13, 35);
    await expect.poll(async () => (await getMissionPill(page))?.progressText ?? '').toMatch(/1\/3|2\/3|3\/3/);

    await driveToCoords(page, 384, 1536, 13, 35);
    await driveToCoords(page, 384, 1664, 13, 40);
    await driveToCoords(page, 512, 1664, 13, 45);
    await driveToCoords(page, 640, 1664, 13, 45);
    await driveToCoords(page, 768, 1664, 13, 45);

    // Stage 3: eliminate the 4 Yakuza thugs around (768, 1664) using M4 + GPS-guided auto-aim
    await expect.poll(async () => (await getMissionPill(page))?.objective ?? '').toMatch(/Eliminate|thugs/i);
    await tapKey(page, 'KeyF', 80); // exit car on foot
    await selectWeaponByName(page, /\bM4\b/i);
    await waitForFrames(page, 10);

    for (let sweep = 0; sweep < 24; sweep++) {
      if ((await getMissionPill(page)) === null) break;
      const gps = await getGpsInfo(page);
      if (gps) {
        const dirKeys = angleToKeys(gps.angleRad);
        if (gps.distanceM > 14) {
          await holdKeys(page, dirKeys, 350);
        } else {
          await holdKeys(page, dirKeys, 200);
        }
        await holdKeys(page, ['ControlLeft'], 350);
        await clickCanvasAtOffset(
          page,
          Math.cos(gps.angleRad) * 140,
          Math.sin(gps.angleRad) * 140,
          200
        );
      } else {
        const angle = (sweep / 8) * Math.PI * 2;
        await holdKeys(page, angleToKeys(angle), 180);
        await holdKeys(page, ['ControlLeft'], 300);
      }
      await page.waitForTimeout(180);
    }

    await expect.poll(async () => await getMissionPill(page), { timeout: 6_000 }).toBeNull();
    const pager = await getPagerText(page);
    expect(pager).toMatch(/MISSION PASSED/i);

    const endCash = await parseCash(page);
    expect(endCash).toBeGreaterThanOrEqual(startCash + 15_000);

    const respect = await getRespect(page);
    expect(respect.syndicate).toBeGreaterThanOrEqual(20);
    expect(respect.yakuza).toBeLessThanOrEqual(-15);

    await tapKey(page, 'Tab');
    await expect(page.getByText(/Contracts Completed:\s*1\/13/i)).toBeVisible();
    await tapKey(page, 'Tab');

    guards.assertClean();
  });

  test('T1.21 M3 Concrete Shoes (inVehicles occupant linking & lose_wanted transition)', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const guards = attachRuntimeGuards(page);
    await page.goto('/');
    await waitForGameReady(page);
    await startNewGameViaUI(page, { mode: 'casual' });

    await toggleGodMode(page, true);
    await grantArsenal(page);
    await launchMission(page, 'syn_concrete_shoes');
    await waitForFrames(page, 20);

    const pill1 = await getMissionPill(page);
    expect(pill1?.title).toMatch(/Concrete Shoes/i);
    expect(pill1?.objective).toMatch(/Ambush|Informant/i);
    expect(pill1?.progressText ?? '').toMatch(/[0-4]\/5/);

    await selectWeaponByName(page, /RPG/i);
    // GPS-guided RPG loop covering both ENE boss stretch (1152, 1664) and WNW guard cars (1120, 1664)
    for (let shot = 0; shot < 16; shot++) {
      const p = await getMissionPill(page);
      if (p && /Pay 'n' Spray|Lose your 2-Star/i.test(p.objective)) break;
      const gps = await getGpsInfo(page);
      if (gps) {
        const dirKeys = angleToKeys(gps.angleRad);
        if (gps.distanceM > 28) {
          await holdKeys(page, dirKeys, 500);
        } else {
          await holdKeys(page, dirKeys, 220);
        }
        await clickCanvasAtOffset(
          page,
          Math.cos(gps.angleRad) * 150,
          Math.sin(gps.angleRad) * 150,
          260
        );
      } else {
        await clickCanvasAtOffset(page, shot % 2 === 0 ? 150 : -150, -30, 140);
      }
      await page.waitForTimeout(1_500);
    }

    await expect
      .poll(async () => (await getMissionPill(page))?.objective ?? '', { timeout: 10_000 })
      .toMatch(/Pay 'n' Spray|Lose your 2-Star/i);
    expect(await getWantedStars(page)).toBeGreaterThanOrEqual(2);

    guards.assertClean();
  });

  test('T1.22 M6 Signal Jammer destructible 3D relay_dish prop advances progress', async ({
    page,
  }) => {
    const guards = attachRuntimeGuards(page);
    await page.goto('/');
    await waitForGameReady(page);
    await startNewGameViaUI(page, { mode: 'casual' });

    await toggleGodMode(page, true);
    await grantArsenal(page);
    await launchMission(page, 'yak_signal_jammer');
    await waitForFrames(page, 20);

    const pill0 = await getMissionPill(page);
    expect(pill0?.title).toMatch(/Signal Jammer/i);
    expect(pill0?.progressText ?? '0/4').toMatch(/0\/4/);

    // Debug jump places player at (1398, 1158); Relay #1 is at (1408, 1152) -> step close and destroy via GPS angle
    await walkToCoords(page, 1402, 1155, 2, true);
    await waitForFrames(page, 12);
    await selectWeaponByName(page, /RPG/i);
    for (let attempt = 0; attempt < 3; attempt++) {
      const p = await getMissionPill(page);
      if (p && /1\/4|2\/4/.test(p.progressText ?? '')) break;
      const gps = await getGpsInfo(page);
      const angle = gps ? gps.angleRad : -0.54;
      await holdKeys(page, angleToKeys(angle), 240);
      await clickCanvasAtOffset(page, Math.cos(angle) * 120, Math.sin(angle) * 120, 260);
      await page.waitForTimeout(1_600);
    }
    if (!/1\/4|2\/4/.test((await getMissionPill(page))?.progressText ?? '')) {
      await selectWeaponByName(page, /\bM4\b/i);
      const gps = await getGpsInfo(page);
      const angle = gps ? gps.angleRad : -0.54;
      await clickCanvasAtOffset(page, Math.cos(angle) * 120, Math.sin(angle) * 120, 800);
      await page.waitForTimeout(300);
    }

    const pill1 = await getMissionPill(page);
    expect(pill1?.progressText).toMatch(/1\/4|2\/4/);

    guards.assertClean();
  });

  test('T1.23 M10 Brooklyn Scrap Metal (natural mobster_v8 + Car Crusher) & M12 Boss rescue', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const guards = attachRuntimeGuards(page);
    await page.goto('/');
    await waitForGameReady(page);
    await startNewGameViaUI(page, { mode: 'casual' });

    await toggleGodMode(page, true);
    await grantArsenal(page);

    // M10 Scrap Metal -> must find and enter mission/natural Brooklyn mobster_v8 (NO Debug spawnVehicle!)
    await launchMission(page, 'bro_scrap_metal');
    await waitForFrames(page, 20);
    const scrapPill = await getMissionPill(page);
    expect(scrapPill?.title).toMatch(/Scrap Metal/i);

    await walkToCoords(page, 1564, 1584, 4, true, 18);
    for (let i = 0; i < 8; i++) {
      const d = await getVehicleDash(page);
      if (d && /Mobster V8/i.test(d.name)) break;
      if (d) {
        await tapKey(page, 'KeyF', 90);
        await page.waitForTimeout(180);
      }
      await tapKey(page, 'KeyF', 90);
      await page.waitForTimeout(200);
      const d2 = await getVehicleDash(page);
      if (d2 && /Mobster V8/i.test(d2.name)) break;
      if (d2) {
        await tapKey(page, 'KeyF', 90);
        await page.waitForTimeout(180);
      }
      await holdKeys(page, i % 2 === 0 ? ['KeyS'] : ['KeyA'], 350);
    }
    await expect.poll(async () => (await getVehicleDash(page))?.name ?? '').toMatch(/Mobster V8/i);

    const cashBeforeCrush = await parseCash(page);
    await driveToCoords(page, 1600, 1600, 11, 35);
    await expect.poll(async () => await parseCash(page), { timeout: 5_000 }).toBeGreaterThan(
      cashBeforeCrush
    );
    await expect.poll(async () => (await getMissionPill(page))?.progressText ?? '').toMatch(/1\/3/);

    // M12 Hostile Takeover -> enter SWAT Enforcer van, advance to b4_storm, clear FBI guards, rescue Boss
    await launchMission(page, 'bro_hostile_takeover');
    await waitForFrames(page, 20);
    const m12Pill = await getMissionPill(page);
    expect(m12Pill?.title).toMatch(/Hostile Takeover/i);
    expect(m12Pill?.objective).toMatch(/SWAT Enforcer/i);

    await walkToCoords(page, 1664, 1400, 4, true, 16);
    for (let i = 0; i < 6; i++) {
      const d = await getVehicleDash(page);
      if (d && /SWAT Enforcer/i.test(d.name)) break;
      await tapKey(page, 'KeyF', 90);
      await page.waitForTimeout(200);
      await holdKeys(page, ['KeyD'], 250);
    }
    await expect.poll(async () => (await getVehicleDash(page))?.name ?? '').toMatch(/SWAT Enforcer/i);

    // Entering SWAT Enforcer advances stage b4_van -> b4_storm (Storm Midtown Precinct) with 5★ heat
    await expect
      .poll(async () => (await getMissionPill(page))?.objective ?? '', { timeout: 6_000 })
      .toMatch(/Storm Midtown Precinct|Brotherhood Boss/i);
    expect(await getWantedStars(page)).toBeGreaterThanOrEqual(5);

    // Teleport to Times Square, drive SWAT van into Midtown Precinct Courtyard (448, 832)
    await teleport(page, 'Times Square');
    await waitForFrames(page, 20);
    await driveToCoords(page, 512, 896, 13, 35);
    await driveToCoords(page, 448, 896, 13, 30);
    await driveToCoords(page, 448, 832, 13, 30);

    // Exit SWAT van, eliminate the 6 FBI guards around Midtown Precinct using GPS-guided M4 (avoids RPG splash on friendly Boss!)
    await tapKey(page, 'KeyF', 80);
    await selectWeaponByName(page, /\bM4\b/i);
    for (let mop = 0; mop < 28; mop++) {
      const p = await getMissionPill(page);
      if (!p || /Lose the 5-Star|FBI blockade/i.test(p.objective)) break;
      const gps = await getGpsInfo(page);
      if (gps) {
        await holdKeys(page, angleToKeys(gps.angleRad), gps.distanceM > 16 ? 420 : 200);
        await clickCanvasAtOffset(
          page,
          Math.cos(gps.angleRad) * 150,
          Math.sin(gps.angleRad) * 150,
          450
        );
      }
      await page.waitForTimeout(220);
    }

    await expect
      .poll(async () => (await getMissionPill(page))?.objective ?? '', { timeout: 8_000 })
      .toMatch(/Lose the 5-Star|FBI blockade/i);

    guards.assertClean();
  });

  test('T1.24 SVG HUD icons, corner minimap, owned weapon strip & [TAB] Map', async ({ page }) => {
    const guards = attachRuntimeGuards(page);
    await page.goto('/');
    await waitForGameReady(page);
    await startNewGameViaUI(page, { mode: 'casual' });

    // Launch a mission briefly so GPS arrow pill is mounted and verified alongside hearts & wanted stars
    await launchMission(page, 'syn_protection_money');
    await waitForFrames(page, 10);

    // 1) Inspect corner HUD minimap canvas BEFORE pressing Tab + verify SVG icons across all 3 groups
    const cornerCheck = await page.evaluate(() => {
      const hpEl = document.querySelector('[title^="Health: "]');
      const hpSvgs = hpEl ? hpEl.querySelectorAll('svg').length : 0;

      const wantedGroup = Array.from(document.querySelectorAll('div')).find((div) => {
        const kids = Array.from(div.children);
        return kids.length === 6 && kids.every((k) => k.tagName.toLowerCase() === 'svg' || k.textContent?.trim() === '★');
      });
      const wantedSvgs = wantedGroup ? wantedGroup.querySelectorAll('svg').length : 0;

      const gpsLabelEl = Array.from(document.querySelectorAll('div, span')).find(
        (el) => el.children.length <= 1 && /\(\d+m\)\s*$/.test(el.textContent?.trim() ?? '')
      );
      const gpsArrowWrap = gpsLabelEl?.parentElement?.querySelector('[style*="rotate("]');
      const gpsSvgs = gpsArrowWrap ? gpsArrowWrap.querySelectorAll('svg').length : 0;

      const bodyText = document.body.innerText;
      const hasUnicodeEmojiHud = /[♥★➤📻⏱☠]/.test(bodyText);

      const miniCanvas = Array.from(document.querySelectorAll('canvas')).find(
        (c) => !c.closest('#game-canvas-container')
      ) as HTMLCanvasElement | undefined;
      let miniDistinctColors = 0;
      if (miniCanvas) {
        const ctx = miniCanvas.getContext('2d');
        if (ctx) {
          const data = ctx.getImageData(0, 0, miniCanvas.width, miniCanvas.height).data;
          const seen = new Set<string>();
          for (let i = 0; i < data.length; i += 64) {
            seen.add(`${data[i] >> 4},${data[i + 1] >> 4},${data[i + 2] >> 4}`);
            if (seen.size >= 8) break;
          }
          miniDistinctColors = seen.size;
        }
      }

      return {
        hpSvgs,
        wantedSvgs,
        gpsSvgs,
        hasUnicodeEmojiHud,
        miniWidth: miniCanvas?.width ?? 0,
        miniHeight: miniCanvas?.height ?? 0,
        miniDistinctColors,
      };
    });

    expect(cornerCheck.miniWidth).toBeGreaterThanOrEqual(176);
    expect(cornerCheck.miniHeight).toBeGreaterThanOrEqual(176);
    expect(cornerCheck.miniDistinctColors).toBeGreaterThanOrEqual(4);
    expect(cornerCheck.hpSvgs).toBeGreaterThanOrEqual(5);
    expect(cornerCheck.wantedSvgs).toBeGreaterThanOrEqual(6);
    expect(cornerCheck.gpsSvgs).toBeGreaterThanOrEqual(1);
    expect(cornerCheck.hasUnicodeEmojiHud).toBe(false);

    // 2) Grant weapons and verify simultaneous Weapon Slot Strip (>= 5 weapon slots) + E/Q/wheel cycling
    await grantArsenal(page);
    const visibleWeaponSlots = await page.evaluate(() => {
      const patterns = [/9MM/i, /UZI/i, /SHOTGUN/i, /\bM4\b/i, /MOLOTOV/i, /GRENADE/i, /FLAMER/i, /RPG/i];
      const text = document.body.innerText;
      return patterns.filter((re) => re.test(text)).length;
    });
    expect(visibleWeaponSlots).toBeGreaterThanOrEqual(5);

    const w1 = await getActiveWeapon(page);
    await tapKey(page, 'KeyE', 60);
    await page.waitForTimeout(80);
    const w2 = await getActiveWeapon(page);
    expect(w2.name).not.toEqual(w1.name);

    await tapKey(page, 'KeyQ', 60);
    await page.waitForTimeout(80);
    const w3 = await getActiveWeapon(page);
    expect(w3.name).toEqual(w1.name);

    await page.mouse.move(640, 360);
    await page.mouse.wheel(0, 120);
    await expect
      .poll(async () => (await getActiveWeapon(page)).name, { timeout: 2_000, intervals: [100] })
      .not.toEqual(w3.name);

    // 3) Open [TAB] Full Map and verify >= 512px non-blank canvas
    await tapKey(page, 'Tab', 60);
    await expect(page.getByRole('heading', { name: /FIVE BOROUGHS MAP/i })).toBeVisible();
    const mapCanvasCheck = await page.evaluate(() => {
      const canvases = Array.from(document.querySelectorAll('canvas'));
      const full = canvases.find((c) => c.width >= 512 && !c.closest('#game-canvas-container'));
      if (!full) return null;
      const ctx = full.getContext('2d');
      let distinct = 0;
      if (ctx) {
        const data = ctx.getImageData(0, 0, full.width, full.height).data;
        const seen = new Set<string>();
        for (let i = 0; i < data.length; i += 256) {
          seen.add(`${data[i] >> 4},${data[i + 1] >> 4},${data[i + 2] >> 4}`);
          if (seen.size >= 8) break;
        }
        distinct = seen.size;
      }
      return { w: full.width, h: full.height, distinct };
    });
    expect(mapCanvasCheck).not.toBeNull();
    expect(mapCanvasCheck!.w).toBeGreaterThanOrEqual(512);
    expect(mapCanvasCheck!.distinct).toBeGreaterThanOrEqual(4);

    await tapKey(page, 'Tab', 60);
    guards.assertClean();
  });

  test('T1.25 M4 Wall Street Vault (tagged collect_pickups) & M8 Zero Day Takedown (fuel_tanker)', async ({
    page,
  }) => {
    test.setTimeout(220_000);
    const guards = attachRuntimeGuards(page);
    await page.goto('/');
    await waitForGameReady(page);
    await startNewGameViaUI(page, { mode: 'casual' });

    await toggleGodMode(page, true);
    await grantArsenal(page);

    // Part A: M4 syn_wall_street_vault
    await launchMission(page, 'syn_wall_street_vault');
    await waitForFrames(page, 20);
    expect((await getMissionPill(page))?.title).toMatch(/Wall Street Vault/i);

    // Board empire_freight near (768, 1770)
    await walkToCoords(page, 768, 1770, 5, true, 16);
    for (let i = 0; i < 6; i++) {
      const d = await getVehicleDash(page);
      if (d && /Empire Box Truck/i.test(d.name)) break;
      await tapKey(page, 'KeyF', 90);
      await page.waitForTimeout(200);
      await holdKeys(page, ['KeyW'], 250);
    }
    await expect.poll(async () => (await getVehicleDash(page))?.name ?? '').toMatch(/Empire Box Truck/i);
    await expect
      .poll(async () => (await getMissionPill(page))?.objective ?? '', { timeout: 5_000 })
      .toMatch(/Breach|armored transport|eliminate guards|SWAT/i);

    // Drive to (576, 1600) via street grid (768, 1664) -> (640, 1664) -> (640, 1600) -> (576, 1600)
    await driveToCoords(page, 768, 1664, 13, 35);
    await driveToCoords(page, 640, 1664, 13, 35);
    await driveToCoords(page, 640, 1600, 11, 25);
    await driveToCoords(page, 576, 1600, 14, 25);
    await tapKey(page, 'KeyF', 80);

    // Clear 6 SWAT via GPS-guided RPG + M4
    await selectWeaponByName(page, /RPG/i);
    for (let shot = 0; shot < 12; shot++) {
      const p = await getMissionPill(page);
      if (p && /cash|case|vault|collect/i.test(p.objective) && /\/3/.test(p.progressText ?? '')) break;
      const gps = await getGpsInfo(page);
      if (gps) {
        await holdKeys(page, angleToKeys(gps.angleRad), gps.distanceM > 28 ? 450 : 200);
        await clickCanvasAtOffset(page, Math.cos(gps.angleRad) * 150, Math.sin(gps.angleRad) * 150, 260);
      }
      await page.waitForTimeout(1_500);
    }
    await selectWeaponByName(page, /\bM4\b/i);
    for (let mop = 0; mop < 14; mop++) {
      const p = await getMissionPill(page);
      if (p && /\/3/.test(p.progressText ?? '')) break;
      const gps = await getGpsInfo(page);
      if (gps) {
        await holdKeys(page, angleToKeys(gps.angleRad), gps.distanceM > 14 ? 350 : 180);
        await clickCanvasAtOffset(page, Math.cos(gps.angleRad) * 150, Math.sin(gps.angleRad) * 150, 400);
      }
      await page.waitForTimeout(200);
    }
    await expect
      .poll(async () => (await getMissionPill(page))?.progressText ?? '', { timeout: 6_000 })
      .toMatch(/0\/3|1\/3/);

    // Exit any vehicle, teleport back to Financial Dist. (640, 1536), then walk on foot via (576, 1536) -> (576, 1600) cleanly into Wall Street Plaza
    const cashBeforeCases = await parseCash(page);
    if ((await getVehicleDash(page)) !== null) {
      await tapKey(page, 'KeyF', 80);
      await page.waitForTimeout(200);
    }
    await teleport(page, 'Financial Dist.');
    await waitForFrames(page, 10);
    await walkToCoords(page, 576, 1536, 3, true, 26);
    await walkToCoords(page, 576, 1600, 3, true, 24);
    await walkToCoords(page, 564, 1592, 1.5, true, 22);
    await walkToCoords(page, 588, 1596, 1.5, true, 22);
    await walkToCoords(page, 576, 1612, 1.5, true, 22);
    await expect
      .poll(async () => (await getMissionPill(page))?.objective ?? '', { timeout: 6_000 })
      .toMatch(/Pay 'n' Spray|Lose|NYPD/i);
    expect(await parseCash(page)).toBeGreaterThan(cashBeforeCases);

    // Part B: M8 yak_zero_day_takedown (12 lieutenants -> fuel_tanker destruction at Queens Rail Depot (1792, 704))
    await launchMission(page, 'yak_zero_day_takedown');
    await teleport(page, 'Queens Expy');
    await waitForFrames(page, 20);
    expect((await getMissionPill(page))?.title).toMatch(/Zero[- ]Day Takedown/i);
    const cashBeforeM8 = await parseCash(page);

    // Drive from Queens Expy (1664, 384) via (1536, 384) -> (1536, 640) -> (1792, 640) -> (1792, 704) into Queens Rail Depot
    await walkToCoords(page, 1640, 384, 3, true, 14);
    await enterSpawnedVehicle(page, 'apex_gt', 'KeyA', /Apex GT/i);
    await driveToCoords(page, 1536, 384, 14, 30);
    await driveToCoords(page, 1536, 640, 14, 40);
    await driveToCoords(page, 1792, 640, 14, 40);
    await driveToCoords(page, 1792, 704, 16, 28);
    await tapKey(page, 'KeyF', 80);
    await page.waitForTimeout(180);
    if ((await getVehicleDash(page)) !== null) {
      await tapKey(page, 'KeyF', 80);
    }
    // Walk into the depot yard before starting RPG/M4 sweep
    await walkToCoords(page, 1792, 704, 16, true, 24);

    await selectWeaponByName(page, /RPG/i);
    for (let shot = 0; shot < 8; shot++) {
      const p = await getMissionPill(page);
      if (!p || /Fuel Tanker/i.test(p.objective)) break;
      const gps = await getGpsInfo(page);
      if (gps) {
        await holdKeys(page, angleToKeys(gps.angleRad), gps.distanceM > 28 ? 420 : 180);
        await clickCanvasAtOffset(page, Math.cos(gps.angleRad) * 150, Math.sin(gps.angleRad) * 150, 260);
      }
      await page.waitForTimeout(1_100);
    }
    await selectWeaponByName(page, /\bM4\b/i);
    for (let mop = 0; mop < 32; mop++) {
      const p = await getMissionPill(page);
      if (!p || /Fuel Tanker/i.test(p.objective)) break;
      const gps = await getGpsInfo(page);
      if (gps) {
        await holdKeys(page, angleToKeys(gps.angleRad), gps.distanceM > 14 ? 320 : 160);
        await clickCanvasAtOffset(page, Math.cos(gps.angleRad) * 150, Math.sin(gps.angleRad) * 150, 380);
      }
      await page.waitForTimeout(160);
    }

    await expect
      .poll(async () => (await getMissionPill(page))?.objective ?? '', { timeout: 8_000 })
      .toMatch(/Fuel Tanker/i);

    // Walk within ~20m of fuel_tanker prop and destroy it with RPG
    await selectWeaponByName(page, /RPG/i);
    for (let step = 0; step < 12; step++) {
      const gps = await getGpsInfo(page);
      if (!gps || gps.distanceM <= 24) break;
      await holdKeys(page, angleToKeys(gps.angleRad), 450);
    }
    for (let shot = 0; shot < 6; shot++) {
      if ((await getMissionPill(page)) === null) break;
      const gps = await getGpsInfo(page);
      const angle = gps ? gps.angleRad : 0;
      await holdKeys(page, angleToKeys(angle), 200);
      await clickCanvasAtOffset(page, Math.cos(angle) * 150, Math.sin(angle) * 150, 260);
      await page.waitForTimeout(1_200);
    }

    await expect.poll(async () => await getMissionPill(page), { timeout: 8_000 }).toBeNull();
    expect(await getPagerText(page)).toMatch(/MISSION PASSED/i);
    expect(await parseCash(page)).toBeGreaterThanOrEqual(cashBeforeM8 + 55_000);

    guards.assertClean();
  });
});
