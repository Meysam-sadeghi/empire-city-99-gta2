import type { DistrictDef, DistrictId, FacilityDef } from '../types/world.types';

export const WORLD_SIZE = 2048;
export const CHUNK_SIZE = 64;
export const TILE_SIZE = 4;
export const CHUNKS_PER_SIDE = 32;
export const TILES_PER_CHUNK = 16;

export const DISTRICTS: Record<DistrictId, DistrictDef> = {
  financial_district: {
    id: 'financial_district',
    name: 'Financial District & Little Italy',
    shortName: 'FINANCIAL DIST.',
    subtitle: 'FIVE FAMILIES SYNDICATE TURF',
    faction: 'syndicate',
    bounds: { x: 0, y: 1344, w: 1216, h: 704 },
    ambientColor: '#ffb35c',
    fogColor: '#1a110c',
    neonPalette: ['#dc2626', '#f59e0b', '#fbbf24', '#ef4444'],
    minimapTint: 'rgba(220, 38, 38, 0.24)',
    spawnPoint: { x: 640, y: 1536 },
    teleportPoint: { x: 640, y: 1536 },
  },
  midtown: {
    id: 'midtown',
    name: 'Midtown & Times Square Core',
    shortName: 'TIMES SQUARE',
    subtitle: 'NEON YAKUZA CARTEL TURF',
    faction: 'yakuza',
    bounds: { x: 0, y: 640, w: 1216, h: 704 },
    ambientColor: '#4be8ff',
    fogColor: '#0c1024',
    neonPalette: ['#06b6d4', '#ec4899', '#a855f7', '#22d3ee'],
    minimapTint: 'rgba(6, 182, 212, 0.24)',
    spawnPoint: { x: 640, y: 960 },
    teleportPoint: { x: 640, y: 960 },
  },
  central_park: {
    id: 'central_park',
    name: 'Central Park & Upper Concourse',
    shortName: 'CENTRAL PARK',
    subtitle: 'NEUTRAL ZONE • HIGH NYPD PATROL',
    faction: null,
    bounds: { x: 0, y: 0, w: 1216, h: 640 },
    ambientColor: '#9ee8a6',
    fogColor: '#0e1714',
    neonPalette: ['#34d399', '#fde047', '#60a5fa', '#f8fafc'],
    minimapTint: 'rgba(34, 197, 94, 0.22)',
    spawnPoint: { x: 640, y: 256 },
    teleportPoint: { x: 640, y: 256 },
  },
  brooklyn_docks: {
    id: 'brooklyn_docks',
    name: 'Brooklyn Docks & Red Hook Waterfront',
    shortName: 'BROOKLYN DOCKS',
    subtitle: 'RED HOOK BROTHERHOOD TURF',
    faction: 'brotherhood',
    bounds: { x: 1344, y: 1024, w: 704, h: 1024 },
    ambientColor: '#ffaa44',
    fogColor: '#16120c',
    neonPalette: ['#f59e0b', '#fb923c', '#facc15', '#38bdf8'],
    minimapTint: 'rgba(245, 158, 11, 0.24)',
    spawnPoint: { x: 1536, y: 1664 },
    teleportPoint: { x: 1600, y: 1600 },
  },
  queens_expressway: {
    id: 'queens_expressway',
    name: 'Queens Rail Yards & Expressway',
    shortName: 'QUEENS EXPY',
    subtitle: 'INDUSTRIAL & HEAVY TRANSPORT ZONE',
    faction: 'brotherhood',
    bounds: { x: 1344, y: 0, w: 704, h: 1024 },
    ambientColor: '#d4b483',
    fogColor: '#141318',
    neonPalette: ['#f59e0b', '#38bdf8', '#f97316', '#e2e8f0'],
    minimapTint: 'rgba(217, 119, 6, 0.18)',
    spawnPoint: { x: 1664, y: 384 },
    teleportPoint: { x: 1664, y: 384 },
  },
};

export const DISTRICT_LIST: DistrictDef[] = Object.values(DISTRICTS);

