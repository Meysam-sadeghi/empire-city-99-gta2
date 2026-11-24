import type { VehicleEntity } from '../types/entity.types';
import type { WorldMapData } from '../types/world.types';
import { VEHICLES } from '../data/vehicles.data';
import { getOverpassElevationAt, isWaterAt } from '../data/mapGenerator';
import { PhysicsWorld } from './PhysicsWorld';
import { ObjectPool } from './ObjectPool';

export interface VehicleControlInput {
  throttle: number; // -1..1
  steer: number; // -1 (left) .. 1 (right)
  handbrake: boolean;
}

export class VehiclePhysics {
  private physics: PhysicsWorld;
  private pool: ObjectPool;
  private map: WorldMapData;
  private skidAccum = 0;

  constructor(physics: PhysicsWorld, pool: ObjectPool, map: WorldMapData) {
    this.physics = physics;
    this.pool = pool;
    this.map = map;
  }

  public static syncDamageStage(v: VehicleEntity): void {
    if (v.damageStage === 'wrecked') return;
    const hpPct = (v.hp / v.maxHp) * 100;
    if (hpPct <= 0) return;
    if (hpPct < 30) {
      v.damageStage = 'burning';
    } else if (hpPct < 60) {
      v.damageStage = 'dented';
      v.burnTimer = 5.0;
    } else {
      v.damageStage = 'clean';
      v.burnTimer = 5.0;
    }
  }

