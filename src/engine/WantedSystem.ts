import type { PedEntity, PlayerEntity, RoadblockEntity, VehicleEntity, VehicleId } from '../types/entity.types';
import type { WorldMapData } from '../types/world.types';
import { getTileAtWorld, TILE_ENUM } from '../data/mapGenerator';
import { PhysicsWorld } from './PhysicsWorld';
import type { VehicleControlInput } from './VehiclePhysics';
import { normalizeAngle } from './TrafficSystem';

export class WantedSystem {
  private map: WorldMapData;
  private physics: PhysicsWorld;
  private reinforceTimer = 0;
  private roadblockTimer = 0;
  private bustTimer = 0;
  public roadblocks: RoadblockEntity[] = [];
  private rbSeq = 0;

  constructor(map: WorldMapData, physics: PhysicsWorld) {
    this.map = map;
    this.physics = physics;
  }

  public addCrimeHeat(player: PlayerEntity, heat: number, minStars = 1): void {
    player.heatScore = Math.min(1000, player.heatScore + heat);
    let stars = player.wantedStars;
    if (player.heatScore >= 650) stars = Math.max(stars, 6);
    else if (player.heatScore >= 460) stars = Math.max(stars, 5);
    else if (player.heatScore >= 300) stars = Math.max(stars, 4);
    else if (player.heatScore >= 175) stars = Math.max(stars, 3);
    else if (player.heatScore >= 80) stars = Math.max(stars, 2);
    else if (player.heatScore >= 20) stars = Math.max(stars, minStars);

    if (stars > player.wantedStars) {
      this.setWantedStars(player, stars);
    } else if (player.wantedStars > 0) {
      // Reset evasion countdown on fresh crime
      player.evasionTimer = 0;
      player.policeLineOfSight = true;
    }
  }

  public setWantedStars(player: PlayerEntity, stars: number): void {
    const clamped = Math.max(0, Math.min(6, Math.round(stars)));
    player.wantedStars = clamped;
    player.evasionTimer = 0;
    if (clamped === 0) {
      player.heatScore = 0;
      player.policeLineOfSight = false;
      player.evasionTarget = 0;
      this.bustTimer = 0;
    } else {
      const thresholds = [0, 25, 90, 190, 320, 480, 680];
      player.heatScore = Math.max(player.heatScore, thresholds[clamped]);
      player.evasionTarget = clamped <= 2 ? 15 : clamped <= 4 ? 30 : 999999; // 5-6 stars require Pay 'n' Spray / Bribe / Mission
    }
  }

  public clearWanted(player: PlayerEntity, vehicles: VehicleEntity[], peds: PedEntity[]): void {
    this.setWantedStars(player, 0);
    // Calm existing pursuing units
    for (const v of vehicles) {
      if (v.aiRole === 'police' || v.aiRole === 'swat' || v.aiRole === 'fbi' || v.aiRole === 'army') {
        v.sirenActive = false;
        v.aiRole = 'traffic';
      }
    }
    for (const p of peds) {
      if (p.role === 'cop' || p.role === 'swat' || p.role === 'fbi' || p.role === 'army') {
        p.aiState = 'wander';
      }
    }
    this.roadblocks.length = 0;
  }

