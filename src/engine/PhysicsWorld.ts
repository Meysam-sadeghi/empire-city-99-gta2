import RAPIER from '@dimforge/rapier2d-compat';
import type { ChunkData } from '../types/world.types';
import { CHUNK_SIZE, TILE_SIZE, TILES_PER_CHUNK } from '../data/districts.data';
import { TILE_ENUM } from '../data/mapGenerator';

// Collision groups (16-bit membership << 16 | 16-bit filter)
// Bit 0 (0x0001): Layer 0 static buildings
// Bit 1 (0x0002): Layer 0 vehicles & actors
// Bit 2 (0x0004): Layer 1 elevated overpass vehicles & actors
// Bit 3 (0x0008): Layer 0 jumping player (buildings yes, L0 vehicles/peds no)
// Bit 4 (0x0010): Layer 1 jumping player (L1 vehicles/peds no)
const GROUP_STATIC_L0 = 0x0001;
const GROUP_ACTOR_L0 = 0x0002;
const GROUP_ACTOR_L1 = 0x0004;
const GROUP_PLAYER_JUMP_L0 = 0x0008;
const GROUP_PLAYER_JUMP_L1 = 0x0010;

export const COLLISION_STATIC_L0 = (GROUP_STATIC_L0 << 16) | (GROUP_ACTOR_L0 | GROUP_PLAYER_JUMP_L0);
export const COLLISION_ACTOR_L0 = (GROUP_ACTOR_L0 << 16) | (GROUP_STATIC_L0 | GROUP_ACTOR_L0);
export const COLLISION_ACTOR_L1 = (GROUP_ACTOR_L1 << 16) | GROUP_ACTOR_L1;
export const COLLISION_PLAYER_JUMP_L0 = (GROUP_PLAYER_JUMP_L0 << 16) | GROUP_STATIC_L0;
export const COLLISION_PLAYER_JUMP_L1 = GROUP_PLAYER_JUMP_L1 << 16;

export function isCircleOverlappingVehicleOBB(
  cx: number,
  cy: number,
  radius: number,
  vx: number,
  vy: number,
  heading: number,
  halfLength: number,
  halfWidth: number
): boolean {
  const dx = cx - vx;
  const dy = cy - vy;
  const cosH = Math.cos(heading);
  const sinH = Math.sin(heading);
  const localX = dx * cosH + dy * sinH;
  const localY = -dx * sinH + dy * cosH;
  const clampedX = Math.max(-halfLength, Math.min(halfLength, localX));
  const clampedY = Math.max(-halfWidth, Math.min(halfWidth, localY));
  const distX = localX - clampedX;
  const distY = localY - clampedY;
  return distX * distX + distY * distY <= radius * radius;
}

export function computeVehicleOBBEscapeDir(
  cx: number,
  cy: number,
  vx: number,
  vy: number,
  heading: number,
  halfLength: number,
  halfWidth: number
): { x: number; y: number } {
  const dx = cx - vx;
  const dy = cy - vy;
  const cosH = Math.cos(heading);
  const sinH = Math.sin(heading);
  const localX = dx * cosH + dy * sinH;
  const localY = -dx * sinH + dy * cosH;

  let lx = 0;
  let ly = 0;
  if (Math.abs(localX) > halfLength || Math.abs(localY) > halfWidth) {
    const clampedX = Math.max(-halfLength, Math.min(halfLength, localX));
    const clampedY = Math.max(-halfWidth, Math.min(halfWidth, localY));
    const ox = localX - clampedX;
    const oy = localY - clampedY;
    const len = Math.hypot(ox, oy);
    if (len > 1e-5) {
      lx = ox / len;
      ly = oy / len;
    } else {
      ly = localY >= 0 ? 1 : -1;
    }
  } else {
    const penX = halfLength - Math.abs(localX);
    const penY = halfWidth - Math.abs(localY);
    if (penX < penY) {
      lx = localX >= 0 ? 1 : -1;
    } else {
      ly = localY >= 0 ? 1 : -1;
    }
  }

  return {
    x: lx * cosH - ly * sinH,
    y: lx * sinH + ly * cosH,
  };
}

export interface BodyMeta {
  kind: 'building' | 'prop' | 'vehicle' | 'ped' | 'player';
  id: string;
}

export interface VehicleContactImpact {
  vehicleId: string;
  otherKind: BodyMeta['kind'];
  otherId: string;
  deltaV: number;
  impactX: number;
  impactY: number;
}

