import type {
  PedEntity,
  PickupEntity,
  PlayerEntity,
  VehicleEntity,
  VehicleId,
  WeaponId,
} from '../types/entity.types';
import type {
  ControlMode,
  FloatingCashPopup,
  GameDifficultyMode,
  GameMode,
  HudSnapshot,
  IncidentSummary,
  LightingMode,
  MinimapBlip,
  PagerMessage,
  SaveGameData,
  SaveSlotMeta,
  UIScreen,
} from '../types/state.types';
import type { DistrictId, FactionId, WorldMapData } from '../types/world.types';
import { DISTRICTS, getDistrictAt, WORLD_FACILITIES } from '../data/districts.data';
import { GANGS, RESPECT_RULES } from '../data/gangs.data';
import { KILL_FRENZIES, MISSIONS, PAYPHONES } from '../data/missions.data';
import { VEHICLES } from '../data/vehicles.data';
import { WEAPON_ORDER, WEAPONS } from '../data/weapons.data';
import { generateNYCWorld, getOverpassElevationAt, getTileAtWorld, isWaterAt, TILE_ENUM } from '../data/mapGenerator';
import { RADIO_LABELS, SoundEngine } from '../audio/SoundEngine';
import { type EntityPrevPose, type RenderFrameData, SceneManager } from '../renderer/SceneManager';
import { ObjectPool } from './ObjectPool';
import {
  PhysicsWorld,
  computeVehicleOBBEscapeDir,
  isCircleOverlappingVehicleOBB,
  type VehicleContactImpact,
} from './PhysicsWorld';
import { ChunkManager } from './ChunkManager';
import { VehiclePhysics, type VehicleControlInput } from './VehiclePhysics';
import { TrafficSystem, normalizeAngle } from './TrafficSystem';
import { PedestrianSystem } from './PedestrianSystem';
import { WantedSystem } from './WantedSystem';
import { CombatSystem, type CombatCallbacks } from './CombatSystem';
import { MissionManager, type MissionEngineHooks } from './MissionManager';

const SAVE_KEY_PREFIX = 'empire_city_99_slot_';
const FIXED_DT = 1 / 60;
const JUMP_INITIAL_VZ = 12.0;
const JUMP_GRAVITY = 30.0;
const JUMP_COOLDOWN = 0.14;
const PLAYER_RADIUS = 0.65;

const GAMEPLAY_CTRL_CODES = new Set([
  'Space',
  'Enter',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyF',
  'KeyQ',
  'KeyE',
  'KeyH',
  'KeyR',
  'KeyM',
  'KeyX',
  'KeyJ',
  'KeyT',
  'CapsLock',
]);

export class GameEngine {
  public readonly map: WorldMapData;
  private physics: PhysicsWorld;
  private chunks: ChunkManager;
  private pool: ObjectPool;
  private vehiclePhysics: VehiclePhysics;
  private traffic: TrafficSystem;
  private pedSystem: PedestrianSystem;
  private wanted: WantedSystem;
  private combat: CombatSystem;
  private missions: MissionManager;
  private scene: SceneManager;
  private sound: SoundEngine;

  private player!: PlayerEntity;
  private vehicles: VehicleEntity[] = [];
  private peds: PedEntity[] = [];
  private pickups: PickupEntity[] = [];
  private respect: Record<FactionId, number> = { syndicate: 0, yakuza: 0, brotherhood: 0 };

  private screen: UIScreen = 'title';
  private gameMode: GameDifficultyMode = 'casual';
  private playMode: GameMode = 'story';
  private lightingMode: LightingMode = 'cycle';
  private controlMode: ControlMode = 'directional';
  private currentDistrict: DistrictId = 'financial_district';
  private timeOfDay = 0.56; // Golden dusk transitioning into vibrant neon night
  private elapsedSec = 0;

  private keys = new Set<string>();
  private mouseDown = false;
  private mouseClientX = 0;
  private mouseClientY = 0;
  private mouseAimActive = false;
  private jumpBufferTimer = 0;

  private pagerMessages: PagerMessage[] = [];
  private cashPopups: FloatingCashPopup[] = [];
  private msgSeq = 0;
  private vehSeq = 0;
  private pickupSeq = 0;
  private nearbyPrompt: string | null = null;
  private statusBanner: string | null = null;
  private incidentSummary: IncidentSummary | null = null;
  private incidentElapsed = 0;

  private rafId = 0;
  private lastFrameMs = 0;
  private accumulator = 0;
  private renderAlpha = 1;
  private fpsFrames = 0;
  private fpsTimer = 0;
  private currentFps = 60;
  private hudEmitAccum = 0;
  private lastHudSig = '';

  private playerPrevPose: EntityPrevPose = { x: 0, y: 0, z: 0, heading: 0 };
  private vehiclePrevPoses = new Map<string, EntityPrevPose>();
  private reusableRenderData: RenderFrameData;
  private seatedByVeh = new Map<string, PedEntity[]>();
  private seatedVehListPool: PedEntity[][] = [];
  private staticFacilityBlips: MinimapBlip[] = [];

  private listeners = new Set<(snap: HudSnapshot) => void>();
  private debugToggleListeners = new Set<() => void>();
  private vehicleCrashCooldowns = new Map<string, number>();
  private vehicleStallTimers = new Map<string, number>();
  private propRamCooldowns = new Map<string, number>();
  private jingleNotes: number[] = [];
  private jingleTimer = 0;
  private elvisConvoys: Array<{
    id: string;
    pedIds: string[];
    killedByRunOver: number;
    heading: number;
    completed: boolean;
  }> = [];
  private elvisSpawnTimer = 5.0;
  private elvisSeq = 0;
  private frenzyCycleIdx = 2;
  private lastCollisionSfxTime = -10;
  private lastPedSplatSfxTime = -10;

  constructor(canvasContainer: HTMLElement) {
    this.map = generateNYCWorld();
    this.physics = new PhysicsWorld();
    this.chunks = new ChunkManager(this.map, this.physics);
    this.pool = new ObjectPool();
    this.vehiclePhysics = new VehiclePhysics(this.physics, this.pool, this.map);
    this.traffic = new TrafficSystem(this.map);
    this.pedSystem = new PedestrianSystem(this.map, this.physics);
    this.wanted = new WantedSystem(this.map, this.physics);
    this.combat = new CombatSystem(this.physics, this.pool);
    this.missions = new MissionManager(this.map);
    this.scene = new SceneManager(canvasContainer, this.map);
    this.sound = new SoundEngine();

    for (let i = 0; i < WORLD_FACILITIES.length; i++) {
      const f = WORLD_FACILITIES[i];
      this.staticFacilityBlips.push({
        x: f.x,
        y: f.y,
        type: f.type === 'pay_n_spray' ? 'pay_n_spray' : f.type === 'car_crusher' ? 'car_crusher' : 'chapel',
        color: f.type === 'pay_n_spray' ? '#22c55e' : f.type === 'car_crusher' ? '#f59e0b' : '#38bdf8',
        label: f.name,
      });
    }

    this.reusableRenderData = {
      player: null as unknown as PlayerEntity,
      vehicles: this.vehicles,
      peds: this.peds,
      pickups: this.pickups,
      projectiles: this.pool.projectiles,
      firePools: this.pool.firePools,
      particles: this.pool.particles,
      decals: this.pool.decals,
      activeChunkKeys: this.chunks.activeChunkKeys,
      districtId: this.currentDistrict,
      timeOfDay: this.timeOfDay,
      elapsedSec: this.elapsedSec,
      objectivePos: null,
      objectiveRadius: 12,
      objectiveColor: '#22c55e',
      muzzleFlashes: this.combat.muzzleFlashes,
      explosionFlashes: this.combat.explosionFlashes,
      lightingMode: this.lightingMode,
      nsGreen: true,
      missionProps: undefined,
      alpha: 1,
      frameDt: FIXED_DT,
      playerPrev: this.playerPrevPose,
      vehiclePrevMap: this.vehiclePrevPoses,
    };

    this.bindInputs();
  }

  private snapPlayerPrevPose(): void {
    this.playerPrevPose.x = this.player.x;
    this.playerPrevPose.y = this.player.y;
    this.playerPrevPose.z = this.player.z;
    this.playerPrevPose.heading = this.player.heading;
  }

  private snapVehiclePrevPose(v: VehicleEntity): void {
    let prev = this.vehiclePrevPoses.get(v.id);
    if (!prev) {
      prev = { x: v.x, y: v.y, z: v.z, heading: v.heading, turretHeading: v.turretHeading };
      this.vehiclePrevPoses.set(v.id, prev);
    } else {
      prev.x = v.x;
      prev.y = v.y;
      prev.z = v.z;
      prev.heading = v.heading;
      prev.turretHeading = v.turretHeading;
    }
  }

  private findVehicleById(id: string | null): VehicleEntity | null {
    if (!id) return null;
    for (let i = 0; i < this.vehicles.length; i++) {
      if (this.vehicles[i].id === id) return this.vehicles[i];
    }
    return null;
  }

  public async init(): Promise<void> {
    await this.physics.init();
    this.setupFreshWorldState();
    this.chunks.update(this.player.x, this.player.y);
    this.lastFrameMs = performance.now();
    this.emitHud();
    this.loop(this.lastFrameMs);
  }

  public subscribe(fn: (snap: HudSnapshot) => void): () => void {
    this.listeners.add(fn);
    fn(this.buildSnapshot());
    return () => this.listeners.delete(fn);
  }

  public onDebugToggle(fn: () => void): () => void {
    this.debugToggleListeners.add(fn);
    return () => this.debugToggleListeners.delete(fn);
  }

  private setupFreshWorldState(): void {
    // Clear existing physics entities
    for (const v of this.vehicles) this.physics.removeBody(v.bodyHandle, v.colliderHandle);
    for (const p of this.peds) this.physics.removeBody(p.bodyHandle, p.colliderHandle);
    if (this.player) this.physics.removeBody(this.player.bodyHandle, this.player.colliderHandle);

    this.vehicles = [];
    this.peds = [];
    this.pickups = [];
    this.vehiclePrevPoses.clear();
    this.accumulator = 0;
    this.renderAlpha = 1;
    this.pool.clearAll();
    this.combat.clearPendingExplosions();
    this.combat.clearFrameFlashes();
    this.vehicleCrashCooldowns.clear();
    this.vehicleStallTimers.clear();
    this.propRamCooldowns.clear();
    this.jingleNotes = [];
    this.jingleTimer = 0;
    this.elvisConvoys = [];
    this.elvisSpawnTimer = 5.0;
    this.incidentSummary = null;
    this.incidentElapsed = 0;
    this.statusBanner = null;
    this.lastCollisionSfxTime = -10;
    this.lastPedSplatSfxTime = -10;
    this.missions.cancelActiveMission([], []);
    this.missions.activeKillFrenzy = null;
    this.missions.activeSideJob = null;
    this.missions.completedMissions.clear();
    this.missions.failedMissions.clear();
    this.missions.completedKillFrenzies.clear();
    this.missions.finaleUnlocked = false;
    this.missions.finaleAutoTriggered = false;
    this.missions.cityClaimed = false;
    this.wanted.roadblocks = [];
    this.respect = { syndicate: 0, yakuza: 0, brotherhood: 0 };

    const spawn = DISTRICTS.financial_district.spawnPoint;
    const body = this.physics.createCharacterBody('player', 'player', spawn.x, spawn.y, 0.65, 0);

    const weapons: Record<WeaponId, number> = {
      fists: -1,
      pistol: 90,
      dual_uzis: 0,
      shotgun: 0,
      m4: 0,
      molotov: 0,
      grenade: 0,
      flamethrower: 0,
      rpg: 0,
    };

    this.jumpBufferTimer = 0;
    this.player = {
      x: spawn.x,
      y: spawn.y,
      z: 0,
      layer: 0,
      heading: -Math.PI / 2,
      vx: 0,
      vy: 0,
      vz: 0,
      jumpHeight: 0,
      isJumping: false,
      jumpCooldown: 0,
      hp: 100,
      maxHp: 100,
      armor: 50,
      maxArmor: 100,
      stamina: 100,
      maxStamina: 100,
      cash: 2500,
      totalCashEarned: 2500,
      multiplier: 1,
      multiplierProgress: 0,
      multiplierDecayTimer: 0,
      wantedStars: 0,
      heatScore: 0,
      evasionTimer: 0,
      evasionTarget: 0,
      policeLineOfSight: false,
      vehicleId: null,
      weapons,
      ownedWeapons: ['fists', 'pistol'],
      activeWeapon: 'pistol',
      fireCooldown: 0,
      walkPhase: 0,
      onFireTimer: 0,
      godMode: false,
      respawnTimer: 0,
      status: 'alive',
      bodyHandle: body.bodyHandle,
      colliderHandle: body.colliderHandle,
      autoAimTargetId: null,
      autoAimPos: null,
    };

    this.currentDistrict = getDistrictAt(this.player.x, this.player.y);
    this.snapPlayerPrevPose();
    this.scene.snapCamera(this.player.x, this.player.y);
    this.populateWorldPickups();

    // Park a starter Metro Yellow Cab & Mobster V8 right nearby on Little Italy Avenue!
    this.spawnVehicle('metro_cab', spawn.x - 10, spawn.y - 6, 0, 'none');
    this.spawnVehicle('mobster_v8', spawn.x + 12, spawn.y - 10, Math.PI, 'none');
    this.spawnVehicle('apex_gt', 640, 944, 0, 'none');
    this.spawnVehicle('brooklyn_muscle', 1550, 1664, 0, 'none');
  }

  private populateWorldPickups(): void {
    this.pickups = [];

    // 8 Hidden Kill Frenzy Skull tokens
    for (const kf of KILL_FRENZIES) {
      this.spawnPickup({
        type: 'kill_frenzy',
        x: kf.x,
        y: kf.y,
        z: 0,
        amount: 1,
        killFrenzyId: kf.id,
        active: true,
        respawnTimer: 0,
      });
    }

    // Strategic Weapon, Armor, Health & Police Bribe pickups across all 5 NYC boroughs
    const worldPickups: { type: PickupEntity['type']; x: number; y: number; weaponId?: WeaponId; amount: number }[] = [
      // Financial District & Little Italy
      { type: 'weapon', x: 616, y: 1528, weaponId: 'dual_uzis', amount: 90 },
      { type: 'armor', x: 576, y: 1600, amount: 100 },
      { type: 'weapon', x: 448, y: 1792, weaponId: 'shotgun', amount: 24 },
      { type: 'bribe', x: 384, y: 1536, amount: 1 },
      { type: 'health', x: 768, y: 1600, amount: 50 },
      // Midtown & Times Square
      { type: 'weapon', x: 640, y: 928, weaponId: 'm4', amount: 90 },
      { type: 'weapon', x: 768, y: 1088, weaponId: 'grenade', amount: 8 },
      { type: 'armor', x: 832, y: 896, amount: 100 },
      { type: 'bribe', x: 512, y: 896, amount: 1 },
      { type: 'health', x: 640, y: 768, amount: 50 },
      // Central Park & Upper Concourse
      { type: 'weapon', x: 640, y: 288, weaponId: 'rpg', amount: 5 },
      { type: 'health', x: 384, y: 384, amount: 100 },
      { type: 'armor', x: 896, y: 384, amount: 100 },
      { type: 'bribe', x: 640, y: 512, amount: 1 },
      // Brooklyn Docks & Red Hook
      { type: 'weapon', x: 1600, y: 1536, weaponId: 'molotov', amount: 10 },
      { type: 'weapon', x: 1728, y: 1408, weaponId: 'shotgun', amount: 30 },
      { type: 'weapon', x: 1856, y: 1664, weaponId: 'flamethrower', amount: 150 },
      { type: 'bribe', x: 1408, y: 1664, amount: 1 },
      { type: 'health', x: 1536, y: 1792, amount: 75 },
      // Queens Rail Yards & Expressway
      { type: 'weapon', x: 1664, y: 384, weaponId: 'rpg', amount: 6 },
      { type: 'weapon', x: 1792, y: 640, weaponId: 'm4', amount: 120 },
      { type: 'armor', x: 1536, y: 512, amount: 100 },
      { type: 'bribe', x: 1664, y: 768, amount: 1 },
    ];

    for (const wp of worldPickups) {
      this.spawnPickup({
        type: wp.type,
        x: wp.x,
        y: wp.y,
        z: 0,
        weaponId: wp.weaponId,
        amount: wp.amount,
        active: true,
        respawnTimer: 0,
      });
    }
  }

