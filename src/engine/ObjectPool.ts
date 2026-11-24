import type {
  DecalEntity,
  DecalKind,
  FirePoolEntity,
  ParticleEntity,
  ParticleKind,
  ProjectileEntity,
  WeaponId,
} from '../types/entity.types';
import type { FactionId } from '../types/world.types';

export class ObjectPool {
  public readonly projectiles: ProjectileEntity[] = [];
  public readonly firePools: FirePoolEntity[] = [];
  public readonly particles: ParticleEntity[] = [];
  public readonly decals: DecalEntity[] = [];

  private projCursor = 0;
  private fireCursor = 0;
  private partCursor = 0;
  private decalCursor = 0;
  private projSeq = 0;

  constructor() {
    for (let i = 0; i < 120; i++) {
      this.projectiles.push({
        active: false,
        id: '',
        ownerId: '',
        weaponId: 'pistol',
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        damage: 0,
        blastRadius: 0,
        life: 0,
        maxLife: 1,
        bounces: 0,
        color: '#fde047',
      });
    }

    for (let i = 0; i < 40; i++) {
      this.firePools.push({
        active: false,
        x: 0,
        y: 0,
        z: 0,
        radius: 5,
        life: 0,
        maxLife: 6,
        ownerId: '',
      });
    }

    for (let i = 0; i < 260; i++) {
      this.particles.push({
        active: false,
        kind: 'smoke_white',
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        size: 1,
        life: 0,
        maxLife: 1,
        color: '#ffffff',
        alpha: 0.8,
      });
    }

    for (let i = 0; i < 180; i++) {
      this.decals.push({
        active: false,
        kind: 'skid',
        x: 0,
        y: 0,
        z: 0,
        rotation: 0,
        width: 0.6,
        length: 1.4,
        alpha: 0.6,
        life: 0,
      });
    }
  }

  public spawnProjectile(params: {
    ownerId: string;
    ownerFaction?: FactionId;
    weaponId: WeaponId;
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz?: number;
    damage: number;
    blastRadius: number;
    life: number;
    color: string;
    isWater?: boolean;
  }): ProjectileEntity {
    const p = this.projectiles[this.projCursor];
    this.projCursor = (this.projCursor + 1) % this.projectiles.length;
    p.active = true;
    p.id = `pr_${this.projSeq++}`;
    p.ownerId = params.ownerId;
    p.ownerFaction = params.ownerFaction;
    p.weaponId = params.weaponId;
    p.x = params.x;
    p.y = params.y;
    p.z = params.z;
    p.vx = params.vx;
    p.vy = params.vy;
    p.vz = params.vz ?? 0;
    p.damage = params.damage;
    p.blastRadius = params.blastRadius;
    p.life = params.life;
    p.maxLife = params.life;
    p.bounces = 0;
    p.color = params.color;
    p.isWater = params.isWater;
    return p;
  }

  public spawnFirePool(
    x: number,
    y: number,
    z: number,
    radius: number,
    life: number,
    ownerId: string
  ): FirePoolEntity {
    const fp = this.firePools[this.fireCursor];
    this.fireCursor = (this.fireCursor + 1) % this.firePools.length;
    fp.active = true;
    fp.x = x;
    fp.y = y;
    fp.z = z;
    fp.radius = radius;
    fp.life = life;
    fp.maxLife = life;
    fp.ownerId = ownerId;
    return fp;
  }

  public spawnParticle(
    kind: ParticleKind,
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    size: number,
    life: number,
    color: string,
    alpha = 0.85
  ): ParticleEntity {
    const pt = this.particles[this.partCursor];
    this.partCursor = (this.partCursor + 1) % this.particles.length;
    pt.active = true;
    pt.kind = kind;
    pt.x = x;
    pt.y = y;
    pt.z = z;
    pt.vx = vx;
    pt.vy = vy;
    pt.vz = vz;
    pt.size = size;
    pt.life = life;
    pt.maxLife = life;
    pt.color = color;
    pt.alpha = alpha;
    return pt;
  }

  public spawnDecal(
    kind: DecalKind,
    x: number,
    y: number,
    z: number,
    rotation: number,
    width: number,
    length: number,
    alpha = 0.55,
    life = 16
  ): DecalEntity {
    const d = this.decals[this.decalCursor];
    this.decalCursor = (this.decalCursor + 1) % this.decals.length;
    d.active = true;
    d.kind = kind;
    d.x = x;
    d.y = y;
    d.z = z;
    d.rotation = rotation;
    d.width = width;
    d.length = length;
    d.alpha = alpha;
    d.life = life;
    return d;
  }

  public updateEffects(dt: number): void {
    const parts = this.particles;
    for (let i = 0; i < parts.length; i++) {
      const pt = parts[i];
      if (!pt.active) continue;
      pt.life -= dt;
      if (pt.life <= 0) {
        pt.active = false;
        continue;
      }
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.z = Math.max(0, pt.z + pt.vz * dt);
      pt.vx *= 0.94;
      pt.vy *= 0.94;
      if (pt.kind === 'smoke_white' || pt.kind === 'smoke_black' || pt.kind === 'explosion') {
        pt.size += dt * (pt.kind === 'explosion' ? 8.5 : 2.2);
      }
    }

    const decals = this.decals;
    for (let i = 0; i < decals.length; i++) {
      const d = decals[i];
      if (!d.active) continue;
      d.life -= dt;
      if (d.life <= 0) d.active = false;
    }
  }

  public clearAll(): void {
    for (let i = 0; i < this.projectiles.length; i++) this.projectiles[i].active = false;
    for (let i = 0; i < this.firePools.length; i++) this.firePools[i].active = false;
    for (let i = 0; i < this.particles.length; i++) this.particles[i].active = false;
    for (let i = 0; i < this.decals.length; i++) this.decals[i].active = false;
  }
}
