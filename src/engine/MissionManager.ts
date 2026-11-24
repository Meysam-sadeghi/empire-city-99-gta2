import type {
  ActiveKillFrenzy,
  ActiveMissionState,
  ActiveSideJob,
  MissionDef,
  PayphoneDef,
  SideJobType,
} from '../types/mission.types';
import type { PedEntity, PickupEntity, PlayerEntity, VehicleEntity, VehicleId, WeaponId } from '../types/entity.types';
import type { FactionId, Vec2, WorldMapData } from '../types/world.types';
import type { MissionPropRenderItem } from '../renderer/SceneManager';
import { KILL_FRENZIES, MISSIONS, MISSIONS_BY_ID, PAYPHONES } from '../data/missions.data';
import { GANGS, RESPECT_RULES } from '../data/gangs.data';
import { VEHICLES } from '../data/vehicles.data';
import { WORLD_FACILITIES } from '../data/districts.data';
import { WEAPONS } from '../data/weapons.data';
import { ALL_AVENUES, ALL_STREETS } from '../data/mapGenerator';

export interface MissionEngineHooks {
  spawnVehicle: (
    specId: VehicleId,
    x: number,
    y: number,
    heading: number,
    aiRole: VehicleEntity['aiRole'],
    targetNodeId?: string,
    isMission?: boolean,
    missionTag?: string
  ) => VehicleEntity | null;
  spawnPed: (params: {
    role: PedEntity['role'];
    x: number;
    y: number;
    faction?: FactionId;
    weaponId?: WeaponId;
    isMissionEntity?: boolean;
    missionTag?: string;
    hpOverride?: number;
  }) => PedEntity;
  grantWeapon: (weaponId: WeaponId, ammo: number, equip?: boolean) => void;
  awardCash: (amount: number, label?: string) => void;
  adjustRespect: (faction: FactionId, delta: number) => void;
  setWantedStars: (stars: number) => void;
  clearWanted: () => void;
  pushPager: (text: string, tone?: 'green' | 'amber' | 'red' | 'cyan', durationSec?: number) => void;
  playSound: (kind: 'complete' | 'cash' | 'beep' | 'paynspray' | 'crusher') => void;
  saveAtChapel: () => void;
  onCityClaimed: () => void;
  spawnPickup: (pickup: Omit<PickupEntity, 'id' | 'bobPhase'>) => PickupEntity;
  despawnPickups: (ids: string[]) => void;
  setPedInVehicle: (ped: PedEntity, veh: VehicleEntity | null, destX?: number, destY?: number) => void;
  ejectPlayerFromVehicle: (veh: VehicleEntity, destX?: number, destY?: number) => void;
  onPropExplosion?: (x: number, y: number, z: number, type: 'relay_dish' | 'fuel_tanker') => void;
}

export class MissionManager {
  public activeMission: ActiveMissionState | null = null;
  public activeKillFrenzy: ActiveKillFrenzy | null = null;
  public activeSideJob: ActiveSideJob | null = null;
  public completedMissions = new Set<string>();
  public failedMissions = new Set<string>();
  public completedKillFrenzies = new Set<string>();
  public finaleUnlocked = false;
  public finaleAutoTriggered = false;
  public cityClaimed = false;

  private missionProps: MissionPropRenderItem[] = [];
  private missionPickups: { id: string; x: number; y: number; collected: boolean }[] = [];
  private allyPedId: string | null = null;
  private waveSpawnTimer = 0;
  private facilityCooldown = 0;
  private defenseWarningCooldown = 0;
  private crusherBackupCooldown = 0;
  private map: WorldMapData;

  constructor(map: WorldMapData) {
    this.map = map;
  }

  public getMissionProps(): MissionPropRenderItem[] {
    return this.missionProps;
  }

  public getAllyPedId(): string | null {
    return this.allyPedId;
  }

  public isAllyCaged(): boolean {
    if (!this.activeMission || !this.allyPedId) return false;
    const stage = this.activeMission.def.stages[this.activeMission.stageIndex];
    return this.activeMission.missionId === 'bro_hostile_takeover' && stage?.id === 'b4_storm';
  }

  public isPayphoneAvailable(ph: PayphoneDef, respect: Record<FactionId, number>): boolean {
    if (this.activeMission) return false;
    if (
      this.finaleUnlocked &&
      !this.completedMissions.has('king_of_five_boroughs') &&
      this.failedMissions.has('king_of_five_boroughs')
    ) {
      return true;
    }
    if (respect[ph.faction] < ph.minRespect) return false;
    if (ph.missionIds.some((id) => !this.completedMissions.has(id))) return true;
    return this.finaleUnlocked && !this.completedMissions.has('king_of_five_boroughs');
  }

  public getNextMissionForPayphone(ph: PayphoneDef): MissionDef | null {
    if (
      this.finaleUnlocked &&
      !this.completedMissions.has('king_of_five_boroughs') &&
      this.failedMissions.has('king_of_five_boroughs')
    ) {
      return MISSIONS.find((m) => m.id === 'king_of_five_boroughs') ?? null;
    }
    for (const id of ph.missionIds) {
      if (!this.completedMissions.has(id)) {
        return MISSIONS_BY_ID[id] ?? null;
      }
    }
    if (this.finaleUnlocked && !this.completedMissions.has('king_of_five_boroughs')) {
      return MISSIONS.find((m) => m.id === 'king_of_five_boroughs') ?? null;
    }
    return null;
  }

  public answerNearestPayphone(
    player: PlayerEntity,
    vehicles: VehicleEntity[],
    peds: PedEntity[],
    respect: Record<FactionId, number>,
    hooks: MissionEngineHooks
  ): boolean {
    if (this.activeMission || player.status !== 'alive' || player.vehicleId) return false;
    let best: PayphoneDef | null = null;
    let bestD = 6.5;
    for (const ph of PAYPHONES) {
      if (!this.isPayphoneAvailable(ph, respect)) continue;
      const d = Math.hypot(ph.x - player.x, ph.y - player.y);
      if (d <= bestD) {
        bestD = d;
        best = ph;
      }
    }
    if (!best) return false;
    const next = this.getNextMissionForPayphone(best);
    if (!next) return false;
    return this.startMissionById(next.id, player, vehicles, peds, hooks);
  }

  public isNearRingingPayphone(player: PlayerEntity, respect: Record<FactionId, number>): PayphoneDef | null {
    if (this.activeMission) return null;
    for (const ph of PAYPHONES) {
      if (!this.isPayphoneAvailable(ph, respect)) continue;
      if (Math.hypot(ph.x - player.x, ph.y - player.y) <= 40) {
        return ph;
      }
    }
    return null;
  }