  public spawnPickup(pickup: Omit<PickupEntity, 'id' | 'bobPhase'>): PickupEntity {
    const entity: PickupEntity = {
      ...pickup,
      id: `pk_${this.pickupSeq++}`,
      bobPhase: Math.random() * Math.PI * 2,
    };
    this.pickups.push(entity);
    return entity;
  }

  public spawnVehicle(
    specId: VehicleId,
    x: number,
    y: number,
    heading: number,
    aiRole: VehicleEntity['aiRole'],
    targetNodeId?: string,
    isMission = false,
    missionTag?: string
  ): VehicleEntity | null {
    const spec = VEHICLES[specId];
    if (!spec) return null;
    const id = `veh_${this.vehSeq++}`;
    const { bodyHandle, colliderHandle } = this.physics.createVehicleBody(
      id,
      x,
      y,
      heading,
      spec.length,
      spec.width,
      spec.mass,
      0
    );

    const color = spec.baseColors[Math.floor(Math.random() * spec.baseColors.length)];
    const entity: VehicleEntity = {
      id,
      specId,
      x,
      y,
      z: 0,
      layer: 0,
      heading,
      vx: 0,
      vy: 0,
      speed: 0,
      angularVelocity: 0,
      steerAngle: 0,
      hp: spec.maxHp,
      maxHp: spec.maxHp,
      damageStage: 'clean',
      burnTimer: 5.0,
      color,
      sirenActive: aiRole === 'police' || aiRole === 'swat' || aiRole === 'fbi',
      headlightsOn: true,
      braking: false,
      drifting: false,
      driverId: aiRole === 'none' ? null : `ai_${id}`,
      isMissionEntity: isMission,
      missionTag,
      aiRole,
      faction: spec.gangOwner,
      targetNodeId,
      aiCooldown: 1.5,
      turretHeading: heading,
      waterImmersionTimer: 0,
      bodyHandle,
      colliderHandle,
      spawnProtected: isMission,
      alive: true,
    };
    this.vehicles.push(entity);
    this.vehiclePrevPoses.set(id, { x, y, z: 0, heading, turretHeading: heading });
    return entity;
  }

  private despawnVehicle(v: VehicleEntity): void {
    this.ejectVehicleOccupants(v, false);
    v.alive = false;
    this.vehiclePrevPoses.delete(v.id);
    this.vehicleCrashCooldowns.delete(v.id);
    this.vehicleStallTimers.delete(v.id);
    this.physics.removeBody(v.bodyHandle, v.colliderHandle);
    const idx = this.vehicles.indexOf(v);
    if (idx !== -1) this.vehicles.splice(idx, 1);
  }

  private removePed(p: PedEntity): void {
    p.alive = false;
    this.physics.removeBody(p.bodyHandle, p.colliderHandle);
    const idx = this.peds.indexOf(p);
    if (idx !== -1) this.peds.splice(idx, 1);
  }

  // ================= PUBLIC GAME & UI COMMANDS =================

  public startNewGame(mode: GameDifficultyMode = 'casual', playMode: GameMode = 'story'): void {
    this.sound.unlock();
    this.gameMode = mode;
    this.playMode = playMode;
    this.setupFreshWorldState();

    if (playMode === 'freeroam') {
      this.respect = { syndicate: 60, yakuza: 60, brotherhood: 60 };
      this.player.cash = 50000;
      this.player.totalCashEarned = 50000;
      this.player.armor = 100;
      this.grantWeapon('dual_uzis', 240, false);
      this.grantWeapon('shotgun', 48, false);
      this.grantWeapon('m4', 180, true);
      this.grantWeapon('grenade', 8, false);
      this.spawnVehicle('roadster_gt', this.player.x + 8, this.player.y + 8, 0, 'none');
      this.spawnVehicle('gangster_ztype', this.player.x - 8, this.player.y + 8, Math.PI, 'none');
    } else if (playMode === 'frenzy') {
      this.player.cash = 10000;
      this.player.totalCashEarned = 10000;
      this.player.armor = 100;
      this.grantWeapon('dual_uzis', 200, false);
      this.grantWeapon('shotgun', 40, false);
      this.frenzyCycleIdx = 2;
      const kf = KILL_FRENZIES[this.frenzyCycleIdx];
      this.teleportPlayer(kf.x, kf.y);
      this.missions.startKillFrenzy(kf.id, this.player, this.getMissionHooks());
    }

    this.chunks.update(this.player.x, this.player.y);
    this.screen = 'playing';
    this.blurFocusedUiElement();
    if (playMode === 'freeroam') {
      this.pushPager('FREE ROAM SANDBOX: ALL 5 BOROUGHS & ALL SYNDICATE PAYPHONES UNLOCKED!', 'cyan', 8);
    } else if (playMode === 'frenzy') {
      this.pushPager('KILL FRENZY ARCADE: NON-STOP RAMPAGE! CLEAR FRENZIES TO ADVANCE!', 'red', 8);
    } else {
      this.pushPager('WELCOME TO EMPIRE CITY 99 — WALK TO THE RINGING PAYPHONE & PRESS [F] TO ANSWER!', 'green', 8);
    }
    this.emitHud();
  }

  public setScreen(screen: UIScreen): void {
    this.sound.unlock();
    this.screen = screen;
    this.keys.clear();
    this.mouseDown = false;
    this.jumpBufferTimer = 0;
    if (screen === 'playing') {
      this.accumulator = 0;
      this.blurFocusedUiElement();
    }
    this.emitHud();
  }

  public setControlMode(mode: ControlMode): void {
    this.controlMode = mode;
    this.emitHud();
  }

  public setGameMode(mode: GameDifficultyMode): void {
    this.gameMode = mode;
    this.emitHud();
  }

  public setPlayMode(mode: GameMode): void {
    this.playMode = mode;
    this.emitHud();
  }

  public setLightingMode(mode: LightingMode): void {
    this.lightingMode = mode;
    if (mode === 'noon') this.timeOfDay = 0.25;
    else if (mode === 'dusk') this.timeOfDay = 0.54;
    else if (mode === 'night') this.timeOfDay = 0.80;
    const label = mode === 'night' ? 'NEON NIGHT' : mode.toUpperCase();
    this.pushPager(`LIGHTING MODE: ${label}`, 'cyan', 3);
    this.sound.playUiBeep(780, 0.06);
    this.emitHud();
  }

  public cycleLightingMode(): void {
    const order: LightingMode[] = ['noon', 'dusk', 'night', 'cycle'];
    const idx = order.indexOf(this.lightingMode);
    this.setLightingMode(order[(idx + 1) % order.length]);
  }

  public selectWeapon(weaponId: WeaponId): void {
    if (!this.player.ownedWeapons.includes(weaponId)) return;
    this.player.activeWeapon = weaponId;
    this.sound.playUiBeep(640, 0.05);
    this.emitHud();
  }

  public launchFinaleFromJournal(): boolean {
    if (!this.missions.finaleUnlocked || this.missions.completedMissions.has('king_of_five_boroughs')) {
      return false;
    }
    this.missions.startMissionById('king_of_five_boroughs', this.player, this.vehicles, this.peds, this.getMissionHooks());
    this.screen = 'playing';
    this.blurFocusedUiElement();
    this.emitHud();
    return true;
  }

  public confirmRespawn(): void {
    if (this.player.status === 'alive') return;
    if (this.incidentElapsed < 0.65) return;
    this.respawnPlayer();
    this.keys.clear();
    this.jumpBufferTimer = 0;
    this.blurFocusedUiElement();
  }

  public toggleMute(): void {
    this.sound.unlock();
    this.sound.setMuted(!this.sound.isMuted());
    this.emitHud();
  }

  public cycleRadio(): void {
    this.sound.unlock();
    const st = this.sound.cycleRadioStation();
    this.pushPager(`TUNED TO: ${RADIO_LABELS[st]}`, 'cyan', 3);
    this.emitHud();
  }

  // ================= MULTI-SLOT LOCALSTORAGE SAVE / LOAD =================

  public getSaveSlots(): (SaveSlotMeta | null)[] {
    return [1, 2, 3].map((slot) => {
      try {
        const raw = localStorage.getItem(`${SAVE_KEY_PREFIX}${slot}`);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as SaveGameData;
        const dist = DISTRICTS[getDistrictAt(parsed.playerX, parsed.playerY)];
        return {
          slot,
          savedAt: parsed.savedAt,
          cash: parsed.cash,
          districtName: dist.shortName,
          completedMissions: parsed.completedMissions.length,
          totalMissions: MISSIONS.length,
          gameMode: parsed.gameMode,
        };
      } catch {
        return null;
      }
    });
  }

  public saveToSlot(slot: number): boolean {
    try {
      const payload: SaveGameData = {
        version: 2,
        savedAt: new Date().toLocaleString(),
        gameMode: this.gameMode,
        playMode: this.playMode,
        lightingMode: this.lightingMode,
        controlMode: this.controlMode,
        playerX: this.player.x,
        playerY: this.player.y,
        playerHeading: this.player.heading,
        hp: this.player.hp,
        maxHp: this.player.maxHp,
        armor: this.player.armor,
        cash: this.player.cash,
        totalCashEarned: this.player.totalCashEarned,
        weapons: { ...this.player.weapons },
        ownedWeapons: [...this.player.ownedWeapons],
        activeWeapon: this.player.activeWeapon,
        respect: { ...this.respect },
        completedMissions: Array.from(this.missions.completedMissions),
        failedMissions: Array.from(this.missions.failedMissions),
        completedKillFrenzies: Array.from(this.missions.completedKillFrenzies),
        finaleUnlocked: this.missions.finaleUnlocked,
        finaleAutoTriggered: this.missions.finaleAutoTriggered,
        cityClaimed: this.missions.cityClaimed,
        timeOfDay: this.timeOfDay,
      };
      localStorage.setItem(`${SAVE_KEY_PREFIX}${slot}`, JSON.stringify(payload));
      this.sound.playUiBeep(880, 0.12);
      this.pushPager(`GAME SAVED TO SLOT ${slot}!`, 'cyan', 4);
      this.emitHud();
      return true;
    } catch {
      return false;
    }
  }

  public loadFromSlot(slot: number): boolean {
    try {
      const raw = localStorage.getItem(`${SAVE_KEY_PREFIX}${slot}`);
      if (!raw) return false;
      const data = JSON.parse(raw) as SaveGameData;
      this.sound.unlock();
      this.setupFreshWorldState();

      this.gameMode = data.gameMode ?? 'casual';
      this.playMode = data.playMode ?? 'story';
      this.lightingMode = data.lightingMode ?? 'cycle';
      this.controlMode = data.controlMode ?? 'directional';
      this.player.x = data.playerX;
      this.player.y = data.playerY;
      this.player.heading = data.playerHeading ?? 0;
      this.player.hp = data.hp;
      this.player.maxHp = data.maxHp;
      this.player.armor = data.armor;
      this.player.cash = data.cash;
      this.player.totalCashEarned = data.totalCashEarned;
      this.player.weapons = { ...data.weapons };
      this.player.ownedWeapons = [...data.ownedWeapons];
      this.player.activeWeapon = data.activeWeapon;
      this.respect = { ...data.respect };
      this.missions.completedMissions = new Set(data.completedMissions ?? []);
      this.missions.failedMissions = new Set(data.failedMissions ?? []);
      this.missions.completedKillFrenzies = new Set(data.completedKillFrenzies ?? []);
      this.missions.cityClaimed = Boolean(data.cityClaimed);
      this.missions.finaleUnlocked = Boolean(
        data.finaleUnlocked ?? (data.cityClaimed || data.failedMissions?.includes('king_of_five_boroughs'))
      );
      this.missions.finaleAutoTriggered = Boolean(
        data.finaleAutoTriggered ?? (data.cityClaimed || data.failedMissions?.includes('king_of_five_boroughs'))
      );
      this.timeOfDay = data.timeOfDay ?? 0.56;

      this.physics.teleportBody(this.player.bodyHandle, this.player.x, this.player.y);
      this.physics.setPlayerJumping(false, 0);
      this.chunks.update(this.player.x, this.player.y);
      this.currentDistrict = getDistrictAt(this.player.x, this.player.y);
      this.accumulator = 0;
      this.renderAlpha = 1;
      this.snapPlayerPrevPose();
      this.scene.snapCamera(this.player.x, this.player.y);
      this.screen = 'playing';
      this.blurFocusedUiElement();
      this.pushPager(`LOADED SAVE SLOT ${slot} — WELCOME BACK TO EMPIRE CITY!`, 'cyan', 5);
      this.emitHud();
      return true;
    } catch {
      return false;
    }
  }

  // ================= DEBUG CONSOLE QA COMMANDS (`~` KEY) =================

  public debugTeleportToDistrict(target: DistrictId | 'nearest_payphone'): void {
    let x = 640;
    let y = 960;
    let label = '';

    if (target === 'nearest_payphone') {
      const ph = this.missions.getNearestAvailablePayphone(this.player, this.respect) ?? PAYPHONES[0];
      x = ph.x + 8;
      y = ph.y;
      label = `${GANGS[ph.faction].shortName} PAYPHONE`;
    } else {
      const d = DISTRICTS[target];
      x = d.teleportPoint.x;
      y = d.teleportPoint.y;
      label = d.shortName;
    }

    this.teleportPlayer(x, y);
    this.pushPager(`DEBUG TELEPORT: ${label}`, 'cyan', 3);
    this.emitHud();
  }

  public debugSpawnVehicle(specId: VehicleId): void {
    const dist = 7.5;
    const sx = this.player.x + Math.cos(this.player.heading) * dist;
    const sy = this.player.y + Math.sin(this.player.heading) * dist;
    const v = this.spawnVehicle(specId, sx, sy, this.player.heading, 'none');
    if (v) {
      this.pushPager(`DEBUG SPAWNED: ${VEHICLES[specId].name.toUpperCase()}`, 'cyan', 3);
      this.sound.playUiBeep(820, 0.08);
    }
    this.emitHud();
  }

