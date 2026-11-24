import type { DistrictId, FactionId, Vec2 } from './world.types';

export type WeaponId =
  | 'fists'
  | 'pistol'
  | 'dual_uzis'
  | 'shotgun'
  | 'm4'
  | 'molotov'
  | 'grenade'
  | 'flamethrower'
  | 'rpg';

export type WeaponCategory = 'melee' | 'hitscan' | 'spread' | 'thrown' | 'flame' | 'rocket';

export interface WeaponSpec {
  id: WeaponId;
  name: string;
  shortName: string;
  category: WeaponCategory;
  damage: number;
  fireRate: number; // rounds per second
  range: number; // meters
  spreadRad: number;
  pellets: number;
  projectileSpeed: number; // m/s (0 for melee)
  blastRadius: number;
  ammoPerPickup: number;
  maxAmmo: number;
  infiniteAmmo: boolean;
  driveByAllowed: boolean;
  knockback: number;
  color: string;
  soundType: WeaponId;
}

export type VehicleId =
  | 'metro_cab'
  | 'mobster_v8'
  | 'apex_gt'
  | 'brooklyn_muscle'
  | 'v8_stallion'
  | 'dons_stretch'
  | 'nypd_cruiser'
  | 'nypd_swat'
  | 'fbi_suv'
  | 'fdny_medic'
  | 'fdny_ladder'
  | 'empire_freight'
  | 'mta_bus'
  | 'rhino_apc'
  | 'city_sedan'
  | 'compact_bug'
  | 'gangster_ztype'
  | 'armored_bank_van'
  | 'garbage_truck'
  | 'ice_cream_van'
  | 'utility_pickup'
  | 'roadster_gt';

export type VehicleClass =
  | 'Civilian'
  | 'Gang'
  | 'Sports'
  | 'Muscle'
  | 'Luxury'
  | 'Police'
  | 'Gov'
  | 'Emergency'
  | 'Commercial'
  | 'Transit'
  | 'Military';

export interface VehicleSpec {
  id: VehicleId;
  name: string;
  vehicleClass: VehicleClass;
  topSpeedKmh: number;
  topSpeedMs: number;
  acceleration: number;
  brakeForce: number;
  driftFactor: number;
  maxHp: number;
  mass: number;
  width: number; // meters
  length: number; // meters
  baseColors: string[];
  accentColor: string;
  hasSiren: boolean;
  sirenStyle?: 'police' | 'fdny' | 'fbi';
  specialWeapon?: 'tank_cannon' | 'water_cannon';
  crusherValue: number;
  spawnDistricts: DistrictId[];
  gangOwner?: FactionId;
  bulletResistant?: boolean;
  crushOnContact?: boolean;
  healOnEnter?: number;
  sideJob?: 'taxi' | 'vigilante' | 'paramedic';
}

export type VehicleDamageStage = 'clean' | 'dented' | 'burning' | 'wrecked';

export interface VehicleEntity {
  id: string;
  specId: VehicleId;
  x: number;
  y: number;
  z: number; // elevation height (0 or 6 for overpass)
  layer: 0 | 1;
  heading: number;
  vx: number;
  vy: number;
  speed: number; // m/s signed forward speed
  angularVelocity: number;
  steerAngle: number;
  hp: number;
  maxHp: number;
  damageStage: VehicleDamageStage;
  burnTimer: number; // 5s countdown when HP 1-29%
  color: string;
  sirenActive: boolean;
  headlightsOn: boolean;
  braking: boolean;
  drifting: boolean;
  driverId: string | null; // 'player' or ped id
  isMissionEntity: boolean;
  missionTag?: string;
  aiRole: 'none' | 'traffic' | 'police' | 'swat' | 'fbi' | 'army' | 'gang' | 'escort' | 'target' | 'ambush';
  faction?: FactionId;
  targetNodeId?: string;
  aiCooldown: number;
  turretHeading: number; // for rhino_apc / fdny_ladder
  waterImmersionTimer: number;
  bodyHandle: number;
  colliderHandle: number;
  spawnProtected: boolean;
  alive: boolean;
}