  public getNearestAvailablePayphone(player: PlayerEntity, respect: Record<FactionId, number>): PayphoneDef | null {
    let best: PayphoneDef | null = null;
    let bestD = Infinity;
    for (const ph of PAYPHONES) {
      if (!this.isPayphoneAvailable(ph, respect)) continue;
      const d = Math.hypot(ph.x - player.x, ph.y - player.y);
      if (d < bestD) {
        bestD = d;
        best = ph;
      }
    }
    return best;
  }

  public startMissionById(
    missionId: string,
    player: PlayerEntity,
    vehicles: VehicleEntity[],
    peds: PedEntity[],
    hooks: MissionEngineHooks
  ): boolean {
    const def = MISSIONS_BY_ID[missionId];
    if (!def) return false;

    this.cancelActiveMission(vehicles, peds, hooks);
    this.failedMissions.delete(def.id);

    let trackedVehicleId: string | undefined;
    if (def.spawnStartVehicle) {
      const sv = def.spawnStartVehicle;
      const veh = hooks.spawnVehicle(sv.specId, sv.pos.x, sv.pos.y, sv.heading, 'none', undefined, true, sv.tag);
      if (veh) trackedVehicleId = veh.id;
    }

    this.activeMission = {
      missionId: def.id,
      def,
      stageIndex: 0,
      stageProgress: 0,
      stageTargetCount: 1,
      stageTimer: 0,
      overallTimer: def.timeLimitSec ?? 0,
      checkpointIndex: 0,
      trackedVehicleId,
      targetEntityIds: [],
      objectivePos: null,
      objectiveLabel: '',
      freePayNSpray: Boolean(def.freePayNSpray),
    };

    hooks.playSound('beep');
    this.initCurrentStage(player, vehicles, peds, hooks, true);
    const firstObj = def.stages[0]?.description ?? '';
    const startText = firstObj
      ? `MISSION START: ${def.title.toUpperCase()} — ${def.briefing} [OBJ: ${firstObj}]`
      : `MISSION START: ${def.title.toUpperCase()} — ${def.briefing}`;
    hooks.pushPager(startText, 'amber', 12);
    return true;
  }

  public cancelActiveMission(vehicles: VehicleEntity[], peds: PedEntity[], hooks?: MissionEngineHooks, player?: PlayerEntity): void {
    if (!this.activeMission && this.missionProps.length === 0 && this.missionPickups.length === 0 && !this.allyPedId) {
      return;
    }
    if (this.missionPickups.length > 0 && hooks) {
      const uncollected = this.missionPickups.filter((p) => !p.collected).map((p) => p.id);
      if (uncollected.length > 0) hooks.despawnPickups(uncollected);
    }
    if (this.allyPedId && hooks) {
      const ally = peds.find((p) => p.id === this.allyPedId);
      if (ally && ally.vehicleId) {
        hooks.setPedInVehicle(ally, null, (player?.x ?? ally.x) + 2.5, (player?.y ?? ally.y) + 1.5);
      }
    }
    this.activeMission = null;
    this.missionProps = [];
    this.missionPickups = [];
    this.allyPedId = null;
    for (const v of vehicles) {
      if (v.isMissionEntity) v.isMissionEntity = false;
    }
    for (const p of peds) {
      if (p.isMissionEntity) p.isMissionEntity = false;
    }
  }

