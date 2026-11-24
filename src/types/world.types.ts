export type DistrictId =
  | 'financial_district'
  | 'midtown'
  | 'central_park'
  | 'brooklyn_docks'
  | 'queens_expressway';

export type FactionId = 'syndicate' | 'yakuza' | 'brotherhood';

export type TileType =
  | 'asphalt'
  | 'road_ns'
  | 'road_ew'
  | 'intersection'
  | 'crosswalk_ns'
  | 'crosswalk_ew'
  | 'broadway'
  | 'sidewalk'
  | 'cobblestone'
  | 'grass'
  | 'park_path'
  | 'water'
  | 'bridge'
  | 'pier'
  | 'building'
  | 'concrete'
  | 'rail'
  | 'ramp_ns'
  | 'ramp_ew'
  | 'overpass'
  | 'facility_pad';

export type BuildingStyle =
  | 'art_deco'
  | 'tenement'
  | 'glass_tower'
  | 'penthouse'
  | 'warehouse'
  | 'container'
  | 'parking_garage'
  | 'precinct'
  | 'chapel'
  | 'paynspray'
  | 'crusher_tower'
  | 'depot';

export interface Vec2 {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BuildingDef {
  id: string;
  x: number; // center world X
  y: number; // center world Y
  w: number; // width X (meters)
  h: number; // depth Y (meters)
  height: number; // 3D height (meters)
  style: BuildingStyle;
  district: DistrictId;
  color: string;
  accentColor: string;
  hasNeonSign?: boolean;
  neonText?: string;
  neonColor?: string;
  hasHelipad?: boolean;
  hasBillboard?: boolean;
  hasFireEscape?: boolean;
  roofHeight?: number;
}

export interface OverpassSegment {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  orientation: 'ns' | 'ew';
  isRamp: boolean;
  rampDir?: 'n' | 's' | 'e' | 'w'; // direction ascending from layer 0 to layer 1
  elevation: number; // 6.0m for deck, 0..6 for ramp
}

export interface PropDef {
  id: string;
  type: 'streetlamp' | 'tree' | 'crane' | 'traffic_light' | 'bus_shelter' | 'neon_cross' | 'payphone_booth' | 'fuel_tanker' | 'relay_dish';
  x: number;
  y: number;
  rotation: number;
  color?: string;
}

export type FacilityType = 'pay_n_spray' | 'car_crusher' | 'sanctuary_chapel' | 'weapon_shop';

export interface FacilityDef {
  id: string;
  type: FacilityType;
  name: string;
  district: DistrictId;
  x: number;
  y: number;
  radius: number;
  cost: number;
}

export interface RoadNode {
  id: string;
  x: number;
  y: number;
  neighbors: string[];
  layer: 0 | 1;
  isIntersection: boolean;
  district: DistrictId;
}

export interface ChunkData {
  cx: number;
  cy: number;
  key: string;
  district: DistrictId;
  tiles: Uint8Array; // 16x16 = 256 tile enum indices
  overpassTiles: Uint8Array; // 16x16 layer-1 deck/ramp mask (0=none, 1=deck, 2=ramp)
  buildings: BuildingDef[];
  overpasses: OverpassSegment[];
  props: PropDef[];
  roadMask: Uint8Array; // 16x16 quick road lookup
}

export interface DistrictDef {
  id: DistrictId;
  name: string;
  shortName: string;
  subtitle: string;
  faction: FactionId | null;
  bounds: Rect; // primary bounding box in world meters
  ambientColor: string;
  fogColor: string;
  neonPalette: string[];
  minimapTint: string;
  spawnPoint: Vec2;
  teleportPoint: Vec2;
}

export interface GangDef {
  id: FactionId;
  name: string;
  shortName: string;
  district: DistrictId;
  color: string;
  secondaryColor: string;
  vehicleId: string;
  weapons: string[];
  rival: FactionId;
  bossName: string;
  emblem: string;
}

export interface WorldMapData {
  worldSize: number; // 2048
  chunkSize: number; // 64
  tileSize: number; // 4
  chunksPerSide: number; // 32
  tilesPerChunk: number; // 16
  chunks: Map<string, ChunkData>;
  facilities: FacilityDef[];
  roadNodes: Map<string, RoadNode>;
  overpasses: OverpassSegment[];
  minimapBasePixels: Uint8ClampedArray; // 256x256 pre-rendered static map overview
  minimapResolution: number;
}
