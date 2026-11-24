import { expect, type Page } from '@playwright/test';

export interface DebugTelemetry {
  fps: number;
  drawCalls: number;
  rigidBodies: number;
  activeChunks: number;
  totalChunks: number;
  vehicles: number;
  peds: number;
  x: number;
  y: number;
  layer: number;
}

function debugContainer(page: Page) {
  return page.locator('div[data-ui-interactive="true"]').filter({
    hasText: 'QA DEBUG CONSOLE',
  });
}

export async function isDebugPanelOpen(page: Page): Promise<boolean> {
  return debugContainer(page).isVisible();
}

export async function openDebugPanel(page: Page): Promise<void> {
  if (await isDebugPanelOpen(page)) return;
  await page.keyboard.press('Backquote');
  try {
    await expect(debugContainer(page)).toBeVisible({ timeout: 2_000 });
  } catch {
    await page.getByRole('button', { name: /\[~\]\s*(?:QA\s*)?DEBUG/i }).click();
    await expect(debugContainer(page)).toBeVisible({ timeout: 3_000 });
  }
}

export async function closeDebugPanel(page: Page): Promise<void> {
  if (!(await isDebugPanelOpen(page))) return;
  await page.keyboard.press('Backquote');
  try {
    await expect(debugContainer(page)).toBeHidden({ timeout: 2_000 });
  } catch {
    await debugContainer(page).getByRole('button', { name: /✕|close/i }).first().click();
    await expect(debugContainer(page)).toBeHidden({ timeout: 3_000 });
  }
}

export async function getTelemetry(page: Page): Promise<DebugTelemetry> {
  const wasOpen = await isDebugPanelOpen(page);
  if (!wasOpen) await openDebugPanel(page);
  try {
    const text = await debugContainer(page).innerText();
    const num = (re: RegExp) => {
      const m = text.match(re);
      return m ? Number(m[1]) : 0;
    };
    const chunksMatch = text.match(/Chunks:\s*(\d+)\s*\/\s*(\d+)/i);
    const posMatch = text.match(/Pos:\s*\((-?\d+),\s*(-?\d+)\)\s*[•|]\s*Elev Layer:\s*(\d+)/i);
    return {
      fps: num(/FPS:\s*(\d+)/i),
      drawCalls: num(/Draw Calls:\s*(\d+)/i),
      rigidBodies: num(/Rapier Bodies:\s*(\d+)/i),
      activeChunks: chunksMatch ? Number(chunksMatch[1]) : 0,
      totalChunks: chunksMatch ? Number(chunksMatch[2]) : 0,
      vehicles: num(/Vehicles:\s*(\d+)/i),
      peds: num(/Peds:\s*(\d+)/i),
      x: posMatch ? Number(posMatch[1]) : 0,
      y: posMatch ? Number(posMatch[2]) : 0,
      layer: posMatch ? Number(posMatch[3]) : 0,
    };
  } finally {
    if (!wasOpen) await closeDebugPanel(page);
  }
}

export async function teleport(page: Page, labelFragment: string): Promise<void> {
  const wasOpen = await isDebugPanelOpen(page);
  if (!wasOpen) await openDebugPanel(page);
  try {
    const btn = debugContainer(page)
      .getByRole('button', { name: new RegExp(labelFragment, 'i') })
      .first();
    await expect(btn).toBeVisible({ timeout: 3_000 });
    await btn.click();
  } finally {
    if (!wasOpen) await closeDebugPanel(page);
  }
}

export async function getSpawnerVehicleIds(page: Page): Promise<string[]> {
  const wasOpen = await isDebugPanelOpen(page);
  if (!wasOpen) await openDebugPanel(page);
  try {
    const vehicleSelect = debugContainer(page)
      .locator('select')
      .filter({ has: page.locator('option[value="metro_cab"]') })
      .first();
    await expect(vehicleSelect).toBeVisible({ timeout: 3_000 });
    return vehicleSelect.locator('option').evaluateAll((opts) =>
      opts.map((o) => (o as HTMLOptionElement).value)
    );
  } finally {
    if (!wasOpen) await closeDebugPanel(page);
  }
}

export async function spawnVehicle(page: Page, vehicleId: string): Promise<void> {
  const wasOpen = await isDebugPanelOpen(page);
  if (!wasOpen) await openDebugPanel(page);
  try {
    const vehicleSelect = debugContainer(page)
      .locator('select')
      .filter({ has: page.locator('option[value="metro_cab"]') })
      .first();
    await expect(vehicleSelect).toBeVisible({ timeout: 3_000 });
    await vehicleSelect.selectOption(vehicleId);
    await debugContainer(page).getByRole('button', { name: /^SPAWN$/i }).click();
  } finally {
    if (!wasOpen) await closeDebugPanel(page);
  }
}

export async function setWanted(page: Page, stars: number): Promise<void> {
  const wasOpen = await isDebugPanelOpen(page);
  if (!wasOpen) await openDebugPanel(page);
  try {
    await debugContainer(page)
      .getByRole('button', { name: new RegExp(`^${stars}(?:★)?$`) })
      .click();
  } finally {
    if (!wasOpen) await closeDebugPanel(page);
  }
}

export async function grantArsenal(page: Page): Promise<void> {
  const wasOpen = await isDebugPanelOpen(page);
  if (!wasOpen) await openDebugPanel(page);
  try {
    await debugContainer(page).getByRole('button', { name: /All Weapons/i }).click();
  } finally {
    if (!wasOpen) await closeDebugPanel(page);
  }
}

export async function addDebugCash(page: Page): Promise<void> {
  const wasOpen = await isDebugPanelOpen(page);
  if (!wasOpen) await openDebugPanel(page);
  try {
    await debugContainer(page).getByRole('button', { name: /\+\$100,000/i }).click();
  } finally {
    if (!wasOpen) await closeDebugPanel(page);
  }
}

export async function toggleGodMode(page: Page, enable?: boolean): Promise<void> {
  const wasOpen = await isDebugPanelOpen(page);
  if (!wasOpen) await openDebugPanel(page);
  try {
    const btn = debugContainer(page).getByRole('button', { name: /God Mode:/i });
    const txt = (await btn.innerText()).trim();
    const isOn = /ON$/i.test(txt);
    if (enable === undefined || enable !== isOn) {
      await btn.click();
    }
  } finally {
    if (!wasOpen) await closeDebugPanel(page);
  }
}

export async function maxRespect(page: Page): Promise<void> {
  const wasOpen = await isDebugPanelOpen(page);
  if (!wasOpen) await openDebugPanel(page);
  try {
    await debugContainer(page).getByRole('button', { name: /Max All Respect/i }).click();
  } finally {
    if (!wasOpen) await closeDebugPanel(page);
  }
}

export async function launchMission(page: Page, missionId: string): Promise<void> {
  const wasOpen = await isDebugPanelOpen(page);
  if (!wasOpen) await openDebugPanel(page);
  try {
    const missionSelect = debugContainer(page)
      .locator('select')
      .filter({ has: page.locator('option[value="syn_protection_money"]') })
      .first();
    await expect(missionSelect).toBeVisible({ timeout: 3_000 });
    await missionSelect.selectOption(missionId);
    await debugContainer(page).getByRole('button', { name: /LAUNCH SELECTED MISSION/i }).click();
  } finally {
    if (!wasOpen) await closeDebugPanel(page);
  }
}
