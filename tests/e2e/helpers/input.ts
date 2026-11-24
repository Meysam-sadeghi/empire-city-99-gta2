import { expect, type Page } from '@playwright/test';
import { getMinimapCoords, getVehicleDash } from './hud';
import { spawnVehicle } from './debugPanel';

export async function holdKeys(page: Page, keys: string[], durationMs: number): Promise<void> {
  const pressed: string[] = [];
  try {
    for (const k of keys) {
      await page.keyboard.down(k);
      pressed.push(k);
    }
    await page.waitForTimeout(durationMs);
  } finally {
    for (let i = pressed.length - 1; i >= 0; i--) {
      await page.keyboard.up(pressed[i]).catch(() => {});
    }
  }
}

export async function holdKeysUntil(
  page: Page,
  keys: string[],
  predicate: () => Promise<boolean>,
  maxMs = 3_500,
  pollMs = 220
): Promise<boolean> {
  const pressed: string[] = [];
  const deadline = Date.now() + maxMs;
  try {
    for (const k of keys) {
      await page.keyboard.down(k);
      pressed.push(k);
    }
    while (Date.now() < deadline) {
      await page.waitForTimeout(pollMs);
      if (await predicate()) return true;
    }
    return await predicate();
  } finally {
    for (let i = pressed.length - 1; i >= 0; i--) {
      await page.keyboard.up(pressed[i]).catch(() => {});
    }
  }
}

