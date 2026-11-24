import * as THREE from 'three';
import type {
  PedRole,
  PickupType,
  VehicleDamageStage,
  VehicleId,
  VehicleSpec,
  WeaponId,
} from '../types/entity.types';
import type { FactionId } from '../types/world.types';
import { VEHICLES } from '../data/vehicles.data';
import { GANGS } from '../data/gangs.data';

export type PedPose = 'idle' | 'w0' | 'w1' | 'w2' | 'w3' | 'jump' | 'dead';

export function computePedPose(
  vx: number,
  vy: number,
  walkPhase: number,
  alive: boolean,
  isJumping = false
): PedPose {
  if (!alive) return 'dead';
  if (isJumping) return 'jump';
  if (Math.hypot(vx, vy) > 0.45) {
    const idx = ((Math.floor(walkPhase * 3.2) % 4) + 4) % 4;
    return `w${idx}` as PedPose;
  }
  return 'idle';
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const SKIN_TONES = ['#f2cbb0', '#e0ac84', '#c6865c', '#8d5524'];
const HAIR_TONES = ['#18181b', '#451a03', '#78350f', '#a16207', '#71717a'];

export class SpriteAtlas {
  private vehicleCache = new Map<string, THREE.CanvasTexture>();
  private turretTex: THREE.CanvasTexture | null = null;
  private pedCache = new Map<string, THREE.CanvasTexture>();
  private pickupCache = new Map<string, THREE.CanvasTexture>();
  private shadowTex: THREE.CanvasTexture | null = null;
  private vehicleShadowTex: THREE.CanvasTexture | null = null;
  private headlightConeTex: THREE.CanvasTexture | null = null;

  public getVehicleSprite(
    id: VehicleId | string,
    primaryColor: string,
    damageStage: VehicleDamageStage
  ): THREE.CanvasTexture {
    return this.getVehicleTexture(id, primaryColor, damageStage, false, 0);
  }

  /**
   * Generates a crisp top-down GTA 2 vehicle sprite oriented facing +X (Right), with zero baked rotated shadow.
   */
  public getVehicleTexture(
    specId: VehicleId | string,
    color: string,
    damageStage: VehicleDamageStage,
    braking = false,
    sirenFlashPhase = 0
  ): THREE.CanvasTexture {
    const spec = (VEHICLES as Record<string, VehicleSpec | undefined>)[specId];
    const hasSiren = Boolean(spec?.hasSiren);
    const sirenBit = hasSiren ? sirenFlashPhase : 0;
    const key = `${specId}_${color}_${damageStage}_${braking ? 1 : 0}_${sirenBit}`;
    const existing = this.vehicleCache.get(key);
    if (existing) return existing;

    // Aspect-ratio-correct canvas dimensions per vehicle silhouette
    let w = 192;
    let h = 92;
    if (specId === 'compact_bug') {
      w = 168;
      h = 92;
    } else if (
      specId === 'nypd_swat' ||
      specId === 'fdny_medic' ||
      specId === 'armored_bank_van' ||
      specId === 'ice_cream_van'
    ) {
      w = 212;
      h = 96;
    } else if (specId === 'rhino_apc') {
      w = 224;
      h = 112;
    } else if (specId === 'dons_stretch' || specId === 'empire_freight' || specId === 'garbage_truck') {
      w = 256;
      h = 96;
    } else if (specId === 'fdny_ladder') {
      w = 268;
      h = 100;
    } else if (specId === 'mta_bus') {
      w = 296;
      h = 96;
    }

    const canvas = makeCanvas(w, h);
    const ctx = canvas.getContext('2d')!;
    const bodyColor = damageStage === 'wrecked' ? '#1f2937' : color;
    const accentColor = spec?.accentColor ?? '#38bdf8';

    // Tires & wheel wells (no rotated shadow baked into texture)
    const wheelW = specId === 'mta_bus' || specId === 'fdny_ladder' ? 28 : 24;
    ctx.fillStyle = '#09090b';
    if (specId !== 'rhino_apc') {
      ctx.fillRect(28, 4, wheelW, 10);
      ctx.fillRect(28, h - 14, wheelW, 10);
      ctx.fillRect(w - 52, 4, wheelW, 10);
      ctx.fillRect(w - 52, h - 14, wheelW, 10);
    }

    if (specId === 'rhino_apc') {
      // Heavy steel caterpillar treads
      ctx.fillStyle = '#1c1917';
      ctx.fillRect(10, 4, w - 20, 20);
      ctx.fillRect(10, h - 24, w - 20, 20);
      ctx.fillStyle = '#44403c';
      for (let x = 14; x < w - 16; x += 14) {
        ctx.fillRect(x, 6, 7, 16);
        ctx.fillRect(x, h - 22, 7, 16);
      }
      // Armored reactive hull
      ctx.fillStyle = bodyColor;
      this.roundRect(ctx, 16, 16, w - 32, h - 32, 7);
      ctx.fill();
      ctx.strokeStyle = '#1c1917';
      ctx.lineWidth = 3;
      ctx.stroke();
      // Sloped front glacis & rear engine louvers
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(w - 54, 22, 34, h - 44);
      ctx.fillStyle = '#292524';
      for (let vy = 26; vy < h - 26; vy += 9) {
        ctx.fillRect(24, vy, 34, 5);
      }
    } else if (specId === 'mta_bus') {
      // Long city transit bus
      ctx.fillStyle = bodyColor;
      this.roundRect(ctx, 8, 9, w - 16, h - 18, 9);
      ctx.fill();
      ctx.strokeStyle = '#09090b';
      ctx.lineWidth = 3;
      ctx.stroke();

      // Blue MTA stripes & tinted side window bands
      ctx.fillStyle = '#2563eb';
      ctx.fillRect(14, 12, w - 28, 7);
      ctx.fillRect(14, h - 19, w - 28, 7);
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(22, 19, w - 58, 5);
      ctx.fillRect(22, h - 24, w - 58, 5);

      // Panoramic front windshield + glare
      ctx.fillStyle = '#0f172a';
      this.roundRect(ctx, w - 30, 14, 16, h - 28, 4);
      ctx.fill();
      this.drawWindshieldGlare(ctx, w - 28, 18, 12, h - 36);

      // Dual roof HVAC pods + skylights
      ctx.fillStyle = '#94a3b8';
      this.roundRect(ctx, 56, 26, 48, h - 52, 4);
      ctx.fill();
      this.roundRect(ctx, 148, 26, 48, h - 52, 4);
      ctx.fill();
      ctx.fillStyle = '#475569';
      ctx.fillRect(66, 32, 28, h - 64);
      ctx.fillRect(158, 32, 28, h - 64);
    } else if (specId === 'fdny_ladder') {
      // Heavy fire engine with extendable turntable ladder
      ctx.fillStyle = bodyColor;
      this.roundRect(ctx, 8, 10, w - 16, h - 20, 7);
      ctx.fill();
      ctx.strokeStyle = '#09090b';
      ctx.lineWidth = 3;
      ctx.stroke();

      // White cab stripe & side equipment lockers
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(14, 13, w - 34, 5);
      ctx.fillRect(14, h - 18, w - 34, 5);

      // Crew cab windshield
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(w - 38, 16, 16, h - 32);
      this.drawWindshieldGlare(ctx, w - 36, 18, 12, h - 36);

      // Turntable + extendable silver ladder along spine
      ctx.fillStyle = '#334155';
      ctx.beginPath();
      ctx.arc(54, h * 0.5, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(24, h * 0.5 - 14, w - 68, 28);
      ctx.fillStyle = '#475569';
      ctx.fillRect(24, h * 0.5 - 14, w - 68, 4);
      ctx.fillRect(24, h * 0.5 + 10, w - 68, 4);
      for (let lx = 32; lx < w - 50; lx += 11) {
        ctx.fillRect(lx, h * 0.5 - 10, 3, 20);
      }
    } else if (specId === 'empire_freight' || specId === 'garbage_truck') {
      // Heavy commercial truck: rear box/compactor + separated front cab
      ctx.fillStyle = bodyColor;
      this.roundRect(ctx, 8, 10, w - 16, h - 20, 7);
      ctx.fill();
      ctx.strokeStyle = '#09090b';
      ctx.lineWidth = 3;
      ctx.stroke();

      if (specId === 'empire_freight') {
        // Corrugated box trailer + blue freight stripe + front cab
        ctx.fillStyle = '#e2e8f0';
        ctx.fillRect(12, 13, w - 74, h - 26);
        ctx.strokeStyle = '#64748b';
        ctx.lineWidth = 2;
        ctx.strokeRect(12, 13, w - 74, h - 26);
        ctx.fillStyle = accentColor;
        ctx.fillRect(18, h * 0.5 - 6, w - 86, 12);
        // Cab
        ctx.fillStyle = bodyColor;
        this.roundRect(ctx, w - 56, 14, 42, h - 28, 5);
        ctx.fill();
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(w - 30, 18, 12, h - 36);
        this.drawWindshieldGlare(ctx, w - 29, 20, 10, h - 40);
      } else {
        // Municipal Garbage Compactor Truck
        ctx.fillStyle = '#3f6212';
        ctx.fillRect(18, 14, w - 78, h - 28);
        // Compactor ribs
        ctx.fillStyle = '#1a2e05';
        for (let rx = 28; rx < w - 66; rx += 16) {
          ctx.fillRect(rx, 14, 4, h - 28);
        }
        // Rear hopper chute
        ctx.fillStyle = '#334155';
        ctx.fillRect(8, 16, 12, h - 32);
        // Cab-over front
        ctx.fillStyle = '#ecfccb';
        ctx.fillRect(w - 54, 14, 40, h - 28);
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(w - 28, 17, 11, h - 34);
        this.drawWindshieldGlare(ctx, w - 27, 19, 9, h - 38);
      }
    } else if (
      specId === 'nypd_swat' ||
      specId === 'armored_bank_van' ||
      specId === 'fdny_medic' ||
      specId === 'ice_cream_van'
    ) {
      // Box vans / Armored trucks / Ambulance
      ctx.fillStyle = bodyColor;
      this.roundRect(ctx, 8, 10, w - 16, h - 20, 8);
      ctx.fill();
      ctx.strokeStyle = '#09090b';
      ctx.lineWidth = 3;
      ctx.stroke();

      // Forward cab windshield
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(w - 46, 16, 18, h - 32);
      this.drawWindshieldGlare(ctx, w - 44, 18, 14, h - 36);

      if (specId === 'nypd_swat') {
        // Reinforced bullbar + armored plates + roof hatch
        ctx.fillStyle = '#475569';
        ctx.fillRect(w - 11, 20, 6, h - 40);
        ctx.fillStyle = '#3b82f6';
        ctx.fillRect(16, 13, w - 68, 5);
        ctx.fillRect(16, h - 18, w - 68, 5);
        ctx.fillStyle = '#0f172a';
        ctx.beginPath();
        ctx.arc(68, h * 0.5, 13, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#64748b';
        ctx.lineWidth = 2;
        ctx.stroke();
      } else if (specId === 'armored_bank_van') {
        // G4 Bullion Armored Bank Van: riveted steel panels + gold bullion stripe + armored hatch
        ctx.fillStyle = '#334155';
        ctx.fillRect(w - 11, 18, 6, h - 36);
        ctx.fillStyle = '#facc15';
        ctx.fillRect(14, 14, w - 64, 6);
        ctx.fillRect(14, h - 20, w - 64, 6);
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(24, 24, w - 84, h - 48);
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 2;
        ctx.strokeRect(24, 24, w - 84, h - 48);
        // Vault roof hatch
        ctx.fillStyle = '#475569';
        ctx.fillRect(62, h * 0.5 - 11, 22, 22);
      } else if (specId === 'fdny_medic') {
        // Box Ambulance with red stripes & crisp roof medical cross
        ctx.fillStyle = '#dc2626';
        ctx.fillRect(12, 13, w - 26, 6);
        ctx.fillRect(12, h - 19, w - 26, 6);
        // Roof box separation line
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 2;
        ctx.strokeRect(14, 18, w - 68, h - 36);
        // Red cross
        ctx.fillStyle = '#dc2626';
        ctx.fillRect(58, h * 0.5 - 6, 32, 12);
        ctx.fillRect(68, h * 0.5 - 16, 12, 32);
      } else if (specId === 'ice_cream_van') {
        // Mister Frosty novelty van: pastel wave stripes, side awning, giant roof cone!
        ctx.fillStyle = '#f472b6';
        ctx.fillRect(14, 13, w - 42, 6);
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(14, h - 19, w - 42, 6);
        // Serving side awning
        ctx.fillStyle = '#fb7185';
        ctx.fillRect(44, h - 13, 46, 6);
        // Giant swirled ice-cream cone on roof
        ctx.fillStyle = '#d97706';
        ctx.beginPath();
        ctx.moveTo(64, h * 0.5);
        ctx.lineTo(92, h * 0.5 - 11);
        ctx.lineTo(92, h * 0.5 + 11);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#fdf2f8';
        ctx.beginPath();
        ctx.arc(96, h * 0.5, 13, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ec4899';
        ctx.beginPath();
        ctx.arc(100, h * 0.5 - 3, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (specId === 'fbi_suv') {
      // Full-length Federal SUV with extended roof + roof rack rails + pushbar
      ctx.fillStyle = bodyColor;
      this.roundRect(ctx, 10, 11, w - 20, h - 22, 9);
      ctx.fill();
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      // Front pushbar
      ctx.fillStyle = '#475569';
      ctx.fillRect(w - 11, 22, 5, h - 44);

      // Extended SUV greenhouse & tinted glass
      ctx.fillStyle = '#020617';
      this.roundRect(ctx, 20, 16, w - 66, h - 32, 5);
      ctx.fill();
      this.drawWindshieldGlare(ctx, w - 62, 19, 14, h - 38);

      // Roof rack rails
      ctx.fillStyle = '#1e293b';
      this.roundRect(ctx, 26, 21, w - 82, h - 42, 4);
      ctx.fill();
      ctx.fillStyle = '#64748b';
      ctx.fillRect(30, 22, w - 90, 3);
      ctx.fillRect(30, h - 25, w - 90, 3);
    } else if (specId === 'utility_pickup') {
      // Open-bed Brotherhood pickup truck
      ctx.fillStyle = bodyColor;
      this.roundRect(ctx, 10, 11, w - 20, h - 22, 8);
      ctx.fill();
      ctx.strokeStyle = '#09090b';
      ctx.lineWidth = 3;
      ctx.stroke();

      // Recessed cargo bed in rear (-X)
      ctx.fillStyle = '#18181b';
      ctx.fillRect(16, 17, 68, h - 34);
      ctx.strokeStyle = '#3f3f46';
      ctx.lineWidth = 2;
      ctx.strokeRect(16, 17, 68, h - 34);
      // Bed ribs + toolbox
      ctx.fillStyle = '#27272a';
      for (let by = 24; by < h - 24; by += 10) {
        ctx.fillRect(20, by, 58, 3);
      }
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(70, 20, 12, h - 40);

      // Forward pickup cab
      ctx.fillStyle = '#0f172a';
      this.roundRect(ctx, 88, 17, 48, h - 34, 5);
      ctx.fill();
      ctx.fillStyle = bodyColor;
      this.roundRect(ctx, 94, 21, 28, h - 42, 4);
      ctx.fill();
      this.drawWindshieldGlare(ctx, 122, 20, 12, h - 40);
    } else if (specId === 'gangster_ztype') {
      // 1930s GTA 2 Z-Type: sweeping flared fenders, running boards, narrow tapered hood, boat-tail
      ctx.fillStyle = '#18181b'; // Running boards
      ctx.fillRect(40, 9, w - 84, h - 18);
      // Flared teardrop wheel fenders
      ctx.fillStyle = bodyColor;
      this.roundRect(ctx, 16, 7, 46, 18, 8);
      ctx.fill();
      this.roundRect(ctx, 16, h - 25, 46, 18, 8);
      ctx.fill();
      this.roundRect(ctx, w - 62, 7, 50, 18, 9);
      ctx.fill();
      this.roundRect(ctx, w - 62, h - 25, 50, 18, 9);
      ctx.fill();

      // Main sculpted vintage fuselage
      ctx.fillStyle = bodyColor;
      this.roundRect(ctx, 12, 16, w - 24, h - 32, 16);
      ctx.fill();
      ctx.strokeStyle = '#09090b';
      ctx.lineWidth = 3;
      ctx.stroke();

      // Chrome hood spine & grille
      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(w - 58, h * 0.5 - 2, 42, 4);
      ctx.fillRect(w - 14, h * 0.5 - 12, 4, 24);

      // Compact vintage greenhouse
      ctx.fillStyle = '#0f172a';
      this.roundRect(ctx, 32, 22, 68, h - 44, 8);
      ctx.fill();
      ctx.fillStyle = bodyColor;
      this.roundRect(ctx, 42, 26, 42, h - 52, 6);
      ctx.fill();
      this.drawWindshieldGlare(ctx, 84, 24, 12, h - 48);
    } else if (specId === 'roadster_gt') {
      // Open-top convertible sports roadster with visible cockpit seats & rollbar
      ctx.fillStyle = bodyColor;
      this.roundRect(ctx, 10, 11, w - 20, h - 22, 16);
      ctx.fill();
      ctx.strokeStyle = '#09090b';
      ctx.lineWidth = 3;
      ctx.stroke();

      // Twin racing accent stripes
      ctx.fillStyle = accentColor;
      ctx.fillRect(18, h * 0.5 - 7, w - 34, 4);
      ctx.fillRect(18, h * 0.5 + 3, w - 34, 4);

      // Open cockpit interior
      ctx.fillStyle = '#1e293b';
      this.roundRect(ctx, 44, 19, 68, h - 38, 7);
      ctx.fill();
      // Bucket seats
      ctx.fillStyle = '#78350f';
      this.roundRect(ctx, 56, 23, 24, 18, 4);
      ctx.fill();
      this.roundRect(ctx, 56, h - 41, 24, 18, 4);
      ctx.fill();
      // Steering wheel
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(95, h - 30, 6, 0, Math.PI * 2);
      ctx.stroke();
      // Chrome roll hoops behind seats
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(48, 31, 8, Math.PI * 0.5, Math.PI * 1.5);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(48, h - 31, 8, Math.PI * 0.5, Math.PI * 1.5);
      ctx.stroke();
      // Low raked windshield
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(106, 20, 8, h - 40);
    } else if (specId === 'compact_bug') {
      // Nimble retro microcar with rounded roof & rear engine louvers
      ctx.fillStyle = bodyColor;
      this.roundRect(ctx, 10, 11, w - 20, h - 22, 22);
      ctx.fill();
      ctx.strokeStyle = '#09090b';
      ctx.lineWidth = 3;
      ctx.stroke();

      // Rear engine vents
      ctx.fillStyle = '#18181b';
      for (let vy = 28; vy < h - 28; vy += 7) {
        ctx.fillRect(18, vy, 14, 3);
      }
      // Bubble cabin
      ctx.fillStyle = '#0f172a';
      this.roundRect(ctx, 38, 18, w - 80, h - 36, 12);
      ctx.fill();
      ctx.fillStyle = bodyColor;
      this.roundRect(ctx, 52, 23, w - 108, h - 46, 9);
      ctx.fill();
      this.drawWindshieldGlare(ctx, w - 58, 22, 12, h - 44);
    } else {
      // Standard Cars, Sports Coupes, Muscle, Police Cruisers, Stretch Limo, & Unknown Fallback
      const radius = specId === 'apex_gt' || specId === 'v8_stallion' ? 16 : 11;
      ctx.fillStyle = bodyColor;
      this.roundRect(ctx, 10, 11, w - 20, h - 22, radius);
      ctx.fill();
      ctx.strokeStyle = 'rgba(9, 9, 11, 0.85)';
      ctx.lineWidth = 3;
      ctx.stroke();

      if (specId === 'apex_gt' || specId === 'v8_stallion') {
        ctx.fillStyle = accentColor;
        ctx.fillRect(16, h * 0.5 - 8, w - 32, 5);
        ctx.fillRect(16, h * 0.5 + 3, w - 32, 5);
        // Hood vents
        ctx.fillStyle = '#09090b';
        ctx.fillRect(w - 50, 22, 14, 8);
        ctx.fillRect(w - 50, h - 30, 14, 8);
        // Rear spoiler wing
        ctx.fillRect(12, 14, 9, h - 28);
      } else if (specId === 'metro_cab') {
        ctx.fillStyle = '#111827';
        for (let cx = 24; cx < w - 24; cx += 12) {
          ctx.fillRect(cx, 13, 6, 4);
          ctx.fillRect(cx, h - 17, 6, 4);
        }
      } else if (specId === 'nypd_cruiser') {
        ctx.fillStyle = '#1d4ed8';
        ctx.fillRect(16, 13, w - 32, 8);
        ctx.fillRect(16, h - 21, w - 32, 8);
        // Front pushbar
        ctx.fillStyle = '#334155';
        ctx.fillRect(w - 11, 22, 5, h - 44);
      } else if (specId === 'brooklyn_muscle') {
        // Chrome supercharger blower scoop on hood
        ctx.fillStyle = '#cbd5e1';
        ctx.fillRect(w - 56, h * 0.5 - 10, 26, 20);
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(w - 36, h * 0.5 - 7, 7, 14);
      } else if (specId === 'dons_stretch') {
        // Gold luxury pinstripe
        ctx.fillStyle = '#f59e0b';
        ctx.fillRect(16, 13, w - 32, 3);
        ctx.fillRect(16, h - 16, w - 32, 3);
      } else if (specId === 'mobster_v8') {
        // Blacked-out grille & chrome hood ornament line
        ctx.fillStyle = '#cbd5e1';
        ctx.fillRect(w - 58, h * 0.5 - 1.5, 42, 3);
      }

      // Cabin greenhouse & windshield glare
      const cabStart = specId === 'dons_stretch' ? 32 : 38;
      const cabLen = specId === 'dons_stretch' ? w - 88 : w - 92;
      ctx.fillStyle = '#0f172a';
      this.roundRect(ctx, cabStart, 18, cabLen, h - 36, 7);
      ctx.fill();
      this.drawWindshieldGlare(ctx, cabStart + cabLen - 16, 21, 14, h - 42);

      // Roof panel
      ctx.fillStyle = specId === 'dons_stretch' ? '#18181b' : bodyColor;
      this.roundRect(ctx, cabStart + 14, 22, cabLen - 32, h - 44, 4);
      ctx.fill();

      // Taxi roof sign
      if (specId === 'metro_cab') {
        ctx.fillStyle = '#fef08a';
        ctx.fillRect(w * 0.5 - 9, h * 0.5 - 12, 16, 24);
        ctx.strokeStyle = '#111827';
        ctx.lineWidth = 2;
        ctx.strokeRect(w * 0.5 - 9, h * 0.5 - 12, 16, 24);
      }
    }

    // Side mirrors (on non-tank vehicles)
    if (specId !== 'rhino_apc') {
      ctx.fillStyle = '#18181b';
      const mirrorX = w - 62;
      ctx.fillRect(mirrorX, 6, 8, 6);
      ctx.fillRect(mirrorX, h - 12, 8, 6);
    }

    // Chrome/dark front & rear bumpers
    ctx.fillStyle = specId === 'gangster_ztype' || specId === 'dons_stretch' ? '#e2e8f0' : '#334155';
    ctx.fillRect(w - 11, 18, 4, h - 36);
    ctx.fillRect(7, 18, 4, h - 36);

    // Siren lightbars (flashing red/blue or red/white)
    if (hasSiren && damageStage !== 'wrecked') {
      const lx = specId === 'fdny_ladder' ? w - 30 : w * 0.52;
      const redHot = sirenFlashPhase === 1;
      const blueHot = sirenFlashPhase === 2;
      ctx.fillStyle = redHot ? '#ff2a2a' : '#7f1d1d';
      ctx.fillRect(lx, 20, 10, h * 0.5 - 22);
      ctx.fillStyle =
        spec?.sirenStyle === 'fdny' ? (blueHot ? '#ffffff' : '#94a3b8') : blueHot ? '#3b82f6' : '#1e3a8a';
      ctx.fillRect(lx, h * 0.5 + 2, 10, h * 0.5 - 22);
    }

    // Headlights (+X front)
    if (damageStage !== 'wrecked') {
      ctx.fillStyle = '#fef9c3';
      ctx.fillRect(w - 14, 15, 5, 13);
      ctx.fillRect(w - 14, h - 28, 5, 13);
    }

    // Taillights / brake lights (-X rear)
    ctx.fillStyle = braking ? '#ff1e1e' : '#7f1d1d';
    ctx.fillRect(9, 15, 5, 13);
    ctx.fillRect(9, h - 28, 5, 13);

    // Damage overlays
    if (damageStage === 'dented' || damageStage === 'burning') {
      ctx.strokeStyle = '#09090b';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(w - 34, 22);
      ctx.lineTo(w - 16, 40);
      ctx.lineTo(w - 36, 56);
      ctx.moveTo(48, 26);
      ctx.lineTo(74, 42);
      ctx.stroke();
      ctx.fillStyle = 'rgba(15, 23, 42, 0.45)';
      ctx.fillRect(w - 42, 22, 24, h - 44);
    }
    if (damageStage === 'wrecked') {
      ctx.fillStyle = 'rgba(9, 9, 11, 0.62)';
      ctx.fillRect(8, 8, w - 16, h - 16);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    this.vehicleCache.set(key, tex);
    return tex;
  }

  private drawWindshieldGlare(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    ctx.fillStyle = 'rgba(186, 230, 253, 0.28)';
    ctx.beginPath();
    ctx.moveTo(x + 2, y);
    ctx.lineTo(x + w, y + h * 0.35);
    ctx.lineTo(x + w - 4, y + h * 0.65);
    ctx.lineTo(x, y + h * 0.25);
    ctx.closePath();
    ctx.fill();
  }

  public getTankTurretTexture(): THREE.CanvasTexture {
    if (this.turretTex) return this.turretTex;
    const w = 224;
    const h = 112;
    const canvas = makeCanvas(w, h);
    const ctx = canvas.getContext('2d')!;
    const cx = w * 0.5;
    const cy = h * 0.5;

    // Long tank barrel facing +X
    ctx.fillStyle = '#1c1917';
    ctx.fillRect(cx, cy - 7, w * 0.46, 14);
    ctx.fillStyle = '#3f4f30';
    ctx.fillRect(cx + 2, cy - 5, w * 0.42, 10);
    // Muzzle brake
    ctx.fillStyle = '#292524';
    ctx.fillRect(w - 18, cy - 9, 12, 18);

    // Armored turret cupola
    ctx.fillStyle = '#556b3f';
    ctx.beginPath();
    ctx.arc(cx - 8, cy, 27, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1c1917';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Commander hatch
    ctx.fillStyle = '#364329';
    ctx.beginPath();
    ctx.arc(cx - 14, cy - 6, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1c1917';
    ctx.lineWidth = 2;
    ctx.stroke();

    this.turretTex = new THREE.CanvasTexture(canvas);
    this.turretTex.colorSpace = THREE.SRGBColorSpace;
    return this.turretTex;
  }

  /**
   * 96x96 Articulated Top-Down Character Sprite (idle / 4-frame walk stride / jump / dead) with zero baked shadow.
   */
  public getPedTexture(
    role: PedRole | 'player',
    shirtColor: string,
    faction?: FactionId,
    alive = true,
    weaponId: WeaponId = 'fists',
    pose: PedPose = alive ? 'idle' : 'dead'
  ): THREE.CanvasTexture {
    const resolvedPose: PedPose = alive ? pose : 'dead';
    const key = `${role}_${shirtColor}_${faction ?? 'none'}_${weaponId}_${resolvedPose}`;
    const existing = this.pedCache.get(key);
    if (existing) return existing;

    const canvas = makeCanvas(96, 96);
    const ctx = canvas.getContext('2d')!;

    const seed = hashString(`${role}_${shirtColor}_${faction ?? ''}`);
    const skin = role === 'player' ? '#eab996' : SKIN_TONES[seed % SKIN_TONES.length];
    const hair = HAIR_TONES[(seed >> 3) % HAIR_TONES.length];

    let coat = shirtColor;
    let pants = '#1e293b';
    if (role === 'player') {
      coat = '#f97316';
      pants = '#1e293b';
    } else if (role === 'cop') {
      coat = '#1d4ed8';
      pants = '#0f172a';
    } else if (role === 'swat') {
      coat = '#1e293b';
      pants = '#09090b';
    } else if (role === 'fbi') {
      coat = '#18181b';
      pants = '#09090b';
    } else if (role === 'army') {
      coat = '#4d5d3b';
      pants = '#364329';
    } else if (faction && (role === 'gang' || role === 'boss')) {
      coat = GANGS[faction].color;
      pants = faction === 'syndicate' ? '#18181b' : '#1e293b';
    }

    if (resolvedPose === 'dead') {
      // Organic multi-lobe blood pool
      ctx.fillStyle = 'rgba(127, 29, 29, 0.78)';
      ctx.beginPath();
      ctx.ellipse(48, 48, 28, 20, 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(36, 40, 14, 12, -0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(153, 27, 27, 0.85)';
      ctx.beginPath();
      ctx.ellipse(50, 50, 18, 13, 0.2, 0, Math.PI * 2);
      ctx.fill();

      // Splayed legs & dark shoes
      ctx.fillStyle = pants;
      ctx.save();
      ctx.translate(32, 48);
      ctx.rotate(-0.28);
      this.roundRect(ctx, -18, -11, 20, 9, 4);
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.translate(32, 48);
      ctx.rotate(0.35);
      this.roundRect(ctx, -18, 3, 20, 9, 4);
      ctx.fill();
      ctx.restore();

      // Sprawled arms
      ctx.fillStyle = coat;
      ctx.save();
      ctx.translate(50, 34);
      ctx.rotate(-0.6);
      this.roundRect(ctx, 0, -4, 16, 8, 4);
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.translate(50, 62);
      ctx.rotate(0.75);
      this.roundRect(ctx, 0, -4, 16, 8, 4);
      ctx.fill();
      ctx.restore();

      // Twisted torso
      ctx.fillStyle = coat;
      this.roundRect(ctx, 32, 34, 24, 28, 8);
      ctx.fill();
      ctx.strokeStyle = '#09090b';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Head + natural skin + role headgear
      this.drawPedHead(ctx, 62, 48, role, faction, skin, hair);
    } else {
      const stride =
        resolvedPose === 'w0' ? 1 : resolvedPose === 'w2' ? -1 : 0;

      // Boss golden aura ring
      if (role === 'boss') {
        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(46, 48, 34, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Jump dynamic tuck outline cue
      if (resolvedPose === 'jump') {
        ctx.strokeStyle = 'rgba(250, 204, 21, 0.38)';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(45, 48, 28, 0, Math.PI * 2);
        ctx.stroke();
      }

      // 1. Legs & Shoes
      if (resolvedPose === 'jump') {
        // Both knees/boots tucked back and outward for clear jump silhouette
        this.drawLeg(ctx, 33, 35, -0.35, 16, pants);
        this.drawLeg(ctx, 33, 61, 0.35, 16, pants);
      } else {
        const leftShift = stride * 12;
        const rightShift = -stride * 12;
        this.drawLeg(ctx, 44 + leftShift, 38, 0, 14, pants);
        this.drawLeg(ctx, 44 + rightShift, 58, 0, 14, pants);
      }

      // 2. Arms & Weapon Stance (drawn around shoulders)
      const effectiveWeapon: WeaponId = role === 'civilian' ? 'fists' : weaponId;
      this.drawArmsAndWeapon(ctx, coat, skin, effectiveWeapon, stride, resolvedPose === 'jump', role, faction);

      // 3. Tapered Shoulders & Shaded Torso
      ctx.fillStyle = coat;
      this.roundRect(ctx, 36, 27, 21, 42, 9);
      ctx.fill();
      ctx.strokeStyle = '#09090b';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      // Collar / lapels / tactical vest details
      if (role === 'player') {
        // Dark bomber collar & open charcoal V-tee
        ctx.fillStyle = '#18181b';
        ctx.beginPath();
        ctx.moveTo(48, 37);
        ctx.lineTo(57, 48);
        ctx.lineTo(48, 59);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#fb923c';
        ctx.fillRect(39, 31, 4, 34);
      } else if (role === 'cop') {
        // Epaulettes + silver badge
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(42, 28, 9, 5);
        ctx.fillRect(42, 63, 9, 5);
        ctx.fillStyle = '#e2e8f0';
        ctx.fillRect(51, 35, 4, 5);
      } else if (role === 'swat') {
        // Ballistic armor chest plate
        ctx.fillStyle = '#334155';
        this.roundRect(ctx, 40, 33, 14, 30, 3);
        ctx.fill();
      } else if (role === 'fbi' || faction === 'syndicate') {
        // Crisp white shirt collar & tie
        ctx.fillStyle = '#f8fafc';
        ctx.beginPath();
        ctx.moveTo(49, 40);
        ctx.lineTo(57, 48);
        ctx.lineTo(49, 56);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = faction === 'syndicate' ? '#dc2626' : '#09090b';
        ctx.fillRect(50, 46, 7, 4);
      } else if (faction === 'yakuza') {
        // Neon cyber-trench collar trim
        ctx.fillStyle = '#22d3ee';
        ctx.fillRect(51, 32, 3, 32);
      } else if (role === 'army') {
        ctx.fillStyle = '#364329';
        ctx.fillRect(39, 34, 15, 6);
        ctx.fillRect(39, 56, 15, 6);
      }

      // 4. Neck shadow + Proportional Head + Face Cue + Hair/Hat
      ctx.fillStyle = 'rgba(9, 9, 11, 0.35)';
      ctx.beginPath();
      ctx.arc(47, 48, 10.5, 0, Math.PI * 2);
      ctx.fill();

      this.drawPedHead(ctx, 49, 48, role, faction, skin, hair);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.pedCache.set(key, tex);
    return tex;
  }

  private drawLeg(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    angle: number,
    len: number,
    pantsColor: string
  ): void {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.fillStyle = pantsColor;
    this.roundRect(ctx, -len * 0.5, -4.5, len, 9, 3);
    ctx.fill();
    // Shoe tip
    ctx.fillStyle = '#09090b';
    this.roundRect(ctx, len * 0.5 - 5, -4, 7, 8, 2);
    ctx.fill();
    ctx.restore();
  }

  private drawArmsAndWeapon(
    ctx: CanvasRenderingContext2D,
    coat: string,
    skin: string,
    weaponId: WeaponId,
    stride: number,
    isJumping: boolean,
    role: PedRole | 'player',
    faction?: FactionId
  ): void {
    const armOut = isJumping ? 4 : 0;

    if (weaponId === 'fists') {
      const swing = stride * 7;
      // Left arm
      ctx.fillStyle = coat;
      this.roundRect(ctx, 42 - swing, 21 - armOut, 15, 8, 4);
      ctx.fill();
      ctx.fillStyle = skin;
      ctx.beginPath();
      ctx.arc(57 - swing, 25 - armOut, 3.8, 0, Math.PI * 2);
      ctx.fill();
      // Right arm
      ctx.fillStyle = coat;
      this.roundRect(ctx, 42 + swing, 67 + armOut, 15, 8, 4);
      ctx.fill();
      ctx.fillStyle = skin;
      ctx.beginPath();
      ctx.arc(57 + swing, 71 + armOut, 3.8, 0, Math.PI * 2);
      ctx.fill();
      if (role === 'player' || role === 'gang') {
        ctx.fillStyle = '#facc15';
        ctx.fillRect(58 + swing, 69 + armOut, 2.5, 4);
      }
      return;
    }

    if (weaponId === 'dual_uzis') {
      // Twin arms extended forward with black SMGs
      for (const side of [-1, 1]) {
        const ay = 48 + side * 19;
        ctx.fillStyle = coat;
        this.roundRect(ctx, 46, ay - 4, 18, 8, 3);
        ctx.fill();
        ctx.fillStyle = skin;
        ctx.beginPath();
        ctx.arc(65, ay, 3.5, 0, Math.PI * 2);
        ctx.fill();
        // Micro-Uzi
        ctx.fillStyle = '#18181b';
        ctx.fillRect(62, ay - 3, 18, 6);
        ctx.fillStyle = '#64748b';
        ctx.fillRect(78, ay - 1.5, 6, 3);
      }
      return;
    }

    if (weaponId === 'pistol') {
      // Left arm tucked
      ctx.fillStyle = coat;
      this.roundRect(ctx, 44, 24 - armOut, 14, 7, 3);
      ctx.fill();
      // Right arm extended forward aiming
      ctx.fillStyle = coat;
      this.roundRect(ctx, 48, 55, 19, 8, 3);
      ctx.fill();
      ctx.fillStyle = skin;
      ctx.beginPath();
      ctx.arc(68, 58, 3.5, 0, Math.PI * 2);
      ctx.fill();
      // 9mm pistol
      ctx.fillStyle = '#cbd5e1';
      ctx.fillRect(66, 55, 16, 5);
      ctx.fillStyle = '#18181b';
      ctx.fillRect(66, 58, 6, 3);
      return;
    }

    if (weaponId === 'shotgun' || weaponId === 'm4') {
      // Two-handed long gun stance
      ctx.fillStyle = coat;
      this.roundRect(ctx, 46, 31, 19, 7, 3);
      ctx.fill();
      this.roundRect(ctx, 46, 56, 17, 7, 3);
      ctx.fill();
      ctx.fillStyle = skin;
      ctx.beginPath();
      ctx.arc(66, 36, 3.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(63, 56, 3.3, 0, Math.PI * 2);
      ctx.fill();

      if (weaponId === 'shotgun') {
        // Wood stock + steel pump barrel
        ctx.fillStyle = '#78350f';
        ctx.fillRect(50, 45, 14, 6);
        ctx.fillStyle = '#334155';
        ctx.fillRect(62, 46, 26, 4.5);
        ctx.fillStyle = '#92400e';
        ctx.fillRect(70, 45.5, 9, 5.5);
      } else {
        // Tactical M4 carbine + magazine + optic
        ctx.fillStyle = '#09090b';
        ctx.fillRect(50, 45, 24, 6);
        ctx.fillStyle = '#475569';
        ctx.fillRect(74, 46.5, 16, 3);
        ctx.fillStyle = '#334155';
        ctx.fillRect(63, 50, 7, 5);
      }
      return;
    }

    if (weaponId === 'flamethrower') {
      // Twin red/orange fuel tanks strapped on back
      ctx.fillStyle = '#dc2626';
      this.roundRect(ctx, 25, 33, 12, 13, 4);
      ctx.fill();
      ctx.fillStyle = '#ea580c';
      this.roundRect(ctx, 25, 50, 12, 13, 4);
      ctx.fill();
      ctx.strokeStyle = '#18181b';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(25, 33, 12, 13);
      ctx.strokeRect(25, 50, 12, 13);

      // Arms holding wand
      ctx.fillStyle = coat;
      this.roundRect(ctx, 46, 32, 18, 7, 3);
      ctx.fill();
      this.roundRect(ctx, 46, 56, 18, 7, 3);
      ctx.fill();
      // Feed hose + brass wand + pilot flame
      ctx.strokeStyle = '#18181b';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(31, 63);
      ctx.quadraticCurveTo(44, 70, 62, 54);
      ctx.stroke();
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(58, 46, 26, 5);
      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(82, 45, 6, 7);
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.arc(89, 48.5, 3, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    if (weaponId === 'rpg') {
      // Olive shoulder launcher tube + flared rear + conical warhead
      ctx.fillStyle = coat;
      this.roundRect(ctx, 45, 56, 17, 7, 3);
      ctx.fill();
      this.roundRect(ctx, 45, 30, 14, 7, 3);
      ctx.fill();
      // Launcher tube over right shoulder
      ctx.fillStyle = '#4d5d3b';
      ctx.fillRect(22, 54, 56, 10);
      ctx.fillStyle = '#1c1917';
      ctx.fillRect(18, 53, 6, 12);
      // Olive warhead cone protruding front
      ctx.fillStyle = '#65a30d';
      ctx.beginPath();
      ctx.moveTo(78, 53);
      ctx.lineTo(90, 59);
      ctx.lineTo(78, 65);
      ctx.closePath();
      ctx.fill();
      return;
    }

    // Molotov / Grenade
    ctx.fillStyle = coat;
    this.roundRect(ctx, 44, 24 - armOut, 13, 7, 3);
    ctx.fill();
    this.roundRect(ctx, 46, 57, 17, 8, 3);
    ctx.fill();
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(64, 61, 3.5, 0, Math.PI * 2);
    ctx.fill();

    if (weaponId === 'molotov') {
      ctx.fillStyle = '#d97706';
      this.roundRect(ctx, 64, 57, 11, 7, 3);
      ctx.fill();
      ctx.fillStyle = '#f97316';
      ctx.beginPath();
      ctx.arc(77, 60, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fef08a';
      ctx.beginPath();
      ctx.arc(77, 60, 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Frag grenade
      ctx.fillStyle = '#4d7c0f';
      ctx.beginPath();
      ctx.arc(69, 61, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#cbd5e1';
      ctx.fillRect(71, 57, 3, 3);
    }
    void faction;
  }

  private drawPedHead(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    role: PedRole | 'player',
    faction: FactionId | undefined,
    skin: string,
    hair: string
  ): void {
    // Head base in natural skin tone
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(cx, cy, 8.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#09090b';
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // Subtle nose / directional face cue toward +X
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(cx + 8.2, cy, 2.2, 0, Math.PI * 2);
    ctx.fill();

    if (role === 'player') {
      // Swept dark hair + sleek dark shades
      ctx.fillStyle = '#18181b';
      ctx.beginPath();
      ctx.arc(cx - 2, cy, 7.6, Math.PI * 0.35, Math.PI * 1.65);
      ctx.fill();
      ctx.fillStyle = '#09090b';
      ctx.fillRect(cx + 4.5, cy - 6.5, 3, 5.5);
      ctx.fillRect(cx + 4.5, cy + 1, 3, 5.5);
    } else if (role === 'cop') {
      // NYPD peaked cap with black bill
      ctx.fillStyle = '#1e3a8a';
      ctx.beginPath();
      ctx.arc(cx - 0.5, cy, 8.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#09090b';
      ctx.fillRect(cx + 5, cy - 6, 5.5, 12);
      ctx.fillStyle = '#facc15';
      ctx.fillRect(cx + 3, cy - 1.5, 2.5, 3);
    } else if (role === 'swat') {
      // Matte tactical helmet + cyan goggles
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.arc(cx, cy, 9.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#22d3ee';
      ctx.fillRect(cx + 5.5, cy - 5.5, 3, 11);
    } else if (role === 'army') {
      // Olive combat helmet
      ctx.fillStyle = '#3f4f30';
      ctx.beginPath();
      ctx.arc(cx, cy, 9.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#1c1917';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else if (role === 'fbi') {
      // Slicked hair + sunglasses
      ctx.fillStyle = '#09090b';
      ctx.beginPath();
      ctx.arc(cx - 2, cy, 7.8, Math.PI * 0.35, Math.PI * 1.65);
      ctx.fill();
      ctx.fillRect(cx + 4.5, cy - 6, 3, 5);
      ctx.fillRect(cx + 4.5, cy + 1, 3, 5);
    } else if (faction === 'syndicate') {
      // Classic gangster fedora hat + crimson band
      ctx.fillStyle = '#18181b';
      ctx.beginPath();
      ctx.ellipse(cx, cy, 10.8, 10.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#dc2626';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 6.2, 0, Math.PI * 2);
      ctx.stroke();
    } else if (faction === 'yakuza') {
      // Dark hair + glowing cyan visor
      ctx.fillStyle = '#18181b';
      ctx.beginPath();
      ctx.arc(cx - 2, cy, 7.6, Math.PI * 0.35, Math.PI * 1.65);
      ctx.fill();
      ctx.fillStyle = '#22d3ee';
      ctx.fillRect(cx + 4.5, cy - 6.5, 3.2, 13);
    } else if (faction === 'brotherhood') {
      // Knit dockworker beanie
      ctx.fillStyle = '#b45309';
      ctx.beginPath();
      ctx.arc(cx - 1.5, cy, 8.2, Math.PI * 0.25, Math.PI * 1.75);
      ctx.fill();
    } else {
      // Civilian / target / ally varied hair
      ctx.fillStyle = hair;
      ctx.beginPath();
      ctx.arc(cx - 2.2, cy, 7.8, Math.PI * 0.3, Math.PI * 1.7);
      ctx.fill();
    }
  }

  public getPickupTexture(type: PickupType, weaponId?: WeaponId): THREE.CanvasTexture {
    const key = `${type}_${weaponId ?? ''}`;
    const existing = this.pickupCache.get(key);
    if (existing) return existing;

    const canvas = makeCanvas(64, 64);
    const ctx = canvas.getContext('2d')!;

    const bg =
      type === 'health'
        ? '#ef4444'
        : type === 'armor'
        ? '#3b82f6'
        : type === 'bribe'
        ? '#facc15'
        : type === 'cash'
        ? '#22c55e'
        : type === 'kill_frenzy'
        ? '#dc2626'
        : '#a855f7';

    ctx.fillStyle = 'rgba(9, 9, 11, 0.8)';
    ctx.beginPath();
    ctx.arc(32, 32, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = bg;
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (type === 'health') {
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(26, 16, 12, 32);
      ctx.fillRect(16, 26, 32, 12);
    } else if (type === 'armor') {
      ctx.fillStyle = '#60a5fa';
      ctx.font = 'bold 22px monospace';
      ctx.fillText('ARM', 32, 33);
    } else if (type === 'bribe') {
      ctx.fillStyle = '#fde047';
      ctx.font = 'bold 28px monospace';
      ctx.fillText('★', 32, 34);
    } else if (type === 'cash') {
      ctx.fillStyle = '#4ade80';
      ctx.font = 'bold 30px monospace';
      ctx.fillText('$', 32, 34);
    } else if (type === 'kill_frenzy') {
      ctx.fillStyle = '#fef08a';
      ctx.font = 'bold 28px monospace';
      ctx.fillText('☠', 32, 34);
    } else {
      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 14px monospace';
      const label = (weaponId ?? 'GUN').slice(0, 4).toUpperCase();
      ctx.fillText(label, 32, 33);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.pickupCache.set(key, tex);
    return tex;
  }

  public getShadowTexture(): THREE.CanvasTexture {
    if (this.shadowTex) return this.shadowTex;
    const canvas = makeCanvas(64, 64);
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(32, 32, 5, 32, 32, 30);
    grad.addColorStop(0, 'rgba(9, 9, 11, 0.56)');
    grad.addColorStop(0.6, 'rgba(9, 9, 11, 0.28)');
    grad.addColorStop(1, 'rgba(9, 9, 11, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    this.shadowTex = new THREE.CanvasTexture(canvas);
    return this.shadowTex;
  }

  public getVehicleShadowTexture(): THREE.CanvasTexture {
    if (this.vehicleShadowTex) return this.vehicleShadowTex;
    const canvas = makeCanvas(64, 64);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'rgba(9, 9, 11, 0.44)';
    this.roundRect(ctx, 5, 8, 54, 48, 12);
    ctx.fill();
    ctx.fillStyle = 'rgba(9, 9, 11, 0.22)';
    this.roundRect(ctx, 2, 5, 60, 54, 15);
    ctx.fill();
    this.vehicleShadowTex = new THREE.CanvasTexture(canvas);
    return this.vehicleShadowTex;
  }

  public getHeadlightConeTexture(): THREE.CanvasTexture {
    if (this.headlightConeTex) return this.headlightConeTex;
    const w = 128;
    const h = 96;
    const canvas = makeCanvas(w, h);
    const ctx = canvas.getContext('2d')!;

    // Dual diverging headlight cones facing +X
    for (const startY of [26, 70]) {
      const grad = ctx.createLinearGradient(0, startY, w, startY);
      grad.addColorStop(0, 'rgba(254, 249, 195, 0.65)');
      grad.addColorStop(0.45, 'rgba(254, 240, 138, 0.28)');
      grad.addColorStop(1, 'rgba(254, 240, 138, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(0, startY - 4);
      ctx.lineTo(w, startY - 24);
      ctx.lineTo(w, startY + 24);
      ctx.lineTo(0, startY + 4);
      ctx.closePath();
      ctx.fill();
    }

    this.headlightConeTex = new THREE.CanvasTexture(canvas);
    this.headlightConeTex.colorSpace = THREE.SRGBColorSpace;
    return this.headlightConeTex;
  }

  private roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
  ): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
}
