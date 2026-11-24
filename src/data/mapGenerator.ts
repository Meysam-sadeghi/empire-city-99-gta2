import type {
  BuildingDef,
  BuildingStyle,
  ChunkData,
  DistrictId,
  OverpassSegment,
  PropDef,
  RoadNode,
  TileType,
  WorldMapData,
} from '../types/world.types';
import {
  CHUNK_SIZE,
  CHUNKS_PER_SIDE,
  DISTRICTS,
  getDistrictAt,
  OPEN_PLAZAS,
  TILE_SIZE,
  TILES_PER_CHUNK,
  WORLD_FACILITIES,
  WORLD_SIZE,
} from './districts.data';
import { PAYPHONES } from './missions.data';

export const TILE_ENUM: Record<TileType, number> = {
  asphalt: 0,
  road_ns: 1,
  road_ew: 2,
  intersection: 3,
  crosswalk_ns: 4,
  crosswalk_ew: 5,
  broadway: 6,
  sidewalk: 7,
  cobblestone: 8,
  grass: 9,
  park_path: 10,
  water: 11,
  bridge: 12,
  pier: 13,
  building: 14,
  concrete: 15,
  rail: 16,
  ramp_ns: 17,
  ramp_ew: 18,
  overpass: 19,
  facility_pad: 20,
};

export const TILE_NAMES: TileType[] = Object.keys(TILE_ENUM) as TileType[];

// Deterministic Mulberry32 PRNG
function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function chunkKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

// Major avenues at multiples of 128m (except x=1280 which is East River)
export const MANHATTAN_AVENUES = [128, 256, 384, 512, 640, 768, 896, 1024, 1152];
export const EAST_BOROUGH_AVENUES = [1408, 1536, 1664, 1792, 1920];
export const ALL_AVENUES = [...MANHATTAN_AVENUES, ...EAST_BOROUGH_AVENUES];
export const ALL_STREETS = [
  128, 256, 384, 512, 640, 768, 896, 1024, 1152, 1280, 1408, 1536, 1664, 1792, 1920,
];
export const BRIDGE_Y = [384, 1280, 1664]; // Queensboro, Manhattan, Brooklyn Bridges

const NEON_SIGNS: Record<DistrictId, string[]> = {
  financial_district: ['SALIERI', 'WALL ST', 'LITTLE ITALY', 'BISTRO 99', 'GOLD EXCHANGE', 'ESPRESSO'],
  midtown: ['NEON 99', 'CYBERNET', 'YAKUZA', 'BROADWAY', 'ARCADE', 'EMPIRE PLAZA', 'SYNTH FM'],
  central_park: ['PLAZA', 'CONCOURSE', 'GALLERY', 'TOWER'],
  brooklyn_docks: ['RED HOOK', 'CARGO 7', 'CRUSHER', 'SHIPYARD', 'DOCKS', 'IRONWORKS'],
  queens_expressway: ['QUEENS EXPY', 'FREIGHT', 'RAIL DEPOT', 'EXPRESS', 'MTA YARD'],
};

function isInCentralPark(wx: number, wy: number): boolean {
  return wx >= 288 && wx <= 992 && wy >= 160 && wy <= 608;
}

function isInCentralParkLake(wx: number, wy: number): boolean {
  // Oval lake around (640, 368), leaving bridge road at x=640 clear
  if (Math.abs(wx - 640) <= 16) return false;
  const dx = (wx - 640) / 112;
  const dy = (wy - 368) / 52;
  return dx * dx + dy * dy < 1.0;
}

function isEastRiver(wx: number, wy: number): boolean {
  return wx >= 1216 && wx < 1344 && wy >= 32 && wy < 2016;
}

function isBridgeTile(wx: number, wy: number): boolean {
  if (!isEastRiver(wx, wy)) return false;
  for (const by of BRIDGE_Y) {
    if (Math.abs(wy - by) <= 14) return true;
  }
  return false;
}

function isHarborWater(wx: number, wy: number): boolean {
  if (wx < 32 || wx >= 2016 || wy < 32 || wy >= 2016) return true;
  // Brooklyn East waterfront cutouts with open piers
  if (wx >= 1944 && wy >= 1120 && wy < 1960) {
    // Piers at y around 1280, 1536, 1792
    const onPier =
      Math.abs(wy - 1280) <= 22 || Math.abs(wy - 1536) <= 22 || Math.abs(wy - 1792) <= 22;
    return !onPier;
  }
  // Brooklyn West Red Hook piers jutting into East River edge
  if (wx >= 1344 && wx < 1372 && wy >= 1340 && wy < 1600) {
    return Math.abs(wy - 1472) > 20;
  }
  return false;
}

