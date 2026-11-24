import * as THREE from 'three';
import type { ChunkData, OverpassSegment, WorldMapData } from '../types/world.types';
import { CHUNK_SIZE, DISTRICTS } from '../data/districts.data';
import { ProceduralTextures } from './ProceduralTextures';

export interface ChunkVisual {
  key: string;
  group: THREE.Group;
  groundTex: THREE.CanvasTexture;
  emissiveSideMats: THREE.MeshLambertMaterial[];
  payphoneRings: THREE.Mesh[];
  streetlampPositions: { x: number; y: number; color: number }[];
}

export class ChunkMeshBuilder {
  private textures: ProceduralTextures;
  private sharedGeos = new Set<THREE.BufferGeometry>();
  private sharedMats = new Set<THREE.Material>();

  private unitBoxGeo: THREE.BoxGeometry;
  private unitCylGeo: THREE.CylinderGeometry;
  private groundPlaneGeo: THREE.PlaneGeometry;
  private unitPlaneGeo: THREE.PlaneGeometry;
  private treeTrunkGeo: THREE.CylinderGeometry;
  private treeLobeMainGeo: THREE.IcosahedronGeometry;
  private treeLobeSubGeo: THREE.IcosahedronGeometry;
  private treeShadowGeo: THREE.CircleGeometry;
  private lampPoleGeo: THREE.CylinderGeometry;
  private lampArmGeo: THREE.BoxGeometry;
  private lampHeadGeo: THREE.BoxGeometry;
  private lampBulbGeo: THREE.SphereGeometry;
  private lampPoolGeo: THREE.PlaneGeometry;
  private pillarGeo: THREE.BoxGeometry;
  private boothPanelGeo: THREE.BoxGeometry;
  private boothRingGeo: THREE.RingGeometry;
  private trafficHousingGeo: THREE.BoxGeometry;
  private trafficLensGeo: THREE.SphereGeometry;
  private waterTowerTankGeo: THREE.CylinderGeometry;
  private waterTowerRoofGeo: THREE.ConeGeometry;
  private dishGeo: THREE.CylinderGeometry;
  private dishFeedGeo: THREE.CylinderGeometry;
  private tankCylGeo: THREE.CylinderGeometry;
  private tankCapGeo: THREE.SphereGeometry;
  private haloRingGeo: THREE.RingGeometry;

  private trunkMat: THREE.MeshLambertMaterial;
  private canopyMatA: THREE.MeshLambertMaterial;
  private canopyMatB: THREE.MeshLambertMaterial;
  private canopyMatC: THREE.MeshLambertMaterial;
  private treeShadowMat: THREE.MeshBasicMaterial;
  private poleMat: THREE.MeshLambertMaterial;
  private pillarMat: THREE.MeshLambertMaterial;
  private skirtMat: THREE.MeshLambertMaterial;
  private parapetMat: THREE.MeshLambertMaterial;
  private rooftopMetalMat: THREE.MeshLambertMaterial;
  private cedarMat: THREE.MeshLambertMaterial;
  private skylightMat: THREE.MeshLambertMaterial;
  private boothFrameMat: THREE.MeshLambertMaterial;
  private boothGlassMat: THREE.MeshLambertMaterial;
  private lampPoolMat: THREE.MeshBasicMaterial;
  private hazardMat: THREE.MeshLambertMaterial;
  private dishMat: THREE.MeshLambertMaterial;
  private beaconRedMat: THREE.MeshBasicMaterial;

  // O(1) shared live traffic signal lens materials
  private nsGreenLensMat: THREE.MeshBasicMaterial;
  private nsRedLensMat: THREE.MeshBasicMaterial;
  private ewGreenLensMat: THREE.MeshBasicMaterial;
  private ewRedLensMat: THREE.MeshBasicMaterial;
  private amberDimMat: THREE.MeshBasicMaterial;

  // Cached per-style/color shared materials (all registered in sharedMats)
  private facadeMatCache = new Map<string, THREE.MeshLambertMaterial>();
  private roofMatCache = new Map<string, THREE.MeshLambertMaterial>();
  private lambertColorMats = new Map<string, THREE.MeshLambertMaterial>();
  private basicColorMats = new Map<string, THREE.MeshBasicMaterial>();
  private signMatCache = new Map<string, THREE.MeshBasicMaterial>();
  private payphoneRingMatCache = new Map<string, THREE.MeshBasicMaterial>();
  private neonCrossHaloMat: THREE.MeshBasicMaterial;
  private currentEmissiveStrength = 0.65;

  constructor(textures: ProceduralTextures) {
    this.textures = textures;

    this.unitBoxGeo = this.regGeo(new THREE.BoxGeometry(1, 1, 1));
    this.unitCylGeo = this.regGeo(new THREE.CylinderGeometry(0.5, 0.5, 1, 10));
    this.groundPlaneGeo = this.regGeo(new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE));
    this.unitPlaneGeo = this.regGeo(new THREE.PlaneGeometry(1, 1));
    this.treeTrunkGeo = this.regGeo(new THREE.CylinderGeometry(0.38, 0.58, 3.2, 7));
    this.treeLobeMainGeo = this.regGeo(new THREE.IcosahedronGeometry(2.35, 1));
    this.treeLobeSubGeo = this.regGeo(new THREE.IcosahedronGeometry(1.75, 1));
    this.treeShadowGeo = this.regGeo(new THREE.CircleGeometry(2.7, 12));

