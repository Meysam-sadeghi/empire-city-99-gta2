import type { PedEntity, PedRole, PlayerEntity, VehicleEntity, WeaponId } from '../types/entity.types';
import type { FactionId, WorldMapData } from '../types/world.types';
import { DISTRICTS, getDistrictAt } from '../data/districts.data';
import { GANGS, RESPECT_RULES } from '../data/gangs.data';
import { getTileAtWorld, isWaterAt, TILE_ENUM } from '../data/mapGenerator';
import { VEHICLES } from '../data/vehicles.data';
import { PhysicsWorld } from './PhysicsWorld';
import { normalizeAngle } from './TrafficSystem';

const CIV_SHIRTS = ['#64748b', '#475569', '#3b82f6', '#10b981', '#eab308', '#ec4899', '#a855f7', '#e2e8f0'];

export class PedestrianSystem {
  private map: WorldMapData;
  private physics: PhysicsWorld;
  private spawnTimer = 0;
  private panicTimer = 0;
  private panicOrigin = { x: 0, y: 0 };
  private maxAmbientPeds = 26;
  private pedSeq = 0;

  constructor(map: WorldMapData, physics: PhysicsWorld) {
    this.map = map;
    this.physics = physics;
  }

  public triggerPanic(x: number, y: number): void {
    this.panicTimer = 6.0;
    this.panicOrigin.x = x;
    this.panicOrigin.y = y;
  }

  public spawnPed(params: {
    role: PedRole;
    x: number;
    y: number;
    faction?: FactionId;
    weaponId?: WeaponId;
    isMissionEntity?: boolean;
    missionTag?: string;
    hpOverride?: number;
  }): PedEntity {
    const id = `ped_${this.pedSeq++}`;
    const { bodyHandle, colliderHandle } = this.physics.createCharacterBody('ped', id, params.x, params.y, 0.62, 0);

    let maxHp = params.hpOverride ?? 50;
    let weaponId: WeaponId = params.weaponId ?? 'fists';
    let shirtColor = CIV_SHIRTS[Math.floor(Math.random() * CIV_SHIRTS.length)];

    if (params.role === 'gang' && params.faction) {
      const gang = GANGS[params.faction];
      shirtColor = gang.color;
      maxHp = params.hpOverride ?? 75;
      weaponId = params.weaponId ?? (gang.weapons[Math.floor(Math.random() * gang.weapons.length)] as WeaponId);
    } else if (params.role === 'cop') {
      shirtColor = '#1d4ed8';
      maxHp = params.hpOverride ?? 75;
      weaponId = params.weaponId ?? 'pistol';
    } else if (params.role === 'swat') {
      shirtColor = '#1e293b';
      maxHp = params.hpOverride ?? 140;
      weaponId = params.weaponId ?? (Math.random() < 0.5 ? 'shotgun' : 'm4');
    } else if (params.role === 'fbi') {
      shirtColor = '#09090b';
      maxHp = params.hpOverride ?? 130;
      weaponId = params.weaponId ?? (Math.random() < 0.5 ? 'dual_uzis' : 'm4');
    } else if (params.role === 'army') {
      shirtColor = '#4d5d3b';
      maxHp = params.hpOverride ?? 160;
      weaponId = params.weaponId ?? 'm4';
    } else if (params.role === 'boss') {
      shirtColor = params.faction ? GANGS[params.faction].color : '#facc15';
      maxHp = params.hpOverride ?? 360;
      weaponId = params.weaponId ?? 'm4';
    }

    return {
      id,
      role: params.role,
      faction: params.faction,
      x: params.x,
      y: params.y,
      z: 0,
      layer: 0,
      heading: Math.random() * Math.PI * 2,
      vx: 0,
      vy: 0,
      hp: maxHp,
      maxHp,
      weaponId,
      fireCooldown: 0.4 + Math.random() * 0.6,
      aiState: 'wander',
      walkPhase: Math.random() * 10,
      shirtColor,
      pantsColor: '#1f2937',
      vehicleId: null,
      isMissionEntity: Boolean(params.isMissionEntity),
      missionTag: params.missionTag,
      onFireTimer: 0,
      stateTimer: 1 + Math.random() * 3,
      wanderAngle: Math.random() * Math.PI * 2,
      bodyHandle,
      colliderHandle,
      alive: true,
      deathTimer: 0,
    };
  }

