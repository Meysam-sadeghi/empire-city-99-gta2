import type {
  PedEntity,
  PlayerEntity,
  VehicleEntity,
  WeaponId,
} from '../types/entity.types';
import type { FactionId, Vec2 } from '../types/world.types';
import { WEAPONS } from '../data/weapons.data';
import { VEHICLES } from '../data/vehicles.data';
import { PhysicsWorld } from './PhysicsWorld';
import { ObjectPool } from './ObjectPool';
import { VehiclePhysics } from './VehiclePhysics';
import { normalizeAngle } from './TrafficSystem';

export interface CombatCallbacks {
  onWeaponSound: (weaponId: WeaponId, volumeScale: number) => void;
  onExplosionSound: (volumeScale: number) => void;
  onPedSplat: (x: number, y: number) => void;
  onScreenShake: (amount: number) => void;
  onPedKilled: (ped: PedEntity, killerId: string, isRunOver?: boolean) => void;
  onVehicleDestroyed: (veh: VehicleEntity, killerId: string) => void;
  onPlayerDamaged: (amount: number, source: string) => void;
  onCrimeCommitted: (heat: number, minStars?: number) => void;
  onPanicTriggered: (x: number, y: number) => void;
  onPropExplosionHit: (x: number, y: number, radius: number) => void;
}

interface OBB2D {
  id?: string;
  x: number;
  y: number;
  heading: number;
  halfLength: number;
  halfWidth: number;
}

function distPointToOBB(px: number, py: number, obb: OBB2D): number {
  const dx = px - obb.x;
  const dy = py - obb.y;
  const cosH = Math.cos(obb.heading);
  const sinH = Math.sin(obb.heading);
  const lx = dx * cosH + dy * sinH;
  const ly = -dx * sinH + dy * cosH;
  const cx = Math.max(-obb.halfLength, Math.min(obb.halfLength, lx));
  const cy = Math.max(-obb.halfWidth, Math.min(obb.halfWidth, ly));
  return Math.hypot(lx - cx, ly - cy);
}

function getOBBCorners(obb: OBB2D): Vec2[] {
  const cosH = Math.cos(obb.heading);
  const sinH = Math.sin(obb.heading);
  const fx = cosH * obb.halfLength;
  const fy = sinH * obb.halfLength;
  const rx = -sinH * obb.halfWidth;
  const ry = cosH * obb.halfWidth;
  return [
    { x: obb.x + fx + rx, y: obb.y + fy + ry },
    { x: obb.x + fx - rx, y: obb.y + fy - ry },
    { x: obb.x - fx + rx, y: obb.y - fy + ry },
    { x: obb.x - fx - rx, y: obb.y - fy - ry },
  ];
}

function obbsOverlapSAT(a: OBB2D, b: OBB2D): boolean {
  const cosA = Math.cos(a.heading);
  const sinA = Math.sin(a.heading);
  const cosB = Math.cos(b.heading);
  const sinB = Math.sin(b.heading);
  const dx = b.x - a.x;
  const dy = b.y - a.y;

  const axes: Array<[number, number]> = [
    [cosA, sinA],
    [-sinA, cosA],
    [cosB, sinB],
    [-sinB, cosB],
  ];

  for (const [ax, ay] of axes) {
    const distProj = Math.abs(dx * ax + dy * ay);
    const extA =
      a.halfLength * Math.abs(cosA * ax + sinA * ay) +
      a.halfWidth * Math.abs(-sinA * ax + cosA * ay);
    const extB =
      b.halfLength * Math.abs(cosB * ax + sinB * ay) +
      b.halfWidth * Math.abs(-sinB * ax + cosB * ay);
    if (distProj > extA + extB) {
      return false;
    }
  }
  return true;
}

function distanceBetweenOBBs(a: OBB2D, b: OBB2D): number {
  if (obbsOverlapSAT(a, b)) return 0;
  let minD = Infinity;
  for (const pt of getOBBCorners(a)) {
    const d = distPointToOBB(pt.x, pt.y, b);
    if (d < minD) minD = d;
  }
  for (const pt of getOBBCorners(b)) {
    const d = distPointToOBB(pt.x, pt.y, a);
    if (d < minD) minD = d;
  }
  return minD;
}

