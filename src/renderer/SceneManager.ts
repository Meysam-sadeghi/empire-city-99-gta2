import * as THREE from 'three';
import type {
  DecalEntity,
  FirePoolEntity,
  ParticleEntity,
  PedEntity,
  PedRole,
  PickupEntity,
  PlayerEntity,
  ProjectileEntity,
  VehicleDamageStage,
  VehicleEntity,
  VehicleId,
  VehicleSpec,
  WeaponId,
} from '../types/entity.types';
import type { BuildingDef, DistrictId, FactionId, Vec2, WorldMapData } from '../types/world.types';
import { VEHICLES } from '../data/vehicles.data';
import { ProceduralTextures } from './ProceduralTextures';
import { computePedPose, type PedPose, SpriteAtlas } from './SpriteAtlas';
import { ChunkMeshBuilder, type ChunkVisual } from './ChunkMeshBuilder';
import { LightingSystem, type LightingMode } from './LightingSystem';

export type { LightingMode };

export interface EntityPrevPose {
  x: number;
  y: number;
  z: number;
  heading: number;
  turretHeading?: number;
}

export interface MissionPropRenderItem {
  id: string;
  type: 'relay_dish' | 'fuel_tanker';
  x: number;
  y: number;
  z: number;
  hp: number;
  maxHp: number;
  alive: boolean;
}

export interface RenderFrameData {
  player: PlayerEntity;
  vehicles: VehicleEntity[];
  peds: PedEntity[];
  pickups: PickupEntity[];
  projectiles: ProjectileEntity[];
  firePools: FirePoolEntity[];
  particles: ParticleEntity[];
  decals: DecalEntity[];
  activeChunkKeys: Set<string>;
  districtId: DistrictId;
  timeOfDay: number;
  elapsedSec: number;
  objectivePos: Vec2 | null;
  objectiveRadius: number;
  objectiveColor: string;
  muzzleFlashes: { x: number; y: number; z: number }[];
  explosionFlashes: { x: number; y: number; z: number; radius: number }[];
  lightingMode?: LightingMode;
  nsGreen?: boolean;
  missionProps?: MissionPropRenderItem[];
  alpha?: number;
  frameDt?: number;
  playerPrev?: EntityPrevPose;
  vehiclePrevMap?: Map<string, EntityPrevPose>;
}

interface VehicleVisual {
  group: THREE.Group;
  bodyMesh: THREE.Mesh;
  turretMesh?: THREE.Mesh;
  shadowMesh: THREE.Mesh;
  headlightMesh: THREE.Mesh;
  lastSpecId: VehicleId | string;
  lastColor: string;
  lastDamageStage: VehicleDamageStage;
  lastBraking: boolean;
  lastSirenPhase: number;
}

interface PedVisual {
  mesh: THREE.Mesh;
  shadowMesh: THREE.Mesh;
  lastRole: PedRole;
  lastShirtColor: string;
  lastFaction: FactionId | undefined;
  lastAlive: boolean;
  lastWeaponId: WeaponId;
  lastPose: PedPose;
}

interface FallbackBldg {
  bx: number;
  by: number;
  bw: number;
  bh: number;
  rx: number;
  ry: number;
  rw: number;
  rh: number;
  distSq: number;
  b: BuildingDef;
}

interface MissionPropVisual {
  group: THREE.Group;
  propRoot: THREE.Group;
  ringMesh: THREE.Mesh;
  hpBgMesh: THREE.Mesh;
  hpFillMesh: THREE.Mesh;
  type: 'relay_dish' | 'fuel_tanker';
  alive: boolean;
}

const FALLBACK_SPEC: Pick<VehicleSpec, 'width' | 'length' | 'hasSiren'> = {
  width: 2.35,
  length: 4.9,
  hasSiren: false,
};

export class SceneManager {
  private static readonly MAX_CHUNK_CACHE = 64;
  private static readonly MAX_CHUNK_BUILDS_PER_FRAME = 2;
  private static readonly CHUNK_BUILD_BUDGET_MS = 4.0;
  private static colorHexCache = new Map<string, number>();
  private static scratchColor = new THREE.Color();

  private static parseColorHex(css: string): number {
    let hex = SceneManager.colorHexCache.get(css);
    if (hex === undefined) {
      SceneManager.scratchColor.set(css);
      hex = SceneManager.scratchColor.getHex();
      SceneManager.colorHexCache.set(css, hex);
    }
    return hex;
  }

  private static compareFallbackBuildings = (a: FallbackBldg, b: FallbackBldg): number => b.distSq - a.distSq;

  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer | null = null;
  private fallbackCanvas: HTMLCanvasElement | null = null;
  private fallbackCtx: CanvasRenderingContext2D | null = null;
  private fallbackChunkCanvases = new Map<string, HTMLCanvasElement>();
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private textures!: ProceduralTextures;
  private atlas!: SpriteAtlas;
  private chunkBuilder!: ChunkMeshBuilder;
  private lighting!: LightingSystem;
  private map: WorldMapData;

  private chunkVisualCache = new Map<string, ChunkVisual>();
  private activeChunkVisuals = new Map<string, ChunkVisual>();
  private missingChunkKeys: string[] = [];
  private syncPlayerX = 640;
  private syncPlayerY = 1536;

  private vehicleVisuals = new Map<string, VehicleVisual>();
  private pedVisuals = new Map<string, PedVisual>();
  private pickupVisuals = new Map<string, THREE.Mesh>();
  private missionPropVisuals = new Map<string, MissionPropVisual>();

  private playerMesh!: THREE.Mesh;
  private playerShadowMesh!: THREE.Mesh;
  private lastPlayerAlive = true;
  private lastPlayerWeapon: WeaponId = 'fists';
  private lastPlayerPose: PedPose = 'idle';
  private autoAimRing!: THREE.Mesh;
  private objectiveRing!: THREE.Mesh;
  private objectiveBeacon!: THREE.Mesh;
  private vehicleShadowMat: THREE.MeshBasicMaterial | null = null;
  private pedShadowMat: THREE.MeshBasicMaterial | null = null;

  // Pre-allocated dynamic effect meshes & cached color hex arrays
  private projectileMeshes: THREE.Mesh[] = [];
  private projectileHexes: number[] = [];
  private fireMeshes: THREE.Mesh[] = [];
  private particleMeshes: THREE.Mesh[] = [];
  private particleHexes: number[] = [];
  private decalMeshes: THREE.Mesh[] = [];
  private decalHexes: number[] = [];

  // Reusable scratch fields (zero per-frame allocations)
  private tmpAliveIds = new Set<string>();
  private tmpRaycaster = new THREE.Raycaster();
  private tmpNdc = new THREE.Vector2();
  private tmpPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private tmpHit = new THREE.Vector3();
  private tmpPlayerPose: EntityPrevPose = { x: 0, y: 0, z: 0, heading: 0 };
  private tmpTargetVehPose: EntityPrevPose = { x: 0, y: 0, z: 0, heading: 0, turretHeading: 0 };
  private tmpVehPose: EntityPrevPose = { x: 0, y: 0, z: 0, heading: 0, turretHeading: 0 };
  private visibleBuildings: FallbackBldg[] = [];
  private visibleBuildingPool: FallbackBldg[] = [];

  private camX = 640;
  private camY = 1536;
  private camHeight = 40;
  private screenShake = 0;

  private unitPlane = new THREE.PlaneGeometry(1, 1);
  private mpRingGeo = new THREE.RingGeometry(2.1, 2.55, 24);
  private hpBarGeo = new THREE.PlaneGeometry(1, 0.34);

  private compareMissingChunks = (a: string, b: string): number => {
    const ca = this.map.chunks.get(a)!;
    const cb = this.map.chunks.get(b)!;
    const half = this.map.chunkSize * 0.5;
    const dax = ca.cx * this.map.chunkSize + half - this.syncPlayerX;
    const day = ca.cy * this.map.chunkSize + half - this.syncPlayerY;
    const dbx = cb.cx * this.map.chunkSize + half - this.syncPlayerX;
    const dby = cb.cy * this.map.chunkSize + half - this.syncPlayerY;
    return dax * dax + day * day - (dbx * dbx + dby * dby);
  };

  constructor(container: HTMLElement, map: WorldMapData) {
    this.container = container;
    this.map = map;
    this.textures = new ProceduralTextures();
    this.atlas = new SpriteAtlas();

    const w = container.clientWidth || window.innerWidth;
    const h = Math.max(1, container.clientHeight || window.innerHeight);

    const probeCanvas = document.createElement('canvas');
    let hasWebGL = false;
    try {
      const gl = probeCanvas.getContext('webgl2') || probeCanvas.getContext('webgl');
      hasWebGL = Boolean(gl);
    } catch {
      hasWebGL = false;
    }

    if (hasWebGL) {
      try {
        this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
      } catch {
        this.renderer = null;
      }
    }

    container.innerHTML = '';

    if (this.renderer) {
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.setSize(w, h);
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.12;
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.renderer.setClearColor('#070b14');
      container.appendChild(this.renderer.domElement);
      this.initThreeScene(w, h);
    } else {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.style.width = '100%';
      c.style.height = '100%';
      c.style.display = 'block';
      container.appendChild(c);
      this.fallbackCanvas = c;
      this.fallbackCtx = c.getContext('2d');
    }

    window.addEventListener('resize', this.handleResize);
  }