  public update(
    dt: number,
    player: PlayerEntity,
    peds: PedEntity[],
    vehicles: VehicleEntity[],
    respect: Record<FactionId, number>,
    onPedFire: (ped: PedEntity, targetX: number, targetY: number) => void,
    onPedDamage: (
      ped: PedEntity,
      dmg: number,
      sourceId: string,
      hitAngle?: number,
      knockback?: number,
      isRunOver?: boolean
    ) => void,
    removePed: (ped: PedEntity) => void
  ): void {
    if (this.panicTimer > 0) this.panicTimer -= dt;

    // 1. Spawn ambient sidewalk civilians, gang patrols, and beat cops
    let ambientCount = 0;
    for (let i = peds.length - 1; i >= 0; i--) {
      const p = peds[i];
      if (!p.alive) {
        p.deathTimer += dt;
        if (p.deathTimer > 14 && !p.isMissionEntity) {
          removePed(p);
        }
        continue;
      }

      const dist = Math.hypot(p.x - player.x, p.y - player.y);
      if (!p.isMissionEntity && p.role !== 'boss' && dist > 155) {
        removePed(p);
        continue;
      }
      if (!p.isMissionEntity) ambientCount++;
    }

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && ambientCount < this.maxAmbientPeds) {
      this.spawnTimer = 0.4;
      const angle = Math.random() * Math.PI * 2;
      const dist = 34 + Math.random() * 72;
      const sx = player.x + Math.cos(angle) * dist;
      const sy = player.y + Math.sin(angle) * dist;
      const tile = getTileAtWorld(this.map, sx, sy);

      if (
        tile === TILE_ENUM.sidewalk ||
        tile === TILE_ENUM.park_path ||
        tile === TILE_ENUM.grass ||
        tile === TILE_ENUM.concrete ||
        tile === TILE_ENUM.cobblestone
      ) {
        const district = getDistrictAt(sx, sy);
        const distDef = DISTRICTS[district];
        const r = Math.random();
        let role: PedRole = 'civilian';
        let faction: FactionId | undefined;

        if (distDef.faction && r < 0.36) {
          role = 'gang';
          faction = distDef.faction;
        } else if (district === 'central_park' && r < 0.22) {
          role = 'cop';
        } else if (r < 0.08) {
          role = 'cop';
        }

        peds.push(this.spawnPed({ role, x: sx, y: sy, faction }));
      }
    }

    // 2. Update every living pedestrian
    const playerTargetX = player.x;
    const playerTargetY = player.y;