  public debugSetWanted(stars: number): void {
    if (stars === 0) {
      this.wanted.clearWanted(this.player, this.vehicles, this.peds);
    } else {
      this.wanted.setWantedStars(this.player, stars);
    }
    this.pushPager(`DEBUG WANTED LEVEL SET TO ${stars}★`, 'amber', 3);
    this.emitHud();
  }

  public debugGiveAllWeapons(): void {
    for (const wId of WEAPON_ORDER) {
      const spec = WEAPONS[wId];
      this.grantWeapon(wId, spec.infiniteAmmo ? -1 : spec.maxAmmo, false);
    }
    this.player.armor = this.player.maxArmor;
    this.player.hp = this.player.maxHp;
    this.pushPager('DEBUG ARSENAL: ALL 9 WEAPONS + MAX AMMO & ARMOR!', 'green', 4);
    this.sound.playCashChime();
    this.emitHud();
  }

  public debugAddCash(amount: number): void {
    this.awardCash(amount, 'DEBUG CASH');
    this.emitHud();
  }

  public debugToggleGodMode(): void {
    this.player.godMode = !this.player.godMode;
    this.pushPager(`GOD MODE: ${this.player.godMode ? 'ENABLED' : 'DISABLED'}`, 'amber', 3);
    this.emitHud();
  }

  public debugMaxRespect(): void {
    this.respect.syndicate = 100;
    this.respect.yakuza = 100;
    this.respect.brotherhood = 100;
    this.pushPager('DEBUG: ALL 3 NYC SYNDICATES SET TO +100 RESPECT!', 'green', 4);
    this.emitHud();
  }

  public debugJumpToMission(missionId: string): void {
    const def = MISSIONS.find((m) => m.id === missionId);
    if (!def) return;
    // Teleport near mission start area so QA can test immediately!
    const startPos =
      def.spawnStartVehicle?.pos ??
      def.stages[0]?.targetPos ??
      def.stages[0]?.checkpoints?.[0];
    if (startPos) {
      this.teleportPlayer(startPos.x - 10, startPos.y + 6);
    }
    this.missions.startMissionById(missionId, this.player, this.vehicles, this.peds, this.getMissionHooks());
    if (this.screen !== 'playing') this.screen = 'playing';
    this.blurFocusedUiElement();
    this.emitHud();
  }

  private teleportPlayer(x: number, y: number): void {
    const playerVeh = this.player.vehicleId ? this.vehicles.find((v) => v.id === this.player.vehicleId) : null;
    if (playerVeh) {
      this.physics.teleportBody(playerVeh.bodyHandle, x, y, playerVeh.heading);
      playerVeh.x = x;
      playerVeh.y = y;
      playerVeh.z = 0;
      playerVeh.layer = 0;
      this.physics.setColliderLayer(playerVeh.colliderHandle, 0);
    }
    this.player.x = x;
    this.player.y = y;
    this.player.z = 0;
    this.player.layer = 0;
    this.player.vz = 0;
    this.player.jumpHeight = 0;
    this.player.isJumping = false;
    this.player.jumpCooldown = 0;
    this.jumpBufferTimer = 0;
    this.physics.teleportBody(this.player.bodyHandle, x, y);
    this.physics.setPlayerJumping(false, 0);
    this.physics.setColliderLayer(this.player.colliderHandle, 0);
    this.chunks.update(x, y);
    this.currentDistrict = getDistrictAt(x, y);
    this.snapPlayerPrevPose();
    if (playerVeh) this.snapVehiclePrevPose(playerVeh);
    this.scene.snapCamera(x, y);
  }

  // ================= INPUT HANDLING =================

  private bindInputs(): void {
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('mousedown', this.handleMouseDown);
    window.addEventListener('mouseup', this.handleMouseUp);
    window.addEventListener('mousemove', this.handleMouseMove);
    window.addEventListener('wheel', this.handleWheel, { passive: true });
    window.addEventListener('blur', this.handleBlur);
    window.addEventListener('click', this.handleWindowClick);
    window.addEventListener('change', this.handleWindowChange);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
  }

  private blurFocusedUiElement(): void {
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      active !== document.body &&
      !['INPUT', 'TEXTAREA'].includes(active.tagName)
    ) {
      active.blur();
    }
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    const code = e.code;

    // `~` Backtick toggles QA Debug Panel anytime (ignore OS key repeat)
    if (code === 'Backquote') {
      e.preventDefault();
      if (!e.repeat) this.debugToggleListeners.forEach((fn) => fn());
      return;
    }

    if (this.screen === 'title') {
      if (code === 'Enter' || code === 'Space') {
        e.preventDefault();
        if (!e.repeat) this.startNewGame(this.gameMode, this.playMode);
      }
      return;
    }

    if (code === 'Escape') {
      e.preventDefault();
      if (!e.repeat) {
        if (this.screen === 'playing') this.setScreen('paused');
        else if (this.screen === 'paused' || this.screen === 'map' || this.screen === 'journal') {
          this.setScreen('playing');
        }
      }
      return;
    }

    if (code === 'Tab') {
      e.preventDefault();
      if (!e.repeat) {
        if (this.screen === 'playing' || this.screen === 'journal') this.setScreen('map');
        else if (this.screen === 'map') this.setScreen('playing');
      }
      return;
    }

    if (code === 'KeyJ' && !(e.ctrlKey || e.metaKey) && !e.altKey) {
      e.preventDefault();
      if (!e.repeat) {
        if (this.screen === 'playing') this.setScreen('journal');
        else if (this.screen === 'journal') this.setScreen('playing');
      }
      return;
    }

    if (this.screen !== 'playing') return;

    const active = document.activeElement;
    if (active instanceof HTMLElement && ['INPUT', 'TEXTAREA'].includes(active.tagName)) {
      return;
    }
    // Prevent focused HUD/Debug buttons or selects from stealing Enter/Space/WASD
    if (
      active instanceof HTMLButtonElement ||
      (active instanceof HTMLSelectElement && GAMEPLAY_CTRL_CODES.has(code))
    ) {
      active.blur();
    }

    this.sound.unlock();

    if (
      code === 'Space' ||
      code === 'Enter' ||
      code === 'CapsLock' ||
      code.startsWith('Arrow') ||
      ((e.ctrlKey || e.metaKey) && !e.altKey && GAMEPLAY_CTRL_CODES.has(code))
    ) {
      e.preventDefault();
    }

    if (this.player.status !== 'alive') {
      if (code === 'Space' && !e.repeat && !this.keys.has(code)) {
        this.confirmRespawn();
      }
      this.keys.add(code);
      return;
    }

    if (!this.keys.has(code)) {
      const ctrlChord = e.ctrlKey || e.metaKey;
      // Edge-triggered actions
      if (code === 'KeyF' || code === 'Enter') {
        const answered =
          !this.player.vehicleId &&
          this.missions.answerNearestPayphone(
            this.player,
            this.vehicles,
            this.peds,
            this.respect,
            this.getMissionHooks()
          );
        if (!answered) {
          this.tryToggleVehicle();
        }
      } else if (code === 'KeyQ' && !ctrlChord) {
        this.cycleWeapon(-1);
      } else if (code === 'KeyE' && !ctrlChord) {
        this.cycleWeapon(1);
      } else if (code === 'KeyH' && !ctrlChord) {
        this.triggerHornOrSiren();
      } else if (code === 'KeyR' && !ctrlChord) {
        this.cycleRadio();
      } else if (code === 'KeyT' && !ctrlChord) {
        this.cycleLightingMode();
      } else if (code === 'CapsLock') {
        this.missions.toggleSideJob(this.player, this.vehicles, this.getMissionHooks());
      } else if (code === 'KeyM' && !ctrlChord) {
        this.toggleMute();
      } else if (code === 'Space' && !this.player.vehicleId && this.player.status === 'alive') {
        this.jumpBufferTimer = 0.12;
      }
    }

    this.keys.add(code);
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private handleMouseDown = (e: MouseEvent): void => {
    if (this.screen !== 'playing') return;
    if ((e.target as HTMLElement)?.closest('[data-ui-interactive="true"]')) return;
    this.blurFocusedUiElement();
    if (e.button === 0) {
      this.sound.unlock();
      this.mouseDown = true;
      this.mouseAimActive = true;
      this.mouseClientX = e.clientX;
      this.mouseClientY = e.clientY;
    }
  };

