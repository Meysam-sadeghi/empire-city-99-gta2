import type { PlayerEntity, VehicleEntity, VehicleId } from '../types/entity.types';
import type { DistrictId, RoadNode, WorldMapData } from '../types/world.types';
import { getDistrictAt } from '../data/districts.data';
import { VEHICLES } from '../data/vehicles.data';
import type { VehicleControlInput } from './VehiclePhysics';

export class TrafficSystem {
  private map: WorldMapData;
  private trafficLightPhase = 0; // 0 = NS green, 1 = EW green
  private trafficLightTimer = 0;
  private spawnTimer = 0;
  private maxTrafficVehicles = 18;

  constructor(map: WorldMapData) {
    this.map = map;
  }

  public isNSGreen(): boolean {
    return this.trafficLightPhase === 0;
  }

  public update(
    dt: number,
    player: PlayerEntity,
    vehicles: VehicleEntity[],
    spawnVehicle: (
      specId: VehicleId,
      x: number,
      y: number,
      heading: number,
      aiRole: VehicleEntity['aiRole'],
      targetNodeId?: string
    ) => VehicleEntity | null,
    despawnVehicle: (v: VehicleEntity) => void
  ): void {
    // 1. Cycle NYC intersection traffic lights every 8 seconds
    this.trafficLightTimer += dt;
    if (this.trafficLightTimer >= 8) {
      this.trafficLightTimer = 0;
      this.trafficLightPhase = 1 - this.trafficLightPhase;
    }

    // 2. Despawn distant ambient traffic beyond streaming radius (~175m)
    let ambientCount = 0;
    for (let i = vehicles.length - 1; i >= 0; i--) {
      const v = vehicles[i];
      if (!v.alive) continue;
      if (v.id === player.vehicleId || v.isMissionEntity || v.spawnProtected) continue;
      const dist = Math.hypot(v.x - player.x, v.y - player.y);
      if (v.aiRole === 'traffic' || v.aiRole === 'none') {
        if (dist > 175) {
          despawnVehicle(v);
        } else {
          ambientCount++;
        }
      }
    }

    // 3. Dynamically spawn ambient NYC traffic on nearby road nodes within ring [65m..145m]
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && ambientCount < this.maxTrafficVehicles) {
      this.spawnTimer = 0.65;
      const candidates: RoadNode[] = [];
      for (const node of this.map.roadNodes.values()) {
        if (node.neighbors.length === 0) continue;
        const dist = Math.hypot(node.x - player.x, node.y - player.y);
        if (dist >= 62 && dist <= 145) {
          candidates.push(node);
        }
      }

      if (candidates.length > 0) {
        const node = candidates[Math.floor(Math.random() * candidates.length)];
        const nextId = node.neighbors[Math.floor(Math.random() * node.neighbors.length)];
        const nextNode = this.map.roadNodes.get(nextId);
        if (nextNode) {
          const heading = Math.atan2(nextNode.y - node.y, nextNode.x - node.x);
          // Offset into right-hand NYC traffic lane (+4.2m right of center)
          const rightX = -Math.sin(heading) * 4.2;
          const rightY = Math.cos(heading) * 4.2;
          const sx = node.x + rightX;
          const sy = node.y + rightY;

          // Ensure no existing car is overlapping spawn spot
          const blocked = vehicles.some(
            (v) => v.alive && Math.hypot(v.x - sx, v.y - sy) < 12
          );
          if (!blocked) {
            const district = getDistrictAt(sx, sy);
            const specId = this.pickDistrictVehicle(district);
            spawnVehicle(specId, sx, sy, heading, 'traffic', nextId);
          }
        }
      }
    }
  }

  public computeTrafficControl(
    v: VehicleEntity,
    player: PlayerEntity,
    playerSirenActive: boolean,
    vehicles: VehicleEntity[]
  ): VehicleControlInput {
    if (!v.targetNodeId) {
      // Pick closest road node
      let best: RoadNode | null = null;
      let bestD = Infinity;
      for (const node of this.map.roadNodes.values()) {
        const d = (node.x - v.x) ** 2 + (node.y - v.y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = node;
        }
      }
      if (best) v.targetNodeId = best.id;
      return { throttle: 0.35, steer: 0, handbrake: false };
    }

    const target = this.map.roadNodes.get(v.targetNodeId);
    if (!target) {
      v.targetNodeId = undefined;
      return { throttle: 0, steer: 0, handbrake: false };
    }

    const dx = target.x - v.x;
    const dy = target.y - v.y;
    const dist = Math.hypot(dx, dy);

    // Advance to next waypoint on arrival
    if (dist < 14 && target.neighbors.length > 0) {
      // Prefer continuing straight or turning smoothly rather than immediate U-turn
      const fwdX = Math.cos(v.heading);
      const fwdY = Math.sin(v.heading);
      const scored = target.neighbors
        .map((id) => {
          const n = this.map.roadNodes.get(id)!;
          const ndx = n.x - target.x;
          const ndy = n.y - target.y;
          const len = Math.max(1, Math.hypot(ndx, ndy));
          const dot = (ndx / len) * fwdX + (ndy / len) * fwdY;
          return { id, dot };
        })
        .filter((item) => item.dot > -0.5);

      const pool = scored.length > 0 ? scored : target.neighbors.map((id) => ({ id, dot: 0 }));
      v.targetNodeId = pool[Math.floor(Math.random() * pool.length)].id;
    }

    // Offset desired waypoint into right-hand lane
    const desiredHeading = Math.atan2(dy, dx);
    const laneOffsetX = -Math.sin(desiredHeading) * 4.2;
    const laneOffsetY = Math.cos(desiredHeading) * 4.2;

    // Pull aside when player has NYPD / FDNY sirens active nearby!
    let sirenPullAside = false;
    if (playerSirenActive) {
      const distPlayer = Math.hypot(player.x - v.x, player.y - v.y);
      if (distPlayer < 36) {
        sirenPullAside = true;
      }
    }

    const goalX = target.x + laneOffsetX * (sirenPullAside ? 2.1 : 1);
    const goalY = target.y + laneOffsetY * (sirenPullAside ? 2.1 : 1);
    const toGoal = Math.atan2(goalY - v.y, goalX - v.x);
    const angleDiff = normalizeAngle(toGoal - v.heading);
    const steer = Math.max(-1, Math.min(1, angleDiff * 1.8));

    if (sirenPullAside) {
      return { throttle: 0.05, steer: Math.min(1, steer + 0.5), handbrake: true };
    }

    // Stop at red traffic light right before intersection
    if (dist > 14 && dist < 24) {
      const movingNS = Math.abs(Math.sin(v.heading)) > Math.abs(Math.cos(v.heading));
      const redLight = (movingNS && !this.isNSGreen()) || (!movingNS && this.isNSGreen());
      if (redLight) {
        return { throttle: -0.6, steer, handbrake: false };
      }
    }

    // Brake for vehicle or player directly ahead in lane
    const fwdX = Math.cos(v.heading);
    const fwdY = Math.sin(v.heading);
    for (const other of vehicles) {
      if (other.id === v.id || !other.alive) continue;
      const ox = other.x - v.x;
      const oy = other.y - v.y;
      const forwardDist = ox * fwdX + oy * fwdY;
      const sideDist = Math.abs(-ox * fwdY + oy * fwdX);
      if (forwardDist > 1 && forwardDist < 13 && sideDist < 3.0) {
        return { throttle: -0.8, steer, handbrake: false };
      }
    }

    const spec = VEHICLES[v.specId];
    const cruiseSpeed = Math.min(13.5, spec.topSpeedMs * 0.46);
    const throttle = v.speed < cruiseSpeed ? 0.55 : 0.05;
    return { throttle, steer, handbrake: false };
  }

  private pickDistrictVehicle(district: DistrictId): VehicleId {
    const r = Math.random();
    switch (district) {
      case 'financial_district':
        if (r < 0.24) return 'city_sedan';
        if (r < 0.42) return 'metro_cab';
        if (r < 0.58) return 'mobster_v8';
        if (r < 0.70) return 'gangster_ztype';
        if (r < 0.78) return 'compact_bug';
        if (r < 0.85) return 'dons_stretch';
        if (r < 0.90) return 'armored_bank_van';
        if (r < 0.95) return 'mta_bus';
        return 'nypd_cruiser';
      case 'midtown':
        if (r < 0.20) return 'city_sedan';
        if (r < 0.40) return 'metro_cab';
        if (r < 0.56) return 'apex_gt';
        if (r < 0.66) return 'roadster_gt';
        if (r < 0.76) return 'v8_stallion';
        if (r < 0.84) return 'compact_bug';
        if (r < 0.88) return 'ice_cream_van';
        if (r < 0.93) return 'mta_bus';
        if (r < 0.96) return 'fdny_medic';
        return 'nypd_cruiser';
      case 'central_park':
        if (r < 0.20) return 'city_sedan';
        if (r < 0.38) return 'nypd_cruiser';
        if (r < 0.52) return 'compact_bug';
        if (r < 0.66) return 'metro_cab';
        if (r < 0.78) return 'roadster_gt';
        if (r < 0.86) return 'v8_stallion';
        if (r < 0.92) return 'ice_cream_van';
        if (r < 0.96) return 'dons_stretch';
        return 'fdny_medic';
      case 'brooklyn_docks':
        if (r < 0.20) return 'brooklyn_muscle';
        if (r < 0.40) return 'utility_pickup';
        if (r < 0.58) return 'empire_freight';
        if (r < 0.70) return 'garbage_truck';
        if (r < 0.80) return 'city_sedan';
        if (r < 0.86) return 'compact_bug';
        if (r < 0.91) return 'mobster_v8';
        if (r < 0.95) return 'metro_cab';
        if (r < 0.98) return 'fdny_ladder';
        return 'mta_bus';
      case 'queens_expressway':
        if (r < 0.22) return 'empire_freight';
        if (r < 0.38) return 'city_sedan';
        if (r < 0.52) return 'utility_pickup';
        if (r < 0.64) return 'garbage_truck';
        if (r < 0.76) return 'brooklyn_muscle';
        if (r < 0.84) return 'compact_bug';
        if (r < 0.91) return 'mta_bus';
        if (r < 0.96) return 'metro_cab';
        return 'nypd_cruiser';
    }
  }
}

export function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