  private initCurrentStage(
    player: PlayerEntity,
    vehicles: VehicleEntity[],
    peds: PedEntity[],
    hooks: MissionEngineHooks,
    suppressObjectivePager = false
  ): void {
    const m = this.activeMission;
    if (!m) return;
    const stage = m.def.stages[m.stageIndex];
    if (!stage) {
      this.completeMission(player, hooks, peds);
      return;
    }

    if (this.missionPickups.length > 0) {
      const uncollected = this.missionPickups.filter((p) => !p.collected).map((p) => p.id);
      if (uncollected.length > 0) hooks.despawnPickups(uncollected);
    }

    m.stageProgress = 0;
    m.stageTargetCount = 1;
    m.checkpointIndex = 0;
    m.stageTimer = stage.timeLimitSec ?? 0;
    m.targetEntityIds = [];
    m.objectiveLabel = stage.description;
    m.freePayNSpray = Boolean(m.def.freePayNSpray || stage.freePayNSpray);
    this.missionProps = [];
    this.missionPickups = [];
    this.waveSpawnTimer = 6;
    this.defenseWarningCooldown = 0;
    this.crusherBackupCooldown = 0;

    if (stage.grantWeapon) {
      hooks.grantWeapon(stage.grantWeapon.weaponId, stage.grantWeapon.ammo, true);
    }

    if (stage.wantedLevel && stage.wantedLevel > player.wantedStars) {
      hooks.setWantedStars(stage.wantedLevel);
    }

    // Spawn second truck if stage specifies checkpoints for deliver_vehicle (Mission 9 Dockside Muscle)
    if (stage.type === 'deliver_vehicle' && stage.checkpoints && stage.checkpoints.length > 0 && stage.vehicleSpecId) {
      const sp = stage.checkpoints[0];
      const veh = hooks.spawnVehicle(
        stage.vehicleSpecId,
        sp.x,
        sp.y,
        Math.PI,
        'none',
        undefined,
        true,
        stage.missionTag
      );
      if (veh) m.trackedVehicleId = veh.id;
    }

    // Spawn mission enemies (linking seated occupants cleanly into inVehicles)
    if (stage.spawnEnemies) {
      for (const grp of stage.spawnEnemies) {
        const vehPool: VehicleEntity[] = [];
        if (grp.inVehicles) {
          const vehCount = Math.max(1, Math.ceil(grp.count / 2));
          const aiRole: VehicleEntity['aiRole'] =
            grp.role === 'swat' ? 'swat' : grp.role === 'fbi' ? 'fbi' : 'gang';
          for (let vc = 0; vc < vehCount; vc++) {
            const ang = (vc / vehCount) * Math.PI * 2;
            const offset = vehCount > 1 ? Math.min(12, grp.spread) : Math.min(4, grp.spread * 0.5);
            const vx = grp.pos.x + Math.cos(ang) * offset;
            const vy = grp.pos.y + Math.sin(ang) * offset;
            const v = hooks.spawnVehicle(grp.inVehicles, vx, vy, ang, aiRole, undefined, true, m.missionId);
            if (v) vehPool.push(v);
          }
        }
        for (let i = 0; i < grp.count; i++) {
          const ang = (i / Math.max(1, grp.count)) * Math.PI * 2 + Math.random() * 0.4;
          const dist = Math.random() * grp.spread;
          const ex = grp.pos.x + Math.cos(ang) * dist;
          const ey = grp.pos.y + Math.sin(ang) * dist;
          const enemy = hooks.spawnPed({
            role: grp.role,
            x: ex,
            y: ey,
            faction: grp.faction,
            weaponId: grp.weaponId,
            isMissionEntity: true,
            missionTag: m.missionId,
          });
          m.targetEntityIds.push(enemy.id);
          if (vehPool.length > 0) {
            const hostVeh = vehPool[i % vehPool.length];
            hooks.setPedInVehicle(enemy, hostVeh);
            if (i < vehPool.length) {
              hostVeh.driverId = enemy.id;
            }
          }
        }
      }
      if (stage.type === 'kill_targets') {
        m.stageTargetCount = m.targetEntityIds.length;
      }
    }

    // M12: Spawn Brotherhood Boss prisoner inside Midtown Precinct Courtyard on b4_storm
    if (m.missionId === 'bro_hostile_takeover' && stage.id === 'b4_storm') {
      const ally = hooks.spawnPed({
        role: 'ally',
        x: 448,
        y: 832,
        faction: 'brotherhood',
        weaponId: 'shotgun',
        isMissionEntity: true,
        missionTag: 'bro_boss_prisoner',
        hpOverride: 450,
      });
      this.allyPedId = ally.id;
    }

    // Spawn collectible cash cases
    if (stage.type === 'collect_pickups' && stage.checkpoints) {
      this.missionPickups = stage.checkpoints.map((pt) => {
        const pk = hooks.spawnPickup({
          type: 'cash',
          x: pt.x,
          y: pt.y,
          z: 0,
          amount: 5000,
          active: true,
          respawnTimer: 0,
        });
        return { id: pk.id, x: pk.x, y: pk.y, collected: false };
      });
      m.stageTargetCount = this.missionPickups.length;
      m.objectivePos = this.missionPickups[0] ? { x: this.missionPickups[0].x, y: this.missionPickups[0].y } : null;
    } else if (stage.type === 'destroy_props' && stage.checkpoints) {
      const propType = stage.propType ?? 'relay_dish';
      const maxHp = propType === 'fuel_tanker' ? 140 : 120;
      this.missionProps = stage.checkpoints.map((pt, idx) => ({
        id: `${m.missionId}_${stage.id}_${idx}`,
        type: propType,
        x: pt.x,
        y: pt.y,
        z: 0,
        hp: maxHp,
        maxHp,
        alive: true,
      }));
      m.stageTargetCount = this.missionProps.length;
      m.objectivePos = this.missionProps[0] ? { x: this.missionProps[0].x, y: this.missionProps[0].y } : null;
    } else if (stage.type === 'drive_checkpoints' && stage.checkpoints) {
      m.stageTargetCount = stage.checkpoints.length;
      m.objectivePos = stage.checkpoints[0];
    } else if (stage.type === 'escort_vehicle' && stage.checkpoints) {
      m.stageTargetCount = stage.checkpoints.length;
      m.objectivePos = stage.checkpoints[0];
    } else if (stage.type === 'crush_vehicles') {
      m.stageTargetCount = stage.count ?? 3;
      m.objectivePos = stage.targetPos ?? { x: 1600, y: 1600 };
      const spawnSpots: { x: number; y: number; heading: number }[] = [
        { x: 1564, y: 1584, heading: 0 },
        { x: 1636, y: 1616, heading: Math.PI },
        { x: 1536, y: 1720, heading: -Math.PI / 2 },
        { x: 1664, y: 1536, heading: Math.PI / 2 },
      ];
      for (const spot of spawnSpots) {
        const occupied = vehicles.some((v) => v.alive && Math.hypot(v.x - spot.x, v.y - spot.y) < 5);
        if (!occupied) {
          hooks.spawnVehicle('mobster_v8', spot.x, spot.y, spot.heading, 'none', undefined, true, 'scrap_target');
        }
      }
    } else if (stage.type === 'lose_wanted') {
      const nearestPns = this.findNearestFacility(player.x, player.y, 'pay_n_spray');
      m.objectivePos = nearestPns ? { x: nearestPns.x, y: nearestPns.y } : null;
    } else {
      m.objectivePos = stage.targetPos ?? null;
    }

    if (!suppressObjectivePager) {
      hooks.pushPager(`OBJECTIVE: ${stage.description}`, 'green', 6);
    }
    void peds;
  }

  private advanceStage(
    player: PlayerEntity,
    vehicles: VehicleEntity[],
    peds: PedEntity[],
    hooks: MissionEngineHooks
  ): void {
    if (!this.activeMission) return;
    if (this.missionPickups.length > 0) {
      const uncollected = this.missionPickups.filter((p) => !p.collected).map((p) => p.id);
      if (uncollected.length > 0) hooks.despawnPickups(uncollected);
      this.missionPickups = [];
    }
    this.missionProps = [];
    this.activeMission.stageIndex++;
    if (this.activeMission.stageIndex >= this.activeMission.def.stages.length) {
      this.completeMission(player, hooks, peds);
    } else {
      hooks.playSound('beep');
      this.initCurrentStage(player, vehicles, peds, hooks);
    }
  }

  private completeMission(player: PlayerEntity, hooks: MissionEngineHooks, peds?: PedEntity[]): void {
    const m = this.activeMission;
    if (!m) return;
    const def = m.def;

    if (this.allyPedId && peds) {
      const ally = peds.find((p) => p.id === this.allyPedId);
      if (ally) {
        if (ally.vehicleId) {
          hooks.setPedInVehicle(ally, null, player.x + 2.5, player.y + 1.5);
        }
        ally.isMissionEntity = false;
      }
    }
    this.completedMissions.add(def.id);
    this.failedMissions.delete(def.id);
    this.activeMission = null;
    this.missionProps = [];
    this.missionPickups = [];
    this.allyPedId = null;

    hooks.awardCash(def.rewardCash, `${def.title.toUpperCase()} PASSED`);
    if (def.faction !== 'all') {
      hooks.adjustRespect(def.faction, def.respectGain);
      const rival = GANGS[def.faction].rival;
      hooks.adjustRespect(rival, def.rivalRespectLoss);
    } else {
      hooks.adjustRespect('syndicate', def.respectGain);
      hooks.adjustRespect('yakuza', def.respectGain);
      hooks.adjustRespect('brotherhood', def.respectGain);
    }

    hooks.clearWanted();
    hooks.playSound('complete');
    hooks.pushPager(`MISSION PASSED! +$${def.rewardCash.toLocaleString()} — ${def.completionText}`, 'green', 9);

    if (def.id === 'king_of_five_boroughs') {
      this.cityClaimed = true;
      hooks.onCityClaimed();
    }
    void player;
  }