export type PedRole =
  | 'civilian'
  | 'gang'
  | 'cop'
  | 'swat'
  | 'fbi'
  | 'army'
  | 'boss'
  | 'target'
  | 'ally';

export type PedAIState = 'wander' | 'flee' | 'chase' | 'attack' | 'cover' | 'dead';

export interface PedEntity {
  id: string;
  role: PedRole;
  faction?: FactionId;
  x: number;
  y: number;
  z: number;
  layer: 0 | 1;
  heading: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  weaponId: WeaponId;
  fireCooldown: number;
  aiState: PedAIState;
  walkPhase: number;
  shirtColor: string;
  pantsColor: string;
  vehicleId: string | null;
  isMissionEntity: boolean;
  missionTag?: string;
  onFireTimer: number;
  stateTimer: number;
  wanderAngle: number;
  bodyHandle: number;
  colliderHandle: number;
  alive: boolean;
  deathTimer: number;
}

export interface PlayerEntity {
  x: number;
  y: number;
  z: number;
  layer: 0 | 1;
  heading: number;
  vx: number;
  vy: number;
  vz: number;
  jumpHeight: number;
  isJumping: boolean;
  jumpCooldown: number;
  hp: number;
  maxHp: number;
  armor: number;
  maxArmor: number;
  stamina: number;
  maxStamina: number;
  cash: number;
  totalCashEarned: number;
  multiplier: number; // 1..5
  multiplierProgress: number;
  multiplierDecayTimer: number;
  wantedStars: number; // 0..6
  heatScore: number;
  evasionTimer: number;
  evasionTarget: number;
  policeLineOfSight: boolean;
  vehicleId: string | null;
  weapons: Record<WeaponId, number>; // ammo count (-1 for infinite)
  ownedWeapons: WeaponId[];
  activeWeapon: WeaponId;
  fireCooldown: number;
  walkPhase: number;
  onFireTimer: number;
  godMode: boolean;
  respawnTimer: number;
  status: 'alive' | 'wasted' | 'busted';
  bodyHandle: number;
  colliderHandle: number;
  autoAimTargetId: string | null;
  autoAimPos: Vec2 | null;
}

export type PickupType = 'weapon' | 'health' | 'armor' | 'bribe' | 'cash' | 'kill_frenzy';

export interface PickupEntity {
  id: string;
  type: PickupType;
  x: number;
  y: number;
  z: number;
  weaponId?: WeaponId;
  amount: number;
  killFrenzyId?: string;
  active: boolean;
  respawnTimer: number;
  bobPhase: number;
}

export interface ProjectileEntity {
  active: boolean;
  id: string;
  ownerId: string;
  ownerFaction?: FactionId;
  weaponId: WeaponId;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  damage: number;
  blastRadius: number;
  life: number;
  maxLife: number;
  bounces: number;
  color: string;
  isWater?: boolean;
}

export interface FirePoolEntity {
  active: boolean;
  x: number;
  y: number;
  z: number;
  radius: number;
  life: number;
  maxLife: number;
  ownerId: string;
}

export type ParticleKind = 'smoke_white' | 'smoke_black' | 'flame' | 'spark' | 'blood' | 'explosion' | 'water' | 'shell';

export interface ParticleEntity {
  active: boolean;
  kind: ParticleKind;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
  life: number;
  maxLife: number;
  color: string;
  alpha: number;
}

export type DecalKind = 'skid' | 'scorch' | 'blood' | 'crater';

export interface DecalEntity {
  active: boolean;
  kind: DecalKind;
  x: number;
  y: number;
  z: number;
  rotation: number;
  width: number;
  length: number;
  alpha: number;
  life: number;
}

export interface RoadblockEntity {
  id: string;
  x: number;
  y: number;
  heading: number;
  hasSpikes: boolean;
  vehicleIds: string[];
  copIds: string[];
  life: number;
}