    for (const p of peds) {
      if (!p.alive || p.vehicleId) continue;
      const body = this.physics.getBody(p.bodyHandle);
      if (!body) continue;

      const pos = body.translation();
      p.x = pos.x;
      p.y = pos.y;

      // Burning damage over time
      if (p.onFireTimer > 0) {
        p.onFireTimer -= dt;
        onPedDamage(p, 24 * dt, 'fire');
        if (!p.alive) continue;
      }

      // Water hazard
      if (isWaterAt(this.map, p.x, p.y, p.layer)) {
        onPedDamage(p, 40 * dt, 'water');
        if (!p.alive) continue;
      }

      // Check vehicle run-over collisions (classic GTA 2 splat!)
      for (const v of vehicles) {
        if (!v.alive || v.layer !== p.layer) continue;
        if (Math.abs(v.z - p.z) > 2.2) continue;
        const spec = VEHICLES[v.specId];
        const speed = Math.hypot(v.vx, v.vy);
        const minSpeed = spec.crushOnContact ? 1.8 : 3.8;
        if (speed <= minSpeed) continue;

        const vBody = this.physics.getBody(v.bodyHandle);
        const vx = vBody ? vBody.translation().x : v.x;
        const vy = vBody ? vBody.translation().y : v.y;
        const vHeading = vBody ? vBody.rotation() : v.heading;

        const dx = p.x - vx;
        const dy = p.y - vy;
        const cosH = Math.cos(vHeading);
        const sinH = Math.sin(vHeading);
        const localX = dx * cosH + dy * sinH;
        const localY = -dx * sinH + dy * cosH;

        const halfL = spec.length * 0.5;
        const halfW = spec.width * 0.5;
        const clampedX = Math.max(-halfL, Math.min(halfL, localX));
        const clampedY = Math.max(-halfW, Math.min(halfW, localY));
        const ox = localX - clampedX;
        const oy = localY - clampedY;
        const dist = Math.hypot(ox, oy);

        let hit = false;
        if (dist <= 1e-4) {
          hit = true;
        } else {
          const nx = ox / dist;
          const ny = oy / dist;
          const localVx = v.vx * cosH + v.vy * sinH;
          const localVy = -v.vx * sinH + v.vy * cosH;
          const approachSpeed = nx * localVx + ny * localVy;
          if (approachSpeed >= -0.6) {
            const reach = approachSpeed > 1.5 ? 0.96 : 0.78;
            hit = dist <= reach;
          }
        }

        if (hit) {
          const dmg = spec.crushOnContact ? p.hp + 100 : Math.max(90, speed * 24);
          const hitAngle = Math.atan2(v.vy, v.vx);
          onPedDamage(p, dmg, v.driverId ?? 'vehicle', hitAngle, Math.min(28, speed * 1.4), true);
          break;
        }
      }
      if (!p.alive) continue;

      const distToPlayer = Math.hypot(playerTargetX - p.x, playerTargetY - p.y);
      const isPolice = p.role === 'cop' || p.role === 'swat' || p.role === 'fbi' || p.role === 'army';
      const isHostileGang =
        (p.role === 'gang' || p.role === 'boss') &&
        (p.isMissionEntity || (p.faction !== undefined && respect[p.faction] < RESPECT_RULES.HOSTILE_THRESHOLD));

      let moveSpeed = 3.2;
      let desiredVx = 0;
      let desiredVy = 0;

      if (p.fireCooldown > 0) p.fireCooldown -= dt;

      if ((isPolice && player.wantedStars > 0 && player.status === 'alive') || (isHostileGang && player.status === 'alive')) {
        // Combat pursuit & fire
        const engageRange = p.role === 'boss' || p.role === 'swat' || p.role === 'fbi' ? 42 : 30;
        const stopDist = isPolice ? 2.4 : 7.5;
        const chaseRange = isPolice || p.isMissionEntity ? 130 : engageRange;
        const desiredHeading = Math.atan2(playerTargetY - p.y, playerTargetX - p.x);
        p.heading += normalizeAngle(desiredHeading - p.heading) * Math.min(1, dt * 10);

        if (distToPlayer < chaseRange && distToPlayer > stopDist) {
          p.aiState = 'chase';
          moveSpeed = p.role === 'swat' || p.role === 'fbi' ? 6.2 : isPolice ? 5.4 : p.isMissionEntity ? 5.6 : 5.4;
          let steerAngle = desiredHeading;
          if (isPolice) {
            // Simple 1-tile (1.6m) building/water corner-slide steering for chasing police
            const probeDist = 1.6;
            const ax = p.x + Math.cos(desiredHeading) * probeDist;
            const ay = p.y + Math.sin(desiredHeading) * probeDist;
            if (getTileAtWorld(this.map, ax, ay) === TILE_ENUM.building || isWaterAt(this.map, ax, ay, p.layer)) {
              const leftAngle = desiredHeading + Math.PI * 0.45;
              const rightAngle = desiredHeading - Math.PI * 0.45;
              const lx = p.x + Math.cos(leftAngle) * probeDist;
              const ly = p.y + Math.sin(leftAngle) * probeDist;
              const rx = p.x + Math.cos(rightAngle) * probeDist;
              const ry = p.y + Math.sin(rightAngle) * probeDist;
              const leftBlocked =
                getTileAtWorld(this.map, lx, ly) === TILE_ENUM.building || isWaterAt(this.map, lx, ly, p.layer);
              const rightBlocked =
                getTileAtWorld(this.map, rx, ry) === TILE_ENUM.building || isWaterAt(this.map, rx, ry, p.layer);
              if (!leftBlocked && rightBlocked) {
                steerAngle = leftAngle;
              } else if (!rightBlocked && leftBlocked) {
                steerAngle = rightAngle;
              } else if (!leftBlocked && !rightBlocked) {
                steerAngle = (p.id.charCodeAt(p.id.length - 1) & 1) === 0 ? leftAngle : rightAngle;
              } else {
                const backLeft = desiredHeading + Math.PI * 0.75;
                const blx = p.x + Math.cos(backLeft) * probeDist;
                const bly = p.y + Math.sin(backLeft) * probeDist;
                if (
                  getTileAtWorld(this.map, blx, bly) !== TILE_ENUM.building &&
                  !isWaterAt(this.map, blx, bly, p.layer)
                ) {
                  steerAngle = backLeft;
                } else {
                  steerAngle = desiredHeading - Math.PI * 0.75;
                }
              }
            }
          }
          desiredVx = Math.cos(steerAngle) * moveSpeed;
          desiredVy = Math.sin(steerAngle) * moveSpeed;
        } else if (distToPlayer <= stopDist) {
          p.aiState = 'attack';
        }

        // Fire weapon if within range and has LOS (hold cop fire during close arrest window)
        const playerSpeed = Math.hypot(player.vx, player.vy);
        const copArresting = isPolice && distToPlayer < 5.5 && playerSpeed < 2.2;
        if (!copArresting && distToPlayer < engageRange && p.fireCooldown <= 0) {
          if (this.physics.hasLineOfSight(p.x, p.y, playerTargetX, playerTargetY, p.layer)) {
            onPedFire(p, playerTargetX, playerTargetY);
            p.fireCooldown =
              p.weaponId === 'dual_uzis'
                ? 0.25
                : p.weaponId === 'm4'
                ? 0.35
                : p.weaponId === 'rpg'
                ? 2.2
                : 0.75;
          } else {
            p.fireCooldown = 0.4;
          }
        }
      } else if (this.panicTimer > 0 && Math.hypot(p.x - this.panicOrigin.x, p.y - this.panicOrigin.y) < 42) {
        // Fleeing civilian panic state
        p.aiState = 'flee';
        const fleeAngle = Math.atan2(p.y - this.panicOrigin.y, p.x - this.panicOrigin.x);
        p.heading = fleeAngle;
        moveSpeed = 6.8;
        desiredVx = Math.cos(fleeAngle) * moveSpeed;
        desiredVy = Math.sin(fleeAngle) * moveSpeed;
      } else {
        // Calm sidewalk wandering
        p.aiState = 'wander';
        p.stateTimer -= dt;
        if (p.stateTimer <= 0) {
          p.stateTimer = 2 + Math.random() * 4;
          // Prefer cardinal NYC sidewalk directions
          const cardinals = [0, Math.PI * 0.5, Math.PI, -Math.PI * 0.5];
          p.wanderAngle = cardinals[Math.floor(Math.random() * cardinals.length)] + (Math.random() - 0.5) * 0.3;
        }
        p.heading = p.wanderAngle;
        moveSpeed = 2.6;
        desiredVx = Math.cos(p.wanderAngle) * moveSpeed;
        desiredVy = Math.sin(p.wanderAngle) * moveSpeed;

        // Avoid stepping into water
        const aheadX = p.x + Math.cos(p.wanderAngle) * 4;
        const aheadY = p.y + Math.sin(p.wanderAngle) * 4;
        if (isWaterAt(this.map, aheadX, aheadY, p.layer)) {
          p.wanderAngle += Math.PI;
        }
      }

      body.setLinvel({ x: desiredVx, y: desiredVy }, true);
      p.vx = desiredVx;
      p.vy = desiredVy;
      if (Math.hypot(desiredVx, desiredVy) > 0.5) {
        p.walkPhase += dt * (moveSpeed * 0.6);
      }
    }
  }
}