  public updateVehicle(
    v: VehicleEntity,
    input: VehicleControlInput,
    dt: number,
    onExplode: (v: VehicleEntity) => void,
    onWaterSubmerge: (v: VehicleEntity) => void,
    skipZeroHpExplode = false
  ): void {
    const body = this.physics.getBody(v.bodyHandle);
    if (!body || !v.alive) return;

    const spec = VEHICLES[v.specId];
    const pos = body.translation();
    const rot = body.rotation();
    const linvel = body.linvel();

    v.x = pos.x;
    v.y = pos.y;
    v.heading = rot;

    // 1. Update Queens Expressway overpass multi-level elevation & Rapier collision layer
    const ov = getOverpassElevationAt(v.x, v.y, this.map.overpasses);
    if (ov.onRamp) {
      v.z = ov.elevation;
      const nextLayer: 0 | 1 = ov.elevation > 2.6 ? 1 : 0;
      if (nextLayer !== v.layer) {
        v.layer = nextLayer;
        this.physics.setColliderLayer(v.colliderHandle, nextLayer);
      }
    } else if (ov.onDeck && v.layer === 1) {
      v.z = ov.elevation;
    } else if (!ov.onDeck && v.layer === 1) {
      // Drove off side of overpass — drop back to layer 0!
      v.layer = 0;
      v.z = Math.max(0, v.z - dt * 18);
      this.physics.setColliderLayer(v.colliderHandle, 0);
    } else {
      v.z = Math.max(0, v.z - dt * 18);
    }

    // 2. Check deep water hazard (East River, Harbor, Central Park Lake)
    if (isWaterAt(this.map, v.x, v.y, v.layer)) {
      v.waterImmersionTimer += dt;
      body.setLinvel({ x: linvel.x * 0.88, y: linvel.y * 0.88 }, true);
      if (v.waterImmersionTimer > 0.45) {
        onWaterSubmerge(v);
        return;
      }
    } else {
      v.waterImmersionTimer = 0;
    }

    // 3. Local forward & lateral velocity decomposition
    const fwdX = Math.cos(v.heading);
    const fwdY = Math.sin(v.heading);
    const rightX = -fwdY;
    const rightY = fwdX;

    let forwardVel = linvel.x * fwdX + linvel.y * fwdY;
    let lateralVel = linvel.x * rightX + linvel.y * rightY;

    // Damage stage top-speed cap (59-30% -> -15% speed, wrecked -> immobile)
    let topSpeed = spec.topSpeedMs;
    if (v.damageStage === 'dented') topSpeed *= 0.85;
    else if (v.damageStage === 'burning') topSpeed *= 0.72;
    else if (v.damageStage === 'wrecked') topSpeed = 0;

    const canDrive = v.damageStage !== 'wrecked' && v.driverId !== null;
    v.braking = false;
    v.drifting = false;

    if (canDrive) {
      const accel = spec.acceleration * 4.2;
      if (input.throttle > 0.05) {
        if (forwardVel < -0.25) {
          v.braking = true;
          const nextVel = forwardVel + spec.brakeForce * 2.2 * dt;
          forwardVel = nextVel > 0 ? Math.min(topSpeed, nextVel * 0.4) : nextVel;
        } else if (forwardVel < topSpeed) {
          forwardVel = Math.min(topSpeed, forwardVel + accel * input.throttle * dt);
        }
      } else if (input.throttle < -0.05) {
        const maxRev = -topSpeed * 0.38;
        if (forwardVel > 0.25) {
          v.braking = true;
          const nextVel = forwardVel - spec.brakeForce * 2.5 * dt;
          forwardVel = nextVel < 0 ? Math.max(maxRev, nextVel * 0.4) : nextVel;
        } else {
          forwardVel = Math.max(maxRev, forwardVel + accel * 0.65 * input.throttle * dt);
        }
      } else {
        // Coasting rolling drag
        forwardVel *= Math.pow(0.28, dt);
      }

      if (input.handbrake) {
        v.braking = true;
        forwardVel *= Math.pow(0.42, dt);
      }

      // Speed-sensitive steering (immediate response from 0 m/s when throttling, smooth coast & high-speed stability)
      const speedAbs = Math.abs(forwardVel);
      const hasThrottle = Math.abs(input.throttle) > 0.05;
      if (Math.abs(input.steer) > 0.02 && (speedAbs > 0.15 || hasThrottle)) {
        const dirSign =
          forwardVel > 0.1
            ? 1
            : forwardVel < -0.1
              ? -1
              : input.throttle < -0.05
                ? -1
                : 1;
        const effectiveSpeed = hasThrottle ? Math.max(speedAbs, 2.8) : speedAbs;
        const lowSpeedGain = Math.min(1, effectiveSpeed / 5.5);
        const highSpeedDamp = 1 - Math.min(0.32, (speedAbs / (topSpeed + 1)) * 0.35);
        const speedFactor = lowSpeedGain * highSpeedDamp;
        const driftBoost = input.handbrake ? 1.38 + spec.driftFactor * 0.45 : 1.0;
        const turnRate = (2.75 + spec.driftFactor * 0.75) * speedFactor * driftBoost;
        body.setAngvel(input.steer * turnRate * dirSign, true);
        v.steerAngle = input.steer * 0.45;
      } else {
        body.setAngvel(body.angvel() * 0.75, true);
        v.steerAngle = 0;
      }
    } else {
      // Unoccupied / wrecked vehicle slows smoothly to stop
      forwardVel *= Math.pow(0.15, dt);
      body.setAngvel(body.angvel() * 0.8, true);
      v.steerAngle = 0;
    }

    // 4. Arcade-Drift Lateral Velocity Cancellation:
    // Normal grip cancels 88% of sideways velocity per step -> retains 12% (smoothed for 60Hz)
    // Handbrake drops lateral grip to 35% -> retains 65% sideways slip for long smoky NYC drifts!
    const gripCancel = input.handbrake && canDrive
      ? Math.max(0.22, 0.35 - spec.driftFactor * 0.14)
      : 0.88;
    const lateralRetention = 1 - gripCancel;
    // Scale retention smoothly per 60Hz frame
    lateralVel *= Math.pow(lateralRetention, dt * 60 * 0.28);

    const newVx = fwdX * forwardVel + rightX * lateralVel;
    const newVy = fwdY * forwardVel + rightY * lateralVel;
    body.setLinvel({ x: newVx, y: newVy }, true);

    v.vx = newVx;
    v.vy = newVy;
    v.speed = forwardVel;
    v.angularVelocity = body.angvel();

    // 5. Tire skid decals & drift smoke particles
    const latSpeed = Math.abs(lateralVel);
    if (canDrive && (latSpeed > 3.6 || (input.handbrake && Math.abs(forwardVel) > 5.5))) {
      v.drifting = true;
      this.skidAccum += dt;
      if (this.skidAccum >= 0.03) {
        this.skidAccum = 0;
        const rearX = v.x - fwdX * (spec.length * 0.38);
        const rearY = v.y - fwdY * (spec.length * 0.38);
        const off = spec.width * 0.34;
        this.pool.spawnDecal('skid', rearX + rightX * off, rearY + rightY * off, v.z, v.heading, 0.35, 1.2, 0.45, 14);
        this.pool.spawnDecal('skid', rearX - rightX * off, rearY - rightY * off, v.z, v.heading, 0.35, 1.2, 0.45, 14);

        this.pool.spawnParticle(
          'smoke_white',
          rearX,
          rearY,
          v.z + 0.2,
          (Math.random() - 0.5) * 2,
          (Math.random() - 0.5) * 2,
          1.2,
          0.9,
          0.45,
          '#e2e8f0',
          0.48
        );
      }
    }

    // 6. Damage state updates, engine smoke/fire & 5-second catastrophic explosion countdown
    const hpPct = (v.hp / v.maxHp) * 100;
    if (v.damageStage !== 'wrecked') {
      if (hpPct <= 0 && !skipZeroHpExplode) {
        onExplode(v);
        return;
      } else if (hpPct < 30) {
        v.damageStage = 'burning';
        v.burnTimer -= dt;
        if (Math.random() < 0.45) {
          const hoodX = v.x + fwdX * (spec.length * 0.35);
          const hoodY = v.y + fwdY * (spec.length * 0.35);
          this.pool.spawnParticle(
            'smoke_black',
            hoodX,
            hoodY,
            v.z + 0.6,
            (Math.random() - 0.5) * 1.6,
            (Math.random() - 0.5) * 1.6,
            2.4,
            1.3,
            0.7,
            '#18181b',
            0.75
          );
          this.pool.spawnParticle(
            'flame',
            hoodX,
            hoodY,
            v.z + 0.7,
            (Math.random() - 0.5) * 1.2,
            (Math.random() - 0.5) * 1.2,
            1.8,
            1.1,
            0.3,
            '#f97316',
            0.9
          );
        }
        if (v.burnTimer <= 0 && !skipZeroHpExplode) {
          v.hp = 0;
          onExplode(v);
          return;
        }
      } else if (hpPct < 60) {
        VehiclePhysics.syncDamageStage(v);
        if (Math.random() < 0.2) {
          const hoodX = v.x + fwdX * (spec.length * 0.35);
          const hoodY = v.y + fwdY * (spec.length * 0.35);
          this.pool.spawnParticle(
            'smoke_white',
            hoodX,
            hoodY,
            v.z + 0.5,
            (Math.random() - 0.5) * 1.2,
            (Math.random() - 0.5) * 1.2,
            1.8,
            0.95,
            0.65,
            '#cbd5e1',
            0.55
          );
        }
      } else {
        VehiclePhysics.syncDamageStage(v);
      }
    }

    // Clamp world boundaries safely
    if (v.x < 12 || v.x > this.map.worldSize - 12 || v.y < 12 || v.y > this.map.worldSize - 12) {
      const clampedX = Math.max(16, Math.min(this.map.worldSize - 16, v.x));
      const clampedY = Math.max(16, Math.min(this.map.worldSize - 16, v.y));
      this.physics.teleportBody(v.bodyHandle, clampedX, clampedY, v.heading);
    }
  }
}