export class PhysicsWorld {
  public world!: RAPIER.World;
  private eventQueue: RAPIER.EventQueue | null = null;
  private initialized = false;
  private chunkStaticColliders = new Map<string, number[]>();
  private colliderMeta = new Map<number, BodyMeta>();
  private bodyMeta = new Map<number, BodyMeta>();
  private playerColliderHandle: number | null = null;
  private playerJumping = false;

  public async init(): Promise<void> {
    if (this.initialized) return;
    await RAPIER.init();
    this.world = new RAPIER.World({ x: 0, y: 0 });
    this.world.timestep = 1 / 60;
    this.eventQueue = new RAPIER.EventQueue(true);
    this.initialized = true;
  }

  public step(): void {
    if (!this.initialized) return;
    if (this.eventQueue) {
      this.world.step(this.eventQueue);
    } else {
      this.world.step();
    }
  }

  public drainVehicleImpacts(minDeltaV = 4.5): VehicleContactImpact[] {
    if (!this.initialized || !this.eventQueue) return [];
    const impacts: VehicleContactImpact[] = [];
    const dt = this.world.timestep || 1 / 60;

    const recordSide = (
      vehMeta: BodyMeta,
      otherMeta: BodyMeta,
      vehColHandle: number,
      otherColHandle: number,
      forceMag: number
    ): void => {
      if (vehMeta.kind !== 'vehicle') return;
      if (otherMeta.kind === 'ped' || otherMeta.kind === 'player') return;
      const vehCol = this.world.getCollider(vehColHandle);
      const otherCol = this.world.getCollider(otherColHandle);
      if (!vehCol || !otherCol) return;
      const body = vehCol.parent();
      if (!body) return;
      const mass = Math.max(0.5, body.mass());
      const deltaV = (forceMag * dt) / mass;
      if (deltaV < minDeltaV) return;

      const t = body.translation();
      const rot = body.rotation();
      const cosR = Math.cos(rot);
      const sinR = Math.sin(rot);
      let impactX = t.x;
      let impactY = t.y;

      this.world.contactPair(vehCol, otherCol, (manifold, flipped) => {
        if (manifold.numContacts() > 0) {
          const localPt = flipped ? manifold.localContactPoint2(0) : manifold.localContactPoint1(0);
          if (localPt) {
            impactX = t.x + localPt.x * cosR - localPt.y * sinR;
            impactY = t.y + localPt.x * sinR + localPt.y * cosR;
          }
        }
      });

      impacts.push({
        vehicleId: vehMeta.id,
        otherKind: otherMeta.kind,
        otherId: otherMeta.id,
        deltaV,
        impactX,
        impactY,
      });
    };

    this.eventQueue.drainContactForceEvents((ev) => {
      const h1 = ev.collider1();
      const h2 = ev.collider2();
      const m1 = this.colliderMeta.get(h1);
      const m2 = this.colliderMeta.get(h2);
      if (!m1 || !m2) return;
      const forceMag = ev.totalForceMagnitude();
      recordSide(m1, m2, h1, h2, forceMag);
      recordSide(m2, m1, h2, h1, forceMag);
    });

    return impacts;
  }

