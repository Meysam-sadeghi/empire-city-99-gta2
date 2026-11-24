import * as THREE from 'three';
import type { DistrictId } from '../types/world.types';
import { DISTRICTS } from '../data/districts.data';

export type LightingMode = 'noon' | 'dusk' | 'night' | 'cycle';

export interface LightingFrameInfo {
  daylight: number;
  nightFactor: number;
  fogColor: THREE.Color;
}

interface DynamicLightRequest {
  x: number;
  y: number;
  z: number;
  color: number;
  intensity: number;
  distance: number;
}

export class LightingSystem {
  private ambientLight: THREE.AmbientLight;
  private sunLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;
  private pointLightPool: THREE.PointLight[] = [];
  private activeRequests: DynamicLightRequest[] = [];
  private currentAmbientColor = new THREE.Color('#8899bb');
  private currentFogColor = new THREE.Color('#0b1120');

  private readonly noonSun = new THREE.Color('#fff5e4');
  private readonly duskSun = new THREE.Color('#ff9e5e');
  private readonly nightSun = new THREE.Color('#6488c4');

  private readonly noonSky = new THREE.Color('#93c5fd');
  private readonly duskSky = new THREE.Color('#fb923c');
  private readonly nightSky = new THREE.Color('#1e3a8a');

  private readonly noonFog = new THREE.Color('#1e293b');
  private readonly duskFog = new THREE.Color('#231320');
  private readonly nightFog = new THREE.Color('#070b14');

  private readonly tmpSun = new THREE.Color();
  private readonly tmpSky = new THREE.Color();
  private readonly tmpFog = new THREE.Color();

  constructor(scene: THREE.Scene) {
    this.ambientLight = new THREE.AmbientLight('#8899bb', 0.85);
    scene.add(this.ambientLight);

    this.hemiLight = new THREE.HemisphereLight('#93c5fd', '#18181b', 0.65);
    scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight('#fff5e4', 1.45);
    this.sunLight.position.set(80, 190, 60);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(1024, 1024);
    this.sunLight.shadow.camera.near = 20;
    this.sunLight.shadow.camera.far = 360;
    const frustum = 75;
    this.sunLight.shadow.camera.left = -frustum;
    this.sunLight.shadow.camera.right = frustum;
    this.sunLight.shadow.camera.top = frustum;
    this.sunLight.shadow.camera.bottom = -frustum;
    this.sunLight.shadow.bias = -0.0008;
    this.sunLight.shadow.normalBias = 0.04;
    scene.add(this.sunLight);
    scene.add(this.sunLight.target);

    // Pre-allocate 15 pooled dynamic PointLights (explosions, sirens, headlights, muzzle flashes, streetlamps)
    for (let i = 0; i < 15; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 28, 1.6);
      light.visible = false;
      scene.add(light);
      this.pointLightPool.push(light);
    }
  }

  public static resolveDaylight(timeOfDay: number, lightingMode?: LightingMode): { daylight: number; nightFactor: number } {
    let effectiveTime = timeOfDay;
    if (lightingMode === 'noon') effectiveTime = 0.25;
    else if (lightingMode === 'dusk') effectiveTime = 0.54;
    else if (lightingMode === 'night') effectiveTime = 0.80;

    const sunWave = Math.sin(effectiveTime * Math.PI * 2);
    const daylight = Math.max(0.14, Math.min(1.0, sunWave * 0.45 + 0.56));
    const nightFactor = 1 - Math.max(0, Math.min(1, (daylight - 0.14) / 0.86));
    return { daylight, nightFactor };
  }

  public beginFrame(
    timeOfDay: number,
    districtId: DistrictId,
    focusX: number,
    focusY: number,
    lightingMode?: LightingMode
  ): LightingFrameInfo {
    this.activeRequests.length = 0;

    const { daylight, nightFactor } = LightingSystem.resolveDaylight(timeOfDay, lightingMode);
    const duskWeight = Math.max(0, 1 - Math.abs(daylight - 0.48) / 0.32);

    const districtDef = DISTRICTS[districtId];
    const districtTint = new THREE.Color(districtDef.ambientColor);
    const districtFog = new THREE.Color(districtDef.fogColor);

    // Base ambient & sky color curves
    const baseSky = new THREE.Color('#cbd5e1')
      .lerp(this.duskSky, duskWeight * 0.55)
      .lerp(this.nightSky, nightFactor * 0.65)
      .lerp(districtTint, 0.28 + nightFactor * 0.16);

    this.currentAmbientColor.lerp(baseSky, 0.12);
    this.ambientLight.color.copy(this.currentAmbientColor);
    this.ambientLight.intensity = 0.18 + daylight * 0.72;

    // Sun directional color & intensity
    this.tmpSun.copy(this.noonSun).lerp(this.nightSun, nightFactor).lerp(this.duskSun, duskWeight * 0.85);
    this.sunLight.color.copy(this.tmpSun);
    this.sunLight.intensity = 0.32 + daylight * 1.38;

    // Texel-snapped directional shadow target to eliminate shadow-edge shimmer during camera panning
    const snapX = Math.round(focusX * 2) / 2;
    const snapY = Math.round(focusY * 2) / 2;
    this.sunLight.position.set(snapX + 80, 190, snapY + 60);
    this.sunLight.target.position.set(snapX, 0, snapY);
    this.sunLight.target.updateMatrixWorld();

    // Hemisphere fill
    this.tmpSky.copy(this.noonSky).lerp(this.nightSky, nightFactor).lerp(this.duskSky, duskWeight * 0.75);
    this.hemiLight.color.copy(this.tmpSky);
    this.hemiLight.intensity = 0.18 + daylight * 0.52;

    // Fog / Clear atmosphere color
    this.tmpFog.copy(this.noonFog).lerp(this.nightFog, nightFactor).lerp(this.duskFog, duskWeight * 0.7).lerp(districtFog, 0.35);
    this.currentFogColor.lerp(this.tmpFog, 0.14);

    return {
      daylight,
      nightFactor,
      fogColor: this.currentFogColor,
    };
  }

  public requestLight(
    x: number,
    y: number,
    z: number,
    color: number,
    intensity: number,
    distance: number
  ): void {
    this.activeRequests.push({ x, y, z, color, intensity, distance });
  }

  public commitLights(focusX: number, focusY: number): void {
    // Prioritize closest dynamic lights to camera focus
    this.activeRequests.sort((a, b) => {
      const da = (a.x - focusX) ** 2 + (a.y - focusY) ** 2;
      const db = (b.x - focusX) ** 2 + (b.y - focusY) ** 2;
      return da - db;
    });

    for (let i = 0; i < this.pointLightPool.length; i++) {
      const light = this.pointLightPool[i];
      const req = this.activeRequests[i];
      if (req) {
        light.visible = true;
        light.position.set(req.x, req.z + 2.6, req.y);
        light.color.setHex(req.color);
        light.intensity = req.intensity;
        light.distance = req.distance;
      } else {
        light.visible = false;
        light.intensity = 0;
      }
    }
  }
}