  private initThreeScene(w: number, h: number): void {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog('#0b1120', 110, 340);

    const aspect = w / Math.max(1, h);
    this.camera = new THREE.PerspectiveCamera(42, aspect, 1, 600);

    this.chunkBuilder = new ChunkMeshBuilder(this.textures);
    this.lighting = new LightingSystem(this.scene);

    // Global ocean base underneath whole map
    const oceanGeo = new THREE.PlaneGeometry(3200, 3200);
    const oceanMat = new THREE.MeshLambertMaterial({ color: '#0c2d48' });
    const ocean = new THREE.Mesh(oceanGeo, oceanMat);
    ocean.rotation.x = -Math.PI / 2;
    ocean.position.set(1024, -0.35, 1024);
    this.scene.add(ocean);

    // Distant LOD skyline across whole 2048m x 2048m city
    const lodSkyline = this.chunkBuilder.buildDistantSkylineLOD(this.map);
    this.scene.add(lodSkyline);

    // Queens Elevated Expressway decks & ramps
    const overpassGroup = this.chunkBuilder.buildOverpassesGroup(this.map.overpasses);
    this.scene.add(overpassGroup);

    // Player top-down articulated sprite + separate ground contact shadow
    const initPlayerTex = this.atlas.getPedTexture('player', '#f97316', undefined, true, 'fists', 'idle');
    this.lastPlayerAlive = true;
    this.lastPlayerWeapon = 'fists';
    this.lastPlayerPose = 'idle';
    const playerMat = new THREE.MeshLambertMaterial({
      map: initPlayerTex,
      transparent: true,
      alphaTest: 0.06,
      depthWrite: false,
      emissive: new THREE.Color('#ffffff'),
      emissiveMap: initPlayerTex,
      emissiveIntensity: 0.18,
    });
    this.playerMesh = new THREE.Mesh(this.unitPlane, playerMat);
    this.playerMesh.rotation.x = -Math.PI / 2;
    this.playerMesh.scale.set(2.45, 2.45, 1);
    this.scene.add(this.playerMesh);

    const playerShadowMat = new THREE.MeshBasicMaterial({
      map: this.atlas.getShadowTexture(),
      transparent: true,
      opacity: 0.56,
      depthWrite: false,
    });
    this.playerShadowMesh = new THREE.Mesh(this.unitPlane, playerShadowMat);
    this.playerShadowMesh.rotation.x = -Math.PI / 2;
    this.playerShadowMesh.scale.set(1.9, 1.9, 1);
    this.scene.add(this.playerShadowMesh);

    this.vehicleShadowMat = new THREE.MeshBasicMaterial({
      map: this.atlas.getVehicleShadowTexture(),
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
    });
    this.pedShadowMat = new THREE.MeshBasicMaterial({
      map: this.atlas.getShadowTexture(),
      transparent: true,
      opacity: 0.48,
      depthWrite: false,
    });

    // Auto-aim reticle ring
    const aimGeo = new THREE.RingGeometry(1.1, 1.45, 20);
    const aimMat = new THREE.MeshBasicMaterial({
      color: '#ef4444',
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.88,
    });
    this.autoAimRing = new THREE.Mesh(aimGeo, aimMat);
    this.autoAimRing.rotation.x = -Math.PI / 2;
    this.autoAimRing.visible = false;
    this.scene.add(this.autoAimRing);

    // Mission objective glowing ground ring + vertical light beam
    const objGeo = new THREE.RingGeometry(0.82, 1.0, 32);
    const objMat = new THREE.MeshBasicMaterial({
      color: '#22c55e',
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
    });
    this.objectiveRing = new THREE.Mesh(objGeo, objMat);
    this.objectiveRing.rotation.x = -Math.PI / 2;
    this.objectiveRing.visible = false;
    this.scene.add(this.objectiveRing);

    const beaconGeo = new THREE.CylinderGeometry(1.1, 1.8, 22, 12, 1, true);
    const beaconMat = new THREE.MeshBasicMaterial({
      color: '#22c55e',
      transparent: true,
      opacity: 0.24,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.objectiveBeacon = new THREE.Mesh(beaconGeo, beaconMat);
    this.objectiveBeacon.visible = false;
    this.scene.add(this.objectiveBeacon);

    // Pre-allocate effect meshes
    const projGeo = new THREE.BoxGeometry(0.95, 0.28, 0.28);
    for (let i = 0; i < 120; i++) {
      const m = new THREE.Mesh(projGeo, new THREE.MeshBasicMaterial({ color: 0xfde047 }));
      m.visible = false;
      this.scene.add(m);
      this.projectileMeshes.push(m);
      this.projectileHexes.push(0xfde047);
    }

    const fireGeo = new THREE.CircleGeometry(1, 12);
    for (let i = 0; i < 40; i++) {
      const m = new THREE.Mesh(
        fireGeo,
        new THREE.MeshBasicMaterial({
          color: 0xf97316,
          transparent: true,
          opacity: 0.72,
          depthWrite: false,
        })
      );
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      this.scene.add(m);
      this.fireMeshes.push(m);
    }

    const partGeo = new THREE.CircleGeometry(0.5, 8);
    for (let i = 0; i < 260; i++) {
      const m = new THREE.Mesh(
        partGeo,
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.8,
          depthWrite: false,
        })
      );
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      this.scene.add(m);
      this.particleMeshes.push(m);
      this.particleHexes.push(0xffffff);
    }

    for (let i = 0; i < 180; i++) {
      const m = new THREE.Mesh(
        this.unitPlane,
        new THREE.MeshBasicMaterial({
          color: 0x111827,
          transparent: true,
          opacity: 0.65,
          depthWrite: false,
        })
      );
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      this.scene.add(m);
      this.decalMeshes.push(m);
      this.decalHexes.push(0x111827);
    }
  }

  private handleResize = (): void => {
    const w = this.container.clientWidth || window.innerWidth;
    const h = Math.max(1, this.container.clientHeight || window.innerHeight);
    if (this.renderer) {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    } else if (this.fallbackCanvas) {
      this.fallbackCanvas.width = w;
      this.fallbackCanvas.height = h;
    }
  };

  public addScreenShake(amount: number): void {
    this.screenShake = Math.min(2.6, Math.max(this.screenShake, amount));
  }

  public snapCamera(x: number, y: number, height = 38): void {
    this.camX = x;
    this.camY = y;
    this.camHeight = height;
  }

  private lerpAngle(prev: number, curr: number, alpha: number): number {
    const diff = Math.atan2(Math.sin(curr - prev), Math.cos(curr - prev));
    return prev + diff * alpha;
  }

  private resolveInterpolatedPose(
    currX: number,
    currY: number,
    currZ: number,
    currHeading: number,
    currTurretHeading: number | undefined,
    prev: EntityPrevPose | undefined,
    alpha: number,
    out: EntityPrevPose
  ): void {
    if (prev && alpha < 1 && Math.hypot(currX - prev.x, currY - prev.y) <= 10) {
      out.x = prev.x + (currX - prev.x) * alpha;
      out.y = prev.y + (currY - prev.y) * alpha;
      out.z = prev.z + (currZ - prev.z) * alpha;
      out.heading = this.lerpAngle(prev.heading, currHeading, alpha);
      if (currTurretHeading !== undefined) {
        const prevTurret = prev.turretHeading ?? currTurretHeading;
        out.turretHeading = this.lerpAngle(prevTurret, currTurretHeading, alpha);
      }
    } else {
      out.x = currX;
      out.y = currY;
      out.z = currZ;
      out.heading = currHeading;
      out.turretHeading = currTurretHeading;
    }
  }

  public screenToWorld(clientX: number, clientY: number, elevation = 0): Vec2 | null {
    if (this.renderer) {
      const rect = this.renderer.domElement.getBoundingClientRect();
      const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
      this.tmpNdc.set(ndcX, ndcY);
      this.tmpRaycaster.setFromCamera(this.tmpNdc, this.camera);
      this.tmpPlane.constant = -elevation;
      if (this.tmpRaycaster.ray.intersectPlane(this.tmpPlane, this.tmpHit)) {
        return { x: this.tmpHit.x, y: this.tmpHit.z };
      }
      return null;
    }
    if (this.fallbackCanvas) {
      const rect = this.fallbackCanvas.getBoundingClientRect();
      const ppm = 520 / Math.max(24, this.camHeight);
      return {
        x: this.camX + (clientX - rect.left - rect.width * 0.5) / ppm,
        y: this.camY + (clientY - rect.top - rect.height * 0.5) / ppm,
      };
    }
    return null;
  }

  public getDrawCalls(): number {
    return this.renderer ? this.renderer.info.render.calls : this.fallbackChunkCanvases.size + 4;
  }

  private getPlayerJumpState(player: PlayerEntity): { jumpHeight: number; isJumping: boolean; shadowGroundZ: number } {
    const pJump = player as { isJumping?: boolean; jumpHeight?: number };
    const jumpHeight =
      pJump.jumpHeight ?? (player.layer === 0 ? Math.max(0, player.z) : Math.max(0, player.z - 6));
    const isJumping = pJump.isJumping ?? jumpHeight > 0.15;
    const shadowGroundZ = player.z - jumpHeight;
    return { jumpHeight, isJumping, shadowGroundZ };
  }