export function getDistrictAt(x: number, y: number): DistrictId {
  if (x >= 1280) {
    return y < 1024 ? 'queens_expressway' : 'brooklyn_docks';
  }
  if (y < 640) return 'central_park';
  if (y < 1344) return 'midtown';
  return 'financial_district';
}

export const WORLD_FACILITIES: FacilityDef[] = [
  // 5 Pay 'n' Spray Garages (1 per district)
  {
    id: 'pns_financial',
    type: 'pay_n_spray',
    name: "Little Italy Pay 'n' Spray",
    district: 'financial_district',
    x: 384,
    y: 1728,
    radius: 13,
    cost: 500,
  },
  {
    id: 'pns_midtown',
    type: 'pay_n_spray',
    name: "Midtown Neon Pay 'n' Spray",
    district: 'midtown',
    x: 896,
    y: 1088,
    radius: 13,
    cost: 500,
  },
  {
    id: 'pns_central_park',
    type: 'pay_n_spray',
    name: "Upper West Pay 'n' Spray",
    district: 'central_park',
    x: 256,
    y: 320,
    radius: 13,
    cost: 500,
  },
  {
    id: 'pns_brooklyn',
    type: 'pay_n_spray',
    name: "Red Hook Dock Pay 'n' Spray",
    district: 'brooklyn_docks',
    x: 1536,
    y: 1472,
    radius: 13,
    cost: 500,
  },
  {
    id: 'pns_queens',
    type: 'pay_n_spray',
    name: "Queens Rail Pay 'n' Spray",
    district: 'queens_expressway',
    x: 1536,
    y: 640,
    radius: 13,
    cost: 500,
  },

  // 2 Car Crushers & Chop Shops (Brooklyn Docks & Queens)
  {
    id: 'crusher_brooklyn',
    type: 'car_crusher',
    name: 'Brooklyn Magnetic Car Crusher',
    district: 'brooklyn_docks',
    x: 1600,
    y: 1600,
    radius: 14,
    cost: 0,
  },
  {
    id: 'crusher_queens',
    type: 'car_crusher',
    name: 'Queens Yard Chop Shop & Crusher',
    district: 'queens_expressway',
    x: 1792,
    y: 704,
    radius: 14,
    cost: 0,
  },

  // 3 Sanctuary Chapels (Save Points)
  {
    id: 'chapel_financial',
    type: 'sanctuary_chapel',
    name: 'St. Jude Sanctuary (Little Italy)',
    district: 'financial_district',
    x: 768,
    y: 1536,
    radius: 10,
    cost: 10000,
  },
  {
    id: 'chapel_midtown',
    type: 'sanctuary_chapel',
    name: 'Neon Grace Chapel (Midtown)',
    district: 'midtown',
    x: 512,
    y: 1152,
    radius: 10,
    cost: 10000,
  },
  {
    id: 'chapel_brooklyn',
    type: 'sanctuary_chapel',
    name: 'Harbor Light Chapel (Brooklyn)',
    district: 'brooklyn_docks',
    x: 1792,
    y: 1664,
    radius: 10,
    cost: 10000,
  },
];

export const OPEN_PLAZAS: { x: number; y: number; radius: number; name: string }[] = [
  { x: 576, y: 1600, radius: 42, name: 'Wall Street Plaza' },
  { x: 448, y: 832, radius: 44, name: 'Midtown Precinct Courtyard' },
  { x: 1600, y: 1600, radius: 46, name: 'Brooklyn Car Crusher Yard' },
  { x: 1792, y: 704, radius: 46, name: 'Queens Rail Depot Yard' },
  { x: 1728, y: 1344, radius: 42, name: 'Red Hook Cargo Warehouse' },
  { x: 640, y: 960, radius: 40, name: 'Times Square Core' },
  { x: 320, y: 1600, radius: 36, name: 'Syndicate Garage Courtyard' },
  { x: 832, y: 896, radius: 36, name: 'Midtown Tower Plaza' },
];