  private handleMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) this.mouseDown = false;
  };

  private handleMouseMove = (e: MouseEvent): void => {
    this.mouseClientX = e.clientX;
    this.mouseClientY = e.clientY;
    if (this.screen === 'playing') {
      this.mouseAimActive = true;
    }
  };

  private handleWheel = (e: WheelEvent): void => {
    if (this.screen !== 'playing') return;
    this.cycleWeapon(e.deltaY > 0 ? 1 : -1);
  };

  private handleBlur = (): void => {
    this.keys.clear();
    this.mouseDown = false;
    this.jumpBufferTimer = 0;
  };

  private handleWindowClick = (e: MouseEvent): void => {
    if (this.screen !== 'playing') return;
    if ((e.target as HTMLElement)?.closest('button')) {
      this.blurFocusedUiElement();
    }
  };

  private handleWindowChange = (e: Event): void => {
    if (this.screen === 'playing' && e.target instanceof HTMLSelectElement) {
      e.target.blur();
    }
  };

  private handleVisibilityChange = (): void => {
    if (document.hidden) {
      this.keys.clear();
      this.mouseDown = false;
      this.jumpBufferTimer = 0;
    }
  };

  // ================= MAIN 60HZ FIXED TIMESTEP LOOP =================

  private loop = (nowMs: number): void => {
    this.rafId = requestAnimationFrame(this.loop);

    const frameDt = Math.min(0.1, (nowMs - this.lastFrameMs) / 1000);
    this.lastFrameMs = nowMs;

    // FPS counter
    this.fpsFrames++;
    this.fpsTimer += frameDt;
    if (this.fpsTimer >= 0.5) {
      this.currentFps = Math.round(this.fpsFrames / this.fpsTimer);
      this.fpsFrames = 0;
      this.fpsTimer = 0;
    }

    if (this.screen === 'playing') {
      this.accumulator += frameDt;
      let steps = 0;
      while (this.accumulator >= FIXED_DT && steps < 4) {
        this.stepSimulation(FIXED_DT);
        this.accumulator -= FIXED_DT;
        steps++;
      }
      if (steps === 4 && this.accumulator > FIXED_DT) {
        this.accumulator = FIXED_DT;
      }
      this.renderAlpha = Math.max(0, Math.min(1, this.accumulator / FIXED_DT));
    } else {
      // Gently silence continuous audio when paused or on title screen
      this.sound.updateContinuous(frameDt, false, 0, false, 0, false, false);
    }

    this.renderFrame(this.renderAlpha, frameDt);

    if (this.screen === 'playing') {
      this.hudEmitAccum += frameDt;
      if (this.hudEmitAccum >= 0.08) {
        this.hudEmitAccum = 0;
        this.emitHudIfDirty();
      }
    }
  };

  private stepSimulation(dt: number): void {
    this.snapPlayerPrevPose();
    for (let i = 0; i < this.vehicles.length; i++) {
      const v = this.vehicles[i];
      if (v.alive) {
        this.snapVehiclePrevPose(v);
      }
    }

    const prevWanted = this.player.wantedStars;
    const prevCash = this.player.cash;
    const prevMissionStage = this.missions.activeMission?.stageIndex ?? -1;
    const prevPrompt = this.nearbyPrompt;

    this.elapsedSec += dt;
    if (this.lightingMode === 'cycle') {
      this.timeOfDay = (this.timeOfDay + dt * 0.0022) % 1; // gentle NYC day/dusk/night cycle
    }
    this.combat.clearFrameFlashes();

    // Expire pager messages & floating cash popups (only allocate when an item actually expired)
    const now = performance.now();
    if (this.pagerMessages.length > 0) {
      let hasExpired = false;
      for (let i = 0; i < this.pagerMessages.length; i++) {
        if (this.pagerMessages[i].expiresAt <= now) {
          hasExpired = true;
          break;
        }
      }
      if (hasExpired) {
        this.pagerMessages = this.pagerMessages.filter((m) => m.expiresAt > now);
      }
    }
    if (this.cashPopups.length > 0) {
      let hasExpired = false;
      for (let i = 0; i < this.cashPopups.length; i++) {
        if (now - this.cashPopups[i].timestamp >= 1500) {
          hasExpired = true;
          break;
        }
      }
      if (hasExpired) {
        this.cashPopups = this.cashPopups.filter((c) => now - c.timestamp < 1500);
      }
    }

    // Score multiplier decay if idle for 14s
    if (this.player.multiplier > 1) {
      this.player.multiplierDecayTimer -= dt;
      if (this.player.multiplierDecayTimer <= 0) {
        this.player.multiplier = Math.max(1, this.player.multiplier - 1);
        this.player.multiplierDecayTimer = 10;
      }
    }

    // Handle WASTED / BUSTED respawn countdown
    if (this.player.status !== 'alive') {
      this.incidentElapsed += dt;
      this.player.respawnTimer -= dt;
      if (this.incidentSummary) {
        this.incidentSummary.canSkip = this.incidentElapsed >= 0.65;
        this.incidentSummary.countdownSec = Math.max(0, Math.ceil(this.player.respawnTimer));
      }
      if (this.player.respawnTimer <= 0) {
        this.respawnPlayer();
      }
      this.physics.step();
      this.pool.updateEffects(dt);
      return;
    }

    // 1. Stream active 5x5 chunks around player
    this.chunks.update(this.player.x, this.player.y);

    // 2. District entry detection banner
    const distNow = getDistrictAt(this.player.x, this.player.y);
    if (distNow !== this.currentDistrict) {
      this.currentDistrict = distNow;
      const d = DISTRICTS[distNow];
      this.pushPager(`ENTERING: ${d.name.toUpperCase()} — ${d.subtitle}`, 'amber', 5);
    }

    // 3. Player controls (on foot or driving)
    let playerVeh = this.findVehicleById(this.player.vehicleId);
    if (playerVeh && !playerVeh.alive) playerVeh = null;

    if (playerVeh && playerVeh.damageStage === 'wrecked') {
      this.ejectPlayerFromVehicle(playerVeh, false);
      playerVeh = null;
    }

    if (!playerVeh && this.player.vehicleId) {
      this.player.vehicleId = null;
      this.player.vz = 0;
      this.player.jumpHeight = 0;
      this.player.isJumping = false;
      this.player.jumpCooldown = 0;
      this.jumpBufferTimer = 0;
      this.snapPlayerPrevPose();
      this.physics.setPlayerJumping(false, this.player.layer);
      this.physics.setBodyEnabled(this.player.bodyHandle, true);
    }

    if (this.jingleNotes.length > 0) {
      if (!playerVeh || playerVeh.specId !== 'ice_cream_van') {
        this.jingleNotes = [];
        this.jingleTimer = 0;
      } else {
        this.jingleTimer -= dt;
        if (this.jingleTimer <= 0) {
          const freq = this.jingleNotes.shift();
          if (freq) {
            this.sound.playUiBeep(freq, 0.13);
            this.jingleTimer = 0.15;
          }
        }
      }
    }

    if (playerVeh) {
      this.updatePlayerInVehicle(playerVeh, dt);
    } else {
      this.updatePlayerOnFoot(dt);
    }

    // 4. Update Traffic spawning & AI Vehicle controls
    const playerSiren = Boolean(playerVeh && playerVeh.sirenActive);
    this.traffic.update(
      dt,
      this.player,
      this.vehicles,
      (specId, x, y, heading, aiRole, targetNodeId) =>
        this.spawnVehicle(specId, x, y, heading, aiRole, targetNodeId),
      (v) => this.despawnVehicle(v)
    );

    // 5. Update every Vehicle via arcade-drift physics
    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      const v = this.vehicles[i];
      if (!v.alive) {
        this.despawnVehicle(v);
        continue;
      }

      let control: VehicleControlInput = { throttle: 0, steer: 0, handbrake: false };
      if (v.id === this.player.vehicleId) {
        control = this.readPlayerVehicleInput();
      } else if (v.driverId && v.damageStage !== 'wrecked') {
        if (v.aiRole === 'police' || v.aiRole === 'swat' || v.aiRole === 'fbi' || v.aiRole === 'army') {
          if (this.player.wantedStars > 0 || v.isMissionEntity) {
            control = this.wanted.computePursuitControl(v, this.player, Math.max(2, this.player.wantedStars));
          } else {
            control = this.traffic.computeTrafficControl(v, this.player, playerSiren, this.vehicles);
          }
        } else if (v.aiRole === 'gang' && v.isMissionEntity) {
          control = this.wanted.computePursuitControl(v, this.player, 2);
        } else if (v.aiRole === 'traffic') {
          control = this.traffic.computeTrafficControl(v, this.player, playerSiren, this.vehicles);
        }
      }

      this.vehiclePhysics.updateVehicle(
        v,
        control,
        dt,
        (explodingVeh) => {
          const killer = explodingVeh.id === this.player.vehicleId ? 'player' : 'explosion';
          this.handleVehicleExploded(explodingVeh, killer);
        },
        (submergedVeh) => {
          submergedVeh.hp = 0;
          submergedVeh.damageStage = 'wrecked';
          this.ejectVehicleOccupants(submergedVeh, false);
          if (submergedVeh.id === this.player.vehicleId) {
            this.ejectPlayerFromVehicle(submergedVeh, false);
            this.pushPager('VEHICLE LOST IN EAST RIVER! SWIM BACK TO SHORE!', 'red', 4);
            this.damagePlayer(35, 'water');
          }
          this.despawnVehicle(submergedVeh);
        },
        this.combat.hasPendingExplosion(v.id)
      );

      // Tank Crush-on-Contact: Rhino APC obliterates normal cars on impact!
      if (v.specId === 'rhino_apc' && Math.abs(v.speed) > 2.5) {
        for (const other of this.vehicles) {
          if (other.id === v.id || !other.alive || other.damageStage === 'wrecked' || other.specId === 'rhino_apc') {
            continue;
          }
          if (Math.hypot(other.x - v.x, other.y - v.y) < 4.5) {
            this.combat.explodeVehicle(
              other,
              v.driverId ?? 'tank',
              this.player,
              this.peds,
              this.vehicles,
              this.getCombatCallbacks()
            );
          }
        }
      }
    }

    // Keep player synced to vehicle coordinates
    if (playerVeh && playerVeh.alive) {
      this.player.x = playerVeh.x;
      this.player.y = playerVeh.y;
      this.player.z = playerVeh.z;
      this.player.layer = playerVeh.layer;
      this.player.heading = playerVeh.heading;
      this.player.vx = playerVeh.vx;
      this.player.vy = playerVeh.vy;
    }

    // Keep seated peds synced to their vehicles & disembark mission crews when close/burning/stalled
    this.syncAndDisembarkSeatedPeds(dt);

    // 5b. Pursuing police cruiser officer disembark for BUSTED arrest reliability
    if (this.player.wantedStars > 0 && this.player.status === 'alive') {
      const pSpeed = playerVeh ? Math.abs(playerVeh.speed) : Math.hypot(this.player.vx, this.player.vy);
      if (pSpeed < 4.0) {
        let hasOfficerNearby = false;
        for (let i = 0; i < this.peds.length; i++) {
          const p = this.peds[i];
          if (!p.alive || p.vehicleId) continue;
          if (p.role === 'cop' || p.role === 'swat' || p.role === 'fbi') {
            if (Math.hypot(p.x - this.player.x, p.y - this.player.y) < 16) {
              hasOfficerNearby = true;
              break;
            }
          }
        }
        if (!hasOfficerNearby) {
          for (let i = 0; i < this.vehicles.length; i++) {
            const v = this.vehicles[i];
            if (!v.alive || v.damageStage === 'wrecked') continue;
            if (v.aiRole !== 'police' && v.aiRole !== 'swat' && v.aiRole !== 'fbi') continue;
            if (!v.driverId || !v.driverId.startsWith('ai_')) continue;
            if (Math.hypot(v.x - this.player.x, v.y - this.player.y) < 14) {
              const spec = VEHICLES[v.specId];
              const sideDist = spec.width * 0.65 + 1.1;
              const endDist = spec.length * 0.6 + 1.0;
              const cosH = Math.cos(v.heading);
              const sinH = Math.sin(v.heading);
              let ex = v.x - sinH * sideDist;
              let ey = v.y + cosH * sideDist;
              const candDx = [-sinH, sinH, -cosH, cosH];
              const candDy = [cosH, -cosH, -sinH, sinH];
              const candDist = [sideDist, sideDist, endDist, endDist];
              for (let c = 0; c < 4; c++) {
                const cx = v.x + candDx[c] * candDist[c];
                const cy = v.y + candDy[c] * candDist[c];
                const tile = getTileAtWorld(this.map, cx, cy);
                if (!isWaterAt(this.map, cx, cy, v.layer) && tile !== TILE_ENUM.building) {
                  ex = cx;
                  ey = cy;
                  break;
                }
              }
              const officerRole = v.aiRole === 'fbi' ? 'fbi' : v.aiRole === 'swat' ? 'swat' : 'cop';
              const officer = this.pedSystem.spawnPed({ role: officerRole, x: ex, y: ey });
              officer.layer = v.layer;
              officer.z = v.z;
              this.physics.setColliderLayer(officer.colliderHandle, v.layer);
              this.peds.push(officer);
              v.driverId = null;
              break;
            }
          }
        }
      }
    }

    // 6. Step Rapier2D rigid-body world & resolve high-speed vehicle crash impacts
    this.physics.step();
    const impacts = this.physics.drainVehicleImpacts(4.5);
    if (impacts.length > 0) {
      this.processVehicleCrashImpacts(impacts);
    }

    // 7. Update Pedestrians (walking, panic fleeing, gang turf hit squads, cops)
    this.pedSystem.update(
      dt,
      this.player,
      this.peds,
      this.vehicles,
      this.respect,
      (ped, tx, ty) => {
        const angle = Math.atan2(ty - ped.y, tx - ped.x);
        this.combat.fireWeapon({
          ownerId: ped.id,
          ownerFaction: ped.faction,
          weaponId: ped.weaponId,
          x: ped.x,
          y: ped.y,
          z: ped.z,
          heading: angle,
          layer: ped.layer,
          player: this.player,
          peds: this.peds,
          vehicles: this.vehicles,
          cb: this.getCombatCallbacks(),
        });
      },
      (ped, dmg, src, hitAngle, knockback, isRunOver) => {
        this.combat.damagePed(
          ped,
          dmg,
          src,
          hitAngle ?? 0,
          knockback ?? 0,
          this.getCombatCallbacks(),
          Boolean(isRunOver)
        );
      },
      (ped) => this.removePed(ped)
    );

    // 7b. Update M12 Brotherhood Boss ally follower & Elvis Impersonator Convoys
    this.updateAllyFollower(dt, playerVeh);
    this.updateElvisConvoys(dt);

    // 8. Update 6-Star NYPD Wanted System
    this.wanted.update(
      dt,
      this.player,
      this.vehicles,
      this.peds,
      (specId, x, y, heading, role) => this.spawnVehicle(specId, x, y, heading, role),
      (role, x, y) => {
        const officer = this.pedSystem.spawnPed({ role, x, y });
        this.peds.push(officer);
        return officer;
      },
      () => this.triggerBusted(),
      (tank, tx, ty) => {
        const aim = Math.atan2(ty - tank.y, tx - tank.x);
        tank.turretHeading = aim;
        this.combat.fireVehicleSpecialWeapon(tank, aim, this.player, this.getCombatCallbacks());
      },
      (pVeh) => {
        pVeh.hp = Math.max(15, pVeh.hp - 40);
        const body = this.physics.getBody(pVeh.bodyHandle);
        if (body) {
          body.setAngvel((Math.random() > 0.5 ? 1 : -1) * 4.2, true);
        }
        this.sound.playCollision(1);
        this.pushPager('NYPD SPIKE STRIP HIT! TIRES SHREDDED!', 'red', 4);
      }
    );

    // 9. Update Combat (projectiles, fire pools, explosions) + destructible mission prop hits
    this.combat.update(dt, this.player, this.peds, this.vehicles, this.getCombatCallbacks());
    this.updateMissionPropHits(dt);

    // 10. Update Pickups & Kill Frenzy Skull collection
    this.updatePickups(dt);

    // 11. Update Missions, Payphones, Facilities, Kill Frenzies & Side Jobs
    const { nearbyPrompt } = this.missions.update(
      dt,
      this.player,
      this.vehicles,
      this.peds,
      this.respect,
      this.gameMode,
      this.getMissionHooks()
    );
    this.nearbyPrompt = nearbyPrompt;

    // Kill Frenzy Arcade mode auto-launches next frenzy after completion/timeout
    if (this.playMode === 'frenzy' && !this.missions.activeKillFrenzy && this.player.status === 'alive') {
      this.frenzyCycleIdx = (this.frenzyCycleIdx + 1) % KILL_FRENZIES.length;
      const nextKf = KILL_FRENZIES[this.frenzyCycleIdx];
      this.teleportPlayer(nextKf.x, nextKf.y);
      this.missions.startKillFrenzy(nextKf.id, this.player, this.getMissionHooks());
    }

    // 12. Update pooled particles & decals
    this.pool.updateEffects(dt);

    // 13. Update continuous Web Audio synthesis (engine RPM, drift screech, sirens, payphone rings, radio)
    let sirenIntensity = playerSiren ? 0.9 : 0;
    if (sirenIntensity === 0) {
      for (const v of this.vehicles) {
        if (!v.alive || !v.sirenActive) continue;
        const d = Math.hypot(v.x - this.player.x, v.y - this.player.y);
        if (d < 80) {
          sirenIntensity = Math.max(sirenIntensity, (1 - d / 80) * 0.7);
        }
      }
    }
    const speedNorm = playerVeh ? Math.abs(playerVeh.speed) / Math.max(1, VEHICLES[playerVeh.specId].topSpeedMs) : 0;
    const ringingPhone = this.missions.isNearRingingPayphone(this.player, this.respect);

    this.sound.updateContinuous(
      dt,
      Boolean(playerVeh),
      speedNorm,
      Boolean(playerVeh?.drifting),
      sirenIntensity,
      Boolean(ringingPhone),
      Boolean(playerVeh)
    );

    if (
      this.player.wantedStars !== prevWanted ||
      this.player.cash !== prevCash ||
      (this.missions.activeMission?.stageIndex ?? -1) !== prevMissionStage ||
      this.nearbyPrompt !== prevPrompt
    ) {
      this.emitHudIfDirty();
    }
  }

  private handleVehicleExploded(explodingVeh: VehicleEntity, killer: string): void {
    this.combat.explodeVehicle(
      explodingVeh,
      killer,
      this.player,
      this.peds,
      this.vehicles,
      this.getCombatCallbacks()
    );
  }

  private processVehicleCrashImpacts(impacts: VehicleContactImpact[]): void {
    for (const imp of impacts) {
      const v = this.vehicles.find((veh) => veh.id === imp.vehicleId);
      if (!v || !v.alive || v.damageStage === 'wrecked') continue;

      const lastCrash = this.vehicleCrashCooldowns.get(v.id) ?? -10;
      if (this.elapsedSec - lastCrash < 0.18) continue;

      const spec = VEHICLES[v.specId];
      const excessDv = Math.max(0, imp.deltaV - 4.5);
      const armorMult = spec.crushOnContact ? 0.15 : spec.bulletResistant ? 0.65 : 1.0;
      const dmg = Math.min(80, excessDv * 1.45 * armorMult);
      if (dmg < 1.5) continue;

      this.vehicleCrashCooldowns.set(v.id, this.elapsedSec);
      v.hp = Math.max(0, v.hp - dmg);

      const severity = Math.max(0.15, Math.min(1, excessDv / 22));
      const sparkCount = Math.round(4 + severity * 6);
      for (let i = 0; i < sparkCount; i++) {
        const a = Math.random() * Math.PI * 2;
        const spd = 3 + Math.random() * 6;
        this.pool.spawnParticle(
          'spark',
          imp.impactX,
          imp.impactY,
          v.z + 0.5,
          Math.cos(a) * spd,
          Math.sin(a) * spd,
          1.5 + Math.random() * 2.5,
          0.45 + Math.random() * 0.25,
          0.18 + Math.random() * 0.14,
          i % 2 === 0 ? '#fde047' : '#fb923c',
          1
        );
      }

      if (severity > 0.35) {
        const puffCount = severity > 0.7 ? 3 : 2;
        for (let i = 0; i < puffCount; i++) {
          this.pool.spawnParticle(
            v.hp < v.maxHp * 0.3 ? 'smoke_black' : 'smoke_white',
            imp.impactX,
            imp.impactY,
            v.z + 0.5,
            (Math.random() - 0.5) * 2.2,
            (Math.random() - 0.5) * 2.2,
            1.4 + Math.random(),
            0.9 + Math.random() * 0.5,
            0.45 + Math.random() * 0.25,
            v.hp < v.maxHp * 0.3 ? '#18181b' : '#cbd5e1',
            0.55
          );
        }
      }

      if (v.id === this.player.vehicleId) {
        this.scene.addScreenShake(0.18 + severity * 0.45);
      }

      const distToPlayer = Math.hypot(imp.impactX - this.player.x, imp.impactY - this.player.y);
      if (distToPlayer < 85 && this.elapsedSec - this.lastCollisionSfxTime >= 0.10) {
        const atten = Math.max(0.2, 1 - distToPlayer / 85);
        this.sound.playCollision(severity * atten);
        this.lastCollisionSfxTime = this.elapsedSec;
      }

      if (v.hp <= 0) {
        this.handleVehicleExploded(v, v.id === this.player.vehicleId ? 'player' : 'crash');
      } else {
        VehiclePhysics.syncDamageStage(v);
      }
    }
  }

  private readPlayerVehicleInput(): VehicleControlInput {
    const up = this.keys.has('KeyW') || this.keys.has('ArrowUp');
    const down = this.keys.has('KeyS') || this.keys.has('ArrowDown');
    const left = this.keys.has('KeyA') || this.keys.has('ArrowLeft');
    const right = this.keys.has('KeyD') || this.keys.has('ArrowRight');
    const handbrake = this.keys.has('Space');
    return {
      throttle: (up ? 1 : 0) - (down ? 1 : 0),
      steer: (right ? 1 : 0) - (left ? 1 : 0),
      handbrake,
    };
  }

  private updatePlayerInVehicle(v: VehicleEntity, dt: number): void {
    if (this.player.fireCooldown > 0) this.player.fireCooldown -= dt;

    // Tank turret aims toward mouse or forward
    if (v.specId === 'rhino_apc' || v.specId === 'fdny_ladder') {
      let aim = v.heading;
      if (this.mouseAimActive) {
        const wpos = this.scene.screenToWorld(this.mouseClientX, this.mouseClientY, v.z);
        if (wpos) aim = Math.atan2(wpos.y - v.y, wpos.x - v.x);
      }
      v.turretHeading = aim;
    }

    // Drive-by shooting (Dual Uzis) or Vehicle Special Weapon (Tank / Firetruck)
    const firing =
      this.mouseDown ||
      this.keys.has('ControlLeft') ||
      this.keys.has('ControlRight') ||
      this.keys.has('KeyX');
    if (firing && this.player.fireCooldown <= 0) {
      const spec = VEHICLES[v.specId];
      if (spec.specialWeapon) {
        this.combat.fireVehicleSpecialWeapon(v, v.turretHeading, this.player, this.getCombatCallbacks());
        this.player.fireCooldown = spec.specialWeapon === 'tank_cannon' ? 1.45 : 0.05;
      } else if (this.player.activeWeapon === 'dual_uzis' && this.player.weapons.dual_uzis > 0) {
        let aim = v.heading + Math.PI * 0.5;
        if (this.mouseAimActive) {
          const wpos = this.scene.screenToWorld(this.mouseClientX, this.mouseClientY, v.z);
          if (wpos) aim = Math.atan2(wpos.y - v.y, wpos.x - v.x);
        }
        this.player.weapons.dual_uzis--;
        this.combat.fireWeapon({
          ownerId: 'player',
          weaponId: 'dual_uzis',
          x: v.x,
          y: v.y,
          z: v.z,
          heading: aim,
          layer: v.layer,
          player: this.player,
          peds: this.peds,
          vehicles: this.vehicles,
          cb: this.getCombatCallbacks(),
        });
        this.player.fireCooldown = 1 / WEAPONS.dual_uzis.fireRate;
      }
    }
  }

  private updatePlayerOnFoot(dt: number): void {
    const body = this.physics.getBody(this.player.bodyHandle);
    if (!body) return;

    const pos = body.translation();
    this.player.x = pos.x;
    this.player.y = pos.y;

    // Overpass elevation & jump physics on foot
    const ov = getOverpassElevationAt(this.player.x, this.player.y, this.map.overpasses);
    let groundZ = 0;
    let nextLayer: 0 | 1 = this.player.layer;
    if (ov.onRamp) {
      groundZ = ov.elevation;
      nextLayer = ov.elevation > 2.6 ? 1 : 0;
    } else if (ov.onDeck && this.player.layer === 1) {
      groundZ = ov.elevation;
      nextLayer = 1;
    } else {
      groundZ = 0;
      nextLayer = 0;
    }

    if (this.player.layer === 1 && nextLayer === 0 && this.player.z > groundZ + 0.1) {
      this.player.jumpHeight = Math.max(this.player.jumpHeight, this.player.z - groundZ);
      this.player.isJumping = true;
    }
    if (nextLayer !== this.player.layer) {
      this.player.layer = nextLayer;
      this.physics.setColliderLayer(this.player.colliderHandle, nextLayer);
    }

    if (this.jumpBufferTimer > 0) this.jumpBufferTimer = Math.max(0, this.jumpBufferTimer - dt);
    if (this.player.jumpCooldown > 0) this.player.jumpCooldown = Math.max(0, this.player.jumpCooldown - dt);

    if (this.jumpBufferTimer > 0 && !this.player.isJumping && this.player.jumpCooldown <= 0) {
      this.player.vz = JUMP_INITIAL_VZ;
      this.player.isJumping = true;
      this.jumpBufferTimer = 0;
      this.sound.playJump();
    }

    if (this.player.isJumping) {
      this.player.vz -= JUMP_GRAVITY * dt;
      this.player.jumpHeight += this.player.vz * dt;
      if (this.player.jumpHeight <= 0) {
        this.player.jumpHeight = 0;
        this.player.vz = 0;
        this.player.isJumping = false;
        this.player.jumpCooldown = JUMP_COOLDOWN;
        this.sound.playLand();
      }
    }
    this.player.z = groundZ + this.player.jumpHeight;

    // Water hazard on foot (swim slowly while taking drowning damage when grounded)
    const inWater = isWaterAt(this.map, this.player.x, this.player.y, this.player.layer);
    if (inWater && !this.player.isJumping) {
      this.damagePlayer(14 * dt, 'water');
    }

    const up = this.keys.has('KeyW') || this.keys.has('ArrowUp');
    const down = this.keys.has('KeyS') || this.keys.has('ArrowDown');
    const left = this.keys.has('KeyA') || this.keys.has('ArrowLeft');
    const right = this.keys.has('KeyD') || this.keys.has('ArrowRight');
    const sprinting = (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) && this.player.stamina > 4;

    const baseSpeed = inWater ? 4.2 : sprinting ? 13.4 : 8.6;
    let moveX = 0;
    let moveY = 0;

    if (this.controlMode === 'tank') {
      const turn = (right ? 1 : 0) - (left ? 1 : 0);
      this.player.heading = normalizeAngle(this.player.heading + turn * 4.2 * dt);
      const fwd = (up ? 1 : 0) - (down ? 1 : 0);
      moveX = Math.cos(this.player.heading) * fwd * baseSpeed;
      moveY = Math.sin(this.player.heading) * fwd * baseSpeed;
    } else {
      const ix = (right ? 1 : 0) - (left ? 1 : 0);
      const iy = (down ? 1 : 0) - (up ? 1 : 0);
      const len = Math.hypot(ix, iy);
      if (len > 0.01) {
        moveX = (ix / len) * baseSpeed;
        moveY = (iy / len) * baseSpeed;
        // Turn toward movement if mouse isn't actively firing
        if (!this.mouseDown) {
          const moveAngle = Math.atan2(iy, ix);
          this.player.heading += normalizeAngle(moveAngle - this.player.heading) * Math.min(1, dt * 16);
        }
      }
    }

    // Stamina drain/regen
    if (sprinting && Math.hypot(moveX, moveY) > 1) {
      this.player.stamina = Math.max(0, this.player.stamina - 28 * dt);
    } else {
      this.player.stamina = Math.min(this.player.maxStamina, this.player.stamina + 34 * dt);
    }

    // Maintain jump collision pass-through while airborne OR until clear of any overlapping vehicle OBB
    let overlappingVeh: VehicleEntity | null = null;
    if (this.player.isJumping || this.physics.isPlayerJumpCollisionActive()) {
      for (const v of this.vehicles) {
        if (!v.alive || v.layer !== this.player.layer) continue;
        const vSpec = VEHICLES[v.specId];
        if (
          isCircleOverlappingVehicleOBB(
            this.player.x,
            this.player.y,
            PLAYER_RADIUS + 0.08,
            v.x,
            v.y,
            v.heading,
            vSpec.length * 0.48,
            vSpec.width * 0.46
          )
        ) {
          overlappingVeh = v;
          break;
        }
      }
    }

    const keepPassThrough =
      this.player.isJumping ||
      (this.physics.isPlayerJumpCollisionActive() && overlappingVeh !== null);
    if (keepPassThrough !== this.physics.isPlayerJumpCollisionActive()) {
      this.physics.setPlayerJumping(keepPassThrough, this.player.layer);
    }

    if (!this.player.isJumping && overlappingVeh && Math.hypot(moveX, moveY) < 0.25) {
      const vSpec = VEHICLES[overlappingVeh.specId];
      const dir = computeVehicleOBBEscapeDir(
        this.player.x,
        this.player.y,
        overlappingVeh.x,
        overlappingVeh.y,
        overlappingVeh.heading,
        vSpec.length * 0.48,
        vSpec.width * 0.46
      );
      moveX = dir.x * 5.5;
      moveY = dir.y * 5.5;
    }

    body.setLinvel({ x: moveX, y: moveY }, true);
    this.player.vx = moveX;
    this.player.vy = moveY;
    if (!this.player.isJumping && Math.hypot(moveX, moveY) > 0.8) {
      this.player.walkPhase += dt * (sprinting ? 1.8 : 1.1);
    }

    // Clamp world bounds
    if (this.player.x < 16 || this.player.x > this.map.worldSize - 16 || this.player.y < 16 || this.player.y > this.map.worldSize - 16) {
      const clampedX = Math.max(20, Math.min(this.map.worldSize - 20, this.player.x));
      const clampedY = Math.max(20, Math.min(this.map.worldSize - 20, this.player.y));
      this.player.x = clampedX;
      this.player.y = clampedY;
      this.physics.teleportBody(this.player.bodyHandle, clampedX, clampedY);
      this.snapPlayerPrevPose();
    }

    // Aiming: Mouse aim OR GTA 2 keyboard directional Auto-Aim cone
    const autoTarget = this.combat.findAutoAimTarget(this.player, this.peds, this.vehicles);
    this.player.autoAimTargetId = autoTarget?.id ?? null;
    this.player.autoAimPos = autoTarget?.pos ?? null;

    if (this.mouseDown && this.mouseAimActive) {
      const wpos = this.scene.screenToWorld(this.mouseClientX, this.mouseClientY, this.player.z);
      if (wpos) {
        this.player.heading = Math.atan2(wpos.y - this.player.y, wpos.x - this.player.x);
      }
    }

    // Firing equipped weapon (Space is reserved exclusively for Jump on foot)
    if (this.player.fireCooldown > 0) this.player.fireCooldown -= dt;
    const wantFire =
      this.mouseDown ||
      this.keys.has('ControlLeft') ||
      this.keys.has('ControlRight') ||
      this.keys.has('KeyX');
    if (wantFire && this.player.fireCooldown <= 0) {
      const wId = this.player.activeWeapon;
      const spec = WEAPONS[wId];
      const ammo = this.player.weapons[wId];
      if (spec.infiniteAmmo || ammo > 0) {
        if (!spec.infiniteAmmo) {
          this.player.weapons[wId] = Math.max(0, ammo - 1);
        }
        let fireAngle = this.player.heading;
        if (!this.mouseDown && autoTarget) {
          fireAngle = autoTarget.angle;
          this.player.heading = fireAngle;
        }
        this.combat.fireWeapon({
          ownerId: 'player',
          weaponId: wId,
          x: this.player.x,
          y: this.player.y,
          z: this.player.z,
          heading: fireAngle,
          layer: this.player.layer,
          player: this.player,
          peds: this.peds,
          vehicles: this.vehicles,
          cb: this.getCombatCallbacks(),
        });
        if (wId === 'fists') {
          const punchX = this.player.x + Math.cos(fireAngle) * 1.9;
          const punchY = this.player.y + Math.sin(fireAngle) * 1.9;
          const hooks = this.getMissionHooks();
          for (const mp of this.missions.getMissionProps()) {
            if (!mp.alive) continue;
            if (Math.hypot(mp.x - punchX, mp.y - punchY) <= 2.6 && Math.abs(this.player.z - mp.z) < 3.5) {
              this.missions.damageMissionProp(mp.id, 15, hooks);
              this.pool.spawnParticle('spark', mp.x, mp.y, mp.z + 1.0, 0, 0, 2, 0.5, 0.2, '#fde047', 1);
            }
          }
        }
        this.player.fireCooldown = 1 / spec.fireRate;
      } else {
        // Auto-fallback to fists when ammo runs dry
        this.player.activeWeapon = 'fists';
      }
    }
  }

  private tryToggleVehicle(): void {
    if (this.player.status !== 'alive') return;

    if (this.player.vehicleId) {
      const v = this.vehicles.find((veh) => veh.id === this.player.vehicleId);
      if (v) this.ejectPlayerFromVehicle(v, true);
      return;
    }

    // Find closest non-wrecked vehicle within 6.2m
    let best: VehicleEntity | null = null;
    let bestD = 6.2;
    for (const v of this.vehicles) {
      if (!v.alive || v.damageStage === 'wrecked') continue;
      const d = Math.hypot(v.x - this.player.x, v.y - this.player.y);
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }

    if (!best) return;

    // Hijack driver & seated occupants out onto asphalt if occupied!
    if (best.driverId && best.driverId !== 'player') {
      const seated = this.peds.filter((p) => p.alive && p.vehicleId === best.id);
      if (seated.length > 0) {
        this.ejectVehicleOccupants(best, !seated[0].isMissionEntity);
      } else {
        const ejectX = best.x - Math.sin(best.heading) * 3.2;
        const ejectY = best.y + Math.cos(best.heading) * 3.2;
        const ejected = this.pedSystem.spawnPed({
          role: best.aiRole === 'police' ? 'cop' : best.faction ? 'gang' : 'civilian',
          x: ejectX,
          y: ejectY,
          faction: best.faction,
        });
        ejected.aiState = 'flee';
        this.peds.push(ejected);
      }

      // Carjacking police/gov/military vehicles or in front of cops adds Wanted Heat!
      const isGov = best.specId === 'nypd_cruiser' || best.specId === 'nypd_swat' || best.specId === 'fbi_suv' || best.specId === 'rhino_apc';
      const copNearby = this.peds.some(
        (p) => p.alive && (p.role === 'cop' || p.role === 'swat') && Math.hypot(p.x - best.x, p.y - best.y) < 38
      );
      if (isGov || copNearby) {
        this.wanted.addCrimeHeat(this.player, isGov ? 45 : 25, isGov ? 2 : 1);
      }
    }

    best.driverId = 'player';
    best.aiRole = 'none';
    this.player.vehicleId = best.id;
    this.player.x = best.x;
    this.player.y = best.y;
    this.player.z = best.z;
    this.player.layer = best.layer;
    this.player.heading = best.heading;
    this.player.vz = 0;
    this.player.jumpHeight = 0;
    this.player.isJumping = false;
    this.player.jumpCooldown = 0;
    this.jumpBufferTimer = 0;
    this.snapPlayerPrevPose();
    this.snapVehiclePrevPose(best);
    this.physics.setPlayerJumping(false, best.layer);
    this.physics.setBodyEnabled(this.player.bodyHandle, false);

    // FDNY Ambulance restores +25 HP on entry!
    const spec = VEHICLES[best.specId];
    if (spec.healOnEnter) {
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + spec.healOnEnter);
      this.pushPager(`FDNY AMBULANCE: +${spec.healOnEnter} HEALTH RESTORED!`, 'green', 3);
    }

    if (spec.sideJob) {
      this.pushPager(`${spec.name.toUpperCase()} — PRESS [CAPSLOCK] TO START ${spec.sideJob.toUpperCase()} MISSIONS!`, 'cyan', 4);
    }

    this.sound.playDoorSlam(true);
  }

  private ejectPlayerFromVehicle(
    v: VehicleEntity,
    playerInitiated: boolean,
    overrideDestX?: number,
    overrideDestY?: number
  ): void {
    const speed = Math.abs(v.speed);
    v.driverId = null;
    this.player.vehicleId = null;

    let exitX = v.x;
    let exitY = v.y;

    if (
      overrideDestX !== undefined &&
      overrideDestY !== undefined &&
      !isWaterAt(this.map, overrideDestX, overrideDestY, v.layer)
    ) {
      exitX = overrideDestX;
      exitY = overrideDestY;
    } else {
      const spec = VEHICLES[v.specId];
      const sideDist = spec.width * 0.85 + 1.1;
      const endDist = spec.length * 0.65 + 1.1;
      const cosH = Math.cos(v.heading);
      const sinH = Math.sin(v.heading);
      const candidates: Array<{ dx: number; dy: number; dist: number }> = [
        { dx: -sinH, dy: cosH, dist: sideDist },
        { dx: sinH, dy: -cosH, dist: sideDist },
        { dx: -cosH, dy: -sinH, dist: endDist },
        { dx: cosH, dy: sinH, dist: endDist },
      ];

      for (const c of candidates) {
        const cx = v.x + c.dx * c.dist;
        const cy = v.y + c.dy * c.dist;
        if (isWaterAt(this.map, cx, cy, v.layer)) continue;
        const hit = this.physics.castRay(v.x, v.y, c.dx, c.dy, c.dist + 0.5, v.colliderHandle, v.layer);
        if (hit && hit.meta?.kind === 'building') continue;
        exitX = cx;
        exitY = cy;
        break;
      }
    }

    this.player.x = exitX;
    this.player.y = exitY;
    this.player.z = v.z;
    this.player.layer = v.layer;
    this.player.vz = 0;
    this.player.jumpHeight = 0;
    this.player.isJumping = false;
    this.player.jumpCooldown = 0;
    this.jumpBufferTimer = 0;
    this.snapPlayerPrevPose();
    this.physics.setBodyEnabled(this.player.bodyHandle, true);
    this.physics.teleportBody(this.player.bodyHandle, exitX, exitY);
    this.physics.setPlayerJumping(false, v.layer);
    this.physics.setColliderLayer(this.player.colliderHandle, v.layer);

    if (playerInitiated) {
      this.sound.playDoorSlam(false);
    }

    // High-speed bail-out tuck-and-roll damage
    if (playerInitiated && speed > 14) {
      const dmg = Math.min(28, Math.round((speed - 12) * 1.4));
      this.damagePlayer(dmg, 'bailout');
      this.pushPager(`TUCK & ROLL! -${dmg} HP`, 'amber', 2.5);
    }
  }

  private cycleWeapon(dir: 1 | -1): void {
    const owned = this.player.ownedWeapons;
    if (owned.length <= 1) return;
    const idx = owned.indexOf(this.player.activeWeapon);
    const next = owned[(idx + dir + owned.length) % owned.length];
    this.player.activeWeapon = next;
    this.sound.playUiBeep(640, 0.05);
    this.emitHud();
  }

  private triggerHornOrSiren(): void {
    const v = this.player.vehicleId ? this.vehicles.find((veh) => veh.id === this.player.vehicleId) : null;
    if (!v) return;
    const spec = VEHICLES[v.specId];
    if (spec.hasSiren) {
      v.sirenActive = !v.sirenActive;
      this.pushPager(`EMERGENCY SIRENS: ${v.sirenActive ? 'ON (TRAFFIC WILL PULL ASIDE)' : 'OFF'}`, 'cyan', 3);
    } else if (v.specId === 'ice_cream_van') {
      if (this.jingleNotes.length > 0) {
        this.jingleNotes = [];
        this.jingleTimer = 0;
        this.pushPager('MISTER FROSTY JINGLE: OFF', 'cyan', 2.5);
      } else {
        this.jingleNotes = [659.25, 783.99, 880, 783.99, 659.25, 523.25, 587.33, 659.25, 587.33, 523.25, 659.25, 523.25];
        this.jingleTimer = 0;
        this.pushPager('MISTER FROSTY JINGLE: ON', 'cyan', 3);
      }
    } else {
      this.sound.playHorn();
    }
  }

  private updatePickups(dt: number): void {
    for (const pk of this.pickups) {
      if (!pk.active) {
        if (pk.respawnTimer > 0) {
          pk.respawnTimer -= dt;
          if (pk.respawnTimer <= 0) pk.active = true;
        }
        continue;
      }

      if (Math.hypot(pk.x - this.player.x, pk.y - this.player.y) <= (this.player.vehicleId ? 3.5 : 2.5)) {
        if (pk.type === 'kill_frenzy' && pk.killFrenzyId) {
          if (this.missions.activeKillFrenzy) continue;
          pk.active = false;
          pk.respawnTimer = 90;
          this.missions.startKillFrenzy(pk.killFrenzyId, this.player, this.getMissionHooks());
        } else if (pk.type === 'weapon' && pk.weaponId) {
          this.grantWeapon(pk.weaponId, pk.amount, true);
          this.sound.playCashChime();
          this.pushPager(`PICKED UP ${WEAPONS[pk.weaponId].name.toUpperCase()} (+${pk.amount} AMMO)`, 'green', 3);
          pk.active = false;
          pk.respawnTimer = 35;
        } else if (pk.type === 'health') {
          if (this.player.hp >= this.player.maxHp) continue;
          this.player.hp = Math.min(this.player.maxHp, this.player.hp + pk.amount);
          this.sound.playCashChime();
          this.pushPager(`HEALTH +${pk.amount}`, 'green', 2.5);
          pk.active = false;
          pk.respawnTimer = 30;
        } else if (pk.type === 'armor') {
          if (this.player.armor >= this.player.maxArmor) continue;
          this.player.armor = Math.min(this.player.maxArmor, this.player.armor + pk.amount);
          this.sound.playCashChime();
          this.pushPager('BODY ARMOR REPLENISHED!', 'cyan', 2.5);
          pk.active = false;
          pk.respawnTimer = 40;
        } else if (pk.type === 'bribe') {
          if (this.player.wantedStars === 0) continue;
          this.wanted.setWantedStars(this.player, Math.max(0, this.player.wantedStars - 2));
          if (this.player.wantedStars === 0) this.wanted.clearWanted(this.player, this.vehicles, this.peds);
          this.sound.playCashChime();
          this.pushPager('POLICE BRIBE COLLECTED! WANTED LEVEL REDUCED!', 'amber', 4);
          pk.active = false;
          pk.respawnTimer = 45;
        } else if (pk.type === 'cash') {
          this.awardCash(pk.amount, 'CASH CASE');
          this.sound.playCashChime();
          this.missions.notifyPickupCollected('cash', pk.id);
          pk.active = false;
          pk.respawnTimer = 0;
        }
      }
    }
  }

  private grantWeapon(weaponId: WeaponId, ammo: number, equip = false): void {
    const spec = WEAPONS[weaponId];
    if (!this.player.ownedWeapons.includes(weaponId)) {
      this.player.ownedWeapons.push(weaponId);
      this.player.ownedWeapons.sort((a, b) => WEAPON_ORDER.indexOf(a) - WEAPON_ORDER.indexOf(b));
    }
    if (spec.infiniteAmmo) {
      this.player.weapons[weaponId] = -1;
    } else {
      this.player.weapons[weaponId] = Math.min(spec.maxAmmo, (this.player.weapons[weaponId] || 0) + ammo);
    }
    if (equip) this.player.activeWeapon = weaponId;
  }

  private awardCash(amount: number, label?: string): void {
    const scaled = Math.round(amount * this.player.multiplier);
    this.player.cash += scaled;
    this.player.totalCashEarned += scaled;
    this.cashPopups.push({
      id: this.msgSeq++,
      amount: scaled,
      label,
      timestamp: performance.now(),
    });
  }

  private bumpMultiplier(): void {
    this.player.multiplierProgress++;
    this.player.multiplierDecayTimer = 14;
    if (this.player.multiplierProgress >= 3 && this.player.multiplier < 5) {
      this.player.multiplier++;
      this.player.multiplierProgress = 0;
      this.pushPager(`SCORE MULTIPLIER UP! x${this.player.multiplier}`, 'amber', 3);
    }
  }

  private adjustRespect(faction: FactionId, delta: number): void {
    this.respect[faction] = Math.max(
      RESPECT_RULES.MIN,
      Math.min(RESPECT_RULES.MAX, this.respect[faction] + delta)
    );
  }

  private damagePlayer(amount: number, _source: string): void {
    if (this.player.godMode || this.player.status !== 'alive') return;

    const preHitMultiplier = this.player.multiplier;

    // Reset score multiplier on heavy hit
    if (amount >= 15 && this.player.multiplier > 1) {
      this.player.multiplier = 1;
      this.player.multiplierProgress = 0;
    }

    let rem = amount;
    if (this.player.armor > 0) {
      const absorbed = Math.min(this.player.armor, rem);
      this.player.armor -= absorbed;
      rem -= absorbed;
    }
    this.player.hp = Math.max(0, this.player.hp - rem);
    if (this.player.hp <= 0) {
      this.triggerWasted(preHitMultiplier);
    }
  }

  private triggerWasted(multiplierSnapshot = this.player.multiplier): void {
    this.player.z = Math.max(0, this.player.z - this.player.jumpHeight);
    this.playerPrevPose.z = this.player.z;
    this.player.vz = 0;
    this.player.jumpHeight = 0;
    this.player.isJumping = false;
    this.player.jumpCooldown = 0;
    this.jumpBufferTimer = 0;
    this.jingleNotes = [];
    this.physics.setPlayerJumping(false, this.player.layer);
    this.player.status = 'wasted';
    this.player.respawnTimer = 4.0;
    this.incidentElapsed = 0;
    this.statusBanner = 'WASTED';
    this.incidentSummary = {
      kind: 'wasted',
      facilityName: 'Empire General Hospital',
      feeDeducted: Math.min(this.player.cash, this.gameMode === 'classic' ? 1000 : 250),
      multiplierLost: multiplierSnapshot,
      weaponsConfiscated: [],
      countdownSec: 4,
      canSkip: false,
    };
    this.sound.playWastedSting();
    this.pushPager('WASTED! MEDEVAC TO EMPIRE GENERAL HOSPITAL...', 'red', 4);
    this.emitHud();
  }

  private triggerBusted(): void {
    this.player.z = Math.max(0, this.player.z - this.player.jumpHeight);
    this.playerPrevPose.z = this.player.z;
    this.player.vz = 0;
    this.player.jumpHeight = 0;
    this.player.isJumping = false;
    this.player.jumpCooldown = 0;
    this.jumpBufferTimer = 0;
    this.jingleNotes = [];
    this.physics.setPlayerJumping(false, this.player.layer);
    this.player.status = 'busted';
    this.player.respawnTimer = 4.0;
    this.incidentElapsed = 0;
    this.statusBanner = 'BUSTED';
    const confiscated =
      this.gameMode === 'classic'
        ? this.player.ownedWeapons.filter((w) => w !== 'fists' && w !== 'pistol')
        : [];
    this.incidentSummary = {
      kind: 'busted',
      facilityName: 'Midtown NYPD Precinct',
      feeDeducted: Math.min(this.player.cash, this.gameMode === 'classic' ? 1000 : 250),
      multiplierLost: this.player.multiplier,
      weaponsConfiscated: confiscated,
      countdownSec: 4,
      canSkip: false,
    };
    this.sound.playWastedSting();
    this.pushPager('BUSTED BY NYPD! PROCESSED AT MIDTOWN PRECINCT...', 'red', 4);
    this.emitHud();
  }

  private respawnPlayer(): void {
    const wasBusted = this.player.status === 'busted';
    if (this.player.vehicleId) {
      const v = this.vehicles.find((veh) => veh.id === this.player.vehicleId);
      if (v) v.driverId = null;
      this.player.vehicleId = null;
    }

    this.player.status = 'alive';
    this.statusBanner = null;
    this.incidentSummary = null;
    this.incidentElapsed = 0;
    this.player.hp = this.player.maxHp;
    this.player.stamina = this.player.maxStamina;
    this.player.multiplier = 1;
    this.player.cash = Math.max(0, this.player.cash - (this.gameMode === 'classic' ? 1000 : 250));

    // In Classic mode, being busted confiscates non-pistol weapons
    if (wasBusted && this.gameMode === 'classic') {
      this.player.ownedWeapons = ['fists', 'pistol'];
      this.player.activeWeapon = 'pistol';
      this.player.weapons.pistol = Math.max(45, this.player.weapons.pistol);
    }

    this.wanted.clearWanted(this.player, this.vehicles, this.peds);
    const spawn = wasBusted ? { x: 448, y: 832 } : { x: 640, y: 1536 };
    this.physics.setBodyEnabled(this.player.bodyHandle, true);
    this.teleportPlayer(spawn.x, spawn.y);
    this.emitHud();
  }

  private pushPager(text: string, tone: PagerMessage['tone'] = 'green', durationSec = 5): void {
    this.pagerMessages.push({
      id: this.msgSeq++,
      text,
      tone,
      expiresAt: performance.now() + durationSec * 1000,
    });
    if (this.pagerMessages.length > 4) {
      this.pagerMessages.shift();
    }
  }

  private getCombatCallbacks(): CombatCallbacks {
    return {
      onWeaponSound: (w, vol) => this.sound.playWeaponSound(w, vol),
      onExplosionSound: (vol) => this.sound.playExplosion(vol),
      onPedSplat: (px, py) => {
        const d = Math.hypot(px - this.player.x, py - this.player.y);
        if (d < 90 && this.elapsedSec - this.lastPedSplatSfxTime >= 0.08) {
          this.sound.playPedSplat(Math.max(0.18, 1 - d / 90));
          this.lastPedSplatSfxTime = this.elapsedSec;
        }
      },
      onScreenShake: (amt) => this.scene.addScreenShake(amt),
      onPedKilled: (ped, killerId, isRunOver) => {
        if (ped.missionTag?.startsWith('elvis_convoy_')) {
          const convoy = this.elvisConvoys.find((c) => c.id === ped.missionTag);
          if (convoy) {
            if (killerId === 'player' && isRunOver) {
              convoy.killedByRunOver++;
            }
            const allDead = convoy.pedIds.every((pid) => {
              const member = this.peds.find((p) => p.id === pid);
              return !member || !member.alive;
            });
            if (allDead && !convoy.completed && convoy.killedByRunOver >= convoy.pedIds.length) {
              convoy.completed = true;
              this.awardCash(5000, 'ELVIS HAS LEFT THE BUILDING!');
              this.sound.playMissionComplete();
              this.pushPager(
                `ELVIS HAS LEFT THE BUILDING! +$${(5000 * this.player.multiplier).toLocaleString()}`,
                'amber',
                6
              );
            }
          }
        }
        if (killerId !== 'player') return;
        this.bumpMultiplier();
        const label = isRunOver ? 'ROADKILL' : ped.role === 'boss' ? 'BOSS DOWN' : undefined;
        if (ped.role === 'gang' || ped.role === 'boss') {
          this.awardCash(ped.role === 'boss' ? 10000 : 500, label);
          if (ped.faction) {
            this.adjustRespect(ped.faction, RESPECT_RULES.KILL_LOSS);
            const rival = GANGS[ped.faction].rival;
            this.adjustRespect(rival, RESPECT_RULES.KILL_RIVAL_GAIN);
          }
          this.missions.notifyKillFrenzyProgress('gangsters', this.player, this.getMissionHooks());
          this.wanted.addCrimeHeat(this.player, 18, 1);
        } else if (ped.role === 'cop' || ped.role === 'swat' || ped.role === 'fbi' || ped.role === 'army') {
          this.awardCash(750, label);
          this.wanted.addCrimeHeat(this.player, 42, 2);
        } else {
          this.awardCash(150, label);
          this.wanted.addCrimeHeat(this.player, 16, 1);
        }
      },
      onVehicleDestroyed: (veh, killerId) => {
        if (veh.id === this.player.vehicleId) {
          this.ejectPlayerFromVehicle(veh, false);
        }
        // Eject any seated AI/mission occupants right before explosion blast runs
        this.ejectVehicleOccupants(veh, false);
        if (killerId !== 'player') return;
        this.bumpMultiplier();
        this.awardCash(1000);
        this.missions.notifyKillFrenzyProgress('vehicles', this.player, this.getMissionHooks());
        this.wanted.addCrimeHeat(this.player, 32, 1);
      },
      onPlayerDamaged: (amt, src) => this.damagePlayer(amt, src),
      onCrimeCommitted: (heat, minStars) => this.wanted.addCrimeHeat(this.player, heat, minStars),
      onPanicTriggered: (x, y) => this.pedSystem.triggerPanic(x, y),
      onPropExplosionHit: (x, y, r) => this.missions.notifyExplosionAt(x, y, r, this.getMissionHooks()),
    };
  }

  private getMissionHooks(): MissionEngineHooks {
    return {
      spawnVehicle: (specId, x, y, heading, aiRole, targetNodeId, isMission, missionTag) =>
        this.spawnVehicle(specId, x, y, heading, aiRole, targetNodeId, isMission, missionTag),
      spawnPed: (params) => {
        const p = this.pedSystem.spawnPed(params);
        this.peds.push(p);
        return p;
      },
      grantWeapon: (w, ammo, equip) => this.grantWeapon(w, ammo, equip),
      awardCash: (amt, lbl) => this.awardCash(amt, lbl),
      adjustRespect: (f, d) => this.adjustRespect(f, d),
      setWantedStars: (s) => this.wanted.setWantedStars(this.player, s),
      clearWanted: () => this.wanted.clearWanted(this.player, this.vehicles, this.peds),
      pushPager: (t, tone, dur) => this.pushPager(t, tone, dur),
      playSound: (kind) => {
        if (kind === 'complete') this.sound.playMissionComplete();
        else if (kind === 'cash') this.sound.playCashChime();
        else if (kind === 'paynspray') this.sound.playPayNSpray();
        else if (kind === 'crusher') this.sound.playCarCrusher();
        else this.sound.playUiBeep();
      },
      saveAtChapel: () => this.saveToSlot(1),
      onCityClaimed: () => {
        this.screen = 'victory';
        this.emitHud();
      },
      spawnPickup: (pk) => this.spawnPickup(pk),
      despawnPickups: (ids) => {
        if (ids.length === 0) return;
        const idSet = new Set(ids);
        this.pickups = this.pickups.filter((pk) => !idSet.has(pk.id));
      },
      setPedInVehicle: (ped, veh, destX, destY) => this.setPedInVehicle(ped, veh, destX, destY),
      ejectPlayerFromVehicle: (veh, destX, destY) => this.ejectPlayerFromVehicle(veh, false, destX, destY),
      onPropExplosion: (x, y, z, type) => {
        this.combat.triggerExplosion(
          x,
          y,
          z,
          type === 'fuel_tanker' ? 15 : 7,
          type === 'fuel_tanker' ? 220 : 80,
          'player',
          this.player,
          this.peds,
          this.vehicles,
          this.getCombatCallbacks()
        );
      },
    };
  }

  private setPedInVehicle(ped: PedEntity, veh: VehicleEntity | null, destX?: number, destY?: number): void {
    if (veh) {
      ped.vehicleId = veh.id;
      ped.x = veh.x;
      ped.y = veh.y;
      ped.z = veh.z;
      ped.layer = veh.layer;
      ped.heading = veh.heading;
      this.physics.setBodyEnabled(ped.bodyHandle, false);
    } else {
      ped.vehicleId = null;
      const ex = destX ?? ped.x;
      const ey = destY ?? ped.y;
      ped.x = ex;
      ped.y = ey;
      this.physics.setBodyEnabled(ped.bodyHandle, true);
      this.physics.teleportBody(ped.bodyHandle, ex, ey);
      this.physics.setColliderLayer(ped.colliderHandle, ped.layer);
    }
  }

  private ejectVehicleOccupants(v: VehicleEntity, makeFlee = false): void {
    const occupants = this.peds.filter((p) => p.alive && p.vehicleId === v.id);
    if (occupants.length === 0) return;
    const spec = VEHICLES[v.specId];
    const sideDist = spec.width * 0.75 + 1.1;
    const cosH = Math.cos(v.heading);
    const sinH = Math.sin(v.heading);

    occupants.forEach((p, idx) => {
      const sign = idx % 2 === 0 ? -1 : 1;
      const back = Math.floor(idx / 2) * 1.8;
      let ex = v.x + sign * -sinH * sideDist - cosH * back;
      let ey = v.y + sign * cosH * sideDist - sinH * back;
      if (isWaterAt(this.map, ex, ey, v.layer)) {
        ex = v.x;
        ey = v.y;
      }
      p.layer = v.layer;
      p.z = v.z;
      this.setPedInVehicle(p, null, ex, ey);
      if (makeFlee) p.aiState = 'flee';
    });

    if (v.driverId && v.driverId !== 'player') {
      v.driverId = null;
    }
  }

  private syncAndDisembarkSeatedPeds(dt: number): void {
    for (const list of this.seatedByVeh.values()) {
      list.length = 0;
      this.seatedVehListPool.push(list);
    }
    this.seatedByVeh.clear();

    for (let i = 0; i < this.peds.length; i++) {
      const p = this.peds[i];
      if (!p.alive || !p.vehicleId) continue;
      const v = this.findVehicleById(p.vehicleId);
      if (!v || !v.alive || v.damageStage === 'wrecked') {
        this.setPedInVehicle(p, null, p.x, p.y);
        continue;
      }
      p.x = v.x;
      p.y = v.y;
      p.z = v.z;
      p.layer = v.layer;
      p.heading = v.heading;
      p.vx = v.vx;
      p.vy = v.vy;
      if (v.id !== this.player.vehicleId) {
        let list = this.seatedByVeh.get(v.id);
        if (!list) {
          list = this.seatedVehListPool.pop() ?? [];
          this.seatedByVeh.set(v.id, list);
        }
        list.push(p);
      }
    }

    for (const [vehId, occupants] of this.seatedByVeh.entries()) {
      const v = this.findVehicleById(vehId);
      if (!v) continue;
      let hasMissionOccupant = false;
      for (let i = 0; i < occupants.length; i++) {
        if (occupants[i].isMissionEntity) {
          hasMissionOccupant = true;
          break;
        }
      }
      if (!hasMissionOccupant) continue;
      const dist = Math.hypot(v.x - this.player.x, v.y - this.player.y);
      const speedAbs = Math.abs(v.speed);
      if (dist < 45 && speedAbs < 1.0) {
        this.vehicleStallTimers.set(v.id, (this.vehicleStallTimers.get(v.id) ?? 0) + dt);
      } else {
        this.vehicleStallTimers.set(v.id, 0);
      }
      const stalled = (this.vehicleStallTimers.get(v.id) ?? 0) > 2.0;
      const closeEngage = dist < 18 && speedAbs < 5.5;
      if (v.damageStage === 'burning' || closeEngage || stalled) {
        this.ejectVehicleOccupants(v, false);
        this.vehicleStallTimers.delete(v.id);
      }
    }
  }

  private updateAllyFollower(dt: number, playerVeh: VehicleEntity | null): void {
    const allyId = this.missions.getAllyPedId();
    if (!allyId) return;
    const ally = this.peds.find((p) => p.id === allyId && p.alive);
    if (!ally) return;

    if (this.missions.isAllyCaged()) {
      ally.hp = ally.maxHp;
      const body = this.physics.getBody(ally.bodyHandle);
      if (body) {
        body.setLinvel({ x: 0, y: 0 }, true);
      }
      ally.vx = 0;
      ally.vy = 0;
      return;
    }

    if (playerVeh && playerVeh.alive) {
      if (ally.vehicleId !== playerVeh.id) {
        if (Math.hypot(ally.x - this.player.x, ally.y - this.player.y) < 8.5) {
          this.setPedInVehicle(ally, playerVeh);
          this.pushPager('BROTHERHOOD BOSS BOARDED — DRIVE TO RED HOOK WAREHOUSE!', 'green', 4);
        } else if (ally.vehicleId === null) {
          const body = this.physics.getBody(ally.bodyHandle);
          if (body) {
            const ang = Math.atan2(this.player.y - ally.y, this.player.x - ally.x);
            const spd = 8.4;
            body.setLinvel({ x: Math.cos(ang) * spd, y: Math.sin(ang) * spd }, true);
            ally.heading = ang;
            ally.vx = Math.cos(ang) * spd;
            ally.vy = Math.sin(ang) * spd;
            ally.walkPhase += dt * 4.5;
          }
        }
      }
    } else {
      if (ally.vehicleId !== null) {
        const ex = this.player.x + Math.cos(this.player.heading + Math.PI * 0.5) * 2.2;
        const ey = this.player.y + Math.sin(this.player.heading + Math.PI * 0.5) * 2.2;
        this.setPedInVehicle(ally, null, ex, ey);
      }
      const body = this.physics.getBody(ally.bodyHandle);
      if (body) {
        const dist = Math.hypot(this.player.x - ally.x, this.player.y - ally.y);
        if (dist > 3.0) {
          const ang = Math.atan2(this.player.y - ally.y, this.player.x - ally.x);
          const spd = 8.4;
          body.setLinvel({ x: Math.cos(ang) * spd, y: Math.sin(ang) * spd }, true);
          ally.heading = ang;
          ally.vx = Math.cos(ang) * spd;
          ally.vy = Math.sin(ang) * spd;
          ally.walkPhase += dt * 4.5;
        } else {
          body.setLinvel({ x: 0, y: 0 }, true);
          ally.vx = 0;
          ally.vy = 0;
        }
      }
    }
  }

  private updateElvisConvoys(dt: number): void {
    // Update & prune active convoys
    for (let i = this.elvisConvoys.length - 1; i >= 0; i--) {
      const convoy = this.elvisConvoys[i];
      const members = convoy.pedIds
        .map((id) => this.peds.find((p) => p.id === id))
        .filter((p): p is PedEntity => Boolean(p && p.alive));

      if (members.length === 0) {
        this.elvisConvoys.splice(i, 1);
        this.elvisSpawnTimer = 18.0;
        continue;
      }

      const allFar = members.every((m) => Math.hypot(m.x - this.player.x, m.y - this.player.y) > 155);
      if (allFar) {
        for (const m of members) this.removePed(m);
        this.elvisConvoys.splice(i, 1);
        this.elvisSpawnTimer = 18.0;
        continue;
      }

      const lead = members[0];
      const aheadX = lead.x + Math.cos(convoy.heading) * 4.5;
      const aheadY = lead.y + Math.sin(convoy.heading) * 4.5;
      const aheadTile = getTileAtWorld(this.map, aheadX, aheadY);
      if (isWaterAt(this.map, aheadX, aheadY, lead.layer) || aheadTile === TILE_ENUM.building) {
        convoy.heading = normalizeAngle(convoy.heading + Math.PI);
      }

      for (const m of members) {
        if (m.aiState === 'flee') continue;
        const body = this.physics.getBody(m.bodyHandle);
        if (!body) continue;
        const vx = Math.cos(convoy.heading) * 2.8;
        const vy = Math.sin(convoy.heading) * 2.8;
        body.setLinvel({ x: vx, y: vy }, true);
        m.vx = vx;
        m.vy = vy;
        m.heading = convoy.heading;
        m.wanderAngle = convoy.heading;
        m.walkPhase += dt * 1.7;
      }
    }

    if (this.elvisConvoys.length > 0) return;
    if (this.currentDistrict !== 'midtown' && this.currentDistrict !== 'financial_district') return;

    this.elvisSpawnTimer -= dt;
    if (this.elvisSpawnTimer > 0) return;
    this.elvisSpawnTimer = 10.0;

    // Find sidewalk strip 38..85m from player in Midtown / Financial District
    for (let attempt = 0; attempt < 24; attempt++) {
      const a = Math.random() * Math.PI * 2;
      const d = 38 + Math.random() * 44;
      const sx = Math.max(64, Math.min(this.map.worldSize - 64, this.player.x + Math.cos(a) * d));
      const sy = Math.max(64, Math.min(this.map.worldSize - 64, this.player.y + Math.sin(a) * d));
      const distId = getDistrictAt(sx, sy);
      if (distId !== 'midtown' && distId !== 'financial_district') continue;
      if (getTileAtWorld(this.map, sx, sy) !== TILE_ENUM.sidewalk) continue;

      const cardinals = [0, Math.PI * 0.5, Math.PI, -Math.PI * 0.5];
      const heading = cardinals[Math.floor(Math.random() * cardinals.length)];
      const positions: { x: number; y: number }[] = [];
      let valid = true;
      for (let k = 0; k < 5; k++) {
        const px = sx - Math.cos(heading) * k * 2.3;
        const py = sy - Math.sin(heading) * k * 2.3;
        const tile = getTileAtWorld(this.map, px, py);
        if (isWaterAt(this.map, px, py, 0) || tile === TILE_ENUM.building) {
          valid = false;
          break;
        }
        positions.push({ x: px, y: py });
      }
      if (!valid) continue;

      const convoyId = `elvis_convoy_${this.elvisSeq++}`;
      const pedIds: string[] = [];
      for (const pos of positions) {
        const elvis = this.pedSystem.spawnPed({
          role: 'civilian',
          x: pos.x,
          y: pos.y,
          isMissionEntity: true,
          missionTag: convoyId,
        });
        elvis.shirtColor = '#f8fafc';
        elvis.pantsColor = '#f8fafc';
        elvis.heading = heading;
        elvis.wanderAngle = heading;
        elvis.stateTimer = 60;
        this.peds.push(elvis);
        pedIds.push(elvis.id);
      }

      this.elvisConvoys.push({
        id: convoyId,
        pedIds,
        killedByRunOver: 0,
        heading,
        completed: false,
      });
      break;
    }
  }

  private updateMissionPropHits(dt: number): void {
    const props = this.missions.getMissionProps();
    if (props.length === 0) return;
    let anyAlive = false;
    for (let i = 0; i < props.length; i++) {
      if (props[i].alive) {
        anyAlive = true;
        break;
      }
    }
    if (!anyAlive) return;
    const hooks = this.getMissionHooks();

    for (const [k, cd] of this.propRamCooldowns.entries()) {
      if (cd - dt <= 0) this.propRamCooldowns.delete(k);
      else this.propRamCooldowns.set(k, cd - dt);
    }

    // 1. Projectiles vs destructible mission props
    for (const pr of this.pool.projectiles) {
      if (!pr.active || pr.isWater) continue;
      if (pr.weaponId === 'grenade') continue; // grenades detonate via fuse -> onPropExplosionHit
      const prevX = pr.x - pr.vx * dt;
      const prevY = pr.y - pr.vy * dt;

      for (const mp of props) {
        if (!mp.alive || Math.abs(pr.z - mp.z) >= 4.5) continue;
        if (distPointToSegment2D(mp.x, mp.y, prevX, prevY, pr.x, pr.y) <= 2.25) {
          pr.active = false;
          if (pr.weaponId === 'rpg') {
            this.combat.triggerExplosion(
              pr.x,
              pr.y,
              pr.z,
              14,
              pr.damage,
              pr.ownerId,
              this.player,
              this.peds,
              this.vehicles,
              this.getCombatCallbacks()
            );
          } else if (pr.weaponId === 'molotov') {
            this.combat.detonateMolotov(pr.x, pr.y, pr.z, pr.ownerId, this.getCombatCallbacks());
          } else {
            for (let s = 0; s < 3; s++) {
              const a = Math.random() * Math.PI * 2;
              this.pool.spawnParticle(
                pr.weaponId === 'flamethrower' ? 'flame' : 'spark',
                mp.x,
                mp.y,
                mp.z + 1.0,
                Math.cos(a) * 4,
                Math.sin(a) * 4,
                2,
                0.45,
                0.2,
                pr.weaponId === 'flamethrower' ? '#fb923c' : '#fde047',
                1
              );
            }
            this.missions.damageMissionProp(mp.id, pr.damage, hooks);
          }
          break;
        }
      }
    }

    // 2. Active FirePools vs destructible mission props
    for (const fp of this.pool.firePools) {
      if (!fp.active) continue;
      for (const mp of props) {
        if (!mp.alive || Math.abs(mp.z - fp.z) >= 3.5) continue;
        if (Math.hypot(mp.x - fp.x, mp.y - fp.y) <= fp.radius + 1.8) {
          this.missions.damageMissionProp(mp.id, 36 * dt, hooks);
        }
      }
    }

    // 3. Vehicle ramming vs destructible mission props
    for (const v of this.vehicles) {
      if (!v.alive || v.damageStage === 'wrecked' || v.layer !== 0) continue;
      const spd = Math.hypot(v.vx, v.vy);
      if (spd <= 4.0) continue;
      const spec = VEHICLES[v.specId];
      for (const mp of props) {
        if (!mp.alive) continue;
        const cdKey = `${v.id}:${mp.id}`;
        if ((this.propRamCooldowns.get(cdKey) ?? 0) > 0) continue;
        if (
          isCircleOverlappingVehicleOBB(
            mp.x,
            mp.y,
            1.85,
            v.x,
            v.y,
            v.heading,
            spec.length * 0.5,
            spec.width * 0.5
          )
        ) {
          this.propRamCooldowns.set(cdKey, 0.35);
          this.missions.damageMissionProp(mp.id, Math.min(120, spd * 5.5), hooks);
          for (let s = 0; s < 5; s++) {
            const a = Math.random() * Math.PI * 2;
            this.pool.spawnParticle('spark', mp.x, mp.y, mp.z + 0.8, Math.cos(a) * 5, Math.sin(a) * 5, 2, 0.5, 0.2, '#fde047', 1);
          }
          this.sound.playCollision(0.75);
          const body = this.physics.getBody(v.bodyHandle);
          if (body) {
            body.setLinvel({ x: v.vx * 0.45, y: v.vy * 0.45 }, true);
          }
        }
      }
    }
  }

  // ================= RENDER & HUD SNAPSHOT =================

  private renderFrame(alpha: number, frameDt: number): void {
    const gps = this.missions.getGpsTarget(this.player, this.respect);
    const rd = this.reusableRenderData;
    rd.player = this.player;
    rd.vehicles = this.vehicles;
    rd.peds = this.peds;
    rd.pickups = this.pickups;
    rd.activeChunkKeys = this.chunks.activeChunkKeys;
    rd.districtId = this.currentDistrict;
    rd.timeOfDay = this.timeOfDay;
    rd.elapsedSec = this.elapsedSec;
    rd.objectivePos = gps ? gps.pos : null;
    rd.objectiveRadius = gps ? gps.radius : 12;
    rd.objectiveColor = gps ? gps.color : '#22c55e';
    rd.lightingMode = this.lightingMode;
    rd.nsGreen = this.traffic.isNSGreen();
    rd.missionProps = this.missions.getMissionProps();
    rd.alpha = alpha;
    rd.frameDt = frameDt;
    rd.playerPrev = this.playerPrevPose;
    rd.vehiclePrevMap = this.vehiclePrevPoses;
    this.scene.render(rd, alpha, frameDt);
  }

  private computeHudSignature(): string {
    const playerVeh = this.findVehicleById(this.player.vehicleId);
    const activeVeh = playerVeh && playerVeh.alive ? playerVeh : null;
    const m = this.missions.activeMission;
    const kf = this.missions.activeKillFrenzy;
    const sj = this.missions.activeSideJob;
    const inc = this.incidentSummary;
    let alivePeds = 0;
    for (let i = 0; i < this.peds.length; i++) {
      if (this.peds[i].alive) alivePeds++;
    }
    const lastPagerId = this.pagerMessages.length > 0 ? this.pagerMessages[this.pagerMessages.length - 1].id : -1;
    return `${this.screen}|${this.player.status}|${Math.round(this.player.hp)}|${Math.round(this.player.armor)}|${Math.round(this.player.stamina)}|${this.player.cash}|${this.player.multiplier}|${this.player.wantedStars}|${this.player.policeLineOfSight ? 1 : 0}|${activeVeh ? activeVeh.id : ''}|${activeVeh ? Math.round((Math.abs(activeVeh.speed) * 3.6) / 0.72) : 0}|${activeVeh ? Math.round((activeVeh.hp / activeVeh.maxHp) * 100) : 0}|${activeVeh?.sirenActive ? 1 : 0}|${this.player.activeWeapon}|${this.player.weapons[this.player.activeWeapon]}|${this.player.ownedWeapons.length}|${this.currentDistrict}|${Math.round(this.player.x)}|${Math.round(this.player.y)}|${Math.round(this.player.heading * 20)}|${m ? `${m.missionId}:${m.stageIndex}:${m.stageProgress}:${m.stageTimer > 0 ? Math.ceil(m.stageTimer) : Math.ceil(m.overallTimer)}` : ''}|${kf ? `${kf.progress}:${Math.ceil(kf.timeLeft)}` : ''}|${sj ? `${sj.level}:${Math.ceil(sj.timeLeft)}` : ''}|${this.nearbyPrompt ?? ''}|${this.pagerMessages.length}:${lastPagerId}|${this.cashPopups.length}|${inc ? `${inc.countdownSec}:${inc.canSkip ? 1 : 0}` : ''}|${this.currentFps}|${this.vehicles.length}|${alivePeds}|${this.chunks.getActiveCount()}|${this.respect.syndicate}:${this.respect.yakuza}:${this.respect.brotherhood}`;
  }

  private emitHudIfDirty(): void {
    if (this.listeners.size === 0) return;
    const sig = this.computeHudSignature();
    if (sig !== this.lastHudSig) {
      this.emitHud();
    }
  }

  private emitHud(): void {
    if (this.listeners.size === 0) return;
    this.lastHudSig = this.computeHudSignature();
    const snap = this.buildSnapshot();
    this.listeners.forEach((fn) => fn(snap));
  }

  public buildSnapshot(): HudSnapshot {
    const foundVeh = this.findVehicleById(this.player.vehicleId);
    const playerVeh = foundVeh && foundVeh.alive ? foundVeh : null;
    const vehSpec = playerVeh ? VEHICLES[playerVeh.specId] : null;
    const dist = DISTRICTS[this.currentDistrict];
    const gps = this.missions.getGpsTarget(this.player, this.respect);

    let gpsAngleRad: number | null = null;
    let gpsDistanceM: number | null = null;
    if (gps) {
      gpsAngleRad = Math.atan2(gps.pos.y - this.player.y, gps.pos.x - this.player.x);
      gpsDistanceM = Math.round(Math.hypot(gps.pos.x - this.player.x, gps.pos.y - this.player.y));
    }

    // Build Minimap Blips (reuse prebuilt static facility blips)
    const blips: MinimapBlip[] = [];
    for (let i = 0; i < this.staticFacilityBlips.length; i++) {
      blips.push(this.staticFacilityBlips[i]);
    }

    // Available Payphones
    for (const ph of PAYPHONES) {
      if (!this.missions.isPayphoneAvailable(ph, this.respect)) continue;
      blips.push({
        x: ph.x,
        y: ph.y,
        type: 'payphone',
        color: ph.tier === 'green' ? '#22c55e' : ph.tier === 'yellow' ? '#facc15' : '#ef4444',
        pulse: true,
      });
    }

    // Active Kill Frenzy skulls
    for (const pk of this.pickups) {
      if (pk.active && pk.type === 'kill_frenzy') {
        blips.push({ x: pk.x, y: pk.y, type: 'kill_frenzy', color: '#f43f5e' });
      }
    }

    // Nearby Police & Mission Enemy Blips
    for (const v of this.vehicles) {
      if (!v.alive || v.damageStage === 'wrecked') continue;
      if (v.aiRole === 'police' || v.aiRole === 'swat' || v.aiRole === 'fbi' || v.aiRole === 'army') {
        blips.push({ x: v.x, y: v.y, type: 'cop', color: '#3b82f6', heading: v.heading });
      } else if (v.isMissionEntity && v.driverId && v.driverId !== 'player') {
        blips.push({ x: v.x, y: v.y, type: 'enemy', color: '#ef4444' });
      }
    }
    for (const p of this.peds) {
      if (!p.alive || p.vehicleId) continue;
      if (p.role === 'boss') {
        blips.push({ x: p.x, y: p.y, type: 'boss', color: '#facc15', pulse: true });
      } else if (p.role === 'ally') {
        blips.push({ x: p.x, y: p.y, type: 'boss', color: '#4ade80', pulse: true });
      } else if (p.isMissionEntity && !p.missionTag?.startsWith('elvis_convoy_')) {
        blips.push({ x: p.x, y: p.y, type: 'enemy', color: '#ef4444' });
      }
    }

    if (gps) {
      blips.push({ x: gps.pos.x, y: gps.pos.y, type: 'objective', color: gps.color, pulse: true });
    }

    const activeMission = this.missions.activeMission
      ? {
          id: this.missions.activeMission.missionId,
          title: this.missions.activeMission.def.title,
          briefing: this.missions.activeMission.def.briefing,
          tier: this.missions.activeMission.def.tier,
          rewardCash: this.missions.activeMission.def.rewardCash,
          stageIndex: this.missions.activeMission.stageIndex,
          totalStages: this.missions.activeMission.def.stages.length,
          objective: this.missions.activeMission.objectiveLabel,
          progressText:
            this.missions.activeMission.stageTargetCount > 1
              ? `${this.missions.activeMission.stageProgress}/${this.missions.activeMission.stageTargetCount}`
              : null,
          timerSec:
            this.missions.activeMission.stageTimer > 0
              ? Math.ceil(this.missions.activeMission.stageTimer)
              : this.missions.activeMission.overallTimer > 0
              ? Math.ceil(this.missions.activeMission.overallTimer)
              : null,
          faction: this.missions.activeMission.def.faction,
        }
      : null;

    const radioStation = this.sound.getRadioStation();
    let alivePedCount = 0;
    for (let i = 0; i < this.peds.length; i++) {
      if (this.peds[i].alive) alivePedCount++;
    }

    return {
      screen: this.screen,
      gameMode: this.gameMode,
      playMode: this.playMode,
      lightingMode: this.lightingMode,
      controlMode: this.controlMode,
      playerStatus: this.player.status,
      statusBanner: this.statusBanner,
      incidentSummary: this.incidentSummary ? { ...this.incidentSummary } : null,
      hp: Math.round(this.player.hp),
      maxHp: this.player.maxHp,
      armor: Math.round(this.player.armor),
      maxArmor: this.player.maxArmor,
      stamina: Math.round(this.player.stamina),
      maxStamina: this.player.maxStamina,
      cash: this.player.cash,
      totalCashEarned: this.player.totalCashEarned,
      multiplier: this.player.multiplier,
      wantedStars: this.player.wantedStars,
      wantedFlashing: this.player.wantedStars > 0 && !this.player.policeLineOfSight && this.player.wantedStars <= 4,
      respect: { ...this.respect },
      activeWeapon: this.player.activeWeapon,
      activeWeaponName: WEAPONS[this.player.activeWeapon].shortName,
      activeWeaponAmmo: this.player.weapons[this.player.activeWeapon],
      ownedWeapons: [...this.player.ownedWeapons],
      weaponAmmo: { ...this.player.weapons },
      inVehicle: Boolean(playerVeh),
      vehicleName: vehSpec?.name ?? null,
      vehicleSpecId: playerVeh?.specId ?? null,
      vehicleSpeedKmh: playerVeh ? Math.round(Math.abs(playerVeh.speed) * 3.6 / 0.72) : 0,
      vehicleHpPct: playerVeh ? Math.round((playerVeh.hp / playerVeh.maxHp) * 100) : 0,
      vehicleSiren: Boolean(playerVeh?.sirenActive),
      vehicleSideJobEligible: vehSpec?.sideJob ?? null,
      districtId: this.currentDistrict,
      districtName: dist.name,
      districtSubtitle: dist.subtitle,
      districtFaction: dist.faction,
      radioStation,
      radioLabel: RADIO_LABELS[radioStation],
      gpsTarget: gps?.pos ?? null,
      gpsAngleRad,
      gpsDistanceM,
      gpsLabel: gps?.label ?? null,
      activeMission,
      activeKillFrenzy: this.missions.activeKillFrenzy
        ? {
            title: this.missions.activeKillFrenzy.def.title,
            progress: this.missions.activeKillFrenzy.progress,
            target: this.missions.activeKillFrenzy.def.targetCount,
            timeLeft: Math.ceil(this.missions.activeKillFrenzy.timeLeft),
          }
        : null,
      activeSideJob: this.missions.activeSideJob
        ? {
            type: this.missions.activeSideJob.type,
            level: this.missions.activeSideJob.level,
            description: this.missions.activeSideJob.description,
            timeLeft: Math.ceil(this.missions.activeSideJob.timeLeft),
          }
        : null,
      nearbyPrompt: this.nearbyPrompt,
      pagerMessages: [...this.pagerMessages],
      cashPopups: [...this.cashPopups],
      completedMissions: Array.from(this.missions.completedMissions),
      failedMissions: Array.from(this.missions.failedMissions),
      completedKillFrenzies: Array.from(this.missions.completedKillFrenzies),
      finaleUnlocked: this.missions.finaleUnlocked,
      cityClaimed: this.missions.cityClaimed,
      godMode: this.player.godMode,
      muted: this.sound.isMuted(),
      timeOfDay: this.timeOfDay,
      playerX: this.player.x,
      playerY: this.player.y,
      playerHeading: this.player.heading,
      minimapBlips: blips,
      telemetry: {
        fps: this.currentFps,
        rigidBodies: this.physics.getRigidBodyCount(),
        activeChunks: this.chunks.getActiveCount(),
        totalChunks: this.chunks.getTotalCount(),
        drawCalls: this.scene.getDrawCalls(),
        activeVehicles: this.vehicles.length,
        activePeds: alivePedCount,
        playerX: Math.round(this.player.x),
        playerY: Math.round(this.player.y),
        playerLayer: this.player.layer,
      },
    };
  }
}

function distPointToSegment2D(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 1e-8) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