function isPierTile(wx: number, wy: number): boolean {
  if (wx >= 1944 && wx < 2016 && wy >= 1120 && wy < 1960) {
    return (
      Math.abs(wy - 1280) <= 22 || Math.abs(wy - 1536) <= 22 || Math.abs(wy - 1792) <= 22
    );
  }
  if (wx >= 1344 && wx < 1372 && Math.abs(wy - 1472) <= 20) {
    return true;
  }
  return false;
}

function isBroadway(wx: number, wy: number): boolean {
  if (wy < 640 || wy > 1820 || wx > 1180) return false;
  const bx = 384 + (wy - 640) * 0.34;
  return Math.abs(wx - bx) <= 10;
}

function isNearFacilityOrPlaza(wx: number, wy: number, pad = 0): boolean {
  for (const f of WORLD_FACILITIES) {
    const dx = wx - f.x;
    const dy = wy - f.y;
    if (dx * dx + dy * dy <= (f.radius + 10 + pad) ** 2) return true;
  }
  for (const p of OPEN_PLAZAS) {
    const dx = wx - p.x;
    const dy = wy - p.y;
    if (dx * dx + dy * dy <= (p.radius + pad) ** 2) return true;
  }
  for (const ph of PAYPHONES) {
    const dx = wx - ph.x;
    const dy = wy - ph.y;
    if (dx * dx + dy * dy <= (12 + pad) ** 2) return true;
  }
  return false;
}

function buildOverpassSegments(): OverpassSegment[] {
  // Queens Elevated Highway Overpass (True 2.5D verticality: layer 1 at z = 6m)
  // N-S expressway along x=1664 from y=192 to y=896, ramps at north & south
  // E-W expressway spur along y=512 from x=1472 to x=1856, ramps at west & east
  const segs: OverpassSegment[] = [
    // N-S north ramp (ascending going south from y=136 to y=200)
    {
      id: 'ov_ns_ramp_n',
      x: 1664,
      y: 168,
      w: 16,
      h: 64,
      orientation: 'ns',
      isRamp: true,
      rampDir: 's',
      elevation: 6,
    },
    // N-S elevated deck
    {
      id: 'ov_ns_deck',
      x: 1664,
      y: 544,
      w: 16,
      h: 688,
      orientation: 'ns',
      isRamp: false,
      elevation: 6,
    },
    // N-S south ramp (ascending going north from y=952 to y=888)
    {
      id: 'ov_ns_ramp_s',
      x: 1664,
      y: 920,
      w: 16,
      h: 64,
      orientation: 'ns',
      isRamp: true,
      rampDir: 'n',
      elevation: 6,
    },
    // E-W west ramp (ascending going east from x=1420 to x=1484)
    {
      id: 'ov_ew_ramp_w',
      x: 1452,
      y: 512,
      w: 64,
      h: 16,
      orientation: 'ew',
      isRamp: true,
      rampDir: 'e',
      elevation: 6,
    },
    // E-W elevated deck
    {
      id: 'ov_ew_deck',
      x: 1664,
      y: 512,
      w: 360,
      h: 16,
      orientation: 'ew',
      isRamp: false,
      elevation: 6,
    },
    // E-W east ramp (ascending going west from x=1908 to x=1844)
    {
      id: 'ov_ew_ramp_e',
      x: 1876,
      y: 512,
      w: 64,
      h: 16,
      orientation: 'ew',
      isRamp: true,
      rampDir: 'w',
      elevation: 6,
    },
  ];
  return segs;
}

export function getOverpassElevationAt(
  wx: number,
  wy: number,
  overpasses: OverpassSegment[]
): { onRamp: boolean; onDeck: boolean; elevation: number } {
  let onRamp = false;
  let onDeck = false;
  let elevation = 0;

  for (const seg of overpasses) {
    const hw = seg.w * 0.5;
    const hh = seg.h * 0.5;
    if (wx >= seg.x - hw && wx <= seg.x + hw && wy >= seg.y - hh && wy <= seg.y + hh) {
      if (!seg.isRamp) {
        onDeck = true;
        elevation = Math.max(elevation, seg.elevation);
      } else {
        onRamp = true;
        let t = 0;
        if (seg.rampDir === 's') {
          t = (wy - (seg.y - hh)) / seg.h;
        } else if (seg.rampDir === 'n') {
          t = ((seg.y + hh) - wy) / seg.h;
        } else if (seg.rampDir === 'e') {
          t = (wx - (seg.x - hw)) / seg.w;
        } else if (seg.rampDir === 'w') {
          t = ((seg.x + hw) - wx) / seg.w;
        }
        t = Math.max(0, Math.min(1, t));
        elevation = Math.max(elevation, t * seg.elevation);
      }
    }
  }
  return { onRamp, onDeck, elevation };
}