export async function waitForFrames(page: Page, frames = 20): Promise<void> {
  await page.evaluate(
    (target) =>
      new Promise<void>((resolve) => {
        let count = 0;
        const tick = () => {
          count++;
          if (count >= target) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    frames
  );
}

export async function tapKey(page: Page, key: string, holdMs = 70): Promise<void> {
  await page.keyboard.down(key);
  try {
    await page.waitForTimeout(holdMs);
  } finally {
    await page.keyboard.up(key).catch(() => {});
  }
}

export async function aimCanvasAtOffset(
  page: Page,
  dxFromCenter = 0,
  dyFromCenter = -120
): Promise<void> {
  const box = await page.locator('#game-canvas-container canvas').boundingBox();
  expect(box).not.toBeNull();
  const x = box!.x + box!.width / 2 + dxFromCenter;
  const y = box!.y + box!.height / 2 + dyFromCenter;
  await page.mouse.move(x, y);
}

export async function clickCanvasAtOffset(
  page: Page,
  dxFromCenter = 0,
  dyFromCenter = -120,
  holdMs = 120
): Promise<void> {
  const box = await page.locator('#game-canvas-container canvas').boundingBox();
  expect(box).not.toBeNull();
  const x = box!.x + box!.width / 2 + dxFromCenter;
  const y = box!.y + box!.height / 2 + dyFromCenter;
  await page.mouse.move(x, y);
  await page.mouse.down({ button: 'left' });
  try {
    await page.waitForTimeout(holdMs);
  } finally {
    await page.mouse.up({ button: 'left' }).catch(() => {});
  }
}

export interface StartGameOptions {
  mode?: 'casual' | 'classic' | 'story' | 'frenzy' | 'freeroam';
  lighting?: 'noon' | 'dusk' | 'night' | 'cycle';
  control?: 'directional' | 'tank';
}

export async function selectTitleOptions(
  page: Page,
  opts: StartGameOptions = {}
): Promise<void> {
  if (opts.lighting) {
    const labelMap: Record<NonNullable<StartGameOptions['lighting']>, RegExp> = {
      noon: /\bnoon\b/i,
      dusk: /\bdusk\b/i,
      night: /neon\s*night|\bnight\b/i,
      cycle: /\bcycle\b/i,
    };
    const btn = page.getByRole('button', { name: labelMap[opts.lighting] }).first();
    await expect(btn).toBeVisible({ timeout: 3_000 });
    await btn.click();
  }

  if (opts.control) {
    const labelMap: Record<NonNullable<StartGameOptions['control']>, RegExp> = {
      directional: /directional/i,
      tank: /\btank\b/i,
    };
    const btn = page.getByRole('button', { name: labelMap[opts.control] }).first();
    await expect(btn).toBeVisible({ timeout: 3_000 });
    await btn.click();
  }
}

export async function waitForSimWarmup(page: Page): Promise<void> {
  // Wait for 4 rAF ticks so initial 5x5 city chunk meshes & WebGL shaders finish compiling
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let frames = 0;
        const tick = () => {
          frames++;
          if (frames >= 4) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      })
  );
  await page.waitForTimeout(150);
}

export async function startNewGameViaUI(
  page: Page,
  opts: StartGameOptions = {}
): Promise<void> {
  await selectTitleOptions(page, opts);

  const mode = opts.mode ?? 'casual';
  if (mode === 'frenzy') {
    const modeBtn = page.getByRole('button', { name: /kill\s*frenzy/i }).first();
    await expect(modeBtn).toBeVisible({ timeout: 4_000 });
    await modeBtn.click();
    const launchBtn = page.getByRole('button', { name: /launch\s*kill\s*frenzy/i }).first();
    await expect(launchBtn).toBeVisible({ timeout: 4_000 });
    await launchBtn.click();
  } else if (mode === 'freeroam') {
    const modeBtn = page.getByRole('button', { name: /free\s*roam/i }).first();
    await expect(modeBtn).toBeVisible({ timeout: 4_000 });
    await modeBtn.click();
    const launchBtn = page.getByRole('button', { name: /launch\s*free\s*roam/i }).first();
    await expect(launchBtn).toBeVisible({ timeout: 4_000 });
    await launchBtn.click();
  } else if (mode === 'classic') {
    const launchBtn = page.getByRole('button', { name: /play\s*classic/i }).first();
    await expect(launchBtn).toBeVisible({ timeout: 4_000 });
    await launchBtn.click();
  } else {
    const launchBtn = page.getByRole('button', { name: /play\s*new\s*game/i }).first();
    await expect(launchBtn).toBeVisible({ timeout: 4_000 });
    await launchBtn.click();
  }

  await page.getByRole('button', { name: /\[~\]\s*(?:QA\s*)?DEBUG/i }).waitFor({ state: 'visible', timeout: 8_000 });
  await waitForSimWarmup(page);
}

/**
 * Spawns a vehicle 7.5m ahead of player, walks toward it along current facing, and enters via KeyF.
 */
export async function enterSpawnedVehicle(
  page: Page,
  vehicleId: string,
  walkKey: 'KeyW' | 'KeyS' | 'KeyA' | 'KeyD' = 'KeyW',
  expectedNameRe?: RegExp
): Promise<void> {
  await holdKeys(page, [walkKey], 240);
  await spawnVehicle(page, vehicleId);

  for (let attempt = 0; attempt < 10; attempt++) {
    const alreadyIn = await getVehicleDash(page);
    if (alreadyIn && (!expectedNameRe || expectedNameRe.test(alreadyIn.name))) {
      return;
    }
    await holdKeys(page, [walkKey], 450);
    await tapKey(page, 'KeyF', 100);
    await page.waitForTimeout(260);
    const dash = await getVehicleDash(page);
    if (dash && (!expectedNameRe || expectedNameRe.test(dash.name))) {
      return;
    }
  }
  const finalDash = await getVehicleDash(page);
  expect(finalDash, `Failed to enter spawned ${vehicleId}`).not.toBeNull();
  if (expectedNameRe) {
    expect(finalDash!.name).toMatch(expectedNameRe);
  }
}

/**
 * Walks player vertically (North/South) using HUD minimap coordinates until reaching targetY ± tolerance.
 */
export async function walkToY(
  page: Page,
  targetY: number,
  tolerance = 3,
  sprint = true
): Promise<void> {
  for (let step = 0; step < 18; step++) {
    const pos = await getMinimapCoords(page);
    if (Math.abs(pos.y - targetY) <= tolerance) return;
    const dist = Math.abs(pos.y - targetY);
    const dirKey = pos.y < targetY ? 'KeyS' : 'KeyW';
    const keys = sprint ? ['ShiftLeft', dirKey] : [dirKey];
    await holdKeys(page, keys, dist > 12 ? 600 : 350);
  }
}

/**
 * Walks player in 2D using HUD minimap coordinates until reaching (targetX, targetY) within tolerance.
 */
export async function walkToCoords(
  page: Page,
  targetX: number,
  targetY: number,
  tolerance = 4,
  sprint = true,
  maxSteps = 24
): Promise<void> {
  for (let step = 0; step < maxSteps; step++) {
    const pos = await getMinimapCoords(page);
    const dx = targetX - pos.x;
    const dy = targetY - pos.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= tolerance) return;

    const keys: string[] = [];
    if (sprint && dist > 10) keys.push('ShiftLeft');
    const axisThreshold = Math.max(1.5, tolerance * 0.45);
    if (dx > axisThreshold) keys.push('KeyD');
    else if (dx < -axisThreshold) keys.push('KeyA');
    if (dy > axisThreshold) keys.push('KeyS');
    else if (dy < -axisThreshold) keys.push('KeyW');

    if (keys.length === 0 || (keys.length === 1 && keys[0] === 'ShiftLeft')) {
      if (Math.abs(dx) >= Math.abs(dy)) keys.push(dx >= 0 ? 'KeyD' : 'KeyA');
      else keys.push(dy >= 0 ? 'KeyS' : 'KeyW');
    }
    await holdKeys(page, keys, dist > 14 ? 550 : dist > 6 ? 350 : 220);
  }
}