  public mountChunk(chunk: ChunkData): void {
    if (this.chunkStaticColliders.has(chunk.key)) return;
    const handles: number[] = [];

    for (const b of chunk.buildings) {
      const colDesc = RAPIER.ColliderDesc.cuboid(b.w * 0.5, b.h * 0.5)
        .setTranslation(b.x, b.y)
        .setFriction(0.2)
        .setRestitution(0.15)
        .setCollisionGroups(COLLISION_STATIC_L0);
      const col = this.world.createCollider(colDesc);
      handles.push(col.handle);
      this.colliderMeta.set(col.handle, { kind: 'building', id: b.id });
    }

    const baseX = chunk.cx * CHUNK_SIZE;
    const baseY = chunk.cy * CHUNK_SIZE;
    for (const p of chunk.props) {
      if (p.type === 'neon_cross' || p.type === 'fuel_tanker' || p.type === 'relay_dish') {
        continue;
      }
      const tx = Math.floor((p.x - baseX) / TILE_SIZE);
      const ty = Math.floor((p.y - baseY) / TILE_SIZE);
      if (tx < 0 || tx >= TILES_PER_CHUNK || ty < 0 || ty >= TILES_PER_CHUNK) {
        continue;
      }
      const idx = ty * TILES_PER_CHUNK + tx;
      if (chunk.roadMask[idx] !== 0 || chunk.overpassTiles[idx] !== 0) {
        continue;
      }
      const tile = chunk.tiles[idx];
      if (
        tile === TILE_ENUM.water ||
        tile === TILE_ENUM.bridge ||
        tile === TILE_ENUM.pier ||
        tile === TILE_ENUM.building ||
        tile === TILE_ENUM.facility_pad ||
        tile === TILE_ENUM.road_ns ||
        tile === TILE_ENUM.road_ew ||
        tile === TILE_ENUM.intersection ||
        tile === TILE_ENUM.crosswalk_ns ||
        tile === TILE_ENUM.crosswalk_ew ||
        tile === TILE_ENUM.broadway ||
        tile === TILE_ENUM.ramp_ns ||
        tile === TILE_ENUM.ramp_ew ||
        tile === TILE_ENUM.overpass
      ) {
        continue;
      }

      let colDesc: RAPIER.ColliderDesc | null = null;
      if (p.type === 'tree') {
        colDesc = RAPIER.ColliderDesc.ball(0.65);
      } else if (p.type === 'crane') {
        colDesc = RAPIER.ColliderDesc.cuboid(1.7, 1.7);
      } else if (p.type === 'streetlamp') {
        colDesc = RAPIER.ColliderDesc.ball(0.35);
      } else if (p.type === 'traffic_light') {
        colDesc = RAPIER.ColliderDesc.ball(0.4);
      } else if (p.type === 'bus_shelter') {
        colDesc = RAPIER.ColliderDesc.ball(1.1);
      } else if (p.type === 'payphone_booth') {
        colDesc = RAPIER.ColliderDesc.ball(0.65);
      }
      if (!colDesc) continue;

      colDesc
        .setTranslation(p.x, p.y)
        .setFriction(0.25)
        .setRestitution(0.15)
        .setCollisionGroups(COLLISION_STATIC_L0);
      const col = this.world.createCollider(colDesc);
      handles.push(col.handle);
      this.colliderMeta.set(col.handle, { kind: 'prop', id: p.id });
    }

    this.chunkStaticColliders.set(chunk.key, handles);
  }

  public unmountChunk(chunkKey: string): void {
    const handles = this.chunkStaticColliders.get(chunkKey);
    if (!handles) return;
    for (const h of handles) {
      const col = this.world.getCollider(h);
      if (col) {
        this.world.removeCollider(col, false);
      }
      this.colliderMeta.delete(h);
    }
    this.chunkStaticColliders.delete(chunkKey);
  }

  public createVehicleBody(
    id: string,
    x: number,
    y: number,
    heading: number,
    length: number,
    width: number,
    mass: number,
    layer: 0 | 1 = 0
  ): { bodyHandle: number; colliderHandle: number } {
    const rbDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y)
      .setRotation(heading)
      .setLinearDamping(0.45)
      .setAngularDamping(3.2)
      .setCcdEnabled(true);
    const body = this.world.createRigidBody(rbDesc);

    // Cuboid half extents: length along local X (heading=0), width along local Y
    const area = Math.max(1, length * width);
    const colDesc = RAPIER.ColliderDesc.cuboid(length * 0.48, width * 0.46)
      .setDensity(mass / area)
      .setFriction(0.15)
      .setRestitution(0.22)
      .setCollisionGroups(layer === 1 ? COLLISION_ACTOR_L1 : COLLISION_ACTOR_L0)
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(100);