  public failMission(reason: string, vehicles: VehicleEntity[], peds: PedEntity[], hooks: MissionEngineHooks): void {
    if (!this.activeMission) return;
    const missionId = this.activeMission.missionId;
    const title = this.activeMission.def.title;
    this.failedMissions.add(missionId);
    this.cancelActiveMission(vehicles, peds, hooks);
    if (missionId === 'king_of_five_boroughs') {
      hooks.pushPager(
        'FINALE FAILED — ANSWER ANY PAYPHONE OR PRESS [J] TO RETRY KING OF THE FIVE BOROUGHS!',
        'red',
        8
      );
    } else {
      hooks.pushPager(`MISSION FAILED (${title}): ${reason}`, 'red', 7);
    }
  }

  public update(
    dt: number,
    player: PlayerEntity,
    vehicles: VehicleEntity[],
    peds: PedEntity[],
    respect: Record<FactionId, number>,
    gameMode: 'casual' | 'classic',
    hooks: MissionEngineHooks
  ): { nearbyPrompt: string | null } {
    if (this.facilityCooldown > 0) this.facilityCooldown -= dt;
    if (this.defenseWarningCooldown > 0) this.defenseWarningCooldown -= dt;
    if (this.crusherBackupCooldown > 0) this.crusherBackupCooldown -= dt;
    let nearbyPrompt: string | null = null;

    // 0. Auto-trigger Finale "King of the Five Boroughs" once player earns $250,000 & +60 respect with any faction
    if (!this.finaleAutoTriggered && !this.completedMissions.has('king_of_five_boroughs') && !this.activeMission) {
      const hasHighRespect =
        respect.syndicate >= RESPECT_RULES.FINALE_MIN_RESPECT ||
        respect.yakuza >= RESPECT_RULES.FINALE_MIN_RESPECT ||
        respect.brotherhood >= RESPECT_RULES.FINALE_MIN_RESPECT;
      if (player.totalCashEarned >= RESPECT_RULES.FINALE_MIN_CASH && hasHighRespect) {
        this.finaleUnlocked = true;
        this.finaleAutoTriggered = true;
        this.startMissionById('king_of_five_boroughs', player, vehicles, peds, hooks);
      }
    }

    // 1. Check Payphone proximity & [F] prompt when standing near ringing booth
    if (!this.activeMission && player.status === 'alive') {
      let bestPh: PayphoneDef | null = null;
      let bestD = 14;
      for (const ph of PAYPHONES) {
        if (!this.isPayphoneAvailable(ph, respect)) continue;
        const d = Math.hypot(ph.x - player.x, ph.y - player.y);
        if (d < bestD) {
          bestD = d;
          bestPh = ph;
        }
      }
      if (bestPh) {
        const gang = GANGS[bestPh.faction].shortName;
        const next = this.getNextMissionForPayphone(bestPh);
        if (!player.vehicleId && bestD <= 6.5 && next) {
          nearbyPrompt = `PRESS [F] TO ANSWER ${gang} ${bestPh.tier.toUpperCase()} PAYPHONE — ${next.title.toUpperCase()}`;
        } else if (player.vehicleId && bestD <= 12) {
          nearbyPrompt = `EXIT CAR & PRESS [F] AT ${gang} ${bestPh.tier.toUpperCase()} PAYPHONE`;
        } else {
          nearbyPrompt = `WALK TO ${gang} ${bestPh.tier.toUpperCase()} PAYPHONE (${Math.round(bestD)}m)`;
        }
      }
    }

    // 2. Interactive Facilities: Pay 'n' Spray, Car Crusher, Sanctuary Chapels
    if (player.status === 'alive') {
      const playerVeh = player.vehicleId ? vehicles.find((v) => v.id === player.vehicleId) ?? null : null;
      for (const fac of WORLD_FACILITIES) {
        const d = Math.hypot(fac.x - player.x, fac.y - player.y);
        if (d > fac.radius + 4) continue;

        if (fac.type === 'pay_n_spray') {
          if (playerVeh) {
            const isFree = Boolean(this.activeMission?.freePayNSpray);
            const cost = isFree ? 0 : fac.cost;
            if (d <= fac.radius - 2 && this.facilityCooldown <= 0) {
              if (player.cash >= cost) {
                player.cash -= cost;
                playerVeh.hp = playerVeh.maxHp;
                playerVeh.damageStage = 'clean';
                playerVeh.burnTimer = 5;
                const colors = ['#ef4444', '#06b6d4', '#facc15', '#22c55e', '#a855f7', '#f97316', '#f8fafc'];
                playerVeh.color = colors[Math.floor(Math.random() * colors.length)];
                hooks.clearWanted();
                hooks.playSound('paynspray');
                hooks.pushPager(
                  isFree
                    ? "PAY 'N' SPRAY: FREE GETAWAY RESPRAY — REPAIRED & WANTED CLEARED!"
                    : "PAY 'N' SPRAY: -$500 — VEHICLE REPAIRED, RESPRAYED & NYPD HEAT CLEARED!",
                  'cyan',
                  5
                );
                this.facilityCooldown = 6;
              } else {
                nearbyPrompt = "PAY 'N' SPRAY REQUIRES $500";
              }
            } else {
              nearbyPrompt = isFree ? "DRIVE INTO PAY 'N' SPRAY (FREE)" : "DRIVE INTO PAY 'N' SPRAY ($500)";
            }
          } else {
            nearbyPrompt = "PAY 'N' SPRAY — BRING A VEHICLE TO REPAIR & CLEAR STARS";
          }
        } else if (fac.type === 'car_crusher') {
          if (playerVeh && d <= fac.radius - 1 && this.facilityCooldown <= 0) {
            const spec = VEHICLES[playerVeh.specId];
            // Eject player safely onto yard beside crane pad before crushing (resetting jump & Rapier body)
            hooks.ejectPlayerFromVehicle(playerVeh, fac.x + fac.radius + 3, fac.y);
            const value = spec.crusherValue;
            playerVeh.alive = false;
            playerVeh.damageStage = 'wrecked';
            hooks.awardCash(value, `CRUSHED ${spec.name.toUpperCase()}`);
            hooks.playSound('crusher');

            // Rare vehicles award bonus weapon pickup!
            if (value >= 2500) {
              hooks.grantWeapon('rpg', 3, false);
              hooks.pushPager(`CAR CRUSHER BONUS: +$${value.toLocaleString()} + 3 RPG ROCKETS!`, 'amber', 6);
            } else {
              hooks.pushPager(`CAR CRUSHER: SCRAPPED ${spec.name.toUpperCase()} FOR +$${value.toLocaleString()}!`, 'amber', 5);
            }

            // Advance Mission 10 "Scrap Metal" if Mobster V8 crushed
            if (
              this.activeMission &&
              this.activeMission.def.stages[this.activeMission.stageIndex]?.type === 'crush_vehicles'
            ) {
              const stage = this.activeMission.def.stages[this.activeMission.stageIndex];
              if (!stage.vehicleSpecId || playerVeh.specId === stage.vehicleSpecId) {
                this.activeMission.stageProgress++;
                if (this.activeMission.stageProgress >= this.activeMission.stageTargetCount) {
                  this.advanceStage(player, vehicles, peds, hooks);
                } else {
                  hooks.pushPager(
                    `SCRAP METAL: ${this.activeMission.stageProgress}/${this.activeMission.stageTargetCount} SYNDICATE CARS CRUSHED!`,
                    'green',
                    5
                  );
                }
              }
            }
            this.facilityCooldown = 4;
          } else {
            nearbyPrompt = 'MAGNETIC CAR CRUSHER — DRIVE ANY VEHICLE ONTO PAD FOR CASH';
          }
        } else if (fac.type === 'sanctuary_chapel') {
          const cost = gameMode === 'casual' ? 0 : fac.cost;
          if (!playerVeh && d <= fac.radius - 2 && this.facilityCooldown <= 0) {
            if (player.cash >= cost) {
              player.cash -= cost;
              hooks.saveAtChapel();
              hooks.playSound('complete');
              hooks.pushPager(
                cost === 0
                  ? 'HALLELUJAH! PROGRESS SAVED AT SANCTUARY CHAPEL (FREE — CASUAL MODE)'
                  : 'HALLELUJAH! -$10,000 — PROGRESS SAVED AT SANCTUARY CHAPEL!',
                'cyan',
                6
              );
              this.facilityCooldown = 10;
            } else {
              nearbyPrompt = 'SANCTUARY CHAPEL SAVE COSTS $10,000 (FREE IN CASUAL MODE)';
            }
          } else {
            nearbyPrompt = cost === 0 ? 'WALK INTO NEON CROSS TO SAVE (FREE)' : 'WALK INTO NEON CROSS TO SAVE ($10,000)';
          }
        }
      }
    }

    // 3. Update Active Scripted Mission
    if (this.activeMission) {
      this.updateActiveMission(dt, player, vehicles, peds, hooks);
    }

    // 4. Update Active Kill Frenzy
    if (this.activeKillFrenzy) {
      this.activeKillFrenzy.timeLeft -= dt;
      // Keep infinite ammo on frenzy weapon
      player.weapons[this.activeKillFrenzy.def.weaponId] = Math.max(
        99,
        WEAPONS[this.activeKillFrenzy.def.weaponId].maxAmmo
      );
      if (this.activeKillFrenzy.timeLeft <= 0) {
        hooks.pushPager(`KILL FRENZY FAILED: ${this.activeKillFrenzy.def.title.toUpperCase()}`, 'red', 5);
        this.activeKillFrenzy = null;
      }
    }

    // 5. Update Repeatable Taxi / Vigilante / Paramedic Side Jobs
    if (this.activeSideJob) {
      this.updateSideJob(dt, player, vehicles, peds, hooks);
    }

    return { nearbyPrompt };
  }

