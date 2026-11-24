import type { DistrictId, FactionId, Vec2 } from './world.types';
import type { VehicleId, WeaponId } from './entity.types';

export type PayphoneTier = 'green' | 'yellow' | 'red' | 'finale';

export interface PayphoneDef {
  id: string;
  faction: FactionId;
  tier: 'green' | 'yellow' | 'red';
  x: number;
  y: number;
  district: DistrictId;
  missionIds: string[];
  minRespect: number;
}

export type MissionObjectiveType =
  | 'enter_vehicle'
  | 'drive_checkpoints'
  | 'deliver_vehicle'
  | 'kill_targets'
  | 'destroy_props'
  | 'escort_vehicle'
  | 'survive_defense'
  | 'crush_vehicles'
  | 'lose_wanted'
  | 'collect_pickups'
  | 'reach_point';

export interface MissionStageDef {
  id: string;
  description: string;
  type: MissionObjectiveType;
  propType?: 'relay_dish' | 'fuel_tanker';
  targetPos?: Vec2;
  checkpoints?: Vec2[];
  radius?: number;
  vehicleSpecId?: VehicleId;
  minVehicleHpPct?: number; // e.g., 75 for Hot Merchandise
  count?: number;
  timeLimitSec?: number;
  wantedLevel?: number;
  spawnEnemies?: {
    count: number;
    role: 'gang' | 'cop' | 'swat' | 'fbi' | 'boss';
    faction?: FactionId;
    weaponId: WeaponId;
    pos: Vec2;
    spread: number;
    inVehicles?: VehicleId;
  }[];
  grantWeapon?: { weaponId: WeaponId; ammo: number };
  freePayNSpray?: boolean;
  missionTag?: string;
}

export interface MissionDef {
  id: string;
  title: string;
  faction: FactionId | 'all';
  tier: PayphoneTier;
  payphoneId?: string;
  briefing: string;
  completionText: string;
  rewardCash: number;
  respectGain: number;
  rivalRespectLoss: number;
  timeLimitSec?: number; // overall mission timer
  freePayNSpray?: boolean;
  stages: MissionStageDef[];
  spawnStartVehicle?: {
    specId: VehicleId;
    pos: Vec2;
    heading: number;
    tag: string;
  };
}

export interface KillFrenzyDef {
  id: string;
  title: string;
  district: DistrictId;
  x: number;
  y: number;
  weaponId: WeaponId;
  targetType: 'vehicles' | 'gangsters';
  targetCount: number;
  durationSec: number;
  rewardCash: number;
  maxHpBonus: number;
}

export type SideJobType = 'taxi' | 'vigilante' | 'paramedic';

export interface ActiveSideJob {
  type: SideJobType;
  level: number;
  targetPos: Vec2;
  dropoffPos?: Vec2;
  phase: 'pickup' | 'dropoff' | 'eliminate';
  targetEntityId?: string;
  timeLeft: number;
  totalEarned: number;
  description: string;
}

export interface ActiveKillFrenzy {
  def: KillFrenzyDef;
  progress: number;
  timeLeft: number;
  previousWeapon: WeaponId;
}

export interface ActiveMissionState {
  missionId: string;
  def: MissionDef;
  stageIndex: number;
  stageProgress: number;
  stageTargetCount: number;
  stageTimer: number;
  overallTimer: number;
  checkpointIndex: number;
  trackedVehicleId?: string;
  targetEntityIds: string[];
  objectivePos: Vec2 | null;
  objectiveLabel: string;
  freePayNSpray: boolean;
}