function classifyTile(wx: number, wy: number): { tile: number; isRoad: boolean } {
  if (isHarborWater(wx, wy)) {
    return { tile: TILE_ENUM.water, isRoad: false };
  }
  if (isPierTile(wx, wy)) {
    return { tile: TILE_ENUM.pier, isRoad: true };
  }
  if (isBridgeTile(wx, wy)) {
    return { tile: TILE_ENUM.bridge, isRoad: true };
  }
  if (isEastRiver(wx, wy)) {
    return { tile: TILE_ENUM.water, isRoad: false };
  }
  if (isInCentralParkLake(wx, wy)) {
    return { tile: TILE_ENUM.water, isRoad: false };
  }

  // Facility pads
  for (const f of WORLD_FACILITIES) {
    const dx = wx - f.x;
    const dy = wy - f.y;
    if (dx * dx + dy * dy <= f.radius * f.radius) {
      return { tile: TILE_ENUM.facility_pad, isRoad: true };
    }
  }

  // Check primary road grid (multiples of 128m)
  const modX = ((wx % 128) + 128) % 128;
  const distToAve = Math.min(modX, 128 - modX);
  const modY = ((wy % 128) + 128) % 128;
  const distToSt = Math.min(modY, 128 - modY);

  // Times Square 6-lane avenue around x = 640
  const isTimesSqAve = Math.abs(wx - 640) <= 16 && wy >= 640 && wy <= 1344;
  const onNSRoad = (distToAve <= 12 && wx >= 96 && wx <= 1952 && !(wx >= 1200 && wx <= 1360)) || isTimesSqAve;
  const onEWRoad = distToSt <= 12 && wy >= 96 && wy <= 1952;

  // Inside Central Park: keep perimeter & 3 main park drives, make rest grass & paths
  if (isInCentralPark(wx, wy)) {
    const onParkDrive =
      Math.abs(wx - 384) <= 10 ||
      Math.abs(wx - 640) <= 10 ||
      Math.abs(wx - 896) <= 10 ||
      Math.abs(wy - 256) <= 10 ||
      Math.abs(wy - 512) <= 10;
    if (onParkDrive) {
      if (onNSRoad && onEWRoad) return { tile: TILE_ENUM.intersection, isRoad: true };
      return { tile: onNSRoad ? TILE_ENUM.road_ns : TILE_ENUM.road_ew, isRoad: true };
    }
    // Winding pedestrian park paths
    const wave = Math.sin(wx * 0.03) * 18;
    if (Math.abs(wy - (384 + wave)) <= 4 || Math.abs(wx - (512 + Math.cos(wy * 0.03) * 16)) <= 4) {
      return { tile: TILE_ENUM.park_path, isRoad: false };
    }
    return { tile: TILE_ENUM.grass, isRoad: false };
  }

  // Crosswalks right next to intersections
  if (onNSRoad && onEWRoad) {
    return { tile: TILE_ENUM.intersection, isRoad: true };
  }
  if (onNSRoad) {
    if (distToSt > 12 && distToSt <= 16) {
      return { tile: TILE_ENUM.crosswalk_ns, isRoad: true };
    }
    return { tile: TILE_ENUM.road_ns, isRoad: true };
  }
  if (onEWRoad) {
    if (distToAve > 12 && distToAve <= 16) {
      return { tile: TILE_ENUM.crosswalk_ew, isRoad: true };
    }
    return { tile: TILE_ENUM.road_ew, isRoad: true };
  }

  // Diagonal Broadway Cut
  if (isBroadway(wx, wy)) {
    return { tile: TILE_ENUM.broadway, isRoad: true };
  }

  // Sidewalks lining avenues and cross streets
  if (distToAve <= 16 || distToSt <= 16) {
    return { tile: TILE_ENUM.sidewalk, isRoad: false };
  }

  // Queens Rail Tracks
  const district = getDistrictAt(wx, wy);
  if (district === 'queens_expressway') {
    if (Math.abs(wx - 1728) <= 6 || Math.abs(wx - 1856) <= 6) {
      return { tile: TILE_ENUM.rail, isRoad: false };
    }
  }

  // Cobblestone alleys in Financial District / Little Italy at mid-blocks
  if (district === 'financial_district') {
    const distMidX = Math.abs(modX - 64);
    const distMidY = Math.abs(modY - 64);
    if (distMidX <= 6 || distMidY <= 6) {
      return { tile: TILE_ENUM.cobblestone, isRoad: false };
    }
  }

  // Open plazas & industrial concrete courtyards
  if (isNearFacilityOrPlaza(wx, wy, 0)) {
    return {
      tile: district === 'brooklyn_docks' || district === 'queens_expressway'
        ? TILE_ENUM.concrete
        : TILE_ENUM.sidewalk,
      isRoad: false,
    };
  }

  if (district === 'brooklyn_docks' || district === 'queens_expressway') {
    return { tile: TILE_ENUM.concrete, isRoad: false };
  }

  return { tile: TILE_ENUM.sidewalk, isRoad: false };
}

