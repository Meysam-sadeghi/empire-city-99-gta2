import type { FactionId, GangDef } from '../types/world.types';

export const GANGS: Record<FactionId, GangDef> = {
  syndicate: {
    id: 'syndicate',
    name: 'Five Families Syndicate',
    shortName: 'SYNDICATE',
    district: 'financial_district',
    color: '#DC2626',
    secondaryColor: '#991B1B',
    vehicleId: 'mobster_v8',
    weapons: ['pistol', 'dual_uzis'],
    rival: 'yakuza',
    bossName: 'Don Salieri',
    emblem: '♛',
  },
  yakuza: {
    id: 'yakuza',
    name: 'Neon Yakuza Cartel',
    shortName: 'YAKUZA',
    district: 'midtown',
    color: '#06B6D4',
    secondaryColor: '#0E7490',
    vehicleId: 'apex_gt',
    weapons: ['dual_uzis', 'm4'],
    rival: 'brotherhood',
    bossName: 'Kenji Kuroda',
    emblem: '❖',
  },
  brotherhood: {
    id: 'brotherhood',
    name: 'Red Hook Brotherhood',
    shortName: 'BROTHERHOOD',
    district: 'brooklyn_docks',
    color: '#F59E0B',
    secondaryColor: '#B45309',
    vehicleId: 'brooklyn_muscle',
    weapons: ['shotgun', 'molotov'],
    rival: 'syndicate',
    bossName: 'Big Eddie Kowalski',
    emblem: '⚒',
  },
};

export const GANG_LIST: GangDef[] = [GANGS.syndicate, GANGS.yakuza, GANGS.brotherhood];

export const RESPECT_RULES = {
  MIN: -100,
  MAX: 100,
  HOSTILE_THRESHOLD: -35,
  GREEN_PAYPHONE_MIN: -20,
  YELLOW_PAYPHONE_MIN: 25,
  RED_PAYPHONE_MIN: 55,
  FINALE_MIN_RESPECT: 60,
  FINALE_MIN_CASH: 250000,
  MISSION_GAIN: 20,
  MISSION_RIVAL_LOSS: -15,
  KILL_LOSS: -3,
  KILL_RIVAL_GAIN: 1,
} as const;