  private updateActiveMission(
    dt: number,
    player: PlayerEntity,
    vehicles: VehicleEntity[],
    peds: PedEntity[],
    hooks: MissionEngineHooks
  ): void {
    const m = this.activeMission;
    if (!m) return;

    if (player.status !== 'alive') {
      this.failMission('You were neutralized.', vehicles, peds, hooks);
      return;
    }

    // M12: Brotherhood Boss ally must survive once spawned
    if (this.allyPedId) {
      const ally = peds.find((p) => p.id === this.allyPedId);
      if (!ally || !ally.alive) {
        this.failMission('The Brotherhood Boss was killed!', vehicles, peds, hooks);
        return;
      }
    }

    // Overall mission countdown
    if (m.def.timeLimitSec) {
      m.overallTimer -= dt;
      if (m.overallTimer <= 0) {
        this.failMission('Time expired!', vehicles, peds, hooks);
        return;
      }
    }

    const stage = m.def.stages[m.stageIndex];
    if (!stage) return;

    const playerVeh = player.vehicleId ? vehicles.find((v) => v.id === player.vehicleId) ?? null : null;

    switch (stage.type) {
      case 'enter_vehicle': {
        const targetVeh =
          (m.trackedVehicleId ? vehicles.find((v) => v.id === m.trackedVehicleId && v.alive) : null) ??
          vehicles.find((v) => v.alive && v.missionTag === stage.missionTag);

        if (targetVeh) {
          m.objectivePos = { x: targetVeh.x, y: targetVeh.y };
          if (targetVeh.damageStage === 'wrecked') {
            this.failMission('Mission vehicle was destroyed!', vehicles, peds, hooks);
            return;
          }
          if (player.vehicleId === targetVeh.id) {
            this.advanceStage(player, vehicles, peds, hooks);
          }
        } else if (playerVeh && stage.vehicleSpecId && playerVeh.specId === stage.vehicleSpecId) {
          this.advanceStage(player, vehicles, peds, hooks);
        }
        break;
      }

      case 'drive_checkpoints': {
        const pts = stage.checkpoints ?? [];
        const cp = pts[m.checkpointIndex];
        if (!cp) {
          this.advanceStage(player, vehicles, peds, hooks);
          return;
        }
        m.objectivePos = cp;
        const rad = stage.radius ?? 15;
        if (Math.hypot(player.x - cp.x, player.y - cp.y) <= rad) {
          m.checkpointIndex++;
          m.stageProgress = m.checkpointIndex;
          hooks.playSound('cash');
          if (m.checkpointIndex >= pts.length) {
            this.advanceStage(player, vehicles, peds, hooks);
          } else {
            hooks.pushPager(`CHECKPOINT ${m.checkpointIndex}/${pts.length} REACHED!`, 'green', 3);
          }
        }
        break;
      }

      case 'deliver_vehicle': {
        const tracked = m.trackedVehicleId ? vehicles.find((v) => v.id === m.trackedVehicleId) : null;
        if (tracked && (!tracked.alive || tracked.damageStage === 'wrecked')) {
          this.failMission('Delivery vehicle destroyed!', vehicles, peds, hooks);
          return;
        }

        const inRequiredVehicle =
          (tracked && player.vehicleId === tracked.id) ||
          (!tracked && playerVeh && (!stage.vehicleSpecId || playerVeh.specId === stage.vehicleSpecId));

        if (!inRequiredVehicle) {
          if (tracked) m.objectivePos = { x: tracked.x, y: tracked.y };
          return;
        }

        if (stage.minVehicleHpPct && playerVeh) {
          const hpPct = (playerVeh.hp / playerVeh.maxHp) * 100;
          if (hpPct < stage.minVehicleHpPct) {
            this.failMission(`Vehicle damaged below ${stage.minVehicleHpPct}% HP!`, vehicles, peds, hooks);
            return;
          }
        }

        if (stage.targetPos) {
          m.objectivePos = stage.targetPos;
          if (Math.hypot(player.x - stage.targetPos.x, player.y - stage.targetPos.y) <= (stage.radius ?? 16)) {
            this.advanceStage(player, vehicles, peds, hooks);
          }
        }
        break;
      }

      case 'escort_vehicle': {
        const limo = m.trackedVehicleId ? vehicles.find((v) => v.id === m.trackedVehicleId) : null;
        if (limo && (!limo.alive || limo.damageStage === 'wrecked')) {
          this.failMission('Escort vehicle destroyed!', vehicles, peds, hooks);
          return;
        }
        const pts = stage.checkpoints ?? (stage.targetPos ? [stage.targetPos] : []);
        const cp = pts[m.checkpointIndex];
        if (!cp) {
          this.advanceStage(player, vehicles, peds, hooks);
          return;
        }
        m.objectivePos = player.vehicleId === limo?.id ? cp : limo ? { x: limo.x, y: limo.y } : cp;
        if (player.vehicleId === limo?.id && Math.hypot(player.x - cp.x, player.y - cp.y) <= (stage.radius ?? 18)) {
          m.checkpointIndex++;
          m.stageProgress = m.checkpointIndex;
          hooks.playSound('beep');
          if (m.checkpointIndex >= pts.length) {
            this.advanceStage(player, vehicles, peds, hooks);
          }
        }
        break;
      }

      case 'kill_targets': {
        const aliveTargets = m.targetEntityIds
          .map((id) => peds.find((p) => p.id === id))
          .filter((p): p is PedEntity => Boolean(p && p.alive));
        m.stageProgress = m.stageTargetCount - aliveTargets.length;
        if (aliveTargets.length === 0) {
          this.advanceStage(player, vehicles, peds, hooks);
        } else {
          // Point GPS to nearest remaining target
          let nearest = aliveTargets[0];
          let bestD = Infinity;
          for (const t of aliveTargets) {
            const d = Math.hypot(t.x - player.x, t.y - player.y);
            if (d < bestD) {
              bestD = d;
              nearest = t;
            }
          }
          m.objectivePos = { x: nearest.x, y: nearest.y };
        }
        break;
      }

      case 'destroy_props': {
        const remaining = this.missionProps.filter((r) => r.alive);
        m.stageProgress = this.missionProps.length - remaining.length;
        if (remaining.length === 0) {
          this.advanceStage(player, vehicles, peds, hooks);
        } else {
          let nearest = remaining[0];
          let bestD = Infinity;
          for (const prop of remaining) {
            const d = Math.hypot(prop.x - player.x, prop.y - player.y);
            if (d < bestD) {
              bestD = d;
              nearest = prop;
            }
          }
          m.objectivePos = { x: nearest.x, y: nearest.y };
        }
        break;
      }

      case 'collect_pickups': {
        const remaining = this.missionPickups.filter((pk) => !pk.collected);
        m.stageProgress = this.missionPickups.length - remaining.length;
        if (remaining.length === 0) {
          this.advanceStage(player, vehicles, peds, hooks);
        } else {
          let nearest = remaining[0];
          let bestD = Infinity;
          for (const pk of remaining) {
            const d = Math.hypot(pk.x - player.x, pk.y - player.y);
            if (d < bestD) {
              bestD = d;
              nearest = pk;
            }
          }
          m.objectivePos = { x: nearest.x, y: nearest.y };
        }
        break;
      }

      case 'survive_defense': {
        const center = stage.targetPos ?? { x: 1320, y: 1280 };
        const rad = stage.radius ?? 65;
        const dist = Math.hypot(player.x - center.x, player.y - center.y);
        m.objectivePos = center;
        if (dist <= rad) {
          m.stageTimer = Math.max(0, m.stageTimer - dt);
          m.objectiveLabel = stage.description;
        } else {
          m.objectiveLabel = 'RETURN TO MANHATTAN BRIDGE TOLL PLAZA!';
          if (this.defenseWarningCooldown <= 0) {
            hooks.pushPager('RETURN TO MANHATTAN BRIDGE TOLL PLAZA TO HOLD THE LINE!', 'amber', 3.5);
            this.defenseWarningCooldown = 4.0;
          }
        }
        this.waveSpawnTimer -= dt;
        if (this.waveSpawnTimer <= 0) {
          this.waveSpawnTimer = 15;
          const activeWavePeds = peds.filter(
            (p) => p.alive && p.isMissionEntity && p.missionTag === m.missionId
          ).length;
          if (activeWavePeds < 8) {
            const spawnX = 1168;
            const spawnY = 1280 + (Math.random() - 0.5) * 10;
            const waveSpec: VehicleId = Math.random() < 0.35 ? 'gangster_ztype' : 'mobster_v8';
            const waveVeh = hooks.spawnVehicle(waveSpec, spawnX, spawnY, 0, 'gang', undefined, true, m.missionId);
            for (let i = 0; i < 2; i++) {
              const hitman = hooks.spawnPed({
                role: 'gang',
                faction: 'syndicate',
                weaponId: 'dual_uzis',
                x: spawnX - i * 2,
                y: spawnY,
                isMissionEntity: true,
                missionTag: m.missionId,
              });
              if (waveVeh) {
                hooks.setPedInVehicle(hitman, waveVeh);
                if (i === 0) waveVeh.driverId = hitman.id;
              }
            }
            hooks.pushPager('INCOMING FIVE FAMILIES HIT SQUAD ACROSS MANHATTAN BRIDGE!', 'red', 4);
          }
        }
        if (m.stageTimer <= 0) {
          this.advanceStage(player, vehicles, peds, hooks);
        }
        break;
      }

      case 'lose_wanted': {
        const nearestPns = this.findNearestFacility(player.x, player.y, 'pay_n_spray');
        m.objectivePos = nearestPns ? { x: nearestPns.x, y: nearestPns.y } : null;
        if (player.wantedStars === 0) {
          this.advanceStage(player, vehicles, peds, hooks);
        }
        break;
      }

      case 'reach_point': {
        if (stage.targetPos) {
          m.objectivePos = stage.targetPos;
          const rad = stage.radius ?? 18;
          const playerInZone = Math.hypot(player.x - stage.targetPos.x, player.y - stage.targetPos.y) <= rad;
          if (m.missionId === 'bro_hostile_takeover' && this.allyPedId) {
            const ally = peds.find((p) => p.id === this.allyPedId && p.alive);
            if (!ally) return;
            const allyInZone =
              (Boolean(player.vehicleId) && ally.vehicleId === player.vehicleId) ||
              Math.hypot(ally.x - stage.targetPos.x, ally.y - stage.targetPos.y) <= rad + 8;
            if (playerInZone && !allyInZone) {
              m.objectivePos = { x: ally.x, y: ally.y };
              m.objectiveLabel = 'PICK UP THE BROTHERHOOD BOSS FIRST!';
              if (this.defenseWarningCooldown <= 0) {
                hooks.pushPager('PICK UP THE BROTHERHOOD BOSS & DELIVER HIM TO RED HOOK WAREHOUSE!', 'amber', 4);
                this.defenseWarningCooldown = 4.0;
              }
              break;
            }
            if (playerInZone && allyInZone) {
              this.advanceStage(player, vehicles, peds, hooks);
            }
          } else if (playerInZone) {
            this.advanceStage(player, vehicles, peds, hooks);
          }
        }
        break;
      }

      case 'crush_vehicles': {
        const targetSpec = stage.vehicleSpecId ?? 'mobster_v8';
        if (playerVeh && playerVeh.specId === targetSpec) {
          m.objectivePos = stage.targetPos ?? { x: 1600, y: 1600 };
          m.objectiveLabel = stage.description;
        } else {
          let nearest: VehicleEntity | null = null;
          let bestD = Infinity;
          let brooklynCount = 0;
          for (const v of vehicles) {
            if (!v.alive || v.damageStage === 'wrecked' || v.specId !== targetSpec) continue;
            if (Math.hypot(v.x - 1600, v.y - 1600) < 340) brooklynCount++;
            const d = Math.hypot(v.x - player.x, v.y - player.y);
            if (d < bestD) {
              bestD = d;
              nearest = v;
            }
          }
          const needed = Math.max(1, m.stageTargetCount - m.stageProgress);
          if (brooklynCount < needed && this.crusherBackupCooldown <= 0) {
            const bx = 1536;
            const by = 1720;
            const blocked = vehicles.some((v) => v.alive && Math.hypot(v.x - bx, v.y - by) < 8);
            if (!blocked) {
              const backup = hooks.spawnVehicle(targetSpec, bx, by, -Math.PI / 2, 'none', undefined, true, 'scrap_target');
              if (backup && !nearest) nearest = backup;
              this.crusherBackupCooldown = 8;
            }
          }
          if (nearest) {
            m.objectivePos = { x: nearest.x, y: nearest.y };
            m.objectiveLabel = 'Jack a Syndicate Mobster V8 & drive it to the Car Crusher';
          } else {
            m.objectivePos = stage.targetPos ?? { x: 1600, y: 1600 };
          }
        }
        break;
      }
    }
  }