export class CombatSystem {
  private physics: PhysicsWorld;
  private pool: ObjectPool;
  private pendingExplosions: Array<{ vehicleId: string; delay: number; attackerId: string }> = [];
  public muzzleFlashes: { x: number; y: number; z: number }[] = [];
  public explosionFlashes: { x: number; y: number; z: number; radius: number }[] = [];

  constructor(physics: PhysicsWorld, pool: ObjectPool) {
    this.physics = physics;
    this.pool = pool;
  }

  public hasPendingExplosion(vehicleId: string): boolean {
    return this.pendingExplosions.some((entry) => entry.vehicleId === vehicleId);
  }

  public clearPendingExplosions(): void {
    this.pendingExplosions.length = 0;
  }

  public clearFrameFlashes(): void {
    this.muzzleFlashes.length = 0;
    this.explosionFlashes.length = 0;
  }

  /**
   * Finds the best GTA 2 directional auto-aim target within a ±42° cone in front of player.
   */
  public findAutoAimTarget(
    player: PlayerEntity,
    peds: PedEntity[],
    vehicles: VehicleEntity[]
  ): { id: string; pos: Vec2; angle: number } | null {
    const spec = WEAPONS[player.activeWeapon];
    const maxRange = Math.max(12, spec.range);
    let bestScore = Infinity;
    let best: { id: string; pos: Vec2; angle: number } | null = null;

    for (const p of peds) {
      if (!p.alive || p.vehicleId) continue;
      const dx = p.x - player.x;
      const dy = p.y - player.y;
      const dist = Math.hypot(dx, dy);
      if (dist > maxRange || dist < 0.8) continue;
      const angle = Math.atan2(dy, dx);
      const diff = Math.abs(normalizeAngle(angle - player.heading));
      if (diff > 0.78) continue; // ~45 deg auto-aim cone
      // Prioritize hostiles / mission targets / cops slightly over civilians
      const priorityMult = p.role === 'civilian' ? 1.55 : 0.75;
      const score = (dist + diff * 18) * priorityMult;
      if (score < bestScore && this.physics.hasLineOfSight(player.x, player.y, p.x, p.y, player.layer)) {
        bestScore = score;
        best = { id: p.id, pos: { x: p.x, y: p.y }, angle };
      }
    }

    if (!best && (player.activeWeapon === 'rpg' || player.activeWeapon === 'grenade' || player.activeWeapon === 'm4')) {
      for (const v of vehicles) {
        if (!v.alive || v.damageStage === 'wrecked' || v.id === player.vehicleId) continue;
        const dx = v.x - player.x;
        const dy = v.y - player.y;
        const dist = Math.hypot(dx, dy);
        if (dist > maxRange || dist < 3) continue;
        const angle = Math.atan2(dy, dx);
        const diff = Math.abs(normalizeAngle(angle - player.heading));
        if (diff > 0.72) continue;
        const score = dist + diff * 20;
        if (score < bestScore) {
          bestScore = score;
          best = { id: v.id, pos: { x: v.x, y: v.y }, angle };
        }
      }
    }

    return best;
  }