    const col = this.world.createCollider(colDesc, body);
    const meta: BodyMeta = { kind: 'vehicle', id };
    this.bodyMeta.set(body.handle, meta);
    this.colliderMeta.set(col.handle, meta);
    return { bodyHandle: body.handle, colliderHandle: col.handle };
  }

  public createCharacterBody(
    kind: 'player' | 'ped',
    id: string,
    x: number,
    y: number,
    radius = 0.65,
    layer: 0 | 1 = 0
  ): { bodyHandle: number; colliderHandle: number } {
    const rbDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y)
      .lockRotations()
      .setLinearDamping(8.0);
    const body = this.world.createRigidBody(rbDesc);

    const colDesc = RAPIER.ColliderDesc.ball(radius)
      .setDensity(1.0)
      .setFriction(0.1)
      .setRestitution(0.05)
      .setCollisionGroups(layer === 1 ? COLLISION_ACTOR_L1 : COLLISION_ACTOR_L0);
    const col = this.world.createCollider(colDesc, body);

    const meta: BodyMeta = { kind, id };
    this.bodyMeta.set(body.handle, meta);
    this.colliderMeta.set(col.handle, meta);
    if (kind === 'player') {
      this.playerColliderHandle = col.handle;
      this.playerJumping = false;
    }
    return { bodyHandle: body.handle, colliderHandle: col.handle };
  }

  public setColliderLayer(colliderHandle: number, layer: 0 | 1): void {
    const col = this.world.getCollider(colliderHandle);
    if (!col) return;
    if (colliderHandle === this.playerColliderHandle && this.playerJumping) {
      col.setCollisionGroups(layer === 1 ? COLLISION_PLAYER_JUMP_L1 : COLLISION_PLAYER_JUMP_L0);
      return;
    }
    col.setCollisionGroups(layer === 1 ? COLLISION_ACTOR_L1 : COLLISION_ACTOR_L0);
  }

  public setPlayerJumping(jumping: boolean, layer: 0 | 1): void {
    this.playerJumping = jumping;
    if (this.playerColliderHandle === null) return;
    const col = this.world.getCollider(this.playerColliderHandle);
    if (!col) return;
    if (jumping) {
      col.setCollisionGroups(layer === 1 ? COLLISION_PLAYER_JUMP_L1 : COLLISION_PLAYER_JUMP_L0);
    } else {
      col.setCollisionGroups(layer === 1 ? COLLISION_ACTOR_L1 : COLLISION_ACTOR_L0);
    }
  }

  public isPlayerJumpCollisionActive(): boolean {
    return this.playerJumping;
  }

  public setBodyEnabled(bodyHandle: number, enabled: boolean): void {
    const body = this.world.getRigidBody(bodyHandle);
    if (body) body.setEnabled(enabled);
  }

  public removeBody(bodyHandle: number, colliderHandle?: number): void {
    if (colliderHandle !== undefined) {
      if (colliderHandle === this.playerColliderHandle) {
        this.playerColliderHandle = null;
        this.playerJumping = false;
      }
      this.colliderMeta.delete(colliderHandle);
    } else if (this.bodyMeta.get(bodyHandle)?.kind === 'player') {
      this.playerColliderHandle = null;
      this.playerJumping = false;
    }
    this.bodyMeta.delete(bodyHandle);
    const body = this.world.getRigidBody(bodyHandle);
    if (body) {
      this.world.removeRigidBody(body);
    }
  }

  public getBody(bodyHandle: number): RAPIER.RigidBody | null {
    return this.world.getRigidBody(bodyHandle) ?? null;
  }

  public teleportBody(bodyHandle: number, x: number, y: number, heading?: number): void {
    const body = this.world.getRigidBody(bodyHandle);
    if (!body) return;
    body.setTranslation({ x, y }, true);
    body.setLinvel({ x: 0, y: 0 }, true);
    body.setAngvel(0, true);
    if (heading !== undefined) {
      body.setRotation(heading, true);
    }
  }

  public castRay(
    ox: number,
    oy: number,
    dx: number,
    dy: number,
    maxDist: number,
    excludeColliderHandle?: number,
    layer: 0 | 1 = 0
  ): { dist: number; x: number; y: number; meta: BodyMeta | null } | null {
    const ray = new RAPIER.Ray({ x: ox, y: oy }, { x: dx, y: dy });
    const filterGroups = layer === 1 ? COLLISION_ACTOR_L1 : COLLISION_ACTOR_L0;
    const hit = this.world.castRay(
      ray,
      maxDist,
      true,
      undefined,
      filterGroups,
      excludeColliderHandle !== undefined ? this.world.getCollider(excludeColliderHandle) ?? undefined : undefined
    );
    if (!hit) return null;
    const dist = hit.timeOfImpact;
    return {
      dist,
      x: ox + dx * dist,
      y: oy + dy * dist,
      meta: this.colliderMeta.get(hit.collider.handle) ?? null,
    };
  }

  public hasLineOfSight(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    layer: 0 | 1 = 0
  ): boolean {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dist = Math.hypot(dx, dy);
    if (dist < 1) return true;
    const hit = this.castRay(x1, y1, dx / dist, dy / dist, dist - 1.5, undefined, layer);
    if (!hit) return true;
    return hit.meta?.kind !== 'building';
  }

  public applyExplosionImpulse(cx: number, cy: number, radius: number, strength: number): void {
    this.world.forEachRigidBody((body) => {
      if (!body.isDynamic() || !body.isEnabled()) return;
      const pos = body.translation();
      const dx = pos.x - cx;
      const dy = pos.y - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > 0.1 && dist < radius) {
        const falloff = 1 - dist / radius;
        const imp = strength * falloff;
        body.applyImpulse({ x: (dx / dist) * imp, y: (dy / dist) * imp }, true);
      }
    });
  }

  public getRigidBodyCount(): number {
    return this.initialized ? this.world.bodies.len() : 0;
  }
}