  public damageMissionProp(propId: string, amount: number, hooks: MissionEngineHooks): void {
    if (!this.activeMission || this.missionProps.length === 0) return;
    const mp = this.missionProps.find((p) => p.id === propId && p.alive);
    if (!mp) return;
    mp.hp = Math.max(0, mp.hp - amount);
    if (mp.hp <= 0) {
      mp.alive = false;
      hooks.playSound('cash');
      const rem = this.missionProps.filter((t) => t.alive).length;
      hooks.pushPager(
        `TARGET DESTROYED! (${this.missionProps.length - rem}/${this.missionProps.length})`,
        'amber',
        4
      );
      hooks.onPropExplosion?.(mp.x, mp.y, mp.z, mp.type);
    }
  }

  public notifyExplosionAt(x: number, y: number, radius: number, hooks: MissionEngineHooks): void {
    if (!this.activeMission || this.missionProps.length === 0) return;
    for (const mp of this.missionProps) {
      if (!mp.alive) continue;
      const d = Math.hypot(mp.x - x, mp.y - y);
      if (d > radius + 2.5) continue;
      const dmg =
        radius <= 8
          ? d <= 5.5
            ? 120
            : 90 * Math.max(0.25, 1 - d / (radius + 2.5))
          : 220 * Math.max(0.35, 1 - d / (radius + 4));
      this.damageMissionProp(mp.id, dmg, hooks);
    }
  }

