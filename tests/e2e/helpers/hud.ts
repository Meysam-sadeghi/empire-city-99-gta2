import type { Page } from '@playwright/test';

export async function parseCash(page: Page): Promise<number> {
  const txt = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('div, span'));
    for (const el of els) {
      if (el.children.length === 0) {
        const t = el.textContent?.trim() ?? '';
        if (/^\$[\d,]{5,}$/.test(t)) return t;
      }
    }
    return '';
  });
  if (!txt) throw new Error('Cash HUD readout not found');
  return Number(txt.replace(/[$,]/g, ''));
}

export async function getMultiplier(page: Page): Promise<number> {
  const txt = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('div, span'));
    for (const el of els) {
      if (el.children.length === 0) {
        const t = el.textContent?.trim() ?? '';
        if (/^x\d+$/.test(t)) return t;
      }
    }
    return '';
  });
  if (!txt) throw new Error('Multiplier HUD badge not found');
  return Number(txt.slice(1));
}

export interface VitalsInfo {
  hp: number;
  maxHp: number;
  armor: number;
  staminaPct: number;
  godMode: boolean;
}

export async function getHealthAndArmor(page: Page): Promise<VitalsInfo> {
  return page.evaluate(() => {
    const hpEl = document.querySelector('[title^="Health: "]');
    const hpTitle = hpEl?.getAttribute('title') ?? '';
    const hpMatch = hpTitle.match(/Health:\s*(\d+)\s*\/\s*(\d+)/i);
    if (!hpMatch) throw new Error(`Health HUD element missing or invalid title: "${hpTitle}"`);

    const armorEl = document.querySelector('[title^="Armor: "]');
    const armorTitle = armorEl?.getAttribute('title') ?? '';
    const armorMatch = armorTitle.match(/Armor:\s*(\d+)/i);

    const stamBar = document.querySelector('[title="Sprint Stamina"] > div') as HTMLElement | null;
    const stamWidth = stamBar?.style.width ?? '100%';
    const staminaPct = Number.parseFloat(stamWidth) || 0;

    const godMode = Array.from(document.querySelectorAll('span')).some(
      (s) => s.textContent?.trim() === 'GOD'
    );

    return {
      hp: Number(hpMatch[1]),
      maxHp: Number(hpMatch[2]),
      armor: armorMatch ? Number(armorMatch[1]) : 0,
      staminaPct,
      godMode,
    };
  });
}

export interface WeaponHudInfo {
  name: string;
  ammo: number; // -1 for infinite
}

export async function getActiveWeapon(page: Page): Promise<WeaponHudInfo> {
  return page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll('div, span'));
    const header = labels.find(
      (el) => el.children.length === 0 && /\[Q\/E\]/.test(el.textContent ?? '')
    );
    if (!header || !header.parentElement) {
      throw new Error('Active weapon HUD badge not found');
    }
    const rawName = (header.textContent ?? '').replace(/\s*\[Q\/E\]\s*/g, '').trim();
    const card = header.closest('div.text-right') ?? header.parentElement;
    const ammoEl =
      card.querySelector(':scope > div:last-child') ??
      header.nextElementSibling ??
      header.parentElement.nextElementSibling;
    const ammoText = ammoEl?.textContent?.trim() ?? '';
    const hasInfinitySvg = ammoText === '' && Boolean(ammoEl?.querySelector('svg'));
    const ammo = ammoText === '∞' || hasInfinitySvg ? -1 : Number(ammoText);
    if (Number.isNaN(ammo)) {
      throw new Error(`Invalid weapon ammo text: "${ammoText}"`);
    }
    return { name: rawName, ammo };
  });
}

export async function getAmmo(page: Page): Promise<number> {
  return (await getActiveWeapon(page)).ammo;
}

export interface VehicleDashInfo {
  name: string;
  speedKmh: number;
  hpPct: number;
  hpClassName: string;
}