    this.lampPoleGeo = this.regGeo(new THREE.CylinderGeometry(0.14, 0.22, 7.6, 6));
    this.lampArmGeo = this.regGeo(new THREE.BoxGeometry(2.6, 0.16, 0.16));
    this.lampHeadGeo = this.regGeo(new THREE.BoxGeometry(0.85, 0.24, 0.45));
    this.lampBulbGeo = this.regGeo(new THREE.SphereGeometry(0.32, 6, 6));
    this.lampPoolGeo = this.regGeo(new THREE.PlaneGeometry(13.5, 13.5));

    this.pillarGeo = this.regGeo(new THREE.BoxGeometry(1.8, 6.0, 1.8));
    this.boothPanelGeo = this.regGeo(new THREE.BoxGeometry(1.45, 2.75, 1.45));
    this.boothRingGeo = this.regGeo(new THREE.RingGeometry(1.5, 2.05, 24));

    this.trafficHousingGeo = this.regGeo(new THREE.BoxGeometry(0.45, 1.25, 0.45));
    this.trafficLensGeo = this.regGeo(new THREE.SphereGeometry(0.14, 6, 6));

    this.waterTowerTankGeo = this.regGeo(new THREE.CylinderGeometry(1.45, 1.45, 2.5, 10));
    this.waterTowerRoofGeo = this.regGeo(new THREE.ConeGeometry(1.65, 1.15, 10));

    this.dishGeo = this.regGeo(new THREE.CylinderGeometry(1.85, 0.45, 0.75, 14));
    this.dishFeedGeo = this.regGeo(new THREE.CylinderGeometry(0.08, 0.12, 1.4, 6));
    this.tankCylGeo = this.regGeo(new THREE.CylinderGeometry(1.25, 1.25, 4.4, 14));
    this.tankCapGeo = this.regGeo(new THREE.SphereGeometry(1.25, 12, 8));
    this.haloRingGeo = this.regGeo(new THREE.RingGeometry(2.3, 2.75, 24));

    this.trunkMat = this.regMat(new THREE.MeshLambertMaterial({ color: '#4e342e' }));
    this.canopyMatA = this.regMat(new THREE.MeshLambertMaterial({ color: '#166534' }));
    this.canopyMatB = this.regMat(new THREE.MeshLambertMaterial({ color: '#15803d' }));
    this.canopyMatC = this.regMat(new THREE.MeshLambertMaterial({ color: '#14532d' }));
    this.treeShadowMat = this.regMat(
      new THREE.MeshBasicMaterial({ color: '#09090b', transparent: true, opacity: 0.34, depthWrite: false })
    );

    this.poleMat = this.regMat(new THREE.MeshLambertMaterial({ color: '#334155' }));
    this.pillarMat = this.regMat(new THREE.MeshLambertMaterial({ color: '#475569' }));
    this.skirtMat = this.regMat(new THREE.MeshLambertMaterial({ color: '#18181b' }));
    this.parapetMat = this.regMat(new THREE.MeshLambertMaterial({ color: '#3f3f46' }));
    this.rooftopMetalMat = this.regMat(new THREE.MeshLambertMaterial({ color: '#64748b' }));
    this.cedarMat = this.regMat(new THREE.MeshLambertMaterial({ color: '#78350f' }));
    this.skylightMat = this.regMat(
      new THREE.MeshLambertMaterial({
        color: '#38bdf8',
        emissive: '#0ea5e9',
        emissiveIntensity: 0.35,
      })
    );
    this.boothFrameMat = this.regMat(new THREE.MeshLambertMaterial({ color: '#18181b' }));
    this.boothGlassMat = this.regMat(
      new THREE.MeshLambertMaterial({ color: '#bae6fd', transparent: true, opacity: 0.38 })
    );
    this.lampPoolMat = this.regMat(
      new THREE.MeshBasicMaterial({
        map: this.textures.getLampPoolTexture(),
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
      })
    );
    this.hazardMat = this.regMat(new THREE.MeshLambertMaterial({ map: this.textures.getFuelHazardTexture() }));
    this.dishMat = this.regMat(new THREE.MeshLambertMaterial({ color: '#cbd5e1' }));
    this.beaconRedMat = this.regMat(new THREE.MeshBasicMaterial({ color: '#ef4444' }));