  public update(
    dt: number,
    player: PlayerEntity,
    vehicles: VehicleEntity[],
    peds: PedEntity[],
    spawnPoliceUnit: (specId: VehicleId, x: number, y: number, heading: number, role: VehicleEntity['aiRole']) => VehicleEntity | null,
    spawnOfficer: (role: PedEntity['role'], x: number, y: number) => PedEntity,
    onPlayerBusted: () => void,
    onTankFire: (tank: VehicleEntity, targetX: number, targetY: number) => void,
    onSpikeStripHit: (playerVeh: VehicleEntity) => void
  ): void {
    if (player.wantedStars <= 0 || player.status !== 'alive') {
      this.bustTimer = 0;
      return;
    }

    const stars = player.wantedStars;

    // 1. Line-of-Sight check against all living cops & pursuing police vehicles
    let seenByPolice = false;
    let activeLawVehicles = 0;
    let activeLawOfficers = 0;

    for (const v of vehicles) {
      if (!v.alive || v.damageStage === 'wrecked') continue;
      if (v.aiRole === 'police' || v.aiRole === 'swat' || v.aiRole === 'fbi' || v.aiRole === 'army') {
        activeLawVehicles++;
        const d = Math.hypot(v.x - player.x, v.y - player.y);
        if (d < 72 && this.physics.hasLineOfSight(v.x, v.y, player.x, player.y, player.layer)) {
          seenByPolice = true;
        }
        // 6-Star Rhino Tank fires explosive cannon shells at player!
        if (v.specId === 'rhino_apc' && d < 62 && v.aiCooldown <= 0) {
          v.turretHeading = Math.atan2(player.y - v.y, player.x - v.x);
          onTankFire(v, player.x, player.y);
          v.aiCooldown = 3.2;
        }
        if (v.aiCooldown > 0) v.aiCooldown -= dt;
      }
    }

    for (const p of peds) {
      if (!p.alive || p.vehicleId) continue;
      if (p.role === 'cop' || p.role === 'swat' || p.role === 'fbi' || p.role === 'army') {
        activeLawOfficers++;
        const d = Math.hypot(p.x - player.x, p.y - player.y);
        if (d < 52 && this.physics.hasLineOfSight(p.x, p.y, player.x, player.y, player.layer)) {
          seenByPolice = true;
        }
      }
    }

    player.policeLineOfSight = seenByPolice;

    // 2. Star Decay / Evasion Timer (1-2★: 15s, 3-4★: 30s, 5-6★: never decays automatically)
    if (stars <= 4) {
      if (!seenByPolice) {
        player.evasionTimer += dt;
        const targetTime = stars <= 2 ? 15 : 30;
        player.evasionTarget = targetTime;
        if (player.evasionTimer >= targetTime) {
          this.setWantedStars(player, stars - 1);
          if (player.wantedStars === 0) {
            this.clearWanted(player, vehicles, peds);
            return;
          }
        }
      } else {
        player.evasionTimer = Math.max(0, player.evasionTimer - dt * 1.5);
      }
    } else {
      player.evasionTimer = 0;
    }

    // 3. Bust check: if player is stopped & cop is right next to them (not in God Mode)
    if (!player.godMode) {
      const playerVeh = player.vehicleId ? vehicles.find((v) => v.id === player.vehicleId) : null;
      const playerSpeed = playerVeh ? Math.abs(playerVeh.speed) : Math.hypot(player.vx, player.vy);
      const copRightBeside = peds.some(
        (p) =>
          p.alive &&
          !p.vehicleId &&
          (p.role === 'cop' || p.role === 'swat' || p.role === 'fbi') &&
          Math.hypot(p.x - player.x, p.y - player.y) < 4.5
      );
      if (copRightBeside && playerSpeed < 2.2) {
        this.bustTimer += dt;
        if (this.bustTimer >= 2.2) {
          this.bustTimer = 0;
          onPlayerBusted();
          return;
        }
      } else {
        this.bustTimer = Math.max(0, this.bustTimer - dt * 2);
      }
    }

    // 4. Escalation Reinforcements per Wanted Tier
    const desiredVehicles = Math.min(7, 1 + stars);
    const desiredFootCops = Math.min(8, 2 + stars);

    this.reinforceTimer -= dt;
    if (this.reinforceTimer <= 0 && activeLawVehicles < desiredVehicles) {
      this.reinforceTimer = Math.max(1.8, 4.5 - stars * 0.45);
      const spawnSpot = this.findNearbyRoadPoint(player.x, player.y, 58, 115);
      if (spawnSpot) {
        const heading = Math.atan2(player.y - spawnSpot.y, player.x - spawnSpot.x);
        const { specId, aiRole, officerRole } = this.getTierUnit(stars);
        const veh = spawnPoliceUnit(specId, spawnSpot.x, spawnSpot.y, heading, aiRole);
        if (veh) {
          veh.sirenActive = true;
          if (activeLawOfficers < desiredFootCops && stars >= 1) {
            spawnOfficer(officerRole, spawnSpot.x + 3.5, spawnSpot.y + 3.5);
          }
        }
      }
    }

    // 5. Roadblocks (3★+) & Spike Strips (4★+)
    if (stars >= 3) {
      this.roadblockTimer -= dt;
      if (this.roadblockTimer <= 0 && this.roadblocks.length < 2) {
        this.roadblockTimer = 18;
        const aheadAngle = player.heading;
        const rx = player.x + Math.cos(aheadAngle) * 84;
        const ry = player.y + Math.sin(aheadAngle) * 84;
        const spot = this.findNearbyRoadPoint(rx, ry, 0, 48);
        if (spot) {
          const perp = aheadAngle + Math.PI * 0.5;
          const rbSpec: VehicleId =
            stars >= 6 ? 'rhino_apc' : stars >= 5 ? 'fbi_suv' : stars >= 4 ? 'nypd_swat' : 'nypd_cruiser';
          const role: VehicleEntity['aiRole'] =
            stars >= 6 ? 'army' : stars >= 5 ? 'fbi' : stars >= 4 ? 'swat' : 'police';
          const offRole: PedEntity['role'] =
            stars >= 6 ? 'army' : stars >= 5 ? 'fbi' : stars >= 4 ? 'swat' : 'cop';

          const v1 = spawnPoliceUnit(rbSpec, spot.x + Math.cos(perp) * 4.2, spot.y + Math.sin(perp) * 4.2, perp, role);
          const v2 = spawnPoliceUnit(rbSpec, spot.x - Math.cos(perp) * 4.2, spot.y - Math.sin(perp) * 4.2, perp, role);
          const c1 = spawnOfficer(offRole, spot.x + Math.cos(perp) * 7, spot.y + Math.sin(perp) * 7);
          const c2 = spawnOfficer(offRole, spot.x - Math.cos(perp) * 7, spot.y - Math.sin(perp) * 7);

          this.roadblocks.push({
            id: `rb_${this.rbSeq++}`,
            x: spot.x,
            y: spot.y,
            heading: aheadAngle,
            hasSpikes: stars >= 4,
            vehicleIds: [v1?.id, v2?.id].filter(Boolean) as string[],
            copIds: [c1.id, c2.id],
            life: 40,
          });
        }
      }
    }

    // Check Spike Strip damage on player vehicle (4★+)
    const playerVeh = player.vehicleId ? vehicles.find((v) => v.id === player.vehicleId) : null;
    for (let i = this.roadblocks.length - 1; i >= 0; i--) {
      const rb = this.roadblocks[i];
      rb.life -= dt;
      if (rb.hasSpikes && playerVeh && Math.hypot(playerVeh.x - rb.x, playerVeh.y - rb.y) < 9) {
        rb.hasSpikes = false; // consume spike strip once triggered
        onSpikeStripHit(playerVeh);
      }
      if (rb.life <= 0) {
        this.roadblocks.splice(i, 1);
      }
    }
  }

