import * as THREE from 'three';
import type { BuildingStyle, ChunkData, FacilityDef } from '../types/world.types';
import { CHUNK_SIZE, TILE_SIZE, TILES_PER_CHUNK, WORLD_FACILITIES } from '../data/districts.data';
import { TILE_ENUM } from '../data/mapGenerator';

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// Precomputed 12-entry shade tables (shade = (hash % 12) - 6) eliminating 256+ rgb(...) string allocations per chunk
const WATER_SHADES: string[] = [];
const GRASS_SHADES: string[] = [];
const PARK_PATH_SHADES: string[] = [];
const ASPHALT_SHADES: string[] = [];
const BRIDGE_SHADES: string[] = [];
const PIER_SHADES: string[] = [];
const COBBLESTONE_SHADES: string[] = [];
const CONCRETE_SHADES: string[] = [];
const SIDEWALK_SHADES: string[] = [];

for (let i = 0; i < 12; i++) {
  const shade = i - 6;
  const halfShade = shade >> 1;
  WATER_SHADES.push(`rgb(${12 + halfShade}, ${46 + shade}, ${82 + shade})`);
  GRASS_SHADES.push(`rgb(${32 + shade}, ${96 + shade}, ${48 + shade})`);
  PARK_PATH_SHADES.push(`rgb(${140 + shade}, ${128 + shade}, ${106 + shade})`);
  ASPHALT_SHADES.push(`rgb(${32 + halfShade}, ${34 + halfShade}, ${40 + halfShade})`);
  BRIDGE_SHADES.push(`rgb(${54 + halfShade}, ${57 + halfShade}, ${66 + halfShade})`);
  PIER_SHADES.push(`rgb(${96 + shade}, ${74 + shade}, ${54 + shade})`);
  COBBLESTONE_SHADES.push(`rgb(${84 + shade}, ${74 + shade}, ${68 + shade})`);
  CONCRETE_SHADES.push(`rgb(${78 + shade}, ${82 + shade}, ${88 + shade})`);
  SIDEWALK_SHADES.push(`rgb(${106 + shade}, ${110 + shade}, ${117 + shade})`);
}

function isAsphaltRoadTile(t: number): boolean {
  return (
    t === TILE_ENUM.road_ns ||
    t === TILE_ENUM.road_ew ||
    t === TILE_ENUM.intersection ||
    t === TILE_ENUM.crosswalk_ns ||
    t === TILE_ENUM.crosswalk_ew ||
    t === TILE_ENUM.broadway ||
    t === TILE_ENUM.asphalt
  );
}

function isCurbSurfaceTile(t: number): boolean {
  return (
    t === TILE_ENUM.sidewalk ||
    t === TILE_ENUM.concrete ||
    t === TILE_ENUM.cobblestone ||
    t === TILE_ENUM.grass ||
    t === TILE_ENUM.park_path ||
    t === TILE_ENUM.building
  );
}

function isBroadwayAnalytical(wx: number, wy: number): boolean {
  if (wy < 640 || wy > 1820 || wx > 1180) return false;
  const bx = 384 + (wy - 640) * 0.34;
  return Math.abs(wx - bx) <= 10;
}

export interface FacadeTexturePair {
  map: THREE.CanvasTexture;
  emissiveMap: THREE.CanvasTexture;
}

export class ProceduralTextures {
  private facadeCache = new Map<string, FacadeTexturePair>();
  private roofCache = new Map<string, THREE.CanvasTexture>();
  private neonCache = new Map<string, THREE.CanvasTexture>();
  private overpassTexture: THREE.CanvasTexture | null = null;
  private lampPoolTexture: THREE.CanvasTexture | null = null;
  private fuelHazardTexture: THREE.CanvasTexture | null = null;

  private getChunkTileAt(chunk: ChunkData, baseX: number, baseY: number, tx: number, ty: number): number {
    if (tx >= 0 && tx < TILES_PER_CHUNK && ty >= 0 && ty < TILES_PER_CHUNK) {
      return chunk.tiles[ty * TILES_PER_CHUNK + tx];
    }
    const wx = baseX + tx * TILE_SIZE + 2;
    const wy = baseY + ty * TILE_SIZE + 2;
    if (isBroadwayAnalytical(wx, wy)) return TILE_ENUM.broadway;
    const modX = ((wx % 128) + 128) % 128;
    const modY = ((wy % 128) + 128) % 128;
    const distX = Math.min(modX, 128 - modX);
    const distY = Math.min(modY, 128 - modY);
    const isTimesSq = Math.abs(wx - 640) <= 16 && wy >= 640 && wy <= 1344;
    const onNS = (distX <= 12 && wx >= 96 && wx <= 1952 && !(wx >= 1200 && wx <= 1360)) || isTimesSq;
    const onEW = distY <= 12 && wy >= 96 && wy <= 1952;
    if (onNS && onEW) return TILE_ENUM.intersection;
    if (onNS) return TILE_ENUM.road_ns;
    if (onEW) return TILE_ENUM.road_ew;
    return TILE_ENUM.sidewalk;
  }