export async function getVehicleDash(page: Page): Promise<VehicleDashInfo | null> {
  return page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('span, div'));
    const speedEl = els.find(
      (el) => el.children.length === 0 && /^\d+\s*KM\/H$/i.test(el.textContent?.trim() ?? '')
    );
    if (!speedEl) return null;
    const card = speedEl.closest('.border-cyan-500\\/60') ?? speedEl.parentElement?.parentElement;
    if (!card) return null;

    const nameEl = card.querySelector(':scope > div:first-child');
    const hpEl = Array.from(card.querySelectorAll('span')).find((s) =>
      /^\d+%\s*HP$/i.test(s.textContent?.trim() ?? '')
    );
    const speedMatch = (speedEl.textContent ?? '').match(/(\d+)\s*KM\/H/i);
    const hpMatch = (hpEl?.textContent ?? '').match(/(\d+)%\s*HP/i);

    return {
      name: nameEl?.textContent?.trim() ?? '',
      speedKmh: speedMatch ? Number(speedMatch[1]) : 0,
      hpPct: hpMatch ? Number(hpMatch[1]) : 0,
      hpClassName: hpEl?.className ?? '',
    };
  });
}

export interface MissionPillInfo {
  title: string;
  objective: string;
  progressText: string | null;
}

export async function getMissionPill(page: Page): Promise<MissionPillInfo | null> {
  return page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('div, span'));
    const legacy = els.find(
      (el) => el.children.length === 0 && /ACTIVE CONTRACT\s*•/i.test(el.textContent ?? '')
    );
    if (legacy && legacy.parentElement) {
      const title = (legacy.textContent ?? '').replace(/^ACTIVE CONTRACT\s*•\s*/i, '').trim();
      const objRaw = legacy.nextElementSibling?.textContent?.trim() ?? '';
      const progMatch = objRaw.match(/\[([^\]]+)\]\s*$/);
      const progressText = progMatch ? progMatch[1] : null;
      const objective = progMatch ? objRaw.slice(0, progMatch.index).trim() : objRaw;
      return { title, objective, progressText };
    }

    const stageSpan = els.find(
      (el) => el.children.length === 0 && /\|\s*STAGE\s+\d+\s*\/\s*\d+/i.test(el.textContent ?? '')
    );
    if (!stageSpan) return null;
    const card =
      stageSpan.closest('div[data-ui-interactive="true"]') ?? stageSpan.parentElement?.parentElement;
    if (!card) return null;
    const title = (stageSpan.textContent ?? '').replace(/\|\s*STAGE\s+\d+\s*\/\s*\d+.*$/i, '').trim();
    const objEl = card.querySelector(':scope > div:nth-child(2)');
    const objRaw = objEl?.textContent?.trim() ?? '';
    const progMatch = objRaw.match(/\[([^\]]+)\]\s*$/);
    const progressText = progMatch ? progMatch[1] : null;
    const objective = progMatch ? objRaw.slice(0, progMatch.index).trim() : objRaw;
    return { title, objective, progressText };
  });
}

export async function getWantedStars(page: Page): Promise<number> {
  return page.evaluate(() => {
    // Support both Unicode ★ spans and Lucide SVG stars
    const candidates = Array.from(document.querySelectorAll('div')).filter((div) => {
      const children = Array.from(div.children);
      if (children.length !== 6) return false;
      const allStars = children.every(
        (c) => c.textContent?.trim() === '★' || c.tagName.toLowerCase() === 'svg'
      );
      return allStars;
    });
    if (candidates.length === 0) return 0;
    const container = candidates[0];
    let lit = 0;
    for (const child of Array.from(container.children)) {
      const cls = child.getAttribute('class') ?? '';
      if (/text-yellow-400|fill-yellow-400/.test(cls)) lit++;
    }
    return lit;
  });
}

export interface RespectInfo {
  syndicate: number;
  yakuza: number;
  brotherhood: number;
}