    this.nsGreenLensMat = this.regMat(new THREE.MeshBasicMaterial({ color: '#22c55e' }));
    this.nsRedLensMat = this.regMat(new THREE.MeshBasicMaterial({ color: '#291214' }));
    this.ewGreenLensMat = this.regMat(new THREE.MeshBasicMaterial({ color: '#0f291a' }));
    this.ewRedLensMat = this.regMat(new THREE.MeshBasicMaterial({ color: '#ef4444' }));
    this.amberDimMat = this.regMat(new THREE.MeshBasicMaterial({ color: '#422006' }));
    this.neonCrossHaloMat = this.regMat(
      new THREE.MeshBasicMaterial({
        color: '#38bdf8',
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
      })
    );
  }

  private regGeo<T extends THREE.BufferGeometry>(g: T): T {
    this.sharedGeos.add(g);
    return g;
  }

  private regMat<T extends THREE.Material>(m: T): T {
    this.sharedMats.add(m);
    return m;
  }

  private getFacadeMat(style: ChunkData['buildings'][number]['style'], color: string, accentColor: string): THREE.MeshLambertMaterial {
    const key = `${style}_${color}_${accentColor}`;
    let mat = this.facadeMatCache.get(key);
    if (!mat) {
      const facadePair = this.textures.getBuildingFacadePair(style, color, accentColor);
      mat = this.regMat(
        new THREE.MeshLambertMaterial({
          map: facadePair.map,
          emissive: new THREE.Color('#ffffff'),
          emissiveMap: facadePair.emissiveMap,
          emissiveIntensity: this.currentEmissiveStrength,
        })
      );
      this.facadeMatCache.set(key, mat);
    }
    return mat;
  }

  private getRoofMat(hasHelipad: boolean, color: string): THREE.MeshLambertMaterial {
    const key = `${hasHelipad ? 'h' : 's'}_${color}`;
    let mat = this.roofMatCache.get(key);
    if (!mat) {
      const roofTex = this.textures.getRoofTexture(hasHelipad, color);
      mat = this.regMat(new THREE.MeshLambertMaterial({ map: roofTex }));
      this.roofMatCache.set(key, mat);
    }
    return mat;
  }

  private getLambertColorMat(color: string): THREE.MeshLambertMaterial {
    let mat = this.lambertColorMats.get(color);
    if (!mat) {
      mat = this.regMat(new THREE.MeshLambertMaterial({ color }));
      this.lambertColorMats.set(color, mat);
    }
    return mat;
  }

  private getBasicColorMat(color: string): THREE.MeshBasicMaterial {
    let mat = this.basicColorMats.get(color);
    if (!mat) {
      mat = this.regMat(new THREE.MeshBasicMaterial({ color }));
      this.basicColorMats.set(color, mat);
    }
    return mat;
  }

  private getSignMat(text: string, color: string): THREE.MeshBasicMaterial {
    const key = `${text}_${color}`;
    let mat = this.signMatCache.get(key);
    if (!mat) {
      const signTex = this.textures.getNeonSignTexture(text, color);
      mat = this.regMat(new THREE.MeshBasicMaterial({ map: signTex }));
      this.signMatCache.set(key, mat);
    }
    return mat;
  }

  private getPayphoneRingMat(color: string): THREE.MeshBasicMaterial {
    let mat = this.payphoneRingMatCache.get(color);
    if (!mat) {
      mat = this.regMat(
        new THREE.MeshBasicMaterial({
          color,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.75,
          depthWrite: false,
        })
      );
      this.payphoneRingMatCache.set(color, mat);
    }
    return mat;
  }

  public setTrafficSignalPhase(nsGreen: boolean): void {
    if (nsGreen) {
      this.nsGreenLensMat.color.set('#22c55e');
      this.nsRedLensMat.color.set('#291214');
      this.ewGreenLensMat.color.set('#0f291a');
      this.ewRedLensMat.color.set('#ef4444');
    } else {
      this.nsGreenLensMat.color.set('#0f291a');
      this.nsRedLensMat.color.set('#ef4444');
      this.ewGreenLensMat.color.set('#22c55e');
      this.ewRedLensMat.color.set('#291214');
    }
  }

  public setNightFactor(nightFactor: number): void {
    this.lampPoolMat.opacity = 0.06 + nightFactor * 0.62;
    this.currentEmissiveStrength = 0.16 + nightFactor * 1.15;
    for (const mat of this.facadeMatCache.values()) {
      mat.emissiveIntensity = this.currentEmissiveStrength;
    }
  }

  /**
   * Builds a single lightweight InstancedMesh LOD skyline for all buildings in the 2048m x 2048m city.
   */
  public buildDistantSkylineLOD(map: WorldMapData): THREE.InstancedMesh {
    const allBuildings: { x: number; y: number; w: number; h: number; height: number; color: string }[] = [];
    for (const chunk of map.chunks.values()) {
      for (const b of chunk.buildings) {
        allBuildings.push(b);
      }
    }

    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshLambertMaterial({ color: '#ffffff' });
    const inst = new THREE.InstancedMesh(geo, mat, Math.max(1, allBuildings.length));
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    allBuildings.forEach((b, i) => {
      dummy.position.set(b.x, b.height * 0.5 - 0.5, b.y);
      dummy.scale.set(b.w * 0.96, b.height * 0.96, b.h * 0.96);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
      color.set(b.color).multiplyScalar(0.75);
      inst.setColorAt(i, color);
    });

    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    inst.castShadow = false;
    inst.receiveShadow = false;
    inst.frustumCulled = false;
    return inst;
  }

  /**
   * Builds a high-detail Three.js Group for an active streamed 64m x 64m chunk.
   */
  public buildChunkVisual(chunk: ChunkData): ChunkVisual {
    const group = new THREE.Group();
    const baseX = chunk.cx * CHUNK_SIZE;
    const baseY = chunk.cy * CHUNK_SIZE;
    const emissiveSideMats: THREE.MeshLambertMaterial[] = [];
    const payphoneRings: THREE.Mesh[] = [];
    const streetlampPositions: { x: number; y: number; color: number }[] = [];

    // 1. Ground plane with 48px/tile procedural texture (shared geometry)
    const groundTex = this.textures.createChunkGroundTexture(chunk);
    const groundMat = new THREE.MeshLambertMaterial({ map: groundTex });
    const groundMesh = new THREE.Mesh(this.groundPlaneGeo, groundMat);
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.position.set(baseX + CHUNK_SIZE * 0.5, 0, baseY + CHUNK_SIZE * 0.5);
    groundMesh.receiveShadow = true;
    group.add(groundMesh);

    // 2. Extruded 3D Buildings with scaled UV repeats, shared cached materials, AO skirts, awnings & 3D rooftops
    for (const b of chunk.buildings) {
      const sideMat = this.getFacadeMat(b.style, b.color, b.accentColor);
      const topMat = this.getRoofMat(Boolean(b.hasHelipad), b.color);
      const materials = [sideMat, sideMat, topMat, topMat, sideMat, sideMat];

      const boxGeo = new THREE.BoxGeometry(b.w, b.height, b.h);
      // Scale UVs directly on this building's BoxGeometry without mutating shared texture repeat
      const posAttr = boxGeo.attributes.position;
      const normAttr = boxGeo.attributes.normal;
      const uvAttr = boxGeo.attributes.uv;
      const repV = Math.max(1, Math.round(b.height / 14));
      const repU_NS = Math.max(1, Math.round(b.w / 10));
      const repU_EW = Math.max(1, Math.round(b.h / 10));
      for (let i = 0; i < posAttr.count; i++) {
        const nx = normAttr.getX(i);
        const ny = normAttr.getY(i);
        if (Math.abs(ny) > 0.5) continue;
        const u = uvAttr.getX(i);
        const v = uvAttr.getY(i);
        const repU = Math.abs(nx) > 0.5 ? repU_EW : repU_NS;
        uvAttr.setXY(i, u * repU, v * repV);
      }
      uvAttr.needsUpdate = true;

      const mesh = new THREE.Mesh(boxGeo, materials);
      mesh.position.set(b.x, b.height * 0.5, b.y);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);

      // Ground-floor AO base plinth grounding building cleanly to sidewalk
      const skirt = new THREE.Mesh(this.unitBoxGeo, this.skirtMat);
      skirt.position.set(b.x, 0.22, b.y);
      skirt.scale.set(b.w + 0.55, 0.44, b.h + 0.55);
      skirt.receiveShadow = true;
      group.add(skirt);

      // Storefront awning on south (+Z) face for commercial/residential towers
      if (
        (b.style === 'tenement' || b.style === 'art_deco' || b.style === 'glass_tower' || b.style === 'penthouse') &&
        b.w >= 10 &&
        b.height >= 9
      ) {
        const awningMat = this.getLambertColorMat(b.accentColor);
        const awning = new THREE.Mesh(this.unitBoxGeo, awningMat);
        awning.position.set(b.x, 3.25, b.y + b.h * 0.5 + 0.65);
        awning.scale.set(Math.min(b.w * 0.62, 9.5), 0.34, 1.3);
        awning.castShadow = true;
        group.add(awning);
      }

      // Deterministic 3D Rooftop Details
      const seed = Math.abs(Math.floor(b.x * 7 + b.y * 13 + b.w * 3)) % 997;

      // 4 parapet rim walls
      const pThick = 0.55;
      const pHeight = 0.62;
      const pY = b.height + pHeight * 0.5;
      const pN = new THREE.Mesh(this.unitBoxGeo, this.parapetMat);
      pN.position.set(b.x, pY, b.y - b.h * 0.5 + pThick * 0.5);
      pN.scale.set(b.w, pHeight, pThick);
      const pS = new THREE.Mesh(this.unitBoxGeo, this.parapetMat);
      pS.position.set(b.x, pY, b.y + b.h * 0.5 - pThick * 0.5);
      pS.scale.set(b.w, pHeight, pThick);
      const pW = new THREE.Mesh(this.unitBoxGeo, this.parapetMat);
      pW.position.set(b.x - b.w * 0.5 + pThick * 0.5, pY, b.y);
      pW.scale.set(pThick, pHeight, Math.max(1, b.h - pThick * 2));
      const pE = new THREE.Mesh(this.unitBoxGeo, this.parapetMat);
      pE.position.set(b.x + b.w * 0.5 - pThick * 0.5, pY, b.y);
      pE.scale.set(pThick, pHeight, Math.max(1, b.h - pThick * 2));
      group.add(pN, pS, pW, pE);

      if (!b.hasHelipad && b.w >= 10 && b.h >= 10) {
        // Stairwell penthouse bulkheads on larger rooftops
        if (b.w >= 16 && b.h >= 16) {
          const ph = new THREE.Mesh(this.unitBoxGeo, this.parapetMat);
          ph.position.set(b.x - b.w * 0.22, b.height + 1.25, b.y - b.h * 0.2);
          ph.scale.set(3.8, 2.5, 3.6);
          ph.castShadow = true;
          group.add(ph);
        }

        // NYC Cedar Water Tower on steel trestle
        if ((b.style === 'tenement' || b.style === 'art_deco' || b.style === 'penthouse') && seed % 5 < 3) {
          const tx = b.x + b.w * 0.22;
          const tz = b.y - b.h * 0.18;
          const leg = new THREE.Mesh(this.unitBoxGeo, this.rooftopMetalMat);
          leg.position.set(tx, b.height + 0.9, tz);
          leg.scale.set(1.7, 1.8, 1.7);
          const tank = new THREE.Mesh(this.waterTowerTankGeo, this.cedarMat);
          tank.position.set(tx, b.height + 2.95, tz);
          tank.castShadow = true;
          const cone = new THREE.Mesh(this.waterTowerRoofGeo, this.parapetMat);
          cone.position.set(tx, b.height + 4.75, tz);
          group.add(leg, tank, cone);
        }

        // HVAC chiller boxes
        if (
          b.style === 'glass_tower' ||
          b.style === 'warehouse' ||
          b.style === 'depot' ||
          b.style === 'parking_garage' ||
          seed % 3 === 0
        ) {
          const hvacCount = b.w >= 18 ? 2 : 1;
          for (let hi = 0; hi < hvacCount; hi++) {
            const hvac = new THREE.Mesh(this.unitBoxGeo, this.rooftopMetalMat);
            hvac.position.set(b.x + (hi === 0 ? 1.8 : -2.2), b.height + 0.55, b.y + b.h * 0.22);
            hvac.scale.set(2.3, 1.1, 1.8);
            hvac.castShadow = true;
            group.add(hvac);
          }
        }

        // Skylight prism
        if ((b.style === 'art_deco' || b.style === 'penthouse' || b.style === 'warehouse') && seed % 4 === 1) {
          const sky = new THREE.Mesh(this.unitBoxGeo, this.skylightMat);
          sky.position.set(b.x, b.height + 0.35, b.y + b.h * 0.08);
          sky.scale.set(Math.min(4.5, b.w * 0.35), 0.55, Math.min(3.5, b.h * 0.25));
          group.add(sky);
        }
      }

      // Glowing Neon Sign / Times Square Billboard on top front edge + Steel Trusses
      if (b.hasNeonSign && b.neonText && b.neonColor) {
        const signMat = this.getSignMat(b.neonText, b.neonColor);
        const signW = Math.min(b.w * 0.86, 20);
        const signH = 4.2;
        const signMesh = new THREE.Mesh(this.unitPlaneGeo, signMat);
        signMesh.scale.set(signW, signH, 1);
        signMesh.position.set(b.x, b.height - 2.6, b.y + b.h * 0.5 + 0.26);
        group.add(signMesh);

        if (b.hasBillboard) {
          const rimMat = this.getBasicColorMat(b.neonColor);
          const rim = new THREE.Mesh(this.unitBoxGeo, rimMat);
          rim.position.set(b.x, b.height + 0.72, b.y);
          rim.scale.set(b.w + 0.45, 0.55, b.h + 0.45);
          group.add(rim);

          // Steel truss support struts behind billboard
          const strutL = new THREE.Mesh(this.unitBoxGeo, this.rooftopMetalMat);
          strutL.position.set(b.x - signW * 0.32, b.height + 1.4, b.y + b.h * 0.5 - 0.5);
          strutL.scale.set(0.35, 2.2, 0.35);
          const strutR = new THREE.Mesh(this.unitBoxGeo, this.rooftopMetalMat);
          strutR.position.set(b.x + signW * 0.32, b.height + 1.4, b.y + b.h * 0.5 - 0.5);
          strutR.scale.set(0.35, 2.2, 0.35);
          group.add(strutL, strutR);
        }
      }
    }

    // 3. Complete All 9 WorldProps
    for (const p of chunk.props) {
      if (p.type === 'tree') {
        const shadow = new THREE.Mesh(this.treeShadowGeo, this.treeShadowMat);
        shadow.rotation.x = -Math.PI / 2;
        shadow.position.set(p.x - 0.9, 0.04, p.y - 0.7);
        group.add(shadow);

        const trunk = new THREE.Mesh(this.treeTrunkGeo, this.trunkMat);
        trunk.position.set(p.x, 1.6, p.y);
        trunk.castShadow = true;
        group.add(trunk);

        const cMain = new THREE.Mesh(this.treeLobeMainGeo, this.canopyMatA);
        cMain.position.set(p.x, 4.6, p.y);
        cMain.rotation.y = p.rotation;
        cMain.castShadow = true;

        const cSub1 = new THREE.Mesh(this.treeLobeSubGeo, this.canopyMatB);
        cSub1.position.set(p.x + Math.cos(p.rotation) * 1.15, 4.15, p.y + Math.sin(p.rotation) * 1.15);
        cSub1.castShadow = true;

        const cSub2 = new THREE.Mesh(this.treeLobeSubGeo, this.canopyMatC);
        cSub2.position.set(p.x - Math.sin(p.rotation) * 1.05, 4.35, p.y + Math.cos(p.rotation) * 1.05);
        cSub2.castShadow = true;

        group.add(cMain, cSub1, cSub2);
      } else if (p.type === 'streetlamp') {
        const pole = new THREE.Mesh(this.lampPoleGeo, this.poleMat);
        pole.position.set(p.x, 3.8, p.y);
        pole.castShadow = true;

        const arm = new THREE.Mesh(this.lampArmGeo, this.poleMat);
        arm.position.set(p.x - 1.15, 7.45, p.y);

        const head = new THREE.Mesh(this.lampHeadGeo, this.poleMat);
        head.position.set(p.x - 2.25, 7.42, p.y);

        const bulbColor = p.color ?? DISTRICTS[chunk.district].ambientColor;
        const bulbMat = this.getBasicColorMat(bulbColor);
        const bulb = new THREE.Mesh(this.lampBulbGeo, bulbMat);
        bulb.position.set(p.x - 2.25, 7.22, p.y);

        const pool = new THREE.Mesh(this.lampPoolGeo, this.lampPoolMat);
        pool.rotation.x = -Math.PI / 2;
        pool.position.set(p.x - 2.25, 0.04, p.y);

        group.add(pole, arm, head, bulb, pool);
        streetlampPositions.push({
          x: p.x - 2.25,
          y: p.y,
          color: bulbMat.color.getHex(),
        });
      } else if (p.type === 'traffic_light') {
        // Steel pole + 2 cantilevered signal heads (NS along Z, EW along X)
        const pole = new THREE.Mesh(this.lampPoleGeo, this.poleMat);
        pole.position.set(p.x, 3.8, p.y);
        pole.castShadow = true;
        group.add(pole);

        // Arm extending -X toward N-S road
        const armNS = new THREE.Mesh(this.lampArmGeo, this.poleMat);
        armNS.position.set(p.x - 1.3, 6.8, p.y);
        const boxNS = new THREE.Mesh(this.trafficHousingGeo, this.boothFrameMat);
        boxNS.position.set(p.x - 2.35, 6.25, p.y);
        const rNS = new THREE.Mesh(this.trafficLensGeo, this.nsRedLensMat);
        rNS.position.set(p.x - 2.35, 6.62, p.y + 0.22);
        const yNS = new THREE.Mesh(this.trafficLensGeo, this.amberDimMat);
        yNS.position.set(p.x - 2.35, 6.25, p.y + 0.22);
        const gNS = new THREE.Mesh(this.trafficLensGeo, this.nsGreenLensMat);
        gNS.position.set(p.x - 2.35, 5.88, p.y + 0.22);

        // Arm extending -Z toward E-W road
        const armEW = new THREE.Mesh(this.lampArmGeo, this.poleMat);
        armEW.rotation.y = Math.PI / 2;
        armEW.position.set(p.x, 6.8, p.y - 1.3);
        const boxEW = new THREE.Mesh(this.trafficHousingGeo, this.boothFrameMat);
        boxEW.position.set(p.x, 6.25, p.y - 2.35);
        const rEW = new THREE.Mesh(this.trafficLensGeo, this.ewRedLensMat);
        rEW.position.set(p.x + 0.22, 6.62, p.y - 2.35);
        const yEW = new THREE.Mesh(this.trafficLensGeo, this.amberDimMat);
        yEW.position.set(p.x + 0.22, 6.25, p.y - 2.35);
        const gEW = new THREE.Mesh(this.trafficLensGeo, this.ewGreenLensMat);
        gEW.position.set(p.x + 0.22, 5.88, p.y - 2.35);

        group.add(armNS, boxNS, rNS, yNS, gNS, armEW, boxEW, rEW, yEW, gEW);
      } else if (p.type === 'payphone_booth') {
        const tierColor = p.color ?? '#22c55e';
        // Translucent glass box + charcoal frame posts + illuminated header + pulsing ground ring
        const glass = new THREE.Mesh(this.boothPanelGeo, this.boothGlassMat);
        glass.position.set(p.x, 1.45, p.y);
        group.add(glass);

        for (const ox of [-0.72, 0.72]) {
          for (const oz of [-0.72, 0.72]) {
            const post = new THREE.Mesh(this.unitBoxGeo, this.boothFrameMat);
            post.position.set(p.x + ox, 1.5, p.y + oz);
            post.scale.set(0.16, 3.0, 0.16);
            post.castShadow = true;
            group.add(post);
          }
        }

        const capMat = this.getBasicColorMat(tierColor);
        const cap = new THREE.Mesh(this.unitBoxGeo, capMat);
        cap.position.set(p.x, 3.12, p.y);
        cap.scale.set(1.72, 0.36, 1.72);

        const consoleBox = new THREE.Mesh(this.unitBoxGeo, this.rooftopMetalMat);
        consoleBox.position.set(p.x, 1.55, p.y - 0.35);
        consoleBox.scale.set(0.65, 0.85, 0.35);

        const ringMat = this.getPayphoneRingMat(tierColor);
        const ring = new THREE.Mesh(this.boothRingGeo, ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(p.x, 0.09, p.y);
        payphoneRings.push(ring);

        group.add(cap, consoleBox, ring);
      } else if (p.type === 'bus_shelter') {
        const shelterGroup = new THREE.Group();
        shelterGroup.position.set(p.x, 0, p.y);
        shelterGroup.rotation.y = -p.rotation;

        const backWall = new THREE.Mesh(this.unitBoxGeo, this.boothGlassMat);
        backWall.position.set(0, 1.35, -0.75);
        backWall.scale.set(4.2, 2.6, 0.12);

        const roof = new THREE.Mesh(this.unitBoxGeo, this.poleMat);
        roof.position.set(0, 2.75, 0);
        roof.scale.set(4.6, 0.18, 1.85);
        roof.castShadow = true;

        const bench = new THREE.Mesh(this.unitBoxGeo, this.cedarMat);
        bench.position.set(-0.3, 0.55, -0.35);
        bench.scale.set(2.8, 0.18, 0.55);

        const lightbox = new THREE.Mesh(this.unitBoxGeo, this.skylightMat);
        lightbox.position.set(1.85, 1.45, 0);
        lightbox.scale.set(0.28, 2.4, 1.2);

        shelterGroup.add(backWall, roof, bench, lightbox);
        group.add(shelterGroup);
      } else if (p.type === 'neon_cross') {
        const base = new THREE.Mesh(this.unitBoxGeo, this.pillarMat);
        base.position.set(p.x, 0.45, p.y);
        base.scale.set(2.4, 0.9, 2.4);

        const mat = this.getBasicColorMat(p.color ?? '#38bdf8');
        const vert = new THREE.Mesh(this.unitBoxGeo, mat);
        vert.position.set(p.x, 4.7, p.y);
        vert.scale.set(0.9, 8.8, 0.9);
        const horiz = new THREE.Mesh(this.unitBoxGeo, mat);
        horiz.position.set(p.x, 6.8, p.y);
        horiz.scale.set(4.6, 0.9, 0.9);

        const halo = new THREE.Mesh(this.haloRingGeo, this.neonCrossHaloMat);
        halo.rotation.x = -Math.PI / 2;
        halo.position.set(p.x, 0.08, p.y);

        group.add(base, vert, horiz, halo);
      } else if (p.type === 'crane') {
        const craneMat = this.getLambertColorMat(p.color ?? '#f59e0b');
        const craneGroup = new THREE.Group();
        craneGroup.position.set(p.x, 0, p.y);
        craneGroup.rotation.y = -p.rotation;

        const base = new THREE.Mesh(this.unitBoxGeo, this.pillarMat);
        base.position.set(0, 1.0, 0);
        base.scale.set(4.2, 2.0, 4.2);

        const tower = new THREE.Mesh(this.unitBoxGeo, craneMat);
        tower.position.set(0, 11.5, 0);
        tower.scale.set(2.4, 21.0, 2.4);
        tower.castShadow = true;

        const cab = new THREE.Mesh(this.unitBoxGeo, this.boothFrameMat);
        cab.position.set(1.2, 20.5, 1.4);
        cab.scale.set(2.2, 2.2, 2.0);

        const arm = new THREE.Mesh(this.unitBoxGeo, craneMat);
        arm.position.set(7.5, 22.2, 0);
        arm.scale.set(25.0, 1.7, 1.9);
        arm.castShadow = true;

        const counterWeight = new THREE.Mesh(this.unitBoxGeo, this.pillarMat);
        counterWeight.position.set(-5.8, 22.0, 0);
        counterWeight.scale.set(4.2, 2.4, 2.5);

        const cable = new THREE.Mesh(this.unitBoxGeo, this.rooftopMetalMat);
        cable.position.set(16.0, 15.5, 0);
        cable.scale.set(0.18, 12.0, 0.18);

        const beacon = new THREE.Mesh(this.trafficLensGeo, this.beaconRedMat);
        beacon.position.set(0, 23.4, 0);

        craneGroup.add(base, tower, cab, arm, counterWeight, cable, beacon);
        group.add(craneGroup);
      } else if (p.type === 'relay_dish') {
        const dishGroup = this.createRelayDishGroup(true);
        dishGroup.position.set(p.x, 0, p.y);
        dishGroup.rotation.y = -p.rotation;
        group.add(dishGroup);
      } else if (p.type === 'fuel_tanker') {
        const tankGroup = this.createFuelTankerGroup(true);
        tankGroup.position.set(p.x, 0, p.y);
        tankGroup.rotation.y = -p.rotation;
        group.add(tankGroup);
      }
    }

    return {
      key: chunk.key,
      group,
      groundTex,
      emissiveSideMats,
      payphoneRings,
      streetlampPositions,
    };
  }

  /**
   * Reusable 3D Relay Dish assembly (used by static WorldProps and live missionProps).
   */
  public createRelayDishGroup(castShadow = true): THREE.Group {
    const g = new THREE.Group();

    const plinth = new THREE.Mesh(this.unitBoxGeo, this.pillarMat);
    plinth.position.set(0, 0.45, 0);
    plinth.scale.set(3.2, 0.9, 3.2);
    plinth.castShadow = castShadow;
    plinth.receiveShadow = true;

    const mast = new THREE.Mesh(this.unitCylGeo, this.rooftopMetalMat);
    mast.position.set(0, 2.0, 0);
    mast.scale.set(0.6, 2.4, 0.6);
    mast.castShadow = castShadow;

    const pivot = new THREE.Group();
    pivot.position.set(0, 3.3, 0);

    const dish = new THREE.Mesh(this.dishGeo, this.dishMat);
    dish.rotation.x = Math.PI * 0.34;
    dish.castShadow = castShadow;

    const feed = new THREE.Mesh(this.dishFeedGeo, this.boothFrameMat);
    feed.rotation.x = Math.PI * 0.34;
    feed.position.set(0, 0.55, 0.72);

    const beacon = new THREE.Mesh(this.trafficLensGeo, this.beaconRedMat);
    beacon.position.set(0, 1.05, 1.2);

    pivot.add(dish, feed, beacon);
    g.userData.dishPivot = pivot;
    g.add(plinth, mast, pivot);
    return g;
  }

  /**
   * Reusable 3D Fuel Tanker Hazard Tank assembly (used by static WorldProps and live missionProps).
   */
  public createFuelTankerGroup(castShadow = true): THREE.Group {
    const g = new THREE.Group();

    const cradleA = new THREE.Mesh(this.unitBoxGeo, this.boothFrameMat);
    cradleA.position.set(-1.3, 0.55, 0);
    cradleA.scale.set(0.55, 1.1, 2.3);
    const cradleB = new THREE.Mesh(this.unitBoxGeo, this.boothFrameMat);
    cradleB.position.set(1.3, 0.55, 0);
    cradleB.scale.set(0.55, 1.1, 2.3);

    const tank = new THREE.Mesh(this.tankCylGeo, this.hazardMat);
    tank.rotation.z = Math.PI / 2;
    tank.position.set(0, 1.75, 0);
    tank.castShadow = castShadow;
    tank.receiveShadow = true;

    const capL = new THREE.Mesh(this.tankCapGeo, this.parapetMat);
    capL.position.set(-2.2, 1.75, 0);
    capL.scale.set(0.35, 1, 1);

    const capR = new THREE.Mesh(this.tankCapGeo, this.parapetMat);
    capR.position.set(2.2, 1.75, 0);
    capR.scale.set(0.35, 1, 1);

    const valve = new THREE.Mesh(this.unitCylGeo, this.rooftopMetalMat);
    valve.position.set(0, 3.1, 0);
    valve.scale.set(0.6, 0.45, 0.6);

    g.add(cradleA, cradleB, tank, capL, capR, valve);
    return g;
  }

  /**
   * Builds global Queens Elevated Expressway decks & inclined ramps once in world space.
   */
  public buildOverpassesGroup(overpasses: OverpassSegment[]): THREE.Group {
    const group = new THREE.Group();
    const deckTex = this.textures.getOverpassRoadTexture();
    const deckMat = new THREE.MeshLambertMaterial({ map: deckTex });
    const railMat = new THREE.MeshLambertMaterial({ color: '#cbd5e1' });

    for (const seg of overpasses) {
      if (!seg.isRamp) {
        const geo = new THREE.BoxGeometry(seg.w, 0.8, seg.h);
        const mesh = new THREE.Mesh(geo, deckMat);
        mesh.position.set(seg.x, seg.elevation - 0.4, seg.y);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);

        // Concrete support columns spaced along span
        const span = seg.orientation === 'ns' ? seg.h : seg.w;
        const count = Math.max(2, Math.floor(span / 48));
        for (let i = 0; i <= count; i++) {
          const offset = -span * 0.45 + (i / count) * span * 0.9;
          const px = seg.orientation === 'ns' ? seg.x : seg.x + offset;
          const py = seg.orientation === 'ns' ? seg.y + offset : seg.y;
          const modX = Math.min(((px % 128) + 128) % 128, 128 - (((px % 128) + 128) % 128));
          const modY = Math.min(((py % 128) + 128) % 128, 128 - (((py % 128) + 128) % 128));
          if (modX < 14 && modY < 14) continue;

          const pLeft = new THREE.Mesh(this.pillarGeo, this.pillarMat);
          const pRight = new THREE.Mesh(this.pillarGeo, this.pillarMat);
          pLeft.castShadow = true;
          pLeft.receiveShadow = true;
          pRight.castShadow = true;
          pRight.receiveShadow = true;
          if (seg.orientation === 'ns') {
            pLeft.position.set(px - seg.w * 0.44, seg.elevation * 0.5, py);
            pRight.position.set(px + seg.w * 0.44, seg.elevation * 0.5, py);
          } else {
            pLeft.position.set(px, seg.elevation * 0.5, py - seg.h * 0.44);
            pRight.position.set(px, seg.elevation * 0.5, py + seg.h * 0.44);
          }
          group.add(pLeft, pRight);
        }
      } else {
        const length = seg.orientation === 'ns' ? seg.h : seg.w;
        const hyp = Math.hypot(length, seg.elevation);
        const pitch = Math.atan2(seg.elevation, length);
        const geo =
          seg.orientation === 'ns'
            ? new THREE.BoxGeometry(seg.w, 0.7, hyp)
            : new THREE.BoxGeometry(hyp, 0.7, seg.h);
        const mesh = new THREE.Mesh(geo, railMat);
        mesh.position.set(seg.x, seg.elevation * 0.5 - 0.2, seg.y);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        if (seg.rampDir === 's') mesh.rotation.x = -pitch;
        else if (seg.rampDir === 'n') mesh.rotation.x = pitch;
        else if (seg.rampDir === 'e') mesh.rotation.z = pitch;
        else if (seg.rampDir === 'w') mesh.rotation.z = -pitch;
        group.add(mesh);
      }
    }

    return group;
  }

  public disposeChunkVisual(visual: ChunkVisual): void {
    visual.groundTex.dispose();
    visual.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        if (!this.sharedGeos.has(obj.geometry)) {
          obj.geometry.dispose();
        }
        if (Array.isArray(obj.material)) {
          for (const m of obj.material) {
            if (!this.sharedMats.has(m)) {
              m.dispose();
            }
          }
        } else if (!this.sharedMats.has(obj.material)) {
          obj.material.dispose();
        }
      }
    });
  }

  public dispose(): void {
    for (const g of this.sharedGeos) g.dispose();
    this.sharedGeos.clear();
    for (const m of this.sharedMats) m.dispose();
    this.sharedMats.clear();
    this.facadeMatCache.clear();
    this.roofMatCache.clear();
    this.lambertColorMats.clear();
    this.basicColorMats.clear();
    this.signMatCache.clear();
    this.payphoneRingMatCache.clear();
  }
}