  public render(data: RenderFrameData, alphaArg?: number, frameDtArg?: number): void {
    const alpha = Math.max(0, Math.min(1, alphaArg ?? data.alpha ?? 1));
    const frameDt = Math.max(0.0001, Math.min(0.1, frameDtArg ?? data.frameDt ?? 1 / 60));

    this.resolveInterpolatedPose(
      data.player.x,
      data.player.y,
      data.player.z,
      data.player.heading,
      undefined,
      data.playerPrev,
      alpha,
      this.tmpPlayerPose
    );
    let px = this.tmpPlayerPose.x;
    let py = this.tmpPlayerPose.y;
    let pz = this.tmpPlayerPose.z;
    let pHeading = this.tmpPlayerPose.heading;

    let targetX = px;
    let targetY = py;
    let targetHeight = 38;
    let leadX = 0;
    let leadY = 0;

    if (data.player.vehicleId) {
      let v: VehicleEntity | null = null;
      for (let i = 0; i < data.vehicles.length; i++) {
        if (data.vehicles[i].id === data.player.vehicleId) {
          v = data.vehicles[i];
          break;
        }
      }
      if (v) {
        this.resolveInterpolatedPose(
          v.x,
          v.y,
          v.z,
          v.heading,
          v.turretHeading,
          data.vehiclePrevMap?.get(v.id),
          alpha,
          this.tmpTargetVehPose
        );
        targetX = this.tmpTargetVehPose.x;
        targetY = this.tmpTargetVehPose.y;
        pz = this.tmpTargetVehPose.z;
        px = targetX;
        py = targetY;
        pHeading = this.tmpTargetVehPose.heading;
        const absSpeed = Math.abs(v.speed);
        const speedNorm = Math.min(1, absSpeed / 42);
        targetHeight = 40 + speedNorm * 35;
        leadX = Math.cos(this.tmpTargetVehPose.heading) * speedNorm * 11;
        leadY = Math.sin(this.tmpTargetVehPose.heading) * speedNorm * 11;
      }
    }

    const posBlend = 1 - Math.exp(-9.0 * frameDt);
    const heightBlend = 1 - Math.exp(-5.0 * frameDt);
    this.camX += (targetX + leadX - this.camX) * posBlend;
    this.camY += (targetY + leadY - this.camY) * posBlend;
    this.camHeight += (targetHeight - this.camHeight) * heightBlend;

    let shakeX = 0;
    let shakeZ = 0;
    if (this.screenShake > 0.01) {
      shakeX = (Math.random() - 0.5) * this.screenShake;
      shakeZ = (Math.random() - 0.5) * this.screenShake;
      this.screenShake *= Math.pow(0.88, frameDt * 60);
    }

    if (!this.renderer) {
      this.renderFallback25D(data, shakeX, shakeZ, alpha, px, py, pz, pHeading);
      return;
    }

    // 1. Sync active 5x5 streamed chunk meshes (64-chunk LRU + staggered <=2/frame builds)
    this.syncChunks(data.activeChunkKeys, px, py);

    // 2. Camera with GTA 2 southward tilt
    const tiltOffsetZ = this.camHeight * 0.24;
    this.camera.position.set(this.camX + shakeX, this.camHeight + pz, this.camY + tiltOffsetZ + shakeZ);
    this.camera.lookAt(this.camX, pz, this.camY);

    // 3. Dynamic Lighting & Mode Contrast
    const lightInfo = this.lighting.beginFrame(
      data.timeOfDay,
      data.districtId,
      this.camX,
      this.camY,
      data.lightingMode
    );
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.copy(lightInfo.fogColor);
    }
    this.renderer.setClearColor(lightInfo.fogColor);

    // O(1) Traffic Signal Lens Sync + Shared Building Facade/Lamp Pool Modulation
    this.chunkBuilder.setTrafficSignalPhase(data.nsGreen ?? true);
    this.chunkBuilder.setNightFactor(lightInfo.nightFactor);

    const payphonePulse = 0.92 + Math.sin(data.elapsedSec * 5.2) * 0.16;
    const payphoneOpacity = 0.48 + Math.sin(data.elapsedSec * 5.2) * 0.28;

    for (const chunkVis of this.activeChunkVisuals.values()) {
      for (const ring of chunkVis.payphoneRings) {
        ring.scale.set(payphonePulse, payphonePulse, 1);
        (ring.material as THREE.MeshBasicMaterial).opacity = payphoneOpacity;
      }
    }

    // 4. Sync Player Sprite & Jump Shadow Separation
    if (data.player.vehicleId) {
      this.playerMesh.visible = false;
      this.playerShadowMesh.visible = false;
    } else {
      const alive = data.player.status === 'alive';
      const { jumpHeight, isJumping, shadowGroundZ } = this.getPlayerJumpState(data.player);
      const interpJumpHeight = Math.max(0, pz - shadowGroundZ);
      const pose = computePedPose(data.player.vx, data.player.vy, data.player.walkPhase, alive, isJumping);

      this.playerMesh.visible = true;
      this.playerMesh.position.set(px, pz + 0.55, py);
      this.playerMesh.rotation.set(-Math.PI / 2, 0, -pHeading);
      const scaleMult = isJumping ? 1.1 : 1.0;
      this.playerMesh.scale.set(2.45 * scaleMult, 2.45 * scaleMult, 1);

      if (
        alive !== this.lastPlayerAlive ||
        data.player.activeWeapon !== this.lastPlayerWeapon ||
        pose !== this.lastPlayerPose
      ) {
        const tex = this.atlas.getPedTexture(
          'player',
          '#f97316',
          undefined,
          alive,
          data.player.activeWeapon,
          pose
        );
        const mat = this.playerMesh.material as THREE.MeshLambertMaterial;
        mat.map = tex;
        mat.emissiveMap = tex;
        mat.needsUpdate = true;
        this.lastPlayerAlive = alive;
        this.lastPlayerWeapon = data.player.activeWeapon;
        this.lastPlayerPose = pose;
      }

      // Ground contact shadow stays pinned to shadowGroundZ and shrinks/softens as jumpHeight increases
      const shadowJ = jumpHeight > 0 || interpJumpHeight > 0 ? interpJumpHeight : 0;
      this.playerShadowMesh.visible = alive;
      this.playerShadowMesh.position.set(
        px - 0.18 - shadowJ * 0.42,
        shadowGroundZ + 0.06,
        py - 0.14 - shadowJ * 0.32
      );
      const shScale = Math.max(0.85, 1.95 - shadowJ * 0.32);
      this.playerShadowMesh.scale.set(shScale, shScale, 1);
      (this.playerShadowMesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0.18, 0.56 - shadowJ * 0.12);
    }

    // Auto-aim reticle
    if (data.player.autoAimPos && !data.player.vehicleId && data.player.status === 'alive') {
      this.autoAimRing.visible = true;
      this.autoAimRing.position.set(data.player.autoAimPos.x, pz + 0.35, data.player.autoAimPos.y);
      const s = 1 + Math.sin(data.elapsedSec * 12) * 0.12;
      this.autoAimRing.scale.set(s, s, 1);
    } else {
      this.autoAimRing.visible = false;
    }

    // 5. Sync Vehicles (with world-aligned shadows, headlight cones & alpha interpolation)
    this.syncVehicles(data.vehicles, data.elapsedSec, lightInfo.nightFactor, alpha, data.vehiclePrevMap);

    // 6. Sync Pedestrians (96x96 articulated sprites + ground contact shadows)
    this.syncPeds(data.peds);

    // 7. Sync Pickups
    this.syncPickups(data.pickups, data.elapsedSec);

    // 8. Sync Live Mission Props (relay_dish & fuel_tanker)
    this.syncMissionProps(data.missionProps ?? [], data.elapsedSec);

    // 9. Sync Projectiles, Fire Pools, Particles, Decals
    this.syncProjectiles(data.projectiles);
    this.syncFirePools(data.firePools, data.elapsedSec);
    this.syncParticles(data.particles);
    this.syncDecals(data.decals);

    // 10. Objective Ring & Beacon
    if (data.objectivePos) {
      this.objectiveRing.visible = true;
      this.objectiveBeacon.visible = true;
      const pulse = 1 + Math.sin(data.elapsedSec * 6) * 0.1;
      const rad = Math.max(4, data.objectiveRadius * 0.6) * pulse;
      this.objectiveRing.position.set(data.objectivePos.x, 0.25, data.objectivePos.y);
      this.objectiveRing.scale.set(rad, rad, 1);
      (this.objectiveRing.material as THREE.MeshBasicMaterial).color.set(data.objectiveColor);

      this.objectiveBeacon.position.set(data.objectivePos.x, 11, data.objectivePos.y);
      (this.objectiveBeacon.material as THREE.MeshBasicMaterial).color.set(data.objectiveColor);
    } else {
      this.objectiveRing.visible = false;
      this.objectiveBeacon.visible = false;
    }

    // 11. Dynamic Lights from Muzzle Flashes, Explosions & Night Streetlamps
    for (const mf of data.muzzleFlashes) {
      this.lighting.requestLight(mf.x, mf.y, mf.z, 0xfbbf24, 24, 18);
    }
    for (const ex of data.explosionFlashes) {
      this.lighting.requestLight(ex.x, ex.y, ex.z, 0xf97316, 85, ex.radius * 2.5);
    }
    if (lightInfo.nightFactor > 0.4) {
      const lampIntensity = 12 * lightInfo.nightFactor;
      for (const chunkVis of this.activeChunkVisuals.values()) {
        for (const sl of chunkVis.streetlampPositions) {
          const dSq = (sl.x - this.camX) ** 2 + (sl.y - this.camY) ** 2;
          if (dSq < 58 * 58) {
            this.lighting.requestLight(sl.x, sl.y, 4.5, sl.color, lampIntensity, 22);
          }
        }
      }
    }

    this.lighting.commitLights(this.camX, this.camY);