  public fireWeapon(params: {
    ownerId: string;
    ownerFaction?: FactionId;
    weaponId: WeaponId;
    x: number;
    y: number;
    z: number;
    heading: number;
    layer: 0 | 1;
    player: PlayerEntity;
    peds: PedEntity[];
    vehicles: VehicleEntity[];
    cb: CombatCallbacks;
  }): void {
    const spec = WEAPONS[params.weaponId];
    const isPlayer = params.ownerId === 'player';
    const distToPlayer = Math.hypot(params.x - params.player.x, params.y - params.player.y);
    const vol = Math.max(0.12, 1 - distToPlayer / 110);
    params.cb.onWeaponSound(params.weaponId, vol);

    if (spec.category !== 'melee') {
      params.cb.onPanicTriggered(params.x, params.y);
      if (isPlayer) {
        params.cb.onCrimeCommitted(spec.category === 'rocket' ? 28 : 6, 1);
      }
    }

    // Melee strike (Brass Knuckles / Fists)
    if (spec.category === 'melee') {
      const hitX = params.x + Math.cos(params.heading) * 1.9;
      const hitY = params.y + Math.sin(params.heading) * 1.9;
      for (const p of params.peds) {
        if (!p.alive || p.id === params.ownerId || p.vehicleId) continue;
        if (Math.hypot(p.x - hitX, p.y - hitY) <= spec.range * 0.75) {
          this.damagePed(p, spec.damage, params.ownerId, params.heading, spec.knockback, params.cb);
        }
      }
      for (const v of params.vehicles) {
        if (!v.alive || v.damageStage === 'wrecked') continue;
        if (Math.hypot(v.x - hitX, v.y - hitY) <= 3.1) {
          this.damageVehicle(v, 10, params.ownerId, params.cb, params.player, params.peds, params.vehicles);
        }
      }
      return;
    }

    // Muzzle flash light
    if (spec.category === 'hitscan' || spec.category === 'spread' || spec.category === 'rocket') {
      this.muzzleFlashes.push({
        x: params.x + Math.cos(params.heading) * 1.6,
        y: params.y + Math.sin(params.heading) * 1.6,
        z: params.z,
      });
    }

    // Spawn projectiles (pellets, bullets, flames, thrown molotov/grenade, RPG rocket)
    const muzzleX = params.x + Math.cos(params.heading) * 1.4;
    const muzzleY = params.y + Math.sin(params.heading) * 1.4;

    for (let i = 0; i < spec.pellets; i++) {
      const spread = (Math.random() - 0.5) * spec.spreadRad;
      const angle = params.heading + spread;
      const speed = spec.projectileSpeed;
      const life =
        params.weaponId === 'grenade'
          ? 2.5
          : params.weaponId === 'molotov'
          ? 0.95
          : spec.range / Math.max(1, speed);

      this.pool.spawnProjectile({
        ownerId: params.ownerId,
        ownerFaction: params.ownerFaction,
        weaponId: params.weaponId,
        x: muzzleX,
        y: muzzleY,
        z: params.z + 0.3,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        vz: spec.category === 'thrown' ? 6.5 : 0,
        damage: spec.damage,
        blastRadius: spec.blastRadius,
        life,
        color: spec.color,
      });
    }
  }

  public fireVehicleSpecialWeapon(
    v: VehicleEntity,
    aimHeading: number,
    player: PlayerEntity,
    cb: CombatCallbacks
  ): void {
    const spec = VEHICLES[v.specId];
    if (spec.specialWeapon === 'tank_cannon') {
      const mx = v.x + Math.cos(aimHeading) * (spec.length * 0.65);
      const my = v.y + Math.sin(aimHeading) * (spec.length * 0.65);
      this.muzzleFlashes.push({ x: mx, y: my, z: v.z + 1 });
      cb.onWeaponSound('rpg', 1);
      cb.onScreenShake(0.65);
      cb.onPanicTriggered(mx, my);
      if (v.driverId === 'player') cb.onCrimeCommitted(35, 2);

      this.pool.spawnProjectile({
        ownerId: v.driverId ?? v.id,
        weaponId: 'rpg',
        x: mx,
        y: my,
        z: v.z + 1.0,
        vx: Math.cos(aimHeading) * 68,
        vy: Math.sin(aimHeading) * 68,
        damage: 260,
        blastRadius: 14,
        life: 1.5,
        color: '#facc15',
      });
    } else if (spec.specialWeapon === 'water_cannon') {
      const mx = v.x + Math.cos(aimHeading) * (spec.length * 0.55);
      const my = v.y + Math.sin(aimHeading) * (spec.length * 0.55);
      this.pool.spawnProjectile({
        ownerId: v.driverId ?? v.id,
        weaponId: 'flamethrower',
        x: mx,
        y: my,
        z: v.z + 1.2,
        vx: Math.cos(aimHeading + (Math.random() - 0.5) * 0.14) * 34,
        vy: Math.sin(aimHeading + (Math.random() - 0.5) * 0.14) * 34,
        damage: 2,
        blastRadius: 0,
        life: 0.55,
        color: '#38bdf8',
        isWater: true,
      });
    }
    void player;
  }