function pickBuildingSpec(
  district: DistrictId,
  rng: () => number
): { style: BuildingStyle; minH: number; maxH: number; colors: string[]; accents: string[] } {
  switch (district) {
    case 'financial_district':
      if (rng() < 0.45) {
        return {
          style: 'art_deco',
          minH: 22,
          maxH: 46,
          colors: ['#7c6d63', '#6b5e54', '#8b7d72', '#5c534d'],
          accents: ['#d97706', '#f59e0b', '#dc2626'],
        };
      }
      if (rng() < 0.85) {
        return {
          style: 'tenement',
          minH: 12,
          maxH: 22,
          colors: ['#7f3b2d', '#6e3226', '#8c4435', '#5c2c23'],
          accents: ['#b91c1c', '#f59e0b', '#fbbf24'],
        };
      }
      return {
        style: 'parking_garage',
        minH: 10,
        maxH: 16,
        colors: ['#52525b', '#64748b'],
        accents: ['#fbbf24'],
      };
    case 'midtown':
      return {
        style: 'glass_tower',
        minH: 26,
        maxH: 58,
        colors: ['#1e293b', '#1e3a5f', '#172554', '#27272a', '#164e63'],
        accents: ['#06b6d4', '#ec4899', '#a855f7', '#22d3ee'],
      };
    case 'central_park':
      return {
        style: 'penthouse',
        minH: 18,
        maxH: 34,
        colors: ['#948a7e', '#78716c', '#a8a29e', '#64748b'],
        accents: ['#fde047', '#34d399', '#e2e8f0'],
      };
    case 'brooklyn_docks':
      if (rng() < 0.55) {
        return {
          style: 'warehouse',
          minH: 9,
          maxH: 16,
          colors: ['#475569', '#52525b', '#57534e', '#3f3f46'],
          accents: ['#f59e0b', '#ea580c', '#38bdf8'],
        };
      }
      return {
        style: 'container',
        minH: 5,
        maxH: 10,
        colors: ['#b91c1c', '#1d4ed8', '#d97706', '#15803d', '#0e7490'],
        accents: ['#f8fafc', '#facc15'],
      };
    case 'queens_expressway':
      return {
        style: 'depot',
        minH: 10,
        maxH: 20,
        colors: ['#4b5563', '#52525b', '#6b7280', '#44403c'],
        accents: ['#f59e0b', '#38bdf8', '#fb923c'],
      };
  }
}