  public notifyPickupCollected(type: PickupEntity['type'], pickupId?: string): void {
    if (!this.activeMission || type !== 'cash' || !pickupId) return;
    const stage = this.activeMission.def.stages[this.activeMission.stageIndex];
    if (stage?.type !== 'collect_pickups') return;
    const mp = this.missionPickups.find((p) => p.id === pickupId && !p.collected);
    if (!mp) return;
    mp.collected = true;
    this.activeMission.stageProgress = this.missionPickups.filter((p) => p.collected).length;
  }

  public startKillFrenzy(killFrenzyId: string, player: PlayerEntity, hooks: MissionEngineHooks): void {
    if (this.activeKillFrenzy) return;
    const def = KILL_FRENZIES.find((k) => k.id === killFrenzyId);
    if (!def) return;
    this.activeKillFrenzy = {
      def,
      progress: 0,
      timeLeft: def.durationSec,
      previousWeapon: player.activeWeapon,
    };
    hooks.grantWeapon(def.weaponId, 999, true);
    hooks.playSound('beep');
    hooks.pushPager(
      `KILL FRENZY: ${def.title.toUpperCase()} — ${def.targetType === 'vehicles' ? 'DESTROY' : 'ELIMINATE'} ${def.targetCount} ${def.targetType.toUpperCase()} IN ${def.durationSec}s!`,
      'red',
      7
    );
  }

  public notifyKillFrenzyProgress(
    kind: 'vehicles' | 'gangsters',
    player: PlayerEntity,
    hooks: MissionEngineHooks
  ): void {
    if (!this.activeKillFrenzy) return;
    if (this.activeKillFrenzy.def.targetType !== kind) return;
    this.activeKillFrenzy.progress++;
    if (this.activeKillFrenzy.progress >= this.activeKillFrenzy.def.targetCount) {
      const def = this.activeKillFrenzy.def;
      this.completedKillFrenzies.add(def.id);
      this.activeKillFrenzy = null;
      player.maxHp += def.maxHpBonus;
      player.hp = player.maxHp;
      hooks.awardCash(def.rewardCash, 'KILL FRENZY PASSED');
      hooks.playSound('complete');
      hooks.pushPager(
        `KILL FRENZY PASSED! +$${def.rewardCash.toLocaleString()} & PERMANENT +${def.maxHpBonus} MAX HP!`,
        'green',
        8
      );
    }
  }

  public toggleSideJob(
    player: PlayerEntity,
    vehicles: VehicleEntity[],
    hooks: MissionEngineHooks
  ): void {
    if (this.activeSideJob) {
      hooks.pushPager(`${this.activeSideJob.type.toUpperCase()} MISSION CANCELLED`, 'amber', 4);
      this.activeSideJob = null;
      return;
    }

    const v = player.vehicleId ? vehicles.find((veh) => veh.id === player.vehicleId) : null;
    if (!v) return;
    const jobType = VEHICLES[v.specId].sideJob;
    if (!jobType) return;

    this.startNextSideJobStage(jobType, 1, 0, player, hooks);
  }