    this.renderer.render(this.scene, this.camera);
  }

  private drawFallbackPlayer2D(
    ctx: CanvasRenderingContext2D,
    data: RenderFrameData,
    px: number,
    py: number,
    pHeading: number,
    jumpHeight: number,
    isJumping: boolean,
    ppm: number,
    halfW: number,
    halfH: number,
    cx: number,
    cy: number
  ): void {
    if (data.player.vehicleId) return;
    const alive = data.player.status === 'alive';
    const pose = computePedPose(data.player.vx, data.player.vy, data.player.walkPhase, alive, isJumping);
    const tex = this.atlas.getPedTexture(
      'player',
      '#f97316',
      undefined,
      alive,
      data.player.activeWeapon,
      pose
    );
    const sz = 2.45 * (isJumping ? 1.12 : 1.0) * ppm;
    const elevOffset = jumpHeight * 0.55 * ppm;
    ctx.save();
    ctx.translate(halfW + (px - cx) * ppm, halfH + (py - cy) * ppm - elevOffset);
    ctx.rotate(pHeading);
    ctx.drawImage(tex.image as HTMLCanvasElement, -sz * 0.5, -sz * 0.5, sz, sz);
    ctx.restore();
  }

  private drawFallbackQuad(
    ctx: CanvasRenderingContext2D,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    x3: number,
    y3: number,
    fill: string
  ): void {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x3, y3);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(9,9,11,0.45)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  /**
   * 2.5D Perspective-Extruded Canvas2D Fallback with full WebGL feature parity.
   */
  private renderFallback25D(
    data: RenderFrameData,
    shakeX: number,
    shakeZ: number,
    alpha: number,
    px: number,
    py: number,
    pz: number,
    pHeading: number
  ): void {
    const ctx = this.fallbackCtx;
    const canvas = this.fallbackCanvas;
    if (!ctx || !canvas) return;
    const w = canvas.width;
    const h = canvas.height;
    const halfW = w * 0.5;
    const halfH = h * 0.5;
    const ppm = 520 / Math.max(24, this.camHeight);
    const cx = this.camX + shakeX;
    const cy = this.camY + shakeZ;

    const { daylight, nightFactor } = LightingSystem.resolveDaylight(data.timeOfDay, data.lightingMode);
    const duskWeight = Math.max(0, 1 - Math.abs(daylight - 0.48) / 0.32);

    ctx.fillStyle = nightFactor > 0.6 ? '#070b14' : '#0c2d48';
    ctx.fillRect(0, 0, w, h);

    // 1. Streamed 768x768 ground chunks with 64-entry LRU + staggered <= 2 builds/frame
    this.missingChunkKeys.length = 0;
    for (const key of data.activeChunkKeys) {
      const existing = this.fallbackChunkCanvases.get(key);
      if (existing) {
        this.fallbackChunkCanvases.delete(key);
        this.fallbackChunkCanvases.set(key, existing);
      } else if (this.map.chunks.has(key)) {
        this.missingChunkKeys.push(key);
      }
    }

    if (this.missingChunkKeys.length > 0) {
      this.syncPlayerX = px;
      this.syncPlayerY = py;
      this.missingChunkKeys.sort(this.compareMissingChunks);
      const buildStart = performance.now();
      let built = 0;
      for (let i = 0; i < this.missingChunkKeys.length && built < SceneManager.MAX_CHUNK_BUILDS_PER_FRAME; i++) {
        if (built >= 1 && performance.now() - buildStart >= SceneManager.CHUNK_BUILD_BUDGET_MS) {
          break;
        }
        const key = this.missingChunkKeys[i];
        const chunk = this.map.chunks.get(key);
        if (!chunk) continue;
        const groundCanvas = this.textures.createChunkGroundCanvas(chunk);
        this.fallbackChunkCanvases.set(key, groundCanvas);
        built++;
      }
    }

    if (this.fallbackChunkCanvases.size > SceneManager.MAX_CHUNK_CACHE) {
      for (const key of this.fallbackChunkCanvases.keys()) {
        if (this.fallbackChunkCanvases.size <= SceneManager.MAX_CHUNK_CACHE) break;
        if (data.activeChunkKeys.has(key)) continue;
        this.fallbackChunkCanvases.delete(key);
      }
    }

    const chunkWorldSz = this.map.chunkSize;
    const chunkScreenSz = chunkWorldSz * ppm;
    for (const key of data.activeChunkKeys) {
      const chunk = this.map.chunks.get(key);
      if (!chunk) continue;
      const sx = halfW + (chunk.cx * chunkWorldSz - cx) * ppm;
      const sy = halfH + (chunk.cy * chunkWorldSz - cy) * ppm;
      const groundCanvas = this.fallbackChunkCanvases.get(key);
      if (groundCanvas) {
        ctx.drawImage(groundCanvas, sx, sy, chunkScreenSz + 0.5, chunkScreenSz + 0.5);
      } else {
        ctx.fillStyle = '#1f2937';
        ctx.fillRect(sx, sy, chunkScreenSz + 0.5, chunkScreenSz + 0.5);
      }
    }

    // 2. Decals & Fire pools
    for (let i = 0; i < data.decals.length; i++) {
      const d = data.decals[i];
      if (!d.active) continue;
      ctx.save();
      ctx.translate(halfW + (d.x - cx) * ppm, halfH + (d.y - cy) * ppm);
      ctx.rotate(d.rotation);
      ctx.fillStyle = d.kind === 'blood' ? 'rgba(127,29,29,0.72)' : 'rgba(9,9,11,0.62)';
      ctx.fillRect(-d.length * ppm * 0.5, -d.width * ppm * 0.5, d.length * ppm, d.width * ppm);
      ctx.restore();
    }
    for (let i = 0; i < data.firePools.length; i++) {
      const fp = data.firePools[i];
      if (!fp.active) continue;
      ctx.fillStyle = 'rgba(249,115,22,0.72)';
      ctx.beginPath();
      ctx.arc(halfW + (fp.x - cx) * ppm, halfH + (fp.y - cy) * ppm, fp.radius * ppm, 0, Math.PI * 2);
      ctx.fill();
    }

    // 3. Ground Lamp Pools & Payphone Rings
    const lampTex = this.textures.getLampPoolTexture().image as HTMLCanvasElement;
    for (const key of data.activeChunkKeys) {
      const chunk = this.map.chunks.get(key);
      if (!chunk) continue;
      for (const p of chunk.props) {
        if (p.type === 'streetlamp' && nightFactor > 0.15) {
          ctx.save();
          ctx.globalAlpha = 0.12 + nightFactor * 0.62;
          const lsz = 13.5 * ppm;
          ctx.drawImage(
            lampTex,
            halfW + (p.x - 2.25 - cx) * ppm - lsz * 0.5,
            halfH + (p.y - cy) * ppm - lsz * 0.5,
            lsz,
            lsz
          );
          ctx.restore();
        } else if (p.type === 'payphone_booth') {
          const pulse = 1.6 + Math.sin(data.elapsedSec * 5.2) * 0.35;
          ctx.strokeStyle = p.color ?? '#22c55e';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(halfW + (p.x - cx) * ppm, halfH + (p.y - cy) * ppm, pulse * ppm, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    // 4. Pickups
    for (let i = 0; i < data.pickups.length; i++) {
      const pk = data.pickups[i];
      if (!pk.active) continue;
      const tex = this.atlas.getPickupTexture(pk.type, pk.weaponId);
      const sz = (pk.type === 'kill_frenzy' ? 3.2 : 2.4) * ppm;
      ctx.drawImage(
        tex.image as HTMLCanvasElement,
        halfW + (pk.x - cx) * ppm - sz * 0.5,
        halfH + (pk.y - cy) * ppm - sz * 0.5,
        sz,
        sz
      );
    }

    // 5. Pedestrians (96x96 animated poses + ground shadow)
    const pedShadowImg = this.atlas.getShadowTexture().image as HTMLCanvasElement;
    for (let i = 0; i < data.peds.length; i++) {
      const p = data.peds[i];
      if (p.vehicleId) continue;
      if (p.alive) {
        const shSz = 1.8 * ppm;
        ctx.drawImage(
          pedShadowImg,
          halfW + (p.x - 0.16 - cx) * ppm - shSz * 0.5,
          halfH + (p.y - 0.12 - cy) * ppm - shSz * 0.5,
          shSz,
          shSz
        );
      }
      const pose = computePedPose(p.vx, p.vy, p.walkPhase, p.alive, false);
      const tex = this.atlas.getPedTexture(p.role, p.shirtColor, p.faction, p.alive, p.weaponId, pose);
      const sz = (p.role === 'boss' ? 2.85 : 2.25) * ppm;
      ctx.save();
      ctx.translate(halfW + (p.x - cx) * ppm, halfH + (p.y - cy) * ppm);
      ctx.rotate(p.heading);
      ctx.drawImage(tex.image as HTMLCanvasElement, -sz * 0.5, -sz * 0.5, sz, sz);
      ctx.restore();
    }

    const { jumpHeight, isJumping, shadowGroundZ } = this.getPlayerJumpState(data.player);
    const interpJumpHeight = jumpHeight > 0 ? Math.max(0, pz - shadowGroundZ) : 0;

    // Draw player shadow on ground BEFORE vehicles so shadow stays under cars during leap
    if (!data.player.vehicleId && data.player.status === 'alive') {
      const shSz = Math.max(0.85, 1.95 - interpJumpHeight * 0.32) * ppm;
      ctx.save();
      ctx.globalAlpha = Math.max(0.2, 0.56 - interpJumpHeight * 0.12);
      ctx.drawImage(
        pedShadowImg,
        halfW + (px - 0.18 - interpJumpHeight * 0.42 - cx) * ppm - shSz * 0.5,
        halfH + (py - 0.14 - interpJumpHeight * 0.32 - cy) * ppm - shSz * 0.5,
        shSz,
        shSz
      );
      ctx.restore();
    }

    // If grounded, draw player before vehicles (or same plane); if airborne, draw AFTER vehicles!
    if (!isJumping) {
      this.drawFallbackPlayer2D(ctx, data, px, py, pHeading, interpJumpHeight, isJumping, ppm, halfW, halfH, cx, cy);
    }

    // 6. Vehicles: World-aligned shadows, Headlight cones, 22 Vehicle Silhouettes & Tank Turrets (interpolated)
    const vehShadowImg = this.atlas.getVehicleShadowTexture().image as HTMLCanvasElement;
    const coneImg = this.atlas.getHeadlightConeTexture().image as HTMLCanvasElement;
    const sirenPhase = Math.floor(data.elapsedSec * 7) % 2 === 0 ? 1 : 2;

    for (let i = 0; i < data.vehicles.length; i++) {
      const v = data.vehicles[i];
      if (!v.alive) continue;
      const spec = (VEHICLES as Record<string, VehicleSpec | undefined>)[v.specId] ?? FALLBACK_SPEC;

      this.resolveInterpolatedPose(
        v.x,
        v.y,
        v.z,
        v.heading,
        v.turretHeading,
        data.vehiclePrevMap?.get(v.id),
        alpha,
        this.tmpVehPose
      );
      const vx = this.tmpVehPose.x;
      const vy = this.tmpVehPose.y;
      const vHeading = this.tmpVehPose.heading;
      const vTurretHeading = this.tmpVehPose.turretHeading ?? v.turretHeading;

      // Sun-aligned ground shadow (-0.42, -0.32 world offset)
      ctx.save();
      ctx.translate(halfW + (vx - 0.42 - cx) * ppm, halfH + (vy - 0.32 - cy) * ppm);
      ctx.rotate(vHeading);
      ctx.drawImage(
        vehShadowImg,
        -spec.length * 0.54 * ppm,
        -spec.width * 0.56 * ppm,
        spec.length * 1.08 * ppm,
        spec.width * 1.12 * ppm
      );
      ctx.restore();

      // Headlight cones for driving vehicles
      if (v.damageStage !== 'wrecked' && v.headlightsOn && Boolean(v.driverId)) {
        ctx.save();
        ctx.globalAlpha = 0.18 + nightFactor * 0.44;
        ctx.translate(halfW + (vx - cx) * ppm, halfH + (vy - cy) * ppm);
        ctx.rotate(vHeading);
        const coneLen = 10.5 * ppm;
        const coneW = spec.width * 2.3 * ppm;
        ctx.drawImage(coneImg, spec.length * 0.48 * ppm, -coneW * 0.5, coneLen, coneW);
        ctx.restore();
      }

      // Vehicle hull
      const tex = this.atlas.getVehicleTexture(
        v.specId,
        v.color,
        v.damageStage,
        v.braking,
        v.sirenActive ? sirenPhase : 0
      );
      ctx.save();
      ctx.translate(halfW + (vx - cx) * ppm, halfH + (vy - cy) * ppm);
      ctx.rotate(vHeading);
      ctx.drawImage(
        tex.image as HTMLCanvasElement,
        -spec.length * 0.53 * ppm,
        -spec.width * 0.54 * ppm,
        spec.length * 1.06 * ppm,
        spec.width * 1.08 * ppm
      );
      ctx.restore();

      // Tank turret
      if (v.specId === 'rhino_apc') {
        const tImg = this.atlas.getTankTurretTexture().image as HTMLCanvasElement;
        ctx.save();
        ctx.translate(halfW + (vx - cx) * ppm, halfH + (vy - cy) * ppm);
        ctx.rotate(vTurretHeading);
        ctx.drawImage(
          tImg,
          -spec.length * 0.62 * ppm,
          -spec.width * 0.56 * ppm,
          spec.length * 1.24 * ppm,
          spec.width * 1.12 * ppm
        );
        ctx.restore();
      }
    }

    // Airborne player drawn on top of cars!
    if (isJumping) {
      this.drawFallbackPlayer2D(ctx, data, px, py, pHeading, interpJumpHeight, isJumping, ppm, halfW, halfH, cx, cy);
    }

    // 7. Mission Props (relay_dish & fuel_tanker) in Fallback
    const missionProps = data.missionProps;
    if (missionProps) {
      for (let i = 0; i < missionProps.length; i++) {
        const mp = missionProps[i];
        const mx = halfW + (mp.x - cx) * ppm;
        const my = halfH + (mp.y - cy) * ppm;
        const rad = 2.4 * ppm;
        if (mp.alive) {
          ctx.strokeStyle = mp.type === 'relay_dish' ? '#22d3ee' : '#f97316';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(mx, my, rad * (1 + Math.sin(data.elapsedSec * 5) * 0.1), 0, Math.PI * 2);
          ctx.stroke();
        }
        if (mp.type === 'relay_dish') {
          ctx.fillStyle = mp.alive ? '#cbd5e1' : '#27272a';
          ctx.beginPath();
          ctx.arc(mx, my, 1.5 * ppm, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = mp.alive ? '#ef4444' : '#09090b';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(mx, my);
          ctx.lineTo(mx + Math.cos(data.elapsedSec * 1.8) * 1.8 * ppm, my + Math.sin(data.elapsedSec * 1.8) * 1.8 * ppm);
          ctx.stroke();
        } else {
          ctx.fillStyle = mp.alive ? '#dc2626' : '#1f2937';
          ctx.fillRect(mx - 2.2 * ppm, my - 1.1 * ppm, 4.4 * ppm, 2.2 * ppm);
          if (mp.alive) {
            ctx.fillStyle = '#facc15';
            ctx.fillRect(mx - 1.0 * ppm, my - 1.1 * ppm, 2.0 * ppm, 2.2 * ppm);
          }
        }
        if (mp.alive && mp.hp < mp.maxHp) {
          const bw = 3.2 * ppm;
          const bh = 0.4 * ppm;
          ctx.fillStyle = '#09090b';
          ctx.fillRect(mx - bw * 0.5, my - 2.8 * ppm, bw, bh);
          ctx.fillStyle = mp.hp / Math.max(1, mp.maxHp) > 0.4 ? '#f59e0b' : '#ef4444';
          ctx.fillRect(mx - bw * 0.5, my - 2.8 * ppm, bw * Math.max(0, mp.hp / Math.max(1, mp.maxHp)), bh);
        }
      }
    }

    // 8. World Props (trees, traffic lights, streetlamps, payphones, bus shelters, cranes, neon crosses)
    const nsGreen = data.nsGreen ?? true;
    for (const key of data.activeChunkKeys) {
      const chunk = this.map.chunks.get(key);
      if (!chunk) continue;
      for (const p of chunk.props) {
        const px2 = halfW + (p.x - cx) * ppm;
        const py2 = halfH + (p.y - cy) * ppm;
        if (p.type === 'tree') {
          ctx.fillStyle = 'rgba(9,9,11,0.34)';
          ctx.beginPath();
          ctx.arc(px2 - 0.8 * ppm, py2 - 0.6 * ppm, 2.5 * ppm, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#166534';
          ctx.beginPath();
          ctx.arc(px2, py2, 2.2 * ppm, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#15803d';
          ctx.beginPath();
          ctx.arc(px2 + 0.9 * ppm, py2 - 0.5 * ppm, 1.5 * ppm, 0, Math.PI * 2);
          ctx.fill();
        } else if (p.type === 'traffic_light') {
          ctx.fillStyle = '#18181b';
          ctx.fillRect(px2 - 2.2 * ppm, py2 - 0.4 * ppm, 2.2 * ppm, 0.8 * ppm);
          ctx.fillRect(px2 - 0.4 * ppm, py2 - 2.2 * ppm, 0.8 * ppm, 2.2 * ppm);
          ctx.fillStyle = nsGreen ? '#22c55e' : '#ef4444';
          ctx.beginPath();
          ctx.arc(px2 - 2.2 * ppm, py2, 0.45 * ppm, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = nsGreen ? '#ef4444' : '#22c55e';
          ctx.beginPath();
          ctx.arc(px2, py2 - 2.2 * ppm, 0.45 * ppm, 0, Math.PI * 2);
          ctx.fill();
        } else if (p.type === 'streetlamp') {
          ctx.strokeStyle = '#475569';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(px2, py2);
          ctx.lineTo(px2 - 2.2 * ppm, py2);
          ctx.stroke();
          ctx.fillStyle = p.color ?? '#fde68a';
          ctx.beginPath();
          ctx.arc(px2 - 2.2 * ppm, py2, 0.45 * ppm, 0, Math.PI * 2);
          ctx.fill();
        } else if (p.type === 'payphone_booth') {
          ctx.fillStyle = '#18181b';
          ctx.fillRect(px2 - 0.9 * ppm, py2 - 0.9 * ppm, 1.8 * ppm, 1.8 * ppm);
          ctx.fillStyle = p.color ?? '#22c55e';
          ctx.fillRect(px2 - 0.65 * ppm, py2 - 0.65 * ppm, 1.3 * ppm, 1.3 * ppm);
        } else if (p.type === 'bus_shelter') {
          ctx.fillStyle = '#334155';
          ctx.fillRect(px2 - 2.2 * ppm, py2 - 0.9 * ppm, 4.4 * ppm, 1.8 * ppm);
        } else if (p.type === 'neon_cross') {
          ctx.fillStyle = '#38bdf8';
          ctx.fillRect(px2 - 2.0 * ppm, py2 - 0.4 * ppm, 4.0 * ppm, 0.8 * ppm);
          ctx.fillRect(px2 - 0.4 * ppm, py2 - 2.0 * ppm, 0.8 * ppm, 4.0 * ppm);
        } else if (p.type === 'crane') {
          ctx.save();
          ctx.translate(px2, py2);
          ctx.rotate(p.rotation);
          ctx.fillStyle = p.color ?? '#f59e0b';
          ctx.fillRect(-5 * ppm, -1 * ppm, 24 * ppm, 2 * ppm);
          ctx.restore();
        }
      }
    }

    // 9. Objective Marker
    if (data.objectivePos) {
      ctx.strokeStyle = data.objectiveColor;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(
        halfW + (data.objectivePos.x - cx) * ppm,
        halfH + (data.objectivePos.y - cy) * ppm,
        Math.max(5, data.objectiveRadius * 0.6) * ppm,
        0,
        Math.PI * 2
      );
      ctx.stroke();
    }

    // 10. True 4-Quad Perspective-Extruded 3D Buildings (sorted back-to-front using pooled entries)
    this.visibleBuildings.length = 0;
    let bldgPoolIdx = 0;
    for (const key of data.activeChunkKeys) {
      const chunk = this.map.chunks.get(key);
      if (!chunk) continue;
      for (const b of chunk.buildings) {
        const bx = halfW + (b.x - cx) * ppm;
        const by = halfH + (b.y - cy) * ppm;
        const bw = b.w * ppm;
        const bh = b.h * ppm;
        if (bx + bw < -80 || bx - bw > w + 80 || by + bh < -80 || by - bh > h + 80) continue;
        const extrude = Math.min(0.45, b.height / Math.max(30, this.camHeight * 2.2));
        const rx = halfW + (bx - halfW) * (1 + extrude);
        const ry = halfH + (by - halfH) * (1 + extrude);
        const rw = bw * (1 + extrude);
        const rh = bh * (1 + extrude);
        let entry = this.visibleBuildingPool[bldgPoolIdx];
        if (!entry) {
          entry = { bx, by, bw, bh, rx, ry, rw, rh, distSq: 0, b };
          this.visibleBuildingPool.push(entry);
        } else {
          entry.bx = bx;
          entry.by = by;
          entry.bw = bw;
          entry.bh = bh;
          entry.rx = rx;
          entry.ry = ry;
          entry.rw = rw;
          entry.rh = rh;
          entry.b = b;
        }
        entry.distSq = (bx - halfW) ** 2 + (by - halfH) ** 2;
        this.visibleBuildings.push(entry);
        bldgPoolIdx++;
      }
    }
    this.visibleBuildings.sort(SceneManager.compareFallbackBuildings);

    for (let i = 0; i < this.visibleBuildings.length; i++) {
      const item = this.visibleBuildings[i];
      const { bx, by, bw, bh, rx, ry, rw, rh, b } = item;
      const bl = bx - bw * 0.5;
      const br = bx + bw * 0.5;
      const bt = by - bh * 0.5;
      const bb = by + bh * 0.5;
      const rl = rx - rw * 0.5;
      const rr = rx + rw * 0.5;
      const rt = ry - rh * 0.5;
      const rb = ry + rh * 0.5;

      // Draw outward-facing side wall quads connecting base footprint to extruded rooftop
      if (rt < bt) this.drawFallbackQuad(ctx, bl, bt, br, bt, rr, rt, rl, rt, '#1e293b'); // North face
      if (rb > bb) this.drawFallbackQuad(ctx, bl, bb, br, bb, rr, rb, rl, rb, b.color); // South face (sunlit)
      if (rl < bl) this.drawFallbackQuad(ctx, bl, bt, bl, bb, rl, rb, rl, rt, '#27272a'); // West face
      if (rr > br) this.drawFallbackQuad(ctx, br, bt, br, bb, rr, rb, rr, rt, '#334155'); // East face

      // Rooftop
      ctx.fillStyle = '#27272a';
      ctx.fillRect(rl, rt, rw, rh);
      ctx.strokeStyle = b.hasBillboard && b.neonColor ? b.neonColor : b.accentColor;
      ctx.lineWidth = 2;
      ctx.strokeRect(rl, rt, rw, rh);

      // Rooftop HVAC / Helipad
      if (b.hasHelipad) {
        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(rx, ry, Math.min(rw, rh) * 0.28, 0, Math.PI * 2);
        ctx.stroke();
      } else if (rw > 18 && rh > 18) {
        ctx.fillStyle = '#3f3f46';
        ctx.fillRect(rl + rw * 0.2, rt + rh * 0.2, rw * 0.22, rh * 0.2);
      }
    }

    // 11. Projectiles & Particles on top
    for (let i = 0; i < data.projectiles.length; i++) {
      const pr = data.projectiles[i];
      if (!pr.active) continue;
      ctx.fillStyle = pr.color;
      ctx.beginPath();
      ctx.arc(halfW + (pr.x - cx) * ppm, halfH + (pr.y - cy) * ppm, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < data.particles.length; i++) {
      const pt = data.particles[i];
      if (!pt.active) continue;
      ctx.globalAlpha = Math.max(0, Math.min(1, pt.alpha * (pt.life / Math.max(0.01, pt.maxLife))));
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(halfW + (pt.x - cx) * ppm, halfH + (pt.y - cy) * ppm, pt.size * ppm * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // 12. Atmospheric Noon / Dusk / Neon Night tint pass
    if (duskWeight > 0.15) {
      ctx.fillStyle = `rgba(249, 115, 22, ${0.1 * duskWeight})`;
      ctx.fillRect(0, 0, w, h);
    }
    if (nightFactor > 0.15) {
      ctx.fillStyle = `rgba(7, 11, 20, ${0.32 * nightFactor})`;
      ctx.fillRect(0, 0, w, h);
    }
  }

  private syncChunks(activeKeys: Set<string>, playerX: number, playerY: number): void {
    // 1. Detach exited chunks from scene WITHOUT disposing (retained in 64-chunk LRU)
    for (const [key, visual] of this.activeChunkVisuals.entries()) {
      if (!activeKeys.has(key)) {
        this.scene.remove(visual.group);
        this.activeChunkVisuals.delete(key);
      }
    }

    // 2. Re-attach cached chunks immediately & collect uncached misses
    this.missingChunkKeys.length = 0;
    for (const key of activeKeys) {
      const active = this.activeChunkVisuals.get(key);
      if (active) {
        this.chunkVisualCache.delete(key);
        this.chunkVisualCache.set(key, active);
        continue;
      }
      const cached = this.chunkVisualCache.get(key);
      if (cached) {
        this.chunkVisualCache.delete(key);
        this.chunkVisualCache.set(key, cached);
        this.scene.add(cached.group);
        this.activeChunkVisuals.set(key, cached);
      } else if (this.map.chunks.has(key)) {
        this.missingChunkKeys.push(key);
      }
    }

    // 3. Stagger uncached chunk builds (<= 2 per frame, 1 unconditionally + 2nd within 4.0ms budget), sorted by distSq
    if (this.missingChunkKeys.length > 0) {
      this.syncPlayerX = playerX;
      this.syncPlayerY = playerY;
      this.missingChunkKeys.sort(this.compareMissingChunks);

      const buildStart = performance.now();
      let built = 0;
      for (let i = 0; i < this.missingChunkKeys.length && built < SceneManager.MAX_CHUNK_BUILDS_PER_FRAME; i++) {
        if (built >= 1 && performance.now() - buildStart >= SceneManager.CHUNK_BUILD_BUDGET_MS) {
          break;
        }
        const key = this.missingChunkKeys[i];
        const chunkData = this.map.chunks.get(key);
        if (!chunkData) continue;
        const visual = this.chunkBuilder.buildChunkVisual(chunkData);
        this.chunkVisualCache.set(key, visual);
        this.scene.add(visual.group);
        this.activeChunkVisuals.set(key, visual);
        built++;
      }
    }

    // 4. Evict oldest non-active entries ONLY beyond MAX_CHUNK_CACHE (64)
    if (this.chunkVisualCache.size > SceneManager.MAX_CHUNK_CACHE) {
      for (const [key, visual] of this.chunkVisualCache.entries()) {
        if (this.chunkVisualCache.size <= SceneManager.MAX_CHUNK_CACHE) break;
        if (activeKeys.has(key) || this.activeChunkVisuals.has(key)) continue;
        this.chunkVisualCache.delete(key);
        this.chunkBuilder.disposeChunkVisual(visual);
      }
    }
  }

  private syncVehicles(
    vehicles: VehicleEntity[],
    elapsedSec: number,
    nightFactor: number,
    alpha: number,
    vehiclePrevMap?: Map<string, EntityPrevPose>
  ): void {
    this.tmpAliveIds.clear();
    const sirenPhase = Math.floor(elapsedSec * 7) % 2 === 0 ? 1 : 2;
    const coneOpacity = 0.2 + nightFactor * 0.42;

    for (let i = 0; i < vehicles.length; i++) {
      const v = vehicles[i];
      if (!v.alive) continue;
      this.tmpAliveIds.add(v.id);
      const spec = (VEHICLES as Record<string, VehicleSpec | undefined>)[v.specId] ?? FALLBACK_SPEC;
      const activeSirenPhase = v.sirenActive ? sirenPhase : 0;

      this.resolveInterpolatedPose(
        v.x,
        v.y,
        v.z,
        v.heading,
        v.turretHeading,
        vehiclePrevMap?.get(v.id),
        alpha,
        this.tmpVehPose
      );
      const vx = this.tmpVehPose.x;
      const vy = this.tmpVehPose.y;
      const vz = this.tmpVehPose.z;
      const vHeading = this.tmpVehPose.heading;
      const vTurretHeading = this.tmpVehPose.turretHeading ?? v.turretHeading;

      let vis = this.vehicleVisuals.get(v.id);
      if (!vis) {
        const group = new THREE.Group();
        const tex = this.atlas.getVehicleTexture(
          v.specId,
          v.color,
          v.damageStage,
          v.braking,
          activeSirenPhase
        );
        const bodyMat = new THREE.MeshLambertMaterial({
          map: tex,
          transparent: true,
          alphaTest: 0.06,
          depthWrite: false,
          emissive: new THREE.Color('#ffffff'),
          emissiveMap: tex,
          emissiveIntensity: 0.16,
        });
        const bodyMesh = new THREE.Mesh(this.unitPlane, bodyMat);
        bodyMesh.rotation.x = -Math.PI / 2;
        bodyMesh.scale.set(spec.length * 1.06, spec.width * 1.08, 1);
        group.add(bodyMesh);

        // Projected translucent headlight cone facing +X in vehicle local space
        const coneMat = new THREE.MeshBasicMaterial({
          map: this.atlas.getHeadlightConeTexture(),
          transparent: true,
          opacity: coneOpacity,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
        const headlightMesh = new THREE.Mesh(this.unitPlane, coneMat);
        headlightMesh.rotation.x = -Math.PI / 2;
        headlightMesh.position.set(spec.length * 0.5 + 5.0, -0.36, 0);
        headlightMesh.scale.set(10.5, spec.width * 2.3, 1);
        group.add(headlightMesh);

        let turretMesh: THREE.Mesh | undefined;
        if (v.specId === 'rhino_apc') {
          const tTex = this.atlas.getTankTurretTexture();
          const tMat = new THREE.MeshLambertMaterial({
            map: tTex,
            transparent: true,
            alphaTest: 0.06,
            depthWrite: false,
            emissive: new THREE.Color('#ffffff'),
            emissiveMap: tTex,
            emissiveIntensity: 0.16,
          });
          turretMesh = new THREE.Mesh(this.unitPlane, tMat);
          turretMesh.rotation.x = -Math.PI / 2;
          turretMesh.position.y = 0.28;
          turretMesh.scale.set(spec.length * 1.24, spec.width * 1.12, 1);
          group.add(turretMesh);
        }

        // Separate world-space sun-aligned ground contact shadow (shared material)
        const shadowMesh = new THREE.Mesh(this.unitPlane, this.vehicleShadowMat!);
        shadowMesh.rotation.set(-Math.PI / 2, 0, -vHeading);
        shadowMesh.scale.set(spec.length * 1.08, spec.width * 1.12, 1);
        this.scene.add(shadowMesh);

        this.scene.add(group);
        vis = {
          group,
          bodyMesh,
          turretMesh,
          shadowMesh,
          headlightMesh,
          lastSpecId: v.specId,
          lastColor: v.color,
          lastDamageStage: v.damageStage,
          lastBraking: v.braking,
          lastSirenPhase: activeSirenPhase,
        };
        this.vehicleVisuals.set(v.id, vis);
      } else if (
        vis.lastSpecId !== v.specId ||
        vis.lastColor !== v.color ||
        vis.lastDamageStage !== v.damageStage ||
        vis.lastBraking !== v.braking ||
        vis.lastSirenPhase !== activeSirenPhase
      ) {
        const tex = this.atlas.getVehicleTexture(
          v.specId,
          v.color,
          v.damageStage,
          v.braking,
          activeSirenPhase
        );
        const bodyMat = vis.bodyMesh.material as THREE.MeshLambertMaterial;
        bodyMat.map = tex;
        bodyMat.emissiveMap = tex;
        bodyMat.needsUpdate = true;
        vis.lastSpecId = v.specId;
        vis.lastColor = v.color;
        vis.lastDamageStage = v.damageStage;
        vis.lastBraking = v.braking;
        vis.lastSirenPhase = activeSirenPhase;
      }

      vis.group.position.set(vx, vz + 0.48, vy);
      vis.group.rotation.y = -vHeading;
      if (vis.turretMesh) {
        vis.turretMesh.rotation.z = -(vTurretHeading - vHeading);
      }

      // World-aligned sun offset (-0.42, -0.32) matching DirectionalLight position (+80, 190, +60)
      vis.shadowMesh.position.set(vx - 0.42, vz + 0.05, vy - 0.32);
      vis.shadowMesh.rotation.set(-Math.PI / 2, 0, -vHeading);

      const showHeadlights = v.damageStage !== 'wrecked' && v.headlightsOn && Boolean(v.driverId);
      vis.headlightMesh.visible = showHeadlights;
      if (showHeadlights) {
        (vis.headlightMesh.material as THREE.MeshBasicMaterial).opacity = coneOpacity;
      }

      // Dynamic Headlights & Flashing Sirens for nearby vehicles
      const distSq = (vx - this.camX) ** 2 + (vy - this.camY) ** 2;
      if (distSq < 95 * 95 && v.damageStage !== 'wrecked') {
        if (v.sirenActive) {
          this.lighting.requestLight(
            vx,
            vy,
            vz + 1.2,
            sirenPhase === 1 ? 0xff2222 : 0x2563eb,
            36,
            26
          );
        } else if (v.headlightsOn && (v.driverId === 'player' || (Boolean(v.driverId) && nightFactor > 0.35 && distSq < 62 * 62))) {
          const hx = vx + Math.cos(vHeading) * (spec.length * 0.9);
          const hy = vy + Math.sin(vHeading) * (spec.length * 0.9);
          const intensity = v.driverId === 'player' ? 28 : 16 * nightFactor;
          this.lighting.requestLight(hx, hy, vz + 0.6, 0xfef08a, intensity, 24);
        }
      }
    }

    for (const [id, vis] of this.vehicleVisuals.entries()) {
      if (!this.tmpAliveIds.has(id)) {
        this.scene.remove(vis.group);
        this.scene.remove(vis.shadowMesh);
        (vis.bodyMesh.material as THREE.Material).dispose();
        (vis.headlightMesh.material as THREE.Material).dispose();
        if (vis.turretMesh) (vis.turretMesh.material as THREE.Material).dispose();
        this.vehicleVisuals.delete(id);
      }
    }
  }

  private syncPeds(peds: PedEntity[]): void {
    this.tmpAliveIds.clear();
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (p.vehicleId) continue;
      this.tmpAliveIds.add(p.id);
      const pose = computePedPose(p.vx, p.vy, p.walkPhase, p.alive, false);
      let vis = this.pedVisuals.get(p.id);
      if (!vis) {
        const tex = this.atlas.getPedTexture(p.role, p.shirtColor, p.faction, p.alive, p.weaponId, pose);
        const mat = new THREE.MeshLambertMaterial({
          map: tex,
          transparent: true,
          alphaTest: 0.06,
          depthWrite: false,
          emissive: new THREE.Color('#ffffff'),
          emissiveMap: tex,
          emissiveIntensity: 0.16,
        });
        const mesh = new THREE.Mesh(this.unitPlane, mat);
        mesh.rotation.x = -Math.PI / 2;
        const size = p.role === 'boss' ? 2.85 : 2.25;
        mesh.scale.set(size, size, 1);
        this.scene.add(mesh);

        const shadowMesh = new THREE.Mesh(this.unitPlane, this.pedShadowMat!);
        shadowMesh.rotation.x = -Math.PI / 2;
        const shSz = p.role === 'boss' ? 2.2 : 1.75;
        shadowMesh.scale.set(shSz, shSz, 1);
        this.scene.add(shadowMesh);

        vis = {
          mesh,
          shadowMesh,
          lastRole: p.role,
          lastShirtColor: p.shirtColor,
          lastFaction: p.faction,
          lastAlive: p.alive,
          lastWeaponId: p.weaponId,
          lastPose: pose,
        };
        this.pedVisuals.set(p.id, vis);
      } else if (
        vis.lastRole !== p.role ||
        vis.lastShirtColor !== p.shirtColor ||
        vis.lastFaction !== p.faction ||
        vis.lastAlive !== p.alive ||
        vis.lastWeaponId !== p.weaponId ||
        vis.lastPose !== pose
      ) {
        const tex = this.atlas.getPedTexture(p.role, p.shirtColor, p.faction, p.alive, p.weaponId, pose);
        const mat = vis.mesh.material as THREE.MeshLambertMaterial;
        mat.map = tex;
        mat.emissiveMap = tex;
        mat.needsUpdate = true;
        vis.lastRole = p.role;
        vis.lastShirtColor = p.shirtColor;
        vis.lastFaction = p.faction;
        vis.lastAlive = p.alive;
        vis.lastWeaponId = p.weaponId;
        vis.lastPose = pose;
      }

      vis.mesh.position.set(p.x, p.z + (p.alive ? 0.5 : 0.16), p.y);
      vis.mesh.rotation.set(-Math.PI / 2, 0, -p.heading);
      vis.shadowMesh.visible = p.alive;
      vis.shadowMesh.position.set(p.x - 0.16, p.z + 0.04, p.y - 0.12);
    }

    for (const [id, vis] of this.pedVisuals.entries()) {
      if (!this.tmpAliveIds.has(id)) {
        this.scene.remove(vis.mesh);
        this.scene.remove(vis.shadowMesh);
        (vis.mesh.material as THREE.Material).dispose();
        this.pedVisuals.delete(id);
      }
    }
  }

  private syncPickups(pickups: PickupEntity[], elapsedSec: number): void {
    this.tmpAliveIds.clear();
    for (let i = 0; i < pickups.length; i++) {
      const pk = pickups[i];
      if (!pk.active) continue;
      const distSq = (pk.x - this.camX) ** 2 + (pk.y - this.camY) ** 2;
      if (distSq > 140 * 140) continue;

      this.tmpAliveIds.add(pk.id);
      let mesh = this.pickupVisuals.get(pk.id);
      if (!mesh) {
        const tex = this.atlas.getPickupTexture(pk.type, pk.weaponId);
        const mat = new THREE.MeshLambertMaterial({
          map: tex,
          transparent: true,
          alphaTest: 0.06,
          depthWrite: false,
          emissive: new THREE.Color('#ffffff'),
          emissiveMap: tex,
          emissiveIntensity: 0.48,
        });
        mesh = new THREE.Mesh(this.unitPlane, mat);
        mesh.rotation.x = -Math.PI / 2;
        const s = pk.type === 'kill_frenzy' ? 3.2 : 2.4;
        mesh.scale.set(s, s, 1);
        this.scene.add(mesh);
        this.pickupVisuals.set(pk.id, mesh);
      }

      const bob = Math.sin(elapsedSec * 4 + pk.bobPhase) * 0.35;
      mesh.position.set(pk.x, pk.z + 0.9 + bob, pk.y);
      mesh.rotation.set(-Math.PI / 2, 0, elapsedSec * 2.2 + pk.bobPhase);
    }

    for (const [id, mesh] of this.pickupVisuals.entries()) {
      if (!this.tmpAliveIds.has(id)) {
        this.scene.remove(mesh);
        (mesh.material as THREE.Material).dispose();
        this.pickupVisuals.delete(id);
      }
    }
  }

  private syncMissionProps(missionProps: MissionPropRenderItem[], elapsedSec: number): void {
    this.tmpAliveIds.clear();

    for (let i = 0; i < missionProps.length; i++) {
      const mp = missionProps[i];
      this.tmpAliveIds.add(mp.id);
      let vis = this.missionPropVisuals.get(mp.id);
      if (!vis) {
        const group = new THREE.Group();
        const propRoot =
          mp.type === 'relay_dish'
            ? this.chunkBuilder.createRelayDishGroup(true)
            : this.chunkBuilder.createFuelTankerGroup(true);
        group.add(propRoot);

        const ringMat = new THREE.MeshBasicMaterial({
          color: mp.type === 'relay_dish' ? '#22d3ee' : '#f97316',
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.8,
          depthWrite: false,
        });
        const ringMesh = new THREE.Mesh(this.mpRingGeo, ringMat);
        ringMesh.rotation.x = -Math.PI / 2;
        ringMesh.position.y = 0.1;
        group.add(ringMesh);

        const hpBgMesh = new THREE.Mesh(
          this.hpBarGeo,
          new THREE.MeshBasicMaterial({ color: '#09090b', side: THREE.DoubleSide })
        );
        hpBgMesh.position.set(0, 4.9, 0);
        hpBgMesh.scale.set(3.4, 1, 1);
        hpBgMesh.rotation.x = -Math.PI * 0.25;
        group.add(hpBgMesh);

        const hpFillMesh = new THREE.Mesh(
          this.hpBarGeo,
          new THREE.MeshBasicMaterial({ color: '#f59e0b', side: THREE.DoubleSide })
        );
        hpFillMesh.position.set(0, 4.91, 0.04);
        hpFillMesh.scale.set(3.2, 0.72, 1);
        hpFillMesh.rotation.x = -Math.PI * 0.25;
        group.add(hpFillMesh);

        this.scene.add(group);
        vis = { group, propRoot, ringMesh, hpBgMesh, hpFillMesh, type: mp.type, alive: mp.alive };
        this.missionPropVisuals.set(mp.id, vis);
      }

      vis.group.position.set(mp.x, mp.z, mp.y);

      if (mp.alive) {
        if (!vis.alive) {
          vis.alive = true;
          vis.propRoot.scale.set(1, 1, 1);
          vis.propRoot.rotation.z = 0;
          const rMat = vis.ringMesh.material as THREE.MeshBasicMaterial;
          rMat.color.setHex(mp.type === 'relay_dish' ? 0x22d3ee : 0xf97316);
          rMat.opacity = 0.8;
        }
        const pulse = 1 + Math.sin(elapsedSec * 5.5) * 0.12;
        vis.ringMesh.visible = true;
        vis.ringMesh.scale.set(pulse, pulse, 1);

        if (mp.type === 'relay_dish') {
          const pivot = vis.propRoot.userData.dishPivot as THREE.Object3D | undefined;
          if (pivot) pivot.rotation.y = elapsedSec * 1.4;
        }

        const showHp = mp.hp < mp.maxHp;
        vis.hpBgMesh.visible = showHp;
        vis.hpFillMesh.visible = showHp;
        if (showHp) {
          const ratio = Math.max(0, Math.min(1, mp.hp / Math.max(1, mp.maxHp)));
          vis.hpFillMesh.scale.set(3.2 * ratio, 0.72, 1);
          vis.hpFillMesh.position.x = -(1 - ratio) * 1.6;
          (vis.hpFillMesh.material as THREE.MeshBasicMaterial).color.setHex(ratio > 0.4 ? 0xf59e0b : 0xef4444);
        }
      } else {
        vis.ringMesh.visible = true;
        const rMat = vis.ringMesh.material as THREE.MeshBasicMaterial;
        rMat.color.setHex(0x09090b);
        rMat.opacity = 0.65;
        vis.ringMesh.scale.set(1.25, 1.25, 1);
        vis.hpBgMesh.visible = false;
        vis.hpFillMesh.visible = false;
        if (vis.alive) {
          vis.alive = false;
          vis.propRoot.scale.set(1, 0.42, 1);
          vis.propRoot.rotation.z = 0.25;
        }
      }
    }

    for (const [id, vis] of this.missionPropVisuals.entries()) {
      if (!this.tmpAliveIds.has(id)) {
        this.disposeMissionPropVisual(vis);
        this.missionPropVisuals.delete(id);
      }
    }
  }

  private disposeMissionPropVisual(vis: MissionPropVisual): void {
    this.scene.remove(vis.group);
    (vis.ringMesh.material as THREE.Material).dispose();
    (vis.hpBgMesh.material as THREE.Material).dispose();
    (vis.hpFillMesh.material as THREE.Material).dispose();
  }

  private syncProjectiles(projectiles: ProjectileEntity[]): void {
    let idx = 0;
    for (let i = 0; i < projectiles.length; i++) {
      const pr = projectiles[i];
      if (!pr.active || idx >= this.projectileMeshes.length) continue;
      const mIdx = idx++;
      const m = this.projectileMeshes[mIdx];
      m.visible = true;
      m.position.set(pr.x, pr.z + 0.85, pr.y);
      const angle = Math.atan2(pr.vy, pr.vx);
      m.rotation.set(0, -angle, 0);
      const scale =
        pr.weaponId === 'rpg'
          ? 2.2
          : pr.isWater
          ? 1.8
          : pr.weaponId === 'molotov' || pr.weaponId === 'grenade'
          ? 1.4
          : 1.0;
      m.scale.set(scale, scale, scale);
      const hex = SceneManager.parseColorHex(pr.color);
      if (this.projectileHexes[mIdx] !== hex) {
        (m.material as THREE.MeshBasicMaterial).color.setHex(hex);
        this.projectileHexes[mIdx] = hex;
      }
    }
    for (; idx < this.projectileMeshes.length; idx++) {
      if (this.projectileMeshes[idx].visible) {
        this.projectileMeshes[idx].visible = false;
      }
    }
  }

  private syncFirePools(pools: FirePoolEntity[], elapsedSec: number): void {
    let idx = 0;
    for (let i = 0; i < pools.length; i++) {
      const fp = pools[i];
      if (!fp.active || idx >= this.fireMeshes.length) continue;
      const m = this.fireMeshes[idx++];
      m.visible = true;
      const flicker = 0.85 + Math.sin(elapsedSec * 18 + idx) * 0.15;
      m.position.set(fp.x, fp.z + 0.22, fp.y);
      m.scale.set(fp.radius * flicker, fp.radius * flicker, 1);
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.min(0.75, fp.life * 0.45);
      mat.color.setHex(idx % 2 === 0 ? 0xf97316 : 0xef4444);

      this.lighting.requestLight(fp.x, fp.y, fp.z + 0.8, 0xf97316, 22, fp.radius * 3.5);
    }
    for (; idx < this.fireMeshes.length; idx++) {
      if (this.fireMeshes[idx].visible) {
        this.fireMeshes[idx].visible = false;
      }
    }
  }

  private syncParticles(particles: ParticleEntity[]): void {
    let idx = 0;
    for (let i = 0; i < particles.length; i++) {
      const pt = particles[i];
      if (!pt.active || idx >= this.particleMeshes.length) continue;
      const mIdx = idx++;
      const m = this.particleMeshes[mIdx];
      m.visible = true;
      m.position.set(pt.x, pt.z + 0.75, pt.y);
      m.scale.set(pt.size, pt.size, 1);
      const mat = m.material as THREE.MeshBasicMaterial;
      const hex = SceneManager.parseColorHex(pt.color);
      if (this.particleHexes[mIdx] !== hex) {
        mat.color.setHex(hex);
        this.particleHexes[mIdx] = hex;
      }
      mat.opacity = Math.max(0, Math.min(1, pt.alpha * (pt.life / Math.max(0.01, pt.maxLife))));
    }
    for (; idx < this.particleMeshes.length; idx++) {
      if (this.particleMeshes[idx].visible) {
        this.particleMeshes[idx].visible = false;
      }
    }
  }

  private syncDecals(decals: DecalEntity[]): void {
    let idx = 0;
    for (let i = 0; i < decals.length; i++) {
      const d = decals[i];
      if (!d.active || idx >= this.decalMeshes.length) continue;
      const mIdx = idx++;
      const m = this.decalMeshes[mIdx];
      m.visible = true;
      m.position.set(d.x, d.z + 0.08, d.y);
      m.rotation.set(-Math.PI / 2, 0, -d.rotation);
      m.scale.set(d.length, d.width, 1);
      const mat = m.material as THREE.MeshBasicMaterial;
      const hex =
        d.kind === 'blood'
          ? 0x7f1d1d
          : d.kind === 'scorch' || d.kind === 'crater'
          ? 0x09090b
          : 0x111827;
      if (this.decalHexes[mIdx] !== hex) {
        mat.color.setHex(hex);
        this.decalHexes[mIdx] = hex;
      }
      mat.opacity = Math.min(d.alpha, d.life * 0.25);
    }
    for (; idx < this.decalMeshes.length; idx++) {
      if (this.decalMeshes[idx].visible) {
        this.decalMeshes[idx].visible = false;
      }
    }
  }

  public dispose(): void {
    window.removeEventListener('resize', this.handleResize);
    if (this.renderer) {
      for (const vis of this.missionPropVisuals.values()) {
        this.disposeMissionPropVisual(vis);
      }
      this.missionPropVisuals.clear();
      for (const vis of this.vehicleVisuals.values()) {
        this.scene.remove(vis.group);
        this.scene.remove(vis.shadowMesh);
        (vis.bodyMesh.material as THREE.Material).dispose();
        (vis.headlightMesh.material as THREE.Material).dispose();
        if (vis.turretMesh) (vis.turretMesh.material as THREE.Material).dispose();
      }
      this.vehicleVisuals.clear();
      for (const vis of this.pedVisuals.values()) {
        this.scene.remove(vis.mesh);
        this.scene.remove(vis.shadowMesh);
        (vis.mesh.material as THREE.Material).dispose();
      }
      this.pedVisuals.clear();
      for (const mesh of this.pickupVisuals.values()) {
        this.scene.remove(mesh);
        (mesh.material as THREE.Material).dispose();
      }
      this.pickupVisuals.clear();
      for (const chunkVis of this.chunkVisualCache.values()) {
        this.scene.remove(chunkVis.group);
        this.chunkBuilder.disposeChunkVisual(chunkVis);
      }
      this.chunkVisualCache.clear();
      this.activeChunkVisuals.clear();
      this.vehicleShadowMat?.dispose();
      this.pedShadowMat?.dispose();
      this.chunkBuilder.dispose();
    }
    this.fallbackChunkCanvases.clear();
    this.textures.dispose();
    this.unitPlane.dispose();
    this.mpRingGeo.dispose();
    this.hpBarGeo.dispose();
    this.renderer?.dispose();
  }
}
