import type { DistrictId, FactionId, Vec2 } from './world.types';
import type { VehicleId, WeaponId } from './entity.types';
import type { PayphoneTier } from './mission.types';
import type { LightingMode } from '../renderer/LightingSystem';

export type { LightingMode };

export type RadioStationId = 'off' | 'head_radio' | 'funk_fm' | 'neon_synth_99';

export type ControlMode = 'directional' | 'tank';

export type GameDifficultyMode = 'casual' | 'classic';

export type GameMode = 'story' | 'frenzy' | 'freeroam';

export type UIScreen = 'title' | 'playing' | 'paused' | 'map' | 'journal' | 'victory';

export interface IncidentSummary {
  kind: 'wasted' | 'busted';
  facilityName: string;
  feeDeducted: number;
  multiplierLost: number;
  weaponsConfiscated: WeaponId[];
  countdownSec: number;
  canSkip: boolean;
}

export interface FloatingCashPopup {
  id: number;
  amount: number;
  label?: string;
  timestamp: number;
}

export interface PagerMessage {
  id: number;
  text: string;
  tone: 'green' | 'amber' | 'red' | 'cyan';
  expiresAt: number;
}

export interface MinimapBlip {
  x: number;
  y: number;
  type:
    | 'player'
    | 'objective'
    | 'payphone'
    | 'pay_n_spray'
    | 'car_crusher'
    | 'chapel'
    | 'cop'
    | 'enemy'
    | 'kill_frenzy'
    | 'vehicle'
    | 'boss';
  color: string;
  pulse?: boolean;
  heading?: number;
  label?: string;
}

export interface TelemetrySnapshot {
  fps: number;
  rigidBodies: number;
  activeChunks: number;
  totalChunks: number;
  drawCalls: number;
  activeVehicles: number;
  activePeds: number;
  playerX: number;
  playerY: number;
  playerLayer: 0 | 1;
}

export interface HudSnapshot {
  screen: UIScreen;
  gameMode: GameDifficultyMode;
  playMode: GameMode;
  lightingMode: LightingMode;
  controlMode: ControlMode;
  playerStatus: 'alive' | 'wasted' | 'busted';
  statusBanner: string | null;
  incidentSummary: IncidentSummary | null;
  hp: number;
  maxHp: number;
  armor: number;
  maxArmor: number;
  stamina: number;
  maxStamina: number;
  cash: number;
  totalCashEarned: number;
  multiplier: number;
  wantedStars: number;
  wantedFlashing: boolean;
  respect: Record<FactionId, number>;
  activeWeapon: WeaponId;
  activeWeaponName: string;
  activeWeaponAmmo: number; // -1 infinite
  ownedWeapons: WeaponId[];
  weaponAmmo: Record<WeaponId, number>;
  inVehicle: boolean;
  vehicleName: string | null;
  vehicleSpecId: VehicleId | null;
  vehicleSpeedKmh: number;
  vehicleHpPct: number;
  vehicleSiren: boolean;
  vehicleSideJobEligible: 'taxi' | 'vigilante' | 'paramedic' | null;
  districtId: DistrictId;
  districtName: string;
  districtSubtitle: string;
  districtFaction: FactionId | null;
  radioStation: RadioStationId;
  radioLabel: string;
  gpsTarget: Vec2 | null;
  gpsAngleRad: number | null; // relative screen angle pointing from player to target
  gpsDistanceM: number | null;
  gpsLabel: string | null;
  activeMission: {
    id: string;
    title: string;
    briefing: string;
    tier: PayphoneTier;
    rewardCash: number;
    stageIndex: number;
    totalStages: number;
    objective: string;
    progressText: string | null;
    timerSec: number | null;
    faction: FactionId | 'all';
  } | null;
  activeKillFrenzy: {
    title: string;
    progress: number;
    target: number;
    timeLeft: number;
  } | null;
  activeSideJob: {
    type: 'taxi' | 'vigilante' | 'paramedic';
    level: number;
    description: string;
    timeLeft: number;
  } | null;
  nearbyPrompt: string | null;
  pagerMessages: PagerMessage[];
  cashPopups: FloatingCashPopup[];
  completedMissions: string[];
  failedMissions: string[];
  completedKillFrenzies: string[];
  finaleUnlocked: boolean;
  cityClaimed: boolean;
  godMode: boolean;
  muted: boolean;
  timeOfDay: number; // 0..1 (0.5 dusk, 0.75 night, 0.25 day)
  playerX: number;
  playerY: number;
  playerHeading: number;
  minimapBlips: MinimapBlip[];
  telemetry: TelemetrySnapshot;
}

export interface SaveSlotMeta {
  slot: number;
  savedAt: string;
  cash: number;
  districtName: string;
  completedMissions: number;
  totalMissions: number;
  gameMode: GameDifficultyMode;
}

export interface SaveGameData {
  version: number;
  savedAt: string;
  gameMode: GameDifficultyMode;
  playMode?: GameMode;
  lightingMode?: LightingMode;
  controlMode: ControlMode;
  playerX: number;
  playerY: number;
  playerHeading: number;
  hp: number;
  maxHp: number;
  armor: number;
  cash: number;
  totalCashEarned: number;
  weapons: Record<WeaponId, number>;
  ownedWeapons: WeaponId[];
  activeWeapon: WeaponId;
  respect: Record<FactionId, number>;
  completedMissions: string[];
  failedMissions?: string[];
  completedKillFrenzies: string[];
  finaleUnlocked?: boolean;
  finaleAutoTriggered?: boolean;
  cityClaimed: boolean;
  timeOfDay: number;
}
