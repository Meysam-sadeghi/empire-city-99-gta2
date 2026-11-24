import React, { useState } from 'react';
import { ChevronRight, Star, X } from 'lucide-react';
import type { HudSnapshot } from '../types/state.types';
import type { VehicleId } from '../types/entity.types';
import type { DistrictId } from '../types/world.types';
import { VEHICLE_LIST } from '../data/vehicles.data';
import { MISSIONS } from '../data/missions.data';
import type { GameEngine } from '../engine/GameEngine';

interface DebugPanelProps {
  engine: GameEngine;
  snapshot: HudSnapshot;
  open: boolean;
  onClose: () => void;
}

export const DebugPanel: React.FC<DebugPanelProps> = ({ engine, snapshot, open, onClose }) => {
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleId>('apex_gt');
  const [selectedMission, setSelectedMission] = useState<string>(MISSIONS[0].id);

  if (!open) return null;

  const teleports: { label: string; target: DistrictId | 'nearest_payphone' }[] = [
    { label: 'Financial Dist.', target: 'financial_district' },
    { label: 'Times Square', target: 'midtown' },
    { label: 'Central Park', target: 'central_park' },
    { label: 'Brooklyn Crusher', target: 'brooklyn_docks' },
    { label: 'Queens Expy', target: 'queens_expressway' },
    { label: 'Nearest Payphone', target: 'nearest_payphone' },
  ];

  return (
    <div
      data-ui-interactive="true"
      className="fixed top-4 right-4 z-40 w-[330px] max-h-[88vh] overflow-y-auto bg-zinc-950/95 border-2 border-amber-400/80 rounded-lg shadow-[0_0_30px_rgba(0,0,0,0.95)] p-3.5 text-xs font-mono text-zinc-100 pointer-events-auto space-y-3"
    >
      <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
        <div className="font-black text-amber-400 tracking-wider">QA DEBUG CONSOLE [`~`]</div>
        <button
          onClick={(e) => {
            e.currentTarget.blur();
            onClose();
          }}
          aria-label="Close Debug Console"
          className="p-1 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-300 cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Live Performance Telemetry */}
      <div className="grid grid-cols-2 gap-1.5 bg-black/70 border border-zinc-800 rounded p-2 text-[11px]">
        <div>FPS: <span className="text-emerald-400 font-bold">{snapshot.telemetry.fps}</span></div>
        <div>Draw Calls: <span className="text-cyan-400 font-bold">{snapshot.telemetry.drawCalls}</span></div>
        <div>Rapier Bodies: <span className="text-amber-300 font-bold">{snapshot.telemetry.rigidBodies}</span></div>
        <div>Chunks: <span className="text-purple-300 font-bold">{snapshot.telemetry.activeChunks} / {snapshot.telemetry.totalChunks}</span></div>
        <div>Vehicles: <span className="text-zinc-200 font-bold">{snapshot.telemetry.activeVehicles}</span></div>
        <div>Peds: <span className="text-zinc-200 font-bold">{snapshot.telemetry.activePeds}</span></div>
        <div className="col-span-2 text-zinc-400">
          Pos: ({snapshot.telemetry.playerX}, {snapshot.telemetry.playerY}) | Elev Layer: <span className="text-cyan-300 font-bold">{snapshot.telemetry.playerLayer}</span>
        </div>
      </div>

      {/* Instant District Teleport */}
      <div>
        <div className="text-[10px] text-zinc-400 font-bold uppercase mb-1">Instant District Teleport</div>
        <div className="grid grid-cols-2 gap-1.5">
          {teleports.map((tp) => (
            <button
              key={tp.target}
              onClick={(e) => {
                e.currentTarget.blur();
                engine.debugTeleportToDistrict(tp.target);
              }}
              className="px-2 py-1.5 rounded bg-zinc-900 hover:bg-cyan-950 border border-zinc-700 hover:border-cyan-400 text-left font-bold cursor-pointer transition-colors flex items-center gap-1"
            >
              <ChevronRight className="w-3.5 h-3.5 shrink-0 text-cyan-400" />
              <span className="truncate">{tp.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Vehicle Spawner Dropdown */}
      <div>
        <div className="text-[10px] text-zinc-400 font-bold uppercase mb-1">
          Vehicle Spawner ({VEHICLE_LIST.length} NYC Models)
        </div>
        <div className="flex gap-1.5">
          <select
            value={selectedVehicle}
            onChange={(e) => {
              setSelectedVehicle(e.target.value as VehicleId);
              e.currentTarget.blur();
            }}
            className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-zinc-100"
          >
            {VEHICLE_LIST.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} ({v.vehicleClass})
              </option>
            ))}
          </select>
          <button
            onClick={(e) => {
              e.currentTarget.blur();
              engine.debugSpawnVehicle(selectedVehicle);
            }}
            className="px-3 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-white font-bold cursor-pointer"
          >
            SPAWN
          </button>
        </div>
      </div>

      {/* Wanted Star Selector (0 to 6 Stars) */}
      <div>
        <div className="text-[10px] text-zinc-400 font-bold uppercase mb-1">Wanted Level (0 - 6 Stars)</div>
        <div className="grid grid-cols-7 gap-1">
          {[0, 1, 2, 3, 4, 5, 6].map((star) => (
            <button
              key={star}
              onClick={(e) => {
                e.currentTarget.blur();
                engine.debugSetWanted(star);
              }}
              className={`py-1 rounded font-black border cursor-pointer flex items-center justify-center gap-0.5 ${
                snapshot.wantedStars === star
                  ? 'bg-yellow-400 text-black border-yellow-200'
                  : 'bg-zinc-900 text-yellow-400 border-zinc-700 hover:bg-zinc-800'
              }`}
            >
              <span>{star}</span>
              <Star className="w-2.5 h-2.5" fill="currentColor" />
            </button>
          ))}
        </div>
      </div>

      {/* Arsenal, Cash, Respect & God Mode */}
      <div>
        <div className="text-[10px] text-zinc-400 font-bold uppercase mb-1">Arsenal & Cheats</div>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            onClick={(e) => {
              e.currentTarget.blur();
              engine.debugGiveAllWeapons();
            }}
            className="px-2 py-1.5 rounded bg-purple-900/70 hover:bg-purple-800 border border-purple-500 text-purple-100 font-bold cursor-pointer"
          >
            All Weapons + Max
          </button>
          <button
            onClick={(e) => {
              e.currentTarget.blur();
              engine.debugAddCash(100000);
            }}
            className="px-2 py-1.5 rounded bg-emerald-900/70 hover:bg-emerald-800 border border-emerald-500 text-emerald-100 font-bold cursor-pointer"
          >
            +$100,000 Cash
          </button>
          <button
            onClick={(e) => {
              e.currentTarget.blur();
              engine.debugToggleGodMode();
            }}
            className={`px-2 py-1.5 rounded border font-bold cursor-pointer ${
              snapshot.godMode
                ? 'bg-amber-400 text-black border-amber-200'
                : 'bg-zinc-900 hover:bg-zinc-800 border-zinc-700 text-amber-300'
            }`}
          >
            God Mode: {snapshot.godMode ? 'ON' : 'OFF'}
          </button>
          <button
            onClick={(e) => {
              e.currentTarget.blur();
              engine.debugMaxRespect();
            }}
            className="px-2 py-1.5 rounded bg-rose-900/70 hover:bg-rose-800 border border-rose-500 text-rose-100 font-bold cursor-pointer"
          >
            Max All Respect
          </button>
        </div>
      </div>

      {/* Mission Jump Selector (All 13 Missions) */}
      <div>
        <div className="text-[10px] text-zinc-400 font-bold uppercase mb-1">Mission Jump (12 + Finale)</div>
        <div className="flex flex-col gap-1.5">
          <select
            value={selectedMission}
            onChange={(e) => {
              setSelectedMission(e.target.value);
              e.currentTarget.blur();
            }}
            className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-zinc-100"
          >
            {MISSIONS.map((m, i) => (
              <option key={m.id} value={m.id}>
                #{i + 1} [{m.faction.toUpperCase()}] {m.title}
              </option>
            ))}
          </select>
          <button
            onClick={(e) => {
              e.currentTarget.blur();
              engine.debugJumpToMission(selectedMission);
            }}
            className="w-full py-1.5 rounded bg-amber-500 hover:bg-amber-400 text-black font-black cursor-pointer"
          >
            LAUNCH SELECTED MISSION
          </button>
        </div>
      </div>
    </div>
  );
};