export async function getRespect(page: Page): Promise<RespectInfo> {
  return page.evaluate(() => {
    const out: RespectInfo = { syndicate: 0, yakuza: 0, brotherhood: 0 };
    const cols = Array.from(document.querySelectorAll('[title*="Respect"]'));
    for (const col of cols) {
      const title = col.getAttribute('title') ?? '';
      const m = title.match(/:\s*([+-]?\d+)\s*Respect/i);
      if (!m) continue;
      const val = Number(m[1]);
      if (/Syndicate/i.test(title)) out.syndicate = val;
      else if (/Yakuza/i.test(title)) out.yakuza = val;
      else if (/Brotherhood/i.test(title)) out.brotherhood = val;
    }
    return out;
  });
}

export async function getMinimapCoords(page: Page): Promise<{ district: string; x: number; y: number }> {
  return page.evaluate(() => {
    const spans = Array.from(document.querySelectorAll('span'));
    const coordSpan = spans.find(
      (s) => s.children.length === 0 && /^\d+,\d+$/.test(s.textContent?.trim() ?? '')
    );
    if (!coordSpan) throw new Error('Minimap coordinate readout not found');
    const [x, y] = (coordSpan.textContent ?? '').trim().split(',').map(Number);
    const district = coordSpan.previousElementSibling?.textContent?.trim() ?? '';
    return { district, x, y };
  });
}

export async function getPagerText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const badge = Array.from(document.querySelectorAll('span')).find(
      (s) => s.textContent?.trim() === 'PAGER 99'
    );
    if (!badge) return '';
    const next = badge.nextElementSibling?.textContent?.trim() ?? '';
    if (next) return next;
    return (badge.parentElement?.textContent ?? '').replace(/PAGER 99/i, '').trim();
  });
}

export async function getGpsText(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('div, span'));
    const gps = els.find((el) => /\(\d+m\)\s*$/.test(el.textContent?.trim() ?? ''));
    return gps?.textContent?.trim() ?? null;
  });
}

export interface GpsInfo {
  angleRad: number;
  distanceM: number;
  label: string;
}

export async function getGpsInfo(page: Page): Promise<GpsInfo | null> {
  return page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('div, span'));
    const gpsLabelEl = els.find(
      (el) => el.children.length <= 1 && /\(\d+m\)\s*$/.test(el.textContent?.trim() ?? '')
    );
    if (!gpsLabelEl || !gpsLabelEl.parentElement) return null;
    const text = gpsLabelEl.textContent?.trim() ?? '';
    const distMatch = text.match(/\((\d+)m\)\s*$/);
    if (!distMatch) return null;
    const arrowEl = gpsLabelEl.parentElement.querySelector('[style*="rotate("]') as HTMLElement | null;
    const rotMatch = arrowEl?.style.transform.match(/rotate\((-?[\d.]+)deg\)/);
    const angleDeg = rotMatch ? Number(rotMatch[1]) : 0;
    return {
      angleRad: (angleDeg * Math.PI) / 180,
      distanceM: Number(distMatch[1]),
      label: text.replace(/\(\d+m\)\s*$/, '').trim(),
    };
  });
}

export async function getMissionTimerSec(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const spans = Array.from(document.querySelectorAll('span'));
    for (const s of spans) {
      if (s.closest('.retro-scanlines')) continue;
      const t = s.textContent?.trim() ?? '';
      const m = t.match(/(?:^|\s)(\d+):(\d{2})$/);
      const cls = `${s.className} ${s.parentElement?.className ?? ''}`;
      if (m && (/⏱/.test(t) || /border-red|text-red/.test(cls))) {
        return Number(m[1]) * 60 + Number(m[2]);
      }
    }
    return null;
  });
}

export async function getRadioLabel(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('span'));
    const el = els.find((s) => /\[R\]\s*$/.test(s.textContent?.trim() ?? '') && s.tagName === 'SPAN');
    return el?.textContent?.trim() ?? null;
  });
}