  private startNextSideJobStage(
    type: SideJobType,
    level: number,
    totalEarned: number,
    player: PlayerEntity,
    hooks: MissionEngineHooks
  ): void {
    const dest = this.pickRandomRoadSpotNear(player.x, player.y, 140, 380);
    if (type === 'taxi') {
      const dropoff = this.pickRandomRoadSpotNear(dest.x, dest.y, 160, 420);
      this.activeSideJob = {
        type,
        level,
        targetPos: dest,
        dropoffPos: dropoff,
        phase: 'pickup',
        timeLeft: 65,
        totalEarned,
        description: `TAXI FARE #${level}: Pick up passenger`,
      };
    } else if (type === 'paramedic') {
      const dropoff = { x: 640, y: 896 }; // Midtown Medical Center
      this.activeSideJob = {
        type,
        level,
        targetPos: dest,
        dropoffPos: dropoff,
        phase: 'pickup',
        timeLeft: 75,
        totalEarned,
        description: `PARAMEDIC #${level}: Rescue injured citizen`,
      };
    } else {
      // Vigilante: spawn fleeing criminal at dest
      const target = hooks.spawnPed({
        role: 'gang',
        faction: 'syndicate',
        weaponId: 'dual_uzis',
        x: dest.x,
        y: dest.y,
        isMissionEntity: true,
        missionTag: 'vigilante_target',
      });
      this.activeSideJob = {
        type,
        level,
        targetPos: dest,
        phase: 'eliminate',
        targetEntityId: target.id,
        timeLeft: 80,
        totalEarned,
        description: `VIGILANTE #${level}: Intercept & neutralize fugitive`,
      };
    }
    hooks.playSound('beep');
    hooks.pushPager(this.activeSideJob.description.toUpperCase(), 'cyan', 5);
  }

  private updateSideJob(
    dt: number,
    player: PlayerEntity,
    vehicles: VehicleEntity[],
    peds: PedEntity[],
    hooks: MissionEngineHooks
  ): void {
    const job = this.activeSideJob;
    if (!job) return;

    const v = player.vehicleId ? vehicles.find((veh) => veh.id === player.vehicleId) : null;
    if (!v || VEHICLES[v.specId].sideJob !== job.type) {
      this.activeSideJob = null;
      hooks.pushPager(`${job.type.toUpperCase()} JOB ENDED (LEFT VEHICLE)`, 'amber', 4);
      return;
    }

    job.timeLeft -= dt;
    if (job.timeLeft <= 0) {
      this.activeSideJob = null;
      hooks.pushPager(`${job.type.toUpperCase()} TIME EXPIRED!`, 'red', 4);
      return;
    }

    if (job.phase === 'pickup') {
      if (Math.hypot(player.x - job.targetPos.x, player.y - job.targetPos.y) < 16 && Math.abs(v.speed) < 8) {
        job.phase = 'dropoff';
        job.targetPos = job.dropoffPos ?? { x: 640, y: 960 };
        job.timeLeft += 45;
        job.description =
          job.type === 'taxi'
            ? `TAXI FARE #${job.level}: Drive passenger to destination`
            : `PARAMEDIC #${job.level}: Rush patient to Midtown ER`;
        hooks.playSound('beep');
        hooks.pushPager(job.description.toUpperCase(), 'green', 4);
      }
    } else if (job.phase === 'dropoff') {
      if (Math.hypot(player.x - job.targetPos.x, player.y - job.targetPos.y) < 18 && Math.abs(v.speed) < 8) {
        const reward = 1500 * job.level;
        hooks.awardCash(reward, `${job.type.toUpperCase()} LVL ${job.level}`);
        hooks.playSound('cash');
        this.startNextSideJobStage(job.type, job.level + 1, job.totalEarned + reward, player, hooks);
      }
    } else if (job.phase === 'eliminate') {
      const target = peds.find((p) => p.id === job.targetEntityId);
      if (!target || !target.alive) {
        const reward = 2200 * job.level;
        hooks.awardCash(reward, `VIGILANTE LVL ${job.level}`);
        hooks.playSound('cash');
        this.startNextSideJobStage(job.type, job.level + 1, job.totalEarned + reward, player, hooks);
      } else {
        job.targetPos = { x: target.x, y: target.y };
      }
    }
  }

  public getGpsTarget(
    player: PlayerEntity,
    respect: Record<FactionId, number>
  ): { pos: Vec2; label: string; color: string; radius: number } | null {
    if (this.activeMission?.objectivePos) {
      return {
        pos: this.activeMission.objectivePos,
        label: this.activeMission.objectiveLabel,
        color: '#22c55e',
        radius: this.activeMission.def.stages[this.activeMission.stageIndex]?.radius ?? 14,
      };
    }
    if (this.activeSideJob) {
      return {
        pos: this.activeSideJob.targetPos,
        label: this.activeSideJob.description,
        color: '#38bdf8',
        radius: 14,
      };
    }
    if (player.wantedStars >= 3) {
      const pns = this.findNearestFacility(player.x, player.y, 'pay_n_spray');
      if (pns) return { pos: { x: pns.x, y: pns.y }, label: "NEAREST PAY 'N' SPRAY", color: '#4ade80', radius: 13 };
    }
    const ph = this.getNearestAvailablePayphone(player, respect);
    if (ph) {
      return {
        pos: { x: ph.x, y: ph.y },
        label: `${GANGS[ph.faction].shortName} ${ph.tier.toUpperCase()} PAYPHONE`,
        color: ph.tier === 'green' ? '#22c55e' : ph.tier === 'yellow' ? '#facc15' : '#ef4444',
        radius: 8,
      };
    }
    return null;
  }

  private findNearestFacility(x: number, y: number, type: 'pay_n_spray' | 'car_crusher' | 'sanctuary_chapel') {
    let best = null;
    let bestD = Infinity;
    for (const f of WORLD_FACILITIES) {
      if (f.type !== type) continue;
      const d = Math.hypot(f.x - x, f.y - y);
      if (d < bestD) {
        bestD = d;
        best = f;
      }
    }
    return best;
  }

  private pickRandomRoadSpotNear(cx: number, cy: number, minD: number, maxD: number): Vec2 {
    for (let i = 0; i < 20; i++) {
      const ax = ALL_AVENUES[Math.floor(Math.random() * ALL_AVENUES.length)];
      const sy = ALL_STREETS[Math.floor(Math.random() * ALL_STREETS.length)];
      const d = Math.hypot(ax - cx, sy - cy);
      if (d >= minD && d <= maxD) return { x: ax, y: sy };
    }
    return { x: 640, y: 960 };
  }

  public getAllMissions(): MissionDef[] {
    return MISSIONS;
  }
}