  public createChunkGroundCanvas(chunk: ChunkData): HTMLCanvasElement {
    const pxPerTile = 48; // 12 px/m -> 768x768 crisp per 64m chunk
    const pxPerM = pxPerTile / TILE_SIZE; // 12
    const size = TILES_PER_CHUNK * pxPerTile;
    const canvas = makeCanvas(size, size);
    const ctx = canvas.getContext('2d')!;

    const baseX = chunk.cx * CHUNK_SIZE;
    const baseY = chunk.cy * CHUNK_SIZE;
    const broadwayTiles: { x: number; y: number }[] = [];

    for (let ty = 0; ty < TILES_PER_CHUNK; ty++) {
      for (let tx = 0; tx < TILES_PER_CHUNK; tx++) {
        const t = chunk.tiles[ty * TILES_PER_CHUNK + tx];
        const x = tx * pxPerTile;
        const y = ty * pxPerTile;
        const wx = baseX + tx * TILE_SIZE + 2;
        const wy = baseY + ty * TILE_SIZE + 2;

        // Deterministic micro-grain per tile
        const hash = ((tx * 73856093) ^ (ty * 19349663) ^ (chunk.cx * 83492791) ^ (chunk.cy * 297121507)) & 255;
        const shadeIdx = hash % 12;

        switch (t) {
          case TILE_ENUM.water: {
            ctx.fillStyle = WATER_SHADES[shadeIdx];
            ctx.fillRect(x, y, pxPerTile, pxPerTile);
            ctx.fillStyle = 'rgba(125, 211, 252, 0.16)';
            ctx.fillRect(x + (hash % 22), y + ((hash * 3) % 34), 16, 2);
            ctx.fillStyle = 'rgba(186, 230, 253, 0.09)';
            ctx.fillRect(x + ((hash * 7) % 24), y + ((hash * 5) % 36), 10, 2);
            break;
          }
          case TILE_ENUM.grass: {
            ctx.fillStyle = GRASS_SHADES[shadeIdx];
            ctx.fillRect(x, y, pxPerTile, pxPerTile);
            ctx.fillStyle = 'rgba(134, 239, 172, 0.12)';
            ctx.fillRect(x + (hash % 28), y + ((hash * 3) % 28), 6, 6);
            ctx.fillStyle = 'rgba(20, 83, 45, 0.22)';
            ctx.fillRect(x + ((hash * 5) % 30), y + ((hash * 7) % 30), 5, 4);
            break;
          }
          case TILE_ENUM.park_path: {
            ctx.fillStyle = PARK_PATH_SHADES[shadeIdx];
            ctx.fillRect(x, y, pxPerTile, pxPerTile);
            ctx.fillStyle = 'rgba(92, 78, 60, 0.16)';
            ctx.fillRect(x + (hash % 32), y + ((hash * 3) % 32), 4, 4);
            break;
          }
          case TILE_ENUM.road_ns:
          case TILE_ENUM.road_ew:
          case TILE_ENUM.intersection:
          case TILE_ENUM.crosswalk_ns:
          case TILE_ENUM.crosswalk_ew:
          case TILE_ENUM.broadway:
          case TILE_ENUM.asphalt: {
            ctx.fillStyle = ASPHALT_SHADES[shadeIdx];
            ctx.fillRect(x, y, pxPerTile, pxPerTile);
            // Subtle asphalt aggregate speckle
            ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
            ctx.fillRect(x + (hash % 34), y + ((hash * 5) % 34), 3, 3);
            ctx.fillStyle = 'rgba(9, 9, 11, 0.16)';
            ctx.fillRect(x + ((hash * 7) % 34), y + ((hash * 3) % 34), 4, 3);

            const modX = ((wx % 128) + 128) % 128;
            const modY = ((wy % 128) + 128) % 128;

            if (t === TILE_ENUM.road_ns) {
              // Subtle longitudinal tire wear bands
              ctx.fillStyle = 'rgba(15, 17, 22, 0.22)';
              ctx.fillRect(x + 10, y, 8, pxPerTile);
              ctx.fillRect(x + 30, y, 8, pxPerTile);

              // Seam-accurate double-yellow centerline along 128m axis
              if (modX === 126) {
                ctx.fillStyle = '#eab308';
                ctx.fillRect(x + pxPerTile - 4, y, 3, pxPerTile);
              } else if (modX === 2) {
                ctx.fillStyle = '#eab308';
                ctx.fillRect(x + 1, y, 3, pxPerTile);
              } else if ((modX === 6 || modX === 122) && ty % 2 === 0) {
                ctx.fillStyle = 'rgba(241, 245, 249, 0.78)';
                ctx.fillRect(x + 22, y + 8, 3, pxPerTile - 16);
              }
            } else if (t === TILE_ENUM.road_ew) {
              ctx.fillStyle = 'rgba(15, 17, 22, 0.22)';
              ctx.fillRect(x, y + 10, pxPerTile, 8);
              ctx.fillRect(x, y + 30, pxPerTile, 8);

              if (modY === 126) {
                ctx.fillStyle = '#eab308';
                ctx.fillRect(x, y + pxPerTile - 4, pxPerTile, 3);
              } else if (modY === 2) {
                ctx.fillStyle = '#eab308';
                ctx.fillRect(x, y + 1, pxPerTile, 3);
              } else if ((modY === 6 || modY === 122) && tx % 2 === 0) {
                ctx.fillStyle = 'rgba(241, 245, 249, 0.78)';
                ctx.fillRect(x + 8, y + 22, pxPerTile - 16, 3);
              }
            } else if (t === TILE_ENUM.crosswalk_ns) {
              ctx.fillStyle = 'rgba(241, 245, 249, 0.88)';
              for (let s = 4; s < pxPerTile - 4; s += 11) {
                ctx.fillRect(x + s, y + 7, 6, pxPerTile - 14);
              }
              // White approach Stop Bar
              if (modY === 14) {
                ctx.fillRect(x, y + pxPerTile - 5, pxPerTile, 4);
              } else if (modY === 114) {
                ctx.fillRect(x, y + 1, pxPerTile, 4);
              }
            } else if (t === TILE_ENUM.crosswalk_ew) {
              ctx.fillStyle = 'rgba(241, 245, 249, 0.88)';
              for (let s = 4; s < pxPerTile - 4; s += 11) {
                ctx.fillRect(x + 7, y + s, pxPerTile - 14, 6);
              }
              if (modX === 14) {
                ctx.fillRect(x + pxPerTile - 5, y, 4, pxPerTile);
              } else if (modX === 114) {
                ctx.fillRect(x + 1, y, 4, pxPerTile);
              }
            } else if (t === TILE_ENUM.broadway) {
              broadwayTiles.push({ x, y });
            }

            // Deterministic asphalt oil patch & cast-iron manhole covers
            if (hash % 23 === 0) {
              ctx.fillStyle = 'rgba(9, 9, 11, 0.34)';
              ctx.beginPath();
              ctx.ellipse(x + 24, y + 24, 9, 6, (hash % 6) * 0.5, 0, Math.PI * 2);
              ctx.fill();
            } else if (hash % 19 === 0 && t !== TILE_ENUM.crosswalk_ns && t !== TILE_ENUM.crosswalk_ew) {
              const mx = x + 24;
              const my = y + 24;
              ctx.fillStyle = '#1f2937';
              ctx.beginPath();
              ctx.arc(mx, my, 7, 0, Math.PI * 2);
              ctx.fill();
              ctx.fillStyle = '#475569';
              ctx.beginPath();
              ctx.arc(mx, my, 5, 0, Math.PI * 2);
              ctx.fill();
              ctx.fillStyle = '#1e293b';
              ctx.fillRect(mx - 3, my - 1, 6, 2);
              ctx.fillRect(mx - 1, my - 3, 2, 6);
            }
            break;
          }
          case TILE_ENUM.bridge: {
            ctx.fillStyle = BRIDGE_SHADES[shadeIdx];
            ctx.fillRect(x, y, pxPerTile, pxPerTile);
            const modY = ((wy % 128) + 128) % 128;
            if (modY === 126) {
              ctx.fillStyle = 'rgba(234, 179, 8, 0.82)';
              ctx.fillRect(x, y + pxPerTile - 4, pxPerTile, 3);
            } else if (modY === 2) {
              ctx.fillStyle = 'rgba(234, 179, 8, 0.82)';
              ctx.fillRect(x, y + 1, pxPerTile, 3);
            }
            // Bridge steel expansion joints & deck girders
            ctx.fillStyle = 'rgba(15, 23, 42, 0.52)';
            ctx.fillRect(x, y, 3, pxPerTile);
            ctx.fillStyle = 'rgba(148, 163, 184, 0.14)';
            ctx.fillRect(x + 3, y, 2, pxPerTile);
            break;
          }
          case TILE_ENUM.pier: {
            ctx.fillStyle = PIER_SHADES[shadeIdx];
            ctx.fillRect(x, y, pxPerTile, pxPerTile);
            ctx.fillStyle = 'rgba(9, 9, 11, 0.28)';
            for (let p = 0; p < pxPerTile; p += 8) {
              ctx.fillRect(x, y + p, pxPerTile, 2);
            }
            ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
            ctx.fillRect(x + 8, y, 2, pxPerTile);
            ctx.fillRect(x + 38, y, 2, pxPerTile);
            break;
          }
          case TILE_ENUM.cobblestone: {
            ctx.fillStyle = COBBLESTONE_SHADES[shadeIdx];
            ctx.fillRect(x, y, pxPerTile, pxPerTile);
            ctx.strokeStyle = 'rgba(20, 16, 14, 0.42)';
            ctx.lineWidth = 1;
            for (let cy = 0; cy < pxPerTile; cy += 12) {
              const rowShift = (cy / 12) % 2 === 0 ? 0 : 8;
              for (let cxp = -8; cxp < pxPerTile; cxp += 16) {
                ctx.strokeRect(x + cxp + rowShift + 0.5, y + cy + 0.5, 15, 11);
              }
            }
            break;
          }
          case TILE_ENUM.rail: {
            ctx.fillStyle = '#3f3b37';
            ctx.fillRect(x, y, pxPerTile, pxPerTile);
            ctx.fillStyle = '#5c4033';
            for (let r = 3; r < pxPerTile; r += 10) {
              ctx.fillRect(x + 4, y + r, pxPerTile - 8, 4);
            }
            ctx.fillStyle = '#94a3b8';
            ctx.fillRect(x + 10, y, 4, pxPerTile);
            ctx.fillRect(x + pxPerTile - 14, y, 4, pxPerTile);
            ctx.fillStyle = '#e2e8f0';
            ctx.fillRect(x + 11, y, 1, pxPerTile);
            ctx.fillRect(x + pxPerTile - 13, y, 1, pxPerTile);
            break;
          }
          case TILE_ENUM.facility_pad: {
            ctx.fillStyle = '#2d333b';
            ctx.fillRect(x, y, pxPerTile, pxPerTile);
            ctx.strokeStyle = 'rgba(250, 204, 21, 0.55)';
            ctx.lineWidth = 2;
            ctx.strokeRect(x + 3, y + 3, pxPerTile - 6, pxPerTile - 6);
            break;
          }
          case TILE_ENUM.concrete: {
            ctx.fillStyle = CONCRETE_SHADES[shadeIdx];
            ctx.fillRect(x, y, pxPerTile, pxPerTile);
            ctx.strokeStyle = 'rgba(9, 9, 11, 0.18)';
            ctx.lineWidth = 1;
            ctx.strokeRect(x + 0.5, y + 0.5, pxPerTile - 1, pxPerTile - 1);
            ctx.strokeRect(x + 24.5, y + 0.5, 23, 23);
            break;
          }
          default: {
            // Sidewalk / building base with 2x2 paving slabs
            ctx.fillStyle = SIDEWALK_SHADES[shadeIdx];
            ctx.fillRect(x, y, pxPerTile, pxPerTile);
            ctx.strokeStyle = 'rgba(9, 9, 11, 0.16)';
            ctx.lineWidth = 1;
            const half = pxPerTile * 0.5;
            ctx.strokeRect(x + 0.5, y + 0.5, half - 1, half - 1);
            ctx.strokeRect(x + half + 0.5, y + 0.5, half - 1, half - 1);
            ctx.strokeRect(x + 0.5, y + half + 0.5, half - 1, half - 1);
            ctx.strokeRect(x + half + 0.5, y + half + 0.5, half - 1, half - 1);
            break;
          }
        }
      }
    }

    // Continuous Diagonal Broadway avenue markings clipped strictly to broadway tiles
    if (broadwayTiles.length > 0 && baseY + CHUNK_SIZE >= 640 && baseY <= 1820 && baseX <= 1190) {
      ctx.save();
      ctx.beginPath();
      for (const bt of broadwayTiles) {
        ctx.rect(bt.x, bt.y, pxPerTile, pxPerTile);
      }
      ctx.clip();

      const y0World = Math.max(640, baseY - 8);
      const y1World = Math.min(1820, baseY + CHUNK_SIZE + 8);
      const x0World = 384 + (y0World - 640) * 0.34;
      const x1World = 384 + (y1World - 640) * 0.34;

      const sx0 = (x0World - baseX) * pxPerM;
      const sy0 = (y0World - baseY) * pxPerM;
      const sx1 = (x1World - baseX) * pxPerM;
      const sy1 = (y1World - baseY) * pxPerM;

      const dx = sx1 - sx0;
      const dy = sy1 - sy0;
      const len = Math.max(1, Math.hypot(dx, dy));
      // Perpendicular unit vector in canvas space
      const nx = dy / len;
      const ny = -dx / len;

      // Double yellow centerline
      ctx.strokeStyle = '#eab308';
      ctx.lineWidth = 3;
      for (const off of [-3, 3]) {
        ctx.beginPath();
        ctx.moveTo(sx0 + nx * off, sy0 + ny * off);
        ctx.lineTo(sx1 + nx * off, sy1 + ny * off);
        ctx.stroke();
      }

      // Dashed outer white lane stripes
      ctx.strokeStyle = 'rgba(241, 245, 249, 0.78)';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([24, 24]);
      for (const off of [-5.2 * pxPerM, 5.2 * pxPerM]) {
        ctx.beginPath();
        ctx.moveTo(sx0 + nx * off, sy0 + ny * off);
        ctx.lineTo(sx1 + nx * off, sy1 + ny * off);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // Diagonal granite curb border hints near edges
      ctx.strokeStyle = 'rgba(203, 213, 225, 0.55)';
      ctx.lineWidth = 3;
      for (const off of [-9.6 * pxPerM, 9.6 * pxPerM]) {
        ctx.beginPath();
        ctx.moveTo(sx0 + nx * off, sy0 + ny * off);
        ctx.lineTo(sx1 + nx * off, sy1 + ny * off);
        ctx.stroke();
      }

      ctx.restore();
    }

    // Second pass: neighbor-aware raised sidewalk curb bevels, curb drop shadows, and storm drains
    for (let ty = 0; ty < TILES_PER_CHUNK; ty++) {
      for (let tx = 0; tx < TILES_PER_CHUNK; tx++) {
        const t = chunk.tiles[ty * TILES_PER_CHUNK + tx];
        const x = tx * pxPerTile;
        const y = ty * pxPerTile;
        const hash = ((tx * 73856093) ^ (ty * 19349663) ^ (chunk.cx * 83492791)) & 255;

        const nT = this.getChunkTileAt(chunk, baseX, baseY, tx, ty - 1);
        const sT = this.getChunkTileAt(chunk, baseX, baseY, tx, ty + 1);
        const wT = this.getChunkTileAt(chunk, baseX, baseY, tx - 1, ty);
        const eT = this.getChunkTileAt(chunk, baseX, baseY, tx + 1, ty);

        if (isCurbSurfaceTile(t)) {
          // Draw raised granite bevel on road-facing edges
          if (isAsphaltRoadTile(nT)) {
            ctx.fillStyle = '#cbd5e1';
            ctx.fillRect(x, y, pxPerTile, 4);
            ctx.fillStyle = '#64748b';
            ctx.fillRect(x, y + 4, pxPerTile, 2);
          }
          if (isAsphaltRoadTile(sT)) {
            ctx.fillStyle = '#cbd5e1';
            ctx.fillRect(x, y + pxPerTile - 4, pxPerTile, 4);
            ctx.fillStyle = '#64748b';
            ctx.fillRect(x, y + pxPerTile - 6, pxPerTile, 2);
          }
          if (isAsphaltRoadTile(wT)) {
            ctx.fillStyle = '#cbd5e1';
            ctx.fillRect(x, y, 4, pxPerTile);
            ctx.fillStyle = '#64748b';
            ctx.fillRect(x + 4, y, 2, pxPerTile);
          }
          if (isAsphaltRoadTile(eT)) {
            ctx.fillStyle = '#cbd5e1';
            ctx.fillRect(x + pxPerTile - 4, y, 4, pxPerTile);
            ctx.fillStyle = '#64748b';
            ctx.fillRect(x + pxPerTile - 6, y, 2, pxPerTile);
          }
        } else if (isAsphaltRoadTile(t)) {
          // Road-side curb drop shadow & deterministic storm drain grates
          ctx.fillStyle = 'rgba(9, 9, 11, 0.48)';
          if (isCurbSurfaceTile(nT)) {
            ctx.fillRect(x, y, pxPerTile, 4);
            if (hash % 11 === 0) this.drawStormDrain(ctx, x + 16, y + 2, true);
          }
          if (isCurbSurfaceTile(sT)) {
            ctx.fillRect(x, y + pxPerTile - 4, pxPerTile, 4);
            if (hash % 11 === 1) this.drawStormDrain(ctx, x + 16, y + pxPerTile - 8, true);
          }
          if (isCurbSurfaceTile(wT)) {
            ctx.fillRect(x, y, 4, pxPerTile);
            if (hash % 11 === 2) this.drawStormDrain(ctx, x + 2, y + 16, false);
          }
          if (isCurbSurfaceTile(eT)) {
            ctx.fillRect(x + pxPerTile - 4, y, 4, pxPerTile);
            if (hash % 11 === 3) this.drawStormDrain(ctx, x + pxPerTile - 8, y + 16, false);
          }
        }
      }
    }

    // Paint branded decals on facility pads inside this chunk
    for (const f of WORLD_FACILITIES) {
      if (f.x >= baseX - 16 && f.x <= baseX + CHUNK_SIZE + 16 && f.y >= baseY - 16 && f.y <= baseY + CHUNK_SIZE + 16) {
        this.paintFacilityMark(ctx, f, baseX, baseY, pxPerTile);
      }
    }

    return canvas;
  }

  public createChunkGroundTexture(chunk: ChunkData): THREE.CanvasTexture {
    const canvas = this.createChunkGroundCanvas(chunk);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    return tex;
  }

  private drawStormDrain(ctx: CanvasRenderingContext2D, x: number, y: number, horizontal: boolean): void {
    ctx.fillStyle = '#09090b';
    if (horizontal) {
      ctx.fillRect(x, y, 16, 6);
      ctx.fillStyle = '#475569';
      for (let i = 2; i < 15; i += 3) {
        ctx.fillRect(x + i, y + 1, 1.5, 4);
      }
    } else {
      ctx.fillRect(x, y, 6, 16);
      ctx.fillStyle = '#475569';
      for (let i = 2; i < 15; i += 3) {
        ctx.fillRect(x + 1, y + i, 4, 1.5);
      }
    }
  }

  private paintFacilityMark(
    ctx: CanvasRenderingContext2D,
    f: FacilityDef,
    baseX: number,
    baseY: number,
    pxPerTile: number
  ): void {
    const cx = ((f.x - baseX) / TILE_SIZE) * pxPerTile;
    const cy = ((f.y - baseY) / TILE_SIZE) * pxPerTile;
    const rad = (f.radius / TILE_SIZE) * pxPerTile * 0.82;

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    if (f.type === 'pay_n_spray') {
      ctx.fillStyle = 'rgba(34, 197, 94, 0.24)';
      ctx.fill();
      ctx.lineWidth = 7;
      ctx.strokeStyle = '#22c55e';
      ctx.stroke();
      ctx.fillStyle = '#4ade80';
      ctx.font = 'bold 24px monospace';
      ctx.textAlign = 'center';
      ctx.fillText("PAY 'N' SPRAY", cx, cy + 8);
    } else if (f.type === 'car_crusher') {
      ctx.fillStyle = 'rgba(245, 158, 11, 0.26)';
      ctx.fill();
      ctx.lineWidth = 8;
      ctx.strokeStyle = '#f59e0b';
      ctx.stroke();
      ctx.fillStyle = '#fbbf24';
      ctx.font = 'bold 24px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('CRUSHER PAD', cx, cy + 8);
    } else if (f.type === 'sanctuary_chapel') {
      ctx.fillStyle = 'rgba(56, 189, 248, 0.24)';
      ctx.fill();
      ctx.lineWidth = 7;
      ctx.strokeStyle = '#38bdf8';
      ctx.stroke();
      ctx.fillStyle = '#bae6fd';
      ctx.font = 'bold 22px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('SAVE CHAPEL', cx, cy + 8);
    }
    ctx.restore();
  }

  public getBuildingFacadePair(style: BuildingStyle, baseColor: string, accentColor: string): FacadeTexturePair {
    const key = `${style}_${baseColor}_${accentColor}`;
    const existing = this.facadeCache.get(key);
    if (existing) return existing;

    const w = 256;
    const h = 256;
    const canvas = makeCanvas(w, h);
    const ctx = canvas.getContext('2d')!;

    const emCanvas = makeCanvas(w, h);
    const ectx = emCanvas.getContext('2d')!;
    ectx.fillStyle = '#000000';
    ectx.fillRect(0, 0, w, h);

    ctx.fillStyle = baseColor;
    ctx.fillRect(0, 0, w, h);

    if (style === 'glass_tower') {
      // Curtain-wall glass tower repeating floor bays
      ctx.fillStyle = 'rgba(15, 23, 42, 0.58)';
      for (let y = 0; y < h; y += 32) {
        ctx.fillRect(0, y + 6, w, 20);
      }
      // Vertical steel mullions
      ctx.fillStyle = 'rgba(226, 232, 240, 0.14)';
      for (let x = 0; x < w; x += 32) {
        ctx.fillRect(x, 0, 3, h);
      }
      // Office window panes + selective emissive lights
      const glowPalette = [accentColor, '#e0f2fe', '#22d3ee', '#f472b6'];
      for (let row = 0; row < 8; row++) {
        const y = row * 32 + 9;
        for (let col = 0; col < 8; col++) {
          const x = col * 32 + 6;
          const seed = (col * 17 + row * 11) % 13;
          const lit = seed < 6;
          const winColor = glowPalette[seed % glowPalette.length];
          ctx.fillStyle = lit ? winColor : 'rgba(148, 163, 184, 0.22)';
          ctx.fillRect(x, y, 22, 14);
          if (lit) {
            ectx.fillStyle = winColor;
            ectx.fillRect(x, y, 22, 14);
          }
        }
      }
      // Horizontal neon architectural spandrel strips
      ctx.fillStyle = accentColor;
      ctx.fillRect(0, 0, w, 4);
      ctx.fillRect(0, 126, w, 4);
      ectx.fillStyle = accentColor;
      ectx.fillRect(0, 0, w, 3);
      ectx.fillRect(0, 126, w, 3);
    } else if (style === 'tenement') {
      // Brick courses + stone sills + warm windows + iron fire escapes (repeating cleanly)
      ctx.fillStyle = 'rgba(9, 9, 11, 0.18)';
      for (let y = 0; y < h; y += 8) {
        ctx.fillRect(0, y, w, 2);
      }
      for (let row = 0; row < 4; row++) {
        const y = row * 64 + 14;
        for (let col = 0; col < 4; col++) {
          const x = col * 64 + 14;
          const lit = ((col * 5 + row * 3) % 5) !== 0;
          // Stone lintel & sill
          ctx.fillStyle = 'rgba(203, 213, 225, 0.35)';
          ctx.fillRect(x - 3, y - 4, 42, 4);
          ctx.fillRect(x - 3, y + 36, 42, 4);

          // Window frame & glass
          ctx.fillStyle = '#111827';
          ctx.fillRect(x - 1, y - 1, 38, 38);
          ctx.fillStyle = lit ? '#fde68a' : '#1e293b';
          ctx.fillRect(x + 2, y + 2, 32, 32);

          // Mullion crossbars
          ctx.fillStyle = '#18181b';
          ctx.fillRect(x + 17, y + 2, 2, 32);
          ctx.fillRect(x + 2, y + 17, 32, 2);

          if (lit) {
            ectx.fillStyle = '#fcd34d';
            ectx.fillRect(x + 2, y + 2, 15, 15);
            ectx.fillRect(x + 19, y + 2, 15, 15);
            ectx.fillRect(x + 2, y + 19, 15, 15);
            ectx.fillRect(x + 19, y + 19, 15, 15);
          }
        }
      }
      // Wrought-iron fire escape landings & stairs
      ctx.strokeStyle = '#18181b';
      ctx.lineWidth = 4;
      for (let row = 0; row < 4; row++) {
        const ly = row * 64 + 46;
        ctx.strokeRect(86, ly, 84, 10);
        ctx.beginPath();
        ctx.moveTo(94, ly + 10);
        ctx.lineTo(162, ly + 64);
        ctx.stroke();
      }
    } else if (style === 'art_deco' || style === 'penthouse') {
      // Art Deco fluted vertical stone piers + recessed bronze spandrels + warm golden bays
      ctx.fillStyle = 'rgba(9, 9, 11, 0.22)';
      for (let x = 0; x < w; x += 32) {
        ctx.fillRect(x, 0, 8, h);
      }
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
      for (let x = 8; x < w; x += 32) {
        ctx.fillRect(x, 0, 3, h);
      }
      for (let row = 0; row < 6; row++) {
        const y = row * 42 + 8;
        for (let col = 0; col < 8; col++) {
          const x = col * 32 + 11;
          const lit = ((col * 7 + row * 3) % 8) < 5;
          ctx.fillStyle = lit ? '#fcd34d' : '#1e293b';
          ctx.fillRect(x, y, 16, 26);
          ctx.fillStyle = 'rgba(15, 23, 42, 0.45)';
          ctx.fillRect(x, y + 26, 16, 6);
          if (lit) {
            ectx.fillStyle = '#fde68a';
            ectx.fillRect(x + 1, y + 1, 14, 24);
          }
        }
      }
      ctx.fillStyle = accentColor;
      ctx.fillRect(0, 0, w, 6);
      ectx.fillStyle = accentColor;
      ectx.fillRect(0, 0, w, 4);
    } else if (style === 'container') {
      // Corrugated steel shipping container ribs + structural frame
      for (let x = 0; x < w; x += 14) {
        ctx.fillStyle = x % 28 === 0 ? 'rgba(9, 9, 11, 0.28)' : 'rgba(255, 255, 255, 0.09)';
        ctx.fillRect(x, 0, 7, h);
      }
      ctx.fillStyle = 'rgba(9, 9, 11, 0.35)';
      ctx.fillRect(0, 0, 12, h);
      ctx.fillRect(w - 12, 0, 12, h);
      ctx.fillStyle = accentColor;
      ctx.fillRect(16, 28, w - 32, 18);
    } else {
      // Warehouse / Depot / Parking Garage / Precinct / Chapel / Pay'n'Spray (clean repeating upper bays)
      ctx.fillStyle = 'rgba(9, 9, 11, 0.22)';
      for (let y = 0; y < h; y += 64) {
        ctx.fillRect(0, y, w, 6);
      }
      for (let x = 0; x < w; x += 64) {
        ctx.fillRect(x, 0, 6, h);
      }
      // Clerestory industrial glass bays per floor band
      for (let row = 0; row < 4; row++) {
        const y = row * 64 + 16;
        for (let col = 0; col < 4; col++) {
          const x = col * 64 + 12;
          const lit = ((col + row) % 3) !== 1;
          ctx.fillStyle = lit ? '#fef08a' : '#1f2937';
          ctx.fillRect(x, y, 42, 18);
          ctx.strokeStyle = '#111827';
          ctx.lineWidth = 2;
          ctx.strokeRect(x, y, 42, 18);
          if (lit) {
            ectx.fillStyle = '#fde047';
            ectx.fillRect(x + 2, y + 2, 38, 14);
          }
        }
      }
      ctx.fillStyle = accentColor;
      ctx.fillRect(0, 248, w, 8);
      if (style === 'precinct' || style === 'chapel' || style === 'paynspray') {
        ectx.fillStyle = accentColor;
        ectx.fillRect(0, 250, w, 6);
      }
    }

    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.RepeatWrapping;

    const emissiveMap = new THREE.CanvasTexture(emCanvas);
    emissiveMap.colorSpace = THREE.SRGBColorSpace;
    emissiveMap.wrapS = THREE.RepeatWrapping;
    emissiveMap.wrapT = THREE.RepeatWrapping;

    const pair = { map, emissiveMap };
    this.facadeCache.set(key, pair);
    return pair;
  }

  public getBuildingFacadeTexture(style: BuildingStyle, baseColor: string, accentColor: string): THREE.CanvasTexture {
    return this.getBuildingFacadePair(style, baseColor, accentColor).map;
  }

  public getRoofTexture(hasHelipad: boolean, baseColor: string): THREE.CanvasTexture {
    const key = `${hasHelipad ? 'heli' : 'std'}_${baseColor}`;
    const existing = this.roofCache.get(key);
    if (existing) return existing;

    const canvas = makeCanvas(256, 256);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#27272a';
    ctx.fillRect(0, 0, 256, 256);

    // Subtle tar/gravel grain & seam grid
    for (let y = 16; y < 240; y += 32) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
      ctx.fillRect(14, y, 228, 2);
      ctx.fillStyle = 'rgba(9, 9, 11, 0.25)';
      ctx.fillRect(14, y + 2, 228, 1);
    }
    for (let x = 16; x < 240; x += 64) {
      ctx.fillStyle = 'rgba(9, 9, 11, 0.2)';
      ctx.fillRect(x, 14, 2, 228);
    }

    // Concrete parapet edge & inner shadow bevel
    ctx.strokeStyle = baseColor;
    ctx.lineWidth = 14;
    ctx.strokeRect(7, 7, 242, 242);
    ctx.strokeStyle = 'rgba(9, 9, 11, 0.55)';
    ctx.lineWidth = 4;
    ctx.strokeRect(16, 16, 224, 224);

    // Flat roof access hatch & vents
    ctx.fillStyle = '#3f3f46';
    ctx.fillRect(32, 32, 32, 24);
    ctx.fillRect(192, 192, 30, 30);
    ctx.fillStyle = '#52525b';
    ctx.fillRect(36, 36, 24, 16);

    if (hasHelipad) {
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.arc(128, 128, 66, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(250, 204, 21, 0.35)';
      ctx.lineWidth = 3;
      ctx.setLineDash([12, 10]);
      ctx.beginPath();
      ctx.arc(128, 128, 78, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#facc15';
      ctx.font = 'bold 82px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('H', 128, 132);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.roofCache.set(key, tex);
    return tex;
  }

  public getNeonSignTexture(text: string, color: string): THREE.CanvasTexture {
    const key = `${text}_${color}`;
    const existing = this.neonCache.get(key);
    if (existing) return existing;

    const canvas = makeCanvas(256, 64);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#09090b';
    ctx.fillRect(0, 0, 256, 64);

    ctx.strokeStyle = color;
    ctx.lineWidth = 5;
    ctx.strokeRect(4, 4, 248, 56);

    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 28px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 34);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.neonCache.set(key, tex);
    return tex;
  }

  public getOverpassRoadTexture(): THREE.CanvasTexture {
    if (this.overpassTexture) return this.overpassTexture;
    const canvas = makeCanvas(128, 128);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#334155';
    ctx.fillRect(0, 0, 128, 128);
    // Concrete side jersey barriers
    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(0, 0, 10, 128);
    ctx.fillRect(118, 0, 10, 128);
    // Double yellow center line
    ctx.fillStyle = '#facc15';
    ctx.fillRect(61, 0, 2, 128);
    ctx.fillRect(65, 0, 2, 128);
    // Dashed lane markers
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(34, 16, 3, 40);
    ctx.fillRect(34, 80, 3, 40);
    ctx.fillRect(91, 16, 3, 40);
    ctx.fillRect(91, 80, 3, 40);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 8);
    this.overpassTexture = tex;
    return tex;
  }

  public getLampPoolTexture(): THREE.CanvasTexture {
    if (this.lampPoolTexture) return this.lampPoolTexture;
    const canvas = makeCanvas(128, 128);
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
    grad.addColorStop(0, 'rgba(254, 240, 138, 0.58)');
    grad.addColorStop(0.45, 'rgba(253, 224, 71, 0.22)');
    grad.addColorStop(1, 'rgba(254, 240, 138, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.lampPoolTexture = tex;
    return tex;
  }

  public getFuelHazardTexture(): THREE.CanvasTexture {
    if (this.fuelHazardTexture) return this.fuelHazardTexture;
    const canvas = makeCanvas(128, 128);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#dc2626';
    ctx.fillRect(0, 0, 128, 128);

    // Metallic rim bands
    ctx.fillStyle = '#334155';
    ctx.fillRect(0, 0, 128, 16);
    ctx.fillRect(0, 112, 128, 16);

    // Yellow/black diagonal hazard band
    ctx.fillStyle = '#facc15';
    ctx.fillRect(0, 48, 128, 32);
    ctx.fillStyle = '#09090b';
    for (let x = -32; x < 160; x += 24) {
      ctx.beginPath();
      ctx.moveTo(x, 48);
      ctx.lineTo(x + 12, 48);
      ctx.lineTo(x + 28, 80);
      ctx.lineTo(x + 16, 80);
      ctx.closePath();
      ctx.fill();
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.fuelHazardTexture = tex;
    return tex;
  }

  public dispose(): void {
    for (const pair of this.facadeCache.values()) {
      pair.map.dispose();
      pair.emissiveMap.dispose();
    }
    this.facadeCache.clear();
    for (const tex of this.roofCache.values()) {
      tex.dispose();
    }
    this.roofCache.clear();
    for (const tex of this.neonCache.values()) {
      tex.dispose();
    }
    this.neonCache.clear();
    this.overpassTexture?.dispose();
    this.overpassTexture = null;
    this.lampPoolTexture?.dispose();
    this.lampPoolTexture = null;
    this.fuelHazardTexture?.dispose();
    this.fuelHazardTexture = null;
  }
}