export function generateNYCWorld(): WorldMapData {
  const rng = createRng(19990929); // GTA 2 release year seed
  const chunks = new Map<string, ChunkData>();
  const overpasses = buildOverpassSegments();
  const roadNodes = new Map<string, RoadNode>();

  // 1. Build Road Graph at all major avenue/street intersections (layer 0) + overpass nodes (layer 1)
  const addNode = (id: string, x: number, y: number, layer: 0 | 1, isIntersection: boolean) => {
    roadNodes.set(id, {
      id,
      x,
      y,
      neighbors: [],
      layer,
      isIntersection,
      district: getDistrictAt(x, y),
    });
  };

  for (const ax of ALL_AVENUES) {
    for (const sy of ALL_STREETS) {
      if (isHarborWater(ax, sy) || (isEastRiver(ax, sy) && !isBridgeTile(ax, sy))) continue;
      if (isInCentralPark(ax, sy) && !([384, 640, 896].includes(ax) && [256, 512].includes(sy))) {
        continue;
      }
      addNode(`n_${ax}_${sy}`, ax, sy, 0, true);
    }
  }

  // Link adjacent road nodes horizontally and vertically + across East River bridges
  for (const node of roadNodes.values()) {
    if (node.layer !== 0) continue;
    const axIdx = ALL_AVENUES.indexOf(node.x);
    const syIdx = ALL_STREETS.indexOf(node.y);
    // Vertical links
    if (syIdx > 0) {
      const up = roadNodes.get(`n_${node.x}_${ALL_STREETS[syIdx - 1]}`);
      if (up) node.neighbors.push(up.id);
    }
    if (syIdx < ALL_STREETS.length - 1) {
      const dn = roadNodes.get(`n_${node.x}_${ALL_STREETS[syIdx + 1]}`);
      if (dn) node.neighbors.push(dn.id);
    }
    // Horizontal links (skip East River unless on bridge Y)
    if (axIdx > 0) {
      const prevX = ALL_AVENUES[axIdx - 1];
      const crossesRiver = prevX === 1152 && node.x === 1408;
      if (!crossesRiver || BRIDGE_Y.includes(node.y)) {
        const left = roadNodes.get(`n_${prevX}_${node.y}`);
        if (left) node.neighbors.push(left.id);
      }
    }
    if (axIdx < ALL_AVENUES.length - 1) {
      const nextX = ALL_AVENUES[axIdx + 1];
      const crossesRiver = node.x === 1152 && nextX === 1408;
      if (!crossesRiver || BRIDGE_Y.includes(node.y)) {
        const right = roadNodes.get(`n_${nextX}_${node.y}`);
        if (right) node.neighbors.push(right.id);
      }
    }
  }

  // 2. Build all 32x32 chunks deterministically
  let buildingSeq = 0;
  let propSeq = 0;

  // Pre-rendered static minimap base (256x256, 1 pixel = 8m)
  const minimapResolution = 256;
  const minimapBasePixels = new Uint8ClampedArray(minimapResolution * minimapResolution * 4);

  for (let cy = 0; cy < CHUNKS_PER_SIDE; cy++) {
    for (let cx = 0; cx < CHUNKS_PER_SIDE; cx++) {
      const baseX = cx * CHUNK_SIZE;
      const baseY = cy * CHUNK_SIZE;
      const district = getDistrictAt(baseX + CHUNK_SIZE * 0.5, baseY + CHUNK_SIZE * 0.5);
      const tiles = new Uint8Array(TILES_PER_CHUNK * TILES_PER_CHUNK);
      const overpassTiles = new Uint8Array(TILES_PER_CHUNK * TILES_PER_CHUNK);
      const roadMask = new Uint8Array(TILES_PER_CHUNK * TILES_PER_CHUNK);
      const buildings: BuildingDef[] = [];
      const props: PropDef[] = [];
      const chunkOverpasses: OverpassSegment[] = [];

      // Check which overpasses overlap this chunk
      for (const seg of overpasses) {
        const overlaps =
          seg.x + seg.w * 0.5 >= baseX &&
          seg.x - seg.w * 0.5 <= baseX + CHUNK_SIZE &&
          seg.y + seg.h * 0.5 >= baseY &&
          seg.y - seg.h * 0.5 <= baseY + CHUNK_SIZE;
        if (overlaps) {
          chunkOverpasses.push(seg);
        }
      }

      // Fill tiles
      for (let ty = 0; ty < TILES_PER_CHUNK; ty++) {
        for (let tx = 0; tx < TILES_PER_CHUNK; tx++) {
          const wx = baseX + tx * TILE_SIZE + TILE_SIZE * 0.5;
          const wy = baseY + ty * TILE_SIZE + TILE_SIZE * 0.5;
          const idx = ty * TILES_PER_CHUNK + tx;
          const { tile, isRoad } = classifyTile(wx, wy);
          tiles[idx] = tile;
          roadMask[idx] = isRoad ? 1 : 0;

          if (chunkOverpasses.length > 0) {
            const ov = getOverpassElevationAt(wx, wy, chunkOverpasses);
            overpassTiles[idx] = ov.onDeck ? 1 : ov.onRamp ? 2 : 0;
          }
        }
      }

      // Place Buildings cleanly inside non-road, non-water, non-park quadrants of this chunk
      // Each 64m chunk can hold up to a 2x2 sub-block of lots where tiles are clear sidewalk/concrete
      const subLotSize = 24;
      const subOffsets = [
        { ox: 20, oy: 20 },
        { ox: 44, oy: 20 },
        { ox: 20, oy: 44 },
        { ox: 44, oy: 44 },
      ];

      // Check whether the interior of a 32x32 sub-lot can fit a building without touching roads/water/plazas
      const canPlaceBuilding = (bx: number, by: number, bw: number, bh: number): boolean => {
        if (bx - bw * 0.5 < 44 || bx + bw * 0.5 > WORLD_SIZE - 44) return false;
        if (by - bh * 0.5 < 44 || by + bh * 0.5 > WORLD_SIZE - 44) return false;
        if (isInCentralPark(bx, by)) return false;
        if (isEastRiver(bx, by) || isEastRiver(bx - bw * 0.5, by) || isEastRiver(bx + bw * 0.5, by)) return false;
        if (isNearFacilityOrPlaza(bx, by, Math.max(bw, bh) * 0.5 + 4)) return false;

        // Sample corners & edges against road grid, Broadway, water, rails, and overpasses
        const pad = 4;
        const samplePts = [
          [bx, by],
          [bx - bw * 0.5 - pad, by - bh * 0.5 - pad],
          [bx + bw * 0.5 + pad, by - bh * 0.5 - pad],
          [bx - bw * 0.5 - pad, by + bh * 0.5 + pad],
          [bx + bw * 0.5 + pad, by + bh * 0.5 + pad],
          [bx, by - bh * 0.5 - pad],
          [bx, by + bh * 0.5 + pad],
          [bx - bw * 0.5 - pad, by],
          [bx + bw * 0.5 + pad, by],
        ];
        for (const [sx, sy] of samplePts) {
          const { tile, isRoad } = classifyTile(sx, sy);
          if (
            isRoad ||
            tile === TILE_ENUM.water ||
            tile === TILE_ENUM.grass ||
            tile === TILE_ENUM.rail ||
            tile === TILE_ENUM.cobblestone ||
            tile === TILE_ENUM.broadway ||
            tile === TILE_ENUM.pier ||
            tile === TILE_ENUM.bridge ||
            tile === TILE_ENUM.facility_pad
          ) {
            return false;
          }
          if (chunkOverpasses.length > 0) {
            const ov = getOverpassElevationAt(sx, sy, chunkOverpasses);
            if (ov.onDeck || ov.onRamp) return false;
          }
        }
        return true;
      };

      // Try placing a large landmark building centered in chunk first (for cleaner Manhattan skyline), else sub-lots
      const chunkCenterX = baseX + 32;
      const chunkCenterY = baseY + 32;
      const tryBig =
        (district === 'midtown' || district === 'financial_district' || district === 'central_park') &&
        rng() < 0.55;

      let placedAny = false;
      if (tryBig && canPlaceBuilding(chunkCenterX, chunkCenterY, 34, 34)) {
        const spec = pickBuildingSpec(district, rng);
        const h = spec.minH + rng() * (spec.maxH - spec.minH);
        const color = spec.colors[Math.floor(rng() * spec.colors.length)];
        const accent = spec.accents[Math.floor(rng() * spec.accents.length)];
        const signs = NEON_SIGNS[district];
        const hasNeon = district === 'midtown' ? rng() < 0.85 : rng() < 0.45;
        buildings.push({
          id: `b_${buildingSeq++}`,
          x: chunkCenterX,
          y: chunkCenterY,
          w: 30 + rng() * 6,
          h: 30 + rng() * 6,
          height: h,
          style: spec.style,
          district,
          color,
          accentColor: accent,
          hasNeonSign: hasNeon,
          neonText: signs[Math.floor(rng() * signs.length)],
          neonColor: DISTRICTS[district].neonPalette[Math.floor(rng() * DISTRICTS[district].neonPalette.length)],
          hasHelipad: district === 'midtown' && h > 40 && rng() < 0.4,
          hasBillboard: district === 'midtown' && rng() < 0.65,
          hasFireEscape: spec.style === 'tenement',
        });
        placedAny = true;
      }

      if (!placedAny) {
        for (const sub of subOffsets) {
          const bx = baseX + sub.ox;
          const by = baseY + sub.oy;
          const bw = district === 'brooklyn_docks' ? 14 + rng() * 6 : 16 + rng() * 5;
          const bh = district === 'brooklyn_docks' ? 10 + rng() * 8 : 16 + rng() * 5;
          if (!canPlaceBuilding(bx, by, bw, bh)) continue;

          const spec = pickBuildingSpec(district, rng);
          const h = spec.minH + rng() * (spec.maxH - spec.minH);
          const color = spec.colors[Math.floor(rng() * spec.colors.length)];
          const accent = spec.accents[Math.floor(rng() * spec.accents.length)];
          const signs = NEON_SIGNS[district];
          buildings.push({
            id: `b_${buildingSeq++}`,
            x: bx,
            y: by,
            w: bw,
            h: bh,
            height: h,
            style: spec.style,
            district,
            color,
            accentColor: accent,
            hasNeonSign: district === 'midtown' ? rng() < 0.7 : rng() < 0.3,
            neonText: signs[Math.floor(rng() * signs.length)],
            neonColor: DISTRICTS[district].neonPalette[Math.floor(rng() * DISTRICTS[district].neonPalette.length)],
            hasBillboard: district === 'midtown' && rng() < 0.35,
            hasFireEscape: spec.style === 'tenement',
          });
        }
      }

      // Mark building footprints on tile map for minimap clarity
      for (const b of buildings) {
        const minTx = Math.max(0, Math.floor((b.x - b.w * 0.5 - baseX) / TILE_SIZE));
        const maxTx = Math.min(TILES_PER_CHUNK - 1, Math.floor((b.x + b.w * 0.5 - baseX) / TILE_SIZE));
        const minTy = Math.max(0, Math.floor((b.y - b.h * 0.5 - baseY) / TILE_SIZE));
        const maxTy = Math.min(TILES_PER_CHUNK - 1, Math.floor((b.y + b.h * 0.5 - baseY) / TILE_SIZE));
        for (let ty = minTy; ty <= maxTy; ty++) {
          for (let tx = minTx; tx <= maxTx; tx++) {
            tiles[ty * TILES_PER_CHUNK + tx] = TILE_ENUM.building;
          }
        }
      }

      // Add Street Props: Trees in Central Park, Streetlamps along sidewalks, Cranes at Brooklyn Docks, Traffic lights at intersections
      if (isInCentralPark(chunkCenterX, chunkCenterY)) {
        for (let i = 0; i < 6; i++) {
          const tx = baseX + 6 + rng() * 52;
          const ty = baseY + 6 + rng() * 52;
          const { tile } = classifyTile(tx, ty);
          if (tile === TILE_ENUM.grass) {
            props.push({
              id: `p_${propSeq++}`,
              type: 'tree',
              x: tx,
              y: ty,
              rotation: rng() * Math.PI * 2,
            });
          }
        }
      } else {
        // Place streetlamp on avenue corners
        if (baseX % 128 === 0 && baseY % 128 === 0 && !isEastRiver(baseX + 16, baseY + 16) && !isHarborWater(baseX + 16, baseY + 16)) {
          props.push({
            id: `p_${propSeq++}`,
            type: 'streetlamp',
            x: baseX + 15,
            y: baseY + 15,
            rotation: 0,
            color: DISTRICTS[district].ambientColor,
          });
          props.push({
            id: `p_${propSeq++}`,
            type: 'traffic_light',
            x: baseX + 14,
            y: baseY + 14,
            rotation: 0,
          });
        }
        // Brooklyn dock cranes near piers
        if (district === 'brooklyn_docks' && baseX >= 1856 && rng() < 0.5) {
          const cxp = baseX + 20;
          const cyp = baseY + 32;
          if (!isHarborWater(cxp, cyp)) {
            props.push({
              id: `p_${propSeq++}`,
              type: 'crane',
              x: cxp,
              y: cyp,
              rotation: Math.PI * 0.5,
              color: '#f59e0b',
            });
          }
        }
      }

      // Add Facility visual props (neon crosses at Sanctuary Chapels, payphone booths)
      for (const f of WORLD_FACILITIES) {
        if (f.x >= baseX && f.x < baseX + CHUNK_SIZE && f.y >= baseY && f.y < baseY + CHUNK_SIZE) {
          if (f.type === 'sanctuary_chapel') {
            props.push({
              id: `p_${propSeq++}`,
              type: 'neon_cross',
              x: f.x,
              y: f.y,
              rotation: 0,
              color: '#38bdf8',
            });
          }
        }
      }
      for (const ph of PAYPHONES) {
        if (ph.x >= baseX && ph.x < baseX + CHUNK_SIZE && ph.y >= baseY && ph.y < baseY + CHUNK_SIZE) {
          props.push({
            id: `p_${propSeq++}`,
            type: 'payphone_booth',
            x: ph.x,
            y: ph.y,
            rotation: 0,
            color: ph.tier === 'green' ? '#22c55e' : ph.tier === 'yellow' ? '#eab308' : '#ef4444',
          });
        }
      }

      chunks.set(chunkKey(cx, cy), {
        cx,
        cy,
        key: chunkKey(cx, cy),
        district,
        tiles,
        overpassTiles,
        buildings,
        overpasses: chunkOverpasses,
        props,
        roadMask,
      });

      // Paint 8x8 block onto 256x256 static minimap pixel buffer
      for (let py = 0; py < 8; py++) {
        for (let px = 0; px < 8; px++) {
          const tileX = px * 2;
          const tileY = py * 2;
          const t = tiles[tileY * TILES_PER_CHUNK + tileX];
          const ov = overpassTiles[tileY * TILES_PER_CHUNK + tileX];
          let r = 38;
          let g = 42;
          let b = 48;

          if (ov > 0) {
            r = 148;
            g = 163;
            b = 184;
          } else if (t === TILE_ENUM.water) {
            r = 12;
            g = 38;
            b = 68;
          } else if (t === TILE_ENUM.grass) {
            r = 22;
            g = 86;
            b = 46;
          } else if (t === TILE_ENUM.park_path) {
            r = 120;
            g = 112;
            b = 88;
          } else if (t === TILE_ENUM.bridge || t === TILE_ENUM.pier) {
            r = 110;
            g = 96;
            b = 76;
          } else if (
            t === TILE_ENUM.road_ns ||
            t === TILE_ENUM.road_ew ||
            t === TILE_ENUM.intersection ||
            t === TILE_ENUM.crosswalk_ns ||
            t === TILE_ENUM.crosswalk_ew ||
            t === TILE_ENUM.broadway
          ) {
            r = 26;
            g = 28;
            b = 34;
          } else if (t === TILE_ENUM.facility_pad) {
            r = 212;
            g = 175;
            b = 55;
          } else if (t === TILE_ENUM.building) {
            if (district === 'financial_district') {
              r = 92; g = 44; b = 44;
            } else if (district === 'midtown') {
              r = 32; g = 74; b = 96;
            } else if (district === 'central_park') {
              r = 82; g = 88; b = 78;
            } else if (district === 'brooklyn_docks') {
              r = 96; g = 68; b = 34;
            } else {
              r = 76; g = 68; b = 56;
            }
          } else if (t === TILE_ENUM.rail) {
            r = 72;
            g = 58;
            b = 46;
          } else {
            r = 52;
            g = 56;
            b = 62;
          }

          const mx = cx * 8 + px;
          const my = cy * 8 + py;
          const pIdx = (my * minimapResolution + mx) * 4;
          minimapBasePixels[pIdx] = r;
          minimapBasePixels[pIdx + 1] = g;
          minimapBasePixels[pIdx + 2] = b;
          minimapBasePixels[pIdx + 3] = 255;
        }
      }
    }
  }

  return {
    worldSize: WORLD_SIZE,
    chunkSize: CHUNK_SIZE,
    tileSize: TILE_SIZE,
    chunksPerSide: CHUNKS_PER_SIDE,
    tilesPerChunk: TILES_PER_CHUNK,
    chunks,
    facilities: WORLD_FACILITIES,
    roadNodes,
    overpasses,
    minimapBasePixels,
    minimapResolution,
  };
}

export function getTileAtWorld(map: WorldMapData, wx: number, wy: number): number {
  if (wx < 0 || wy < 0 || wx >= map.worldSize || wy >= map.worldSize) {
    return TILE_ENUM.water;
  }
  const cx = Math.floor(wx / map.chunkSize);
  const cy = Math.floor(wy / map.chunkSize);
  const chunk = map.chunks.get(`${cx},${cy}`);
  if (!chunk) return TILE_ENUM.water;
  const tx = Math.floor((wx - cx * map.chunkSize) / map.tileSize);
  const ty = Math.floor((wy - cy * map.chunkSize) / map.tileSize);
  return chunk.tiles[ty * map.tilesPerChunk + tx];
}

export function isWaterAt(map: WorldMapData, wx: number, wy: number, layer: 0 | 1): boolean {
  if (layer === 1) return false;
  return getTileAtWorld(map, wx, wy) === TILE_ENUM.water;
}