  public computePursuitControl(
    v: VehicleEntity,
    player: PlayerEntity,
    wantedStars: number
  ): VehicleControlInput {
    // Lead player's position slightly for 2★+ PIT maneuvers!
    const leadTime = wantedStars >= 2 ? 0.65 : 0.15;
    let targetX = player.x + player.vx * leadTime;
    let targetY = player.y + player.vy * leadTime;

    const dx = targetX - v.x;
    const dy = targetY - v.y;
    const dist = Math.hypot(dx, dy);

    // 2★+ PIT maneuver offset: aim for rear quarter panel when close
    if (wantedStars >= 2 && player.vehicleId && dist < 18 && dist > 5) {
      targetX -= Math.cos(player.heading) * 3.0;
      targetY -= Math.sin(player.heading) * 3.0;
    }

    const desiredAngle = Math.atan2(targetY - v.y, targetX - v.x);
    const diff = normalizeAngle(desiredAngle - v.heading);
    const steer = Math.max(-1, Math.min(1, diff * 2.1));

    // If nose is pointed nearly opposite to target, reverse briefly to unstick
    if (Math.abs(diff) > 2.35 && v.speed < 2.5) {
      return { throttle: -0.75, steer: -steer, handbrake: false };
    }

    const handbrake = Math.abs(diff) > 1.15 && v.speed > 10;
    const throttle = dist < 9 && v.specId === 'rhino_apc' ? 0.25 : 0.95;
    return { throttle, steer, handbrake };
  }

  private getTierUnit(stars: number): {
    specId: VehicleId;
    aiRole: VehicleEntity['aiRole'];
    officerRole: PedEntity['role'];
  } {
    if (stars >= 6) {
      return Math.random() < 0.65
        ? { specId: 'rhino_apc', aiRole: 'army', officerRole: 'army' }
        : { specId: 'nypd_swat', aiRole: 'army', officerRole: 'army' };
    }
    if (stars === 5) {
      return { specId: 'fbi_suv', aiRole: 'fbi', officerRole: 'fbi' };
    }
    if (stars === 4) {
      return Math.random() < 0.65
        ? { specId: 'nypd_swat', aiRole: 'swat', officerRole: 'swat' }
        : { specId: 'nypd_cruiser', aiRole: 'police', officerRole: 'swat' };
    }
    return { specId: 'nypd_cruiser', aiRole: 'police', officerRole: 'cop' };
  }

  private findNearbyRoadPoint(cx: number, cy: number, minDist: number, maxDist: number): { x: number; y: number } | null {
    for (let attempt = 0; attempt < 24; attempt++) {
      const a = Math.random() * Math.PI * 2;
      const d = minDist + Math.random() * Math.max(10, maxDist - minDist);
      const tx = Math.max(64, Math.min(this.map.worldSize - 64, cx + Math.cos(a) * d));
      const ty = Math.max(64, Math.min(this.map.worldSize - 64, cy + Math.sin(a) * d));
      const tile = getTileAtWorld(this.map, tx, ty);
      if (
        tile === TILE_ENUM.road_ns ||
        tile === TILE_ENUM.road_ew ||
        tile === TILE_ENUM.intersection ||
        tile === TILE_ENUM.bridge
      ) {
        return { x: tx, y: ty };
      }
    }
    return null;
  }
}