  public update(
    dt: number,
    player: PlayerEntity,
    peds: PedEntity[],
    vehicles: VehicleEntity[],
    cb: CombatCallbacks
  ): void {
    // 0. Process staggered domino chain-reaction explosion queue
    if (this.pendingExplosions.length > 0) {
      const ready: Array<{ vehicleId: string; attackerId: string }> = [];
      for (let i = this.pendingExplosions.length - 1; i >= 0; i--) {
        this.pendingExplosions[i].delay -= dt;
        if (this.pendingExplosions[i].delay <= 0) {
          ready.push({
            vehicleId: this.pendingExplosions[i].vehicleId,
            attackerId: this.pendingExplosions[i].attackerId,
          });
          this.pendingExplosions.splice(i, 1);
        }
      }
      for (const item of ready) {
        const veh = vehicles.find((v) => v.id === item.vehicleId);
        if (veh && veh.alive && veh.damageStage !== 'wrecked') {
          this.explodeVehicle(veh, item.attackerId, player, peds, vehicles, cb);
        }
      }
    }

    // 1. Update active projectiles
    for (const pr of this.pool.projectiles) {
      if (!pr.active) continue;
      pr.life -= dt;
      const nextX = pr.x + pr.vx * dt;
      const nextY = pr.y + pr.vy * dt;

      // Gravity arc for thrown Molotovs & bouncing Frag Grenades
      if (pr.weaponId === 'molotov' || pr.weaponId === 'grenade') {
        pr.vz -= 16 * dt;
        pr.z += pr.vz * dt;
        if (pr.z <= 0.15) {
          pr.z = 0.15;
          if (pr.weaponId === 'molotov') {
            this.detonateMolotov(pr.x, pr.y, pr.z, pr.ownerId, cb);
            pr.active = false;
            continue;
          } else {
            // Frag grenade bounces and rolls until 2.5s fuse expires!
            pr.vz = Math.abs(pr.vz) * 0.42;
            pr.vx *= 0.65;
            pr.vy *= 0.65;
            pr.bounces++;
          }
        }
      }

      if (pr.life <= 0) {
        if (pr.weaponId === 'grenade' || pr.weaponId === 'rpg') {
          this.triggerExplosion(pr.x, pr.y, pr.z, pr.blastRadius || 12, pr.damage, pr.ownerId, player, peds, vehicles, cb);
        } else if (pr.weaponId === 'molotov') {
          this.detonateMolotov(pr.x, pr.y, pr.z, pr.ownerId, cb);
        }
        pr.active = false;
        continue;
      }

      // Check building wall hit via Rapier raycast along step segment
      const segDx = nextX - pr.x;
      const segDy = nextY - pr.y;
      const segDist = Math.hypot(segDx, segDy);
      if (segDist > 0.05) {
        const hit = this.physics.castRay(pr.x, pr.y, segDx / segDist, segDy / segDist, segDist, undefined, 0);
        if (hit && hit.meta?.kind === 'building') {
          if (pr.weaponId === 'grenade') {
            pr.vx = -pr.vx * 0.5;
            pr.vy = -pr.vy * 0.5;
            continue;
          }
          if (pr.weaponId === 'molotov') {
            this.detonateMolotov(hit.x, hit.y, pr.z, pr.ownerId, cb);
          } else if (pr.weaponId === 'rpg') {
            this.triggerExplosion(hit.x, hit.y, pr.z, 14, pr.damage, pr.ownerId, player, peds, vehicles, cb);
          } else {
            this.spawnSparks(hit.x, hit.y, pr.z, 3);
          }
          pr.active = false;
          continue;
        }
      }

      pr.x = nextX;
      pr.y = nextY;

      // Flame particles trail for RPG & Flamethrower
      if (pr.weaponId === 'rpg' && Math.random() < 0.7) {
        this.pool.spawnParticle('smoke_white', pr.x, pr.y, pr.z, 0, 0, 0.8, 0.9, 0.3, '#e2e8f0', 0.65);
      } else if (pr.weaponId === 'flamethrower' && !pr.isWater) {
        this.pool.spawnParticle('flame', pr.x, pr.y, pr.z, pr.vx * 0.1, pr.vy * 0.1, 1.2, 1.35, 0.22, '#f97316', 0.85);
      } else if (pr.isWater) {
        this.pool.spawnParticle('water', pr.x, pr.y, pr.z, pr.vx * 0.12, pr.vy * 0.12, 0.5, 1.1, 0.2, '#38bdf8', 0.7);
      }

      // Skip entity collision for still-airborne grenades
      if (pr.weaponId === 'grenade') continue;

      // Check collision with Player (if fired by enemy)
      if (pr.ownerId !== 'player' && player.status === 'alive') {
        const hitRadius = player.vehicleId ? 2.4 : 1.15;
        if (Math.hypot(pr.x - player.x, pr.y - player.y) < hitRadius) {
          if (player.vehicleId) {
            const pVeh = vehicles.find((v) => v.id === player.vehicleId);
            if (pVeh) {
              const dmg = VEHICLES[pVeh.specId].bulletResistant ? pr.damage * 0.25 : pr.damage * 0.75;
              this.damageVehicle(pVeh, dmg, pr.ownerId, cb, player, peds, vehicles);
            }
          } else {
            cb.onPlayerDamaged(pr.damage * 0.65, pr.ownerId);
          }
          if (pr.weaponId === 'rpg') {
            this.triggerExplosion(pr.x, pr.y, pr.z, 14, pr.damage, pr.ownerId, player, peds, vehicles, cb);
          }
          pr.active = false;
          continue;
        }
      }

      // Check collision with Pedestrians
      let hitEntity = false;
      for (const p of peds) {
        if (!p.alive || p.vehicleId || p.id === pr.ownerId) continue;
        if (Math.hypot(pr.x - p.x, pr.y - p.y) < 1.25) {
          if (pr.isWater) {
            const body = this.physics.getBody(p.bodyHandle);
            if (body) body.applyImpulse({ x: pr.vx * 0.6, y: pr.vy * 0.6 }, true);
            p.onFireTimer = 0;
          } else if (pr.weaponId === 'rpg') {
            this.triggerExplosion(pr.x, pr.y, pr.z, 14, pr.damage, pr.ownerId, player, peds, vehicles, cb);
          } else if (pr.weaponId === 'molotov') {
            this.detonateMolotov(pr.x, pr.y, pr.z, pr.ownerId, cb);
          } else {
            const shotAngle = Math.atan2(pr.vy, pr.vx);
            const kb = WEAPONS[pr.weaponId].knockback;
            this.damagePed(p, pr.damage, pr.ownerId, shotAngle, kb, cb);
            if (pr.weaponId === 'flamethrower') p.onFireTimer = 4.0;
          }
          pr.active = false;
          hitEntity = true;
          break;
        }
      }
      if (hitEntity) continue;

      // Check collision with Vehicles
      for (const v of vehicles) {
        if (!v.alive || v.damageStage === 'wrecked') continue;
        if (pr.ownerId === 'player' && v.id === player.vehicleId) continue;
        const spec = VEHICLES[v.specId];
        if (Math.hypot(pr.x - v.x, pr.y - v.y) < Math.max(spec.width, spec.length) * 0.52) {
          if (pr.isWater) {
            // Firetruck water cannon pushes vehicles strongly & extinguishes flames!
            const body = this.physics.getBody(v.bodyHandle);
            if (body) body.applyImpulse({ x: pr.vx * 1.4, y: pr.vy * 1.4 }, true);
            if (v.damageStage === 'burning') v.burnTimer = Math.min(5, v.burnTimer + 0.5);
          } else if (pr.weaponId === 'rpg') {
            this.triggerExplosion(pr.x, pr.y, pr.z, 14, pr.damage, pr.ownerId, player, peds, vehicles, cb);
          } else if (pr.weaponId === 'molotov') {
            this.detonateMolotov(pr.x, pr.y, pr.z, pr.ownerId, cb);
          } else {
            const mult = spec.bulletResistant ? 0.3 : 1.0;
            this.damageVehicle(v, pr.damage * mult, pr.ownerId, cb, player, peds, vehicles);
            this.spawnSparks(pr.x, pr.y, pr.z, 2);
          }
          pr.active = false;
          break;
        }
      }
    }

    // 2. Update active Fire Pools (Molotovs & Explosions)
    for (const fp of this.pool.firePools) {
      if (!fp.active) continue;
      fp.life -= dt;
      if (fp.life <= 0) {
        fp.active = false;
        continue;
      }

      if (Math.random() < 0.35) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * fp.radius * 0.8;
        this.pool.spawnParticle(
          'flame',
          fp.x + Math.cos(a) * r,
          fp.y + Math.sin(a) * r,
          fp.z + 0.3,
          0,
          0,
          2.2,
          1.4,
          0.32,
          '#f97316',
          0.85
        );
      }

      // Ignite & damage peds inside fire pool (elevation-filtered)
      for (const p of peds) {
        if (!p.alive || p.vehicleId || Math.abs(p.z - fp.z) >= 3.5) continue;
        if (Math.hypot(p.x - fp.x, p.y - fp.y) <= fp.radius) {
          p.onFireTimer = 4.0;
          this.damagePed(p, 26 * dt, fp.ownerId, 0, 0, cb);
        }
      }
      // Damage vehicles parked inside fire pool (elevation-filtered)
      for (const v of vehicles) {
        if (!v.alive || v.damageStage === 'wrecked' || Math.abs(v.z - fp.z) >= 3.5) continue;
        if (Math.hypot(v.x - fp.x, v.y - fp.y) <= fp.radius + 1.5) {
          this.damageVehicle(v, 22 * dt, fp.ownerId, cb, player, peds, vehicles);
        }
      }
      // Damage player on foot inside fire pool (elevation-filtered)
      if (!player.vehicleId && player.status === 'alive' && Math.abs(player.z - fp.z) < 3.5 && Math.hypot(player.x - fp.x, player.y - fp.y) <= fp.radius) {
        cb.onPlayerDamaged(18 * dt, 'fire');
      }
    }
  }

  public detonateMolotov(x: number, y: number, z: number, ownerId: string, cb: CombatCallbacks): void {
    this.pool.spawnFirePool(x, y, z, 6.0, 7.0, ownerId);
    this.pool.spawnDecal('scorch', x, y, z, Math.random() * Math.PI, 6.2, 6.2, 0.55, 25);
    cb.onPropExplosionHit(x, y, 7.5);
    cb.onPanicTriggered(x, y);
  }

  public triggerExplosion(
    x: number,
    y: number,
    z: number,
    radius: number,
    damage: number,
    ownerId: string,
    player: PlayerEntity,
    peds: PedEntity[],
    vehicles: VehicleEntity[],
    cb: CombatCallbacks,
    sourceVehicle?: OBB2D,
    playerWasEjected = false
  ): void {
    const distToPlayer = Math.hypot(x - player.x, y - player.y);
    const vol = Math.max(0.15, 1 - distToPlayer / 140);
    cb.onExplosionSound(vol);
    if (distToPlayer < 85) {
      cb.onScreenShake(Math.max(0.4, (1 - distToPlayer / 85) * 2.2));
    }
    cb.onPanicTriggered(x, y);
    cb.onPropExplosionHit(x, y, radius);
    if (ownerId === 'player') {
      cb.onCrimeCommitted(45, 2);
    }

    // Visual explosion flash + scorch crater decal + fireball particles
    this.explosionFlashes.push({ x, y, z, radius });
    this.pool.spawnDecal('crater', x, y, z, Math.random() * Math.PI, radius * 0.9, radius * 0.9, 0.72, 35);
    this.pool.spawnFirePool(x, y, z, Math.min(5.5, radius * 0.35), 4.5, ownerId);

    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = 3 + Math.random() * 11;
      this.pool.spawnParticle(
        i % 3 === 0 ? 'smoke_black' : 'explosion',
        x,
        y,
        z + 0.5,
        Math.cos(a) * spd,
        Math.sin(a) * spd,
        2 + Math.random() * 4,
        2.0 + Math.random() * 2.2,
        0.55 + Math.random() * 0.4,
        i % 3 === 0 ? '#18181b' : i % 2 === 0 ? '#f97316' : '#fef08a',
        0.95
      );
    }

    // Rapier radial impulse blast (tuned so clustered/linear 3+ car chains remain within domino range)
    this.physics.applyExplosionImpulse(x, y, radius * 1.2, 33);

    // Blast damage to pedestrians (elevation-filtered)
    for (const p of peds) {
      if (!p.alive || p.vehicleId) continue;
      if (Math.abs(p.z - z) >= 3.5) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d <= radius) {
        const falloff = 1 - d / (radius + 2);
        this.damagePed(p, damage * falloff, ownerId, Math.atan2(p.y - y, p.x - x), 24, cb);
      }
    }

    // Blast damage to player (elevation-filtered; single blast pass when ejected)
    if (player.status === 'alive' && Math.abs(player.z - z) < 3.5) {
      const dp = Math.hypot(player.x - x, player.y - y);
      if (dp <= radius) {
        const falloff = 1 - dp / (radius + 2);
        const mult = playerWasEjected ? 0.36 : player.vehicleId ? 0.35 : 0.7;
        cb.onPlayerDamaged(damage * falloff * mult, ownerId);
      }
    }

    // Staggered hull-to-hull chain-reaction blast damage to nearby vehicles
    for (const v of vehicles) {
      if (!v.alive || v.damageStage === 'wrecked' || v.id === sourceVehicle?.id || this.hasPendingExplosion(v.id)) {
        continue;
      }
      if (Math.abs(v.z - z) >= 3.5) continue;
      const spec = VEHICLES[v.specId];
      const targetOBB: OBB2D = {
        id: v.id,
        x: v.x,
        y: v.y,
        heading: v.heading,
        halfLength: spec.length * 0.5,
        halfWidth: spec.width * 0.5,
      };
      const edgeDist = sourceVehicle
        ? distanceBetweenOBBs(sourceVehicle, targetOBB)
        : distPointToOBB(x, y, targetOBB);
      if (edgeDist > radius) continue;

      let dmg: number;
      if (sourceVehicle && edgeDist <= 4.5 && v.specId !== 'rhino_apc') {
        dmg = Math.max(v.maxHp + 25, damage * 1.8);
      } else if (!sourceVehicle && edgeDist <= 0.6 && damage >= 200 && v.specId !== 'rhino_apc') {
        dmg = Math.max(v.maxHp + 25, damage * 1.35);
      } else {
        const falloff = Math.max(0, 1 - edgeDist / (radius + 2));
        const boost = edgeDist <= 4.5 ? 1.35 : 1.1;
        dmg = damage * falloff * boost;
      }

      v.hp = Math.max(0, v.hp - dmg);
      if (v.hp <= 0) {
        v.damageStage = 'burning';
        const delay = !sourceVehicle && edgeDist < 0.6
          ? 0.08
          : 0.18 + Math.min(0.14, edgeDist * 0.03);
        v.burnTimer = Math.min(v.burnTimer, delay);
        this.pendingExplosions.push({
          vehicleId: v.id,
          delay,
          attackerId: ownerId,
        });
      } else {
        VehiclePhysics.syncDamageStage(v);
      }
    }
  }

  public damagePed(
    p: PedEntity,
    amount: number,
    attackerId: string,
    hitAngle: number,
    knockback: number,
    cb: CombatCallbacks,
    isRunOver = false
  ): void {
    if (!p.alive) return;
    p.hp -= amount;
    if (knockback > 0) {
      const body = this.physics.getBody(p.bodyHandle);
      if (body) {
        body.applyImpulse({ x: Math.cos(hitAngle) * knockback, y: Math.sin(hitAngle) * knockback }, true);
      }
    }
    if (isRunOver || amount >= 5) {
      const count = isRunOver ? 7 : amount >= 20 ? 3 : 1;
      const colors = ['#dc2626', '#991b1b', '#ef4444'];
      for (let i = 0; i < count; i++) {
        const angle = knockback > 0
          ? hitAngle + (Math.random() - 0.5) * 1.4
          : Math.random() * Math.PI * 2;
        const spd = isRunOver ? 2.5 + Math.random() * 4.5 : 1.5 + Math.random() * 2.5;
        this.pool.spawnParticle(
          'blood',
          p.x,
          p.y,
          p.z + 0.4,
          Math.cos(angle) * spd,
          Math.sin(angle) * spd,
          1.5 + Math.random() * 2.5,
          isRunOver ? 0.55 + Math.random() * 0.5 : 0.7,
          isRunOver ? 0.35 + Math.random() * 0.2 : 0.35,
          colors[i % colors.length],
          0.9
        );
      }
    }

    if (p.hp <= 0) {
      p.hp = 0;
      p.alive = false;
      p.aiState = 'dead';
      this.physics.setBodyEnabled(p.bodyHandle, false);
      const decalW = isRunOver ? 2.6 + Math.random() * 0.8 : 2.2;
      const decalH = isRunOver ? 2.3 + Math.random() * 0.7 : 2.0;
      this.pool.spawnDecal('blood', p.x, p.y, p.z, Math.random() * Math.PI, decalW, decalH, isRunOver ? 0.78 : 0.72, isRunOver ? 28 : 22);
      if (isRunOver) {
        cb.onPedSplat(p.x, p.y);
      }
      cb.onPedKilled(p, attackerId, isRunOver);
    }
  }

  public damageVehicle(
    v: VehicleEntity,
    amount: number,
    attackerId: string,
    cb: CombatCallbacks,
    player: PlayerEntity,
    peds: PedEntity[],
    vehicles: VehicleEntity[]
  ): void {
    if (!v.alive || v.damageStage === 'wrecked' || this.hasPendingExplosion(v.id)) return;
    v.hp = Math.max(0, v.hp - amount);
    if (v.hp <= 0) {
      this.explodeVehicle(v, attackerId, player, peds, vehicles, cb);
    } else {
      VehiclePhysics.syncDamageStage(v);
    }
  }

  public explodeVehicle(
    v: VehicleEntity,
    attackerId: string,
    player: PlayerEntity,
    peds: PedEntity[],
    vehicles: VehicleEntity[],
    cb: CombatCallbacks
  ): void {
    for (let i = this.pendingExplosions.length - 1; i >= 0; i--) {
      if (this.pendingExplosions[i].vehicleId === v.id) {
        this.pendingExplosions.splice(i, 1);
      }
    }
    if (v.damageStage === 'wrecked') return;
    v.hp = 0;
    v.damageStage = 'wrecked';
    v.sirenActive = false;
    v.headlightsOn = false;
    const playerWasInside = player.vehicleId === v.id;
    cb.onVehicleDestroyed(v, attackerId);
    const spec = VEHICLES[v.specId];
    const sourceOBB: OBB2D = {
      id: v.id,
      x: v.x,
      y: v.y,
      heading: v.heading,
      halfLength: spec.length * 0.5,
      halfWidth: spec.width * 0.5,
    };
    this.triggerExplosion(v.x, v.y, v.z, 14, 180, attackerId, player, peds, vehicles, cb, sourceOBB, playerWasInside);
  }

  private spawnSparks(x: number, y: number, z: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      this.pool.spawnParticle('spark', x, y, z + 0.4, Math.cos(a) * 6, Math.sin(a) * 6, 2, 0.5, 0.2, '#fde047', 1);
    }
  }
}
