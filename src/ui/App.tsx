import React, { useEffect, useState } from 'react';
import {
  BookOpen,
  Crown,
  Diamond,
  Flame,
  Hammer,
  Moon,
  Play,
  RefreshCw,
  Skull,
  Star,
  Sun,
  Sunset,
  Zap,
} from 'lucide-react';
import type { GameMode, HudSnapshot, LightingMode, SaveSlotMeta } from '../types/state.types';
import type { FactionId } from '../types/world.types';
import type { GameEngine } from '../engine/GameEngine';
import { GANG_LIST, RESPECT_RULES } from '../data/gangs.data';
import { MISSIONS } from '../data/missions.data';
import { VEHICLE_LIST } from '../data/vehicles.data';
import { HudOverlay } from './HudOverlay';
import { DebugPanel } from './DebugPanel';
import { Minimap } from './Minimap';

interface AppProps {
  engine: GameEngine;
}

function FactionBadgeIcon({ faction, className = 'w-3.5 h-3.5' }: { faction: FactionId | 'all'; className?: string }) {
  if (faction === 'syndicate') return <Crown className={className} />;
  if (faction === 'yakuza') return <Diamond className={className} />;
  if (faction === 'brotherhood') return <Hammer className={className} />;
  return <Star className={className} fill="currentColor" />;
}

const LIGHTING_OPTIONS: { id: LightingMode; label: string; icon: React.ReactNode }[] = [
  { id: 'noon', label: 'NOON', icon: <Sun className="w-3.5 h-3.5" /> },
  { id: 'dusk', label: 'DUSK', icon: <Sunset className="w-3.5 h-3.5" /> },
  { id: 'night', label: 'NEON NIGHT', icon: <Moon className="w-3.5 h-3.5" /> },
  { id: 'cycle', label: 'CYCLE', icon: <RefreshCw className="w-3.5 h-3.5" /> },
];

const MODE_OPTIONS: { id: GameMode; label: string; desc: string; icon: React.ReactNode }[] = [
  { id: 'story', label: 'STORY CAREER', desc: '13 Syndicate Contracts', icon: <Play className="w-3.5 h-3.5" /> },
  { id: 'frenzy', label: 'KILL FRENZY ARCADE', desc: 'Non-Stop Rampage', icon: <Skull className="w-3.5 h-3.5" /> },
  { id: 'freeroam', label: 'FREE ROAM SANDBOX', desc: 'All Boroughs & Gear', icon: <Zap className="w-3.5 h-3.5" /> },
];

export const App: React.FC<AppProps> = ({ engine }) => {
  const [snapshot, setSnapshot] = useState<HudSnapshot>(() => engine.buildSnapshot());
  const [debugOpen, setDebugOpen] = useState(false);
  const [saveSlots, setSaveSlots] = useState<(SaveSlotMeta | null)[]>(() => engine.getSaveSlots());

  useEffect(() => {
    const unsubHud = engine.subscribe((snap) => setSnapshot(snap));
    const unsubDbg = engine.onDebugToggle(() => setDebugOpen((v) => !v));
    return () => {
      unsubHud();
      unsubDbg();
    };
  }, [engine]);

  useEffect(() => {
    if (snapshot.screen === 'title' || snapshot.screen === 'paused') {
      setSaveSlots(engine.getSaveSlots());
    }
  }, [engine, snapshot.screen]);

  const handleSave = (slot: number) => {
    engine.saveToSlot(slot);
    setSaveSlots(engine.getSaveSlots());
  };

  const lightingLabel =
    snapshot.lightingMode === 'night' ? 'NEON NIGHT' : snapshot.lightingMode.toUpperCase();

  return (
    <div className="fixed inset-0 pointer-events-none font-mono">
      {/* ACTIVE GAMEPLAY HUD */}
      {snapshot.screen === 'playing' && (
        <HudOverlay
          map={engine.map}
          snapshot={snapshot}
          onToggleDebug={() => setDebugOpen((v) => !v)}
          onOpenMap={() => engine.setScreen('map')}
          onOpenJournal={() => engine.setScreen('journal')}
          onOpenPause={() => engine.setScreen('paused')}
          onCycleRadio={() => engine.cycleRadio()}
          onCycleLighting={() => engine.cycleLightingMode()}
          onSelectWeapon={(w) => engine.selectWeapon(w)}
          onConfirmRespawn={() => engine.confirmRespawn()}
        />
      )}

      {/* COLLAPSIBLE QA DEBUG CONSOLE (`~` KEY) */}
      <DebugPanel
        engine={engine}
        snapshot={snapshot}
        open={debugOpen}
        onClose={() => setDebugOpen(false)}
      />

      {/* TITLE SCREEN */}
      {snapshot.screen === 'title' && (
        <div
          data-ui-interactive="true"
          className="fixed inset-0 z-30 pointer-events-auto bg-gradient-to-b from-black/80 via-[#0a0d1c]/85 to-black/95 flex items-center justify-center p-6 retro-scanlines overflow-y-auto"
        >
          <div className="max-w-4xl w-full bg-zinc-950/92 border-2 border-cyan-400/70 rounded-xl p-6 shadow-[0_0_50px_rgba(6,182,212,0.3)] space-y-5">
            <div className="text-center space-y-1">
              <div className="text-xs font-bold tracking-[0.45em] text-amber-400 uppercase">
                NEW YORK CITY | 1999 | 2.5D OPEN-WORLD ACTION
              </div>
              <h1 className="text-5xl md:text-6xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-amber-400 via-rose-500 to-cyan-400 gta-text-shadow">
                EMPIRE CITY '99
              </h1>
              <p className="text-xs text-zinc-400">
                5 Connected Boroughs | 3 Rival Syndicates | {VEHICLE_LIST.length} Vehicles | 9 Weapons | 6-Star NYPD Escalation
              </p>
            </div>

            {/* GTA 2 Mode, Lighting & Control Selectors */}
            <div className="grid md:grid-cols-3 gap-3 text-[11px]">
              {/* Game Mode */}
              <div className="bg-black/60 border border-zinc-800 rounded-lg p-2.5 space-y-1.5">
                <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Gameplay Mode</div>
                <div className="space-y-1">
                  {MODE_OPTIONS.map((m) => {
                    const active = snapshot.playMode === m.id;
                    return (
                      <button
                        key={m.id}
                        onClick={(e) => {
                          e.currentTarget.blur();
                          engine.setPlayMode(m.id);
                        }}
                        className={`w-full px-2.5 py-1.5 rounded border text-left flex items-center justify-between cursor-pointer ${
                          active
                            ? 'bg-cyan-950/80 border-cyan-400 text-cyan-200 font-black'
                            : 'bg-zinc-900/90 border-zinc-700 text-zinc-300 hover:bg-zinc-800'
                        }`}
                      >
                        <span className="inline-flex items-center gap-1.5">
                          {m.icon}
                          <span>{m.label}</span>
                        </span>
                        <span className="text-[9px] text-zinc-400">{m.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Lighting Mode (Live Preview) */}
              <div className="bg-black/60 border border-zinc-800 rounded-lg p-2.5 space-y-1.5">
                <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">City Lighting</div>
                <div className="grid grid-cols-2 gap-1.5">
                  {LIGHTING_OPTIONS.map((opt) => {
                    const active = snapshot.lightingMode === opt.id;
                    return (
                      <button
                        key={opt.id}
                        onClick={(e) => {
                          e.currentTarget.blur();
                          engine.setLightingMode(opt.id);
                        }}
                        className={`px-2 py-2 rounded border font-bold flex items-center justify-center gap-1.5 cursor-pointer ${
                          active
                            ? 'bg-amber-500/20 border-amber-400 text-amber-300'
                            : 'bg-zinc-900/90 border-zinc-700 text-zinc-300 hover:bg-zinc-800'
                        }`}
                      >
                        {opt.icon}
                        <span>{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Foot Control Mode */}
              <div className="bg-black/60 border border-zinc-800 rounded-lg p-2.5 space-y-1.5">
                <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Foot Controls</div>
                <div className="grid grid-cols-2 gap-1.5">
                  {(['directional', 'tank'] as const).map((cm) => {
                    const active = snapshot.controlMode === cm;
                    return (
                      <button
                        key={cm}
                        onClick={(e) => {
                          e.currentTarget.blur();
                          engine.setControlMode(cm);
                        }}
                        className={`px-2 py-2 rounded border font-bold uppercase cursor-pointer ${
                          active
                            ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300'
                            : 'bg-zinc-900/90 border-zinc-700 text-zinc-300 hover:bg-zinc-800'
                        }`}
                      >
                        {cm}
                      </button>
                    );
                  })}
                </div>
                <div className="text-[10px] text-zinc-400 leading-snug pt-0.5">
                  {snapshot.controlMode === 'directional'
                    ? 'Screen-relative WASD steering with mouse or auto-aim.'
                    : "Classic '99 tank turning (A/D turn, W/S step)."}
                </div>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              {/* Launch Controls */}
              <div className="space-y-2.5">
                {snapshot.playMode === 'story' ? (
                  <>
                    <button
                      onClick={(e) => {
                        e.currentTarget.blur();
                        engine.startNewGame('casual', 'story');
                      }}
                      className="w-full py-3 px-4 rounded-lg bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white font-black text-base tracking-wider shadow-lg cursor-pointer flex items-center justify-center gap-2"
                    >
                      <Play className="w-4 h-4" fill="currentColor" />
                      <span>PLAY NEW GAME (CASUAL MODE)</span>
                    </button>
                    <button
                      onClick={(e) => {
                        e.currentTarget.blur();
                        engine.startNewGame('classic', 'story');
                      }}
                      className="w-full py-2.5 px-4 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-amber-500/60 text-amber-300 font-bold text-sm tracking-wider cursor-pointer flex items-center justify-center gap-2"
                    >
                      <Star className="w-4 h-4" fill="currentColor" />
                      <span>PLAY CLASSIC '99 MODE ($10K CHAPEL SAVES)</span>
                    </button>
                  </>
                ) : (
                  <button
                    onClick={(e) => {
                      e.currentTarget.blur();
                      engine.startNewGame('casual', snapshot.playMode);
                    }}
                    className="w-full py-3.5 px-4 rounded-lg bg-gradient-to-r from-rose-600 via-amber-600 to-cyan-600 hover:brightness-110 text-white font-black text-base tracking-wider shadow-lg cursor-pointer flex items-center justify-center gap-2"
                  >
                    <Flame className="w-4 h-4" />
                    <span>
                      LAUNCH {snapshot.playMode === 'frenzy' ? 'KILL FRENZY ARCADE' : 'FREE ROAM SANDBOX'}
                    </span>
                  </button>
                )}

                {/* Load Existing Save Slots */}
                <div className="pt-1 space-y-1.5">
                  <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                    Load Saved Slot (localStorage)
                  </div>
                  {[1, 2, 3].map((slot, i) => {
                    const meta = saveSlots[i];
                    return (
                      <button
                        key={slot}
                        disabled={!meta}
                        onClick={(e) => {
                          e.currentTarget.blur();
                          engine.loadFromSlot(slot);
                        }}
                        className={`w-full px-3 py-2 rounded border text-left text-xs flex items-center justify-between ${
                          meta
                            ? 'bg-zinc-900 hover:bg-zinc-800 border-zinc-600 text-zinc-100 cursor-pointer'
                            : 'bg-zinc-950/60 border-zinc-800 text-zinc-600 cursor-not-allowed'
                        }`}
                      >
                        <span className="font-bold">SLOT {slot}</span>
                        {meta ? (
                          <span className="text-[10px] text-emerald-400">
                            ${meta.cash.toLocaleString()} | {meta.districtName} | {meta.completedMissions}/{meta.totalMissions}M
                          </span>
                        ) : (
                          <span className="text-[10px]">EMPTY</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Quick Controls & Factions Card */}
              <div className="bg-black/60 border border-zinc-800 rounded-lg p-3.5 text-xs space-y-2.5">
                <div className="font-black text-cyan-300 tracking-wider">CONTROLS BRIEFING</div>
                <div className="grid grid-cols-2 gap-y-1 text-[11px] text-zinc-300">
                  <span><b className="text-amber-300">WASD / Arrows</b></span><span>Move / Drive</span>
                  <span><b className="text-amber-300">Space</b></span><span>Jump (Foot) / Handbrake (Car)</span>
                  <span><b className="text-amber-300">LMB / Ctrl / X</b></span><span>Fire Weapon</span>
                  <span><b className="text-amber-300">Shift</b></span><span>Sprint</span>
                  <span><b className="text-amber-300">F / Enter</b></span><span>Car / Answer Payphone</span>
                  <span><b className="text-amber-300">Q / E / Wheel</b></span><span>Cycle 9 Weapons</span>
                  <span><b className="text-amber-300">H / R / T</b></span><span>Horn / Radio / Lighting</span>
                  <span><b className="text-amber-300">CapsLock</b></span><span>Taxi / Police / Medic Job</span>
                  <span><b className="text-amber-300">J / Tab / ~</b></span><span>Missions / Map / QA Debug</span>
                </div>
                <div className="border-t border-zinc-800 pt-2 flex justify-between text-[10px]">
                  {GANG_LIST.map((g) => (
                    <span
                      key={g.id}
                      style={{ color: g.color }}
                      className="font-bold inline-flex items-center gap-1"
                    >
                      <FactionBadgeIcon faction={g.id} className="w-3 h-3" />
                      <span>{g.shortName}</span>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* FULL-SCREEN NYC DISTRICT & GANG TURF MAP (`TAB` KEY) */}
      {snapshot.screen === 'map' && (
        <div
          data-ui-interactive="true"
          className="fixed inset-0 z-30 pointer-events-auto bg-black/90 flex flex-col items-center justify-center p-4 gap-3"
        >
          <div className="flex items-center justify-between w-[min(78vh,640px)]">
            <div>
              <h2 className="text-xl font-black text-cyan-300 tracking-wider">EMPIRE CITY '99 - FIVE BOROUGHS MAP</h2>
              <p className="text-[11px] text-zinc-400">
                2048m x 2048m Seamless NYC | Contracts Completed: {snapshot.completedMissions.length}/{MISSIONS.length} | Kill Frenzies: {snapshot.completedKillFrenzies.length}/8
              </p>
            </div>
            <button
              onClick={(e) => {
                e.currentTarget.blur();
                engine.setScreen('playing');
              }}
              className="px-4 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs cursor-pointer"
            >
              CLOSE [TAB]
            </button>
          </div>

          <Minimap map={engine.map} snapshot={snapshot} fullScreen />

          <div className="flex flex-wrap items-center justify-center gap-4 text-[11px] bg-zinc-950 border border-zinc-800 px-4 py-2 rounded">
            <span className="text-red-400 font-bold inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 inline-block bg-red-500 rounded-xs" /> Five Families Turf
            </span>
            <span className="text-cyan-400 font-bold inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 inline-block bg-cyan-400 rounded-xs" /> Neon Yakuza Turf
            </span>
            <span className="text-amber-400 font-bold inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 inline-block bg-amber-400 rounded-xs" /> Red Hook Turf
            </span>
            <span className="text-emerald-400 font-bold">[P] Pay 'n' Spray</span>
            <span className="text-amber-300 font-bold">[C] Car Crusher</span>
            <span className="text-sky-400 font-bold">[+] Save Chapel</span>
            <span className="text-rose-400 font-bold inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 inline-block bg-rose-500 rounded-full" /> Kill Frenzy
            </span>
            <span className="text-yellow-300 font-bold inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 inline-block bg-yellow-300 rounded-xs" /> Ringing Payphone
            </span>
          </div>
        </div>
      )}

      {/* MISSION ROSTER & BRIEFING JOURNAL (`J` KEY) */}
      {snapshot.screen === 'journal' && (
        <div
          data-ui-interactive="true"
          className="fixed inset-0 z-30 pointer-events-auto bg-black/88 flex items-center justify-center p-4"
        >
          <div className="w-full max-w-4xl max-h-[88vh] bg-zinc-950 border-2 border-cyan-400/80 rounded-xl p-5 flex flex-col gap-3 shadow-[0_0_50px_rgba(6,182,212,0.3)]">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div>
                <h2 className="text-xl font-black text-cyan-300 tracking-wider flex items-center gap-2">
                  <BookOpen className="w-5 h-5" />
                  <span>SYNDICATE MISSION ROSTER &amp; BRIEFINGS</span>
                </h2>
                <p className="text-[11px] text-zinc-400">
                  Contracts: {snapshot.completedMissions.length}/{MISSIONS.length} | Kill Frenzies: {snapshot.completedKillFrenzies.length}/8 | Earned: ${snapshot.totalCashEarned.toLocaleString()}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {snapshot.finaleUnlocked && !snapshot.completedMissions.includes('king_of_five_boroughs') && (
                  <button
                    onClick={(e) => {
                      e.currentTarget.blur();
                      engine.launchFinaleFromJournal();
                    }}
                    className="px-3 py-1.5 rounded bg-amber-500 hover:bg-amber-400 text-black font-black text-xs cursor-pointer"
                  >
                    LAUNCH FINALE
                  </button>
                )}
                <button
                  onClick={(e) => {
                    e.currentTarget.blur();
                    engine.setScreen('playing');
                  }}
                  className="px-3 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs cursor-pointer"
                >
                  CLOSE [J / ESC]
                </button>
              </div>
            </div>

            <div className="overflow-y-auto pr-1 space-y-2">
              {MISSIONS.map((m, idx) => {
                const completed = snapshot.completedMissions.includes(m.id);
                const active = snapshot.activeMission?.id === m.id;
                const failed = snapshot.failedMissions.includes(m.id);
                const minRespect =
                  m.tier === 'green'
                    ? RESPECT_RULES.GREEN_PAYPHONE_MIN
                    : m.tier === 'yellow'
                    ? RESPECT_RULES.YELLOW_PAYPHONE_MIN
                    : m.tier === 'red'
                    ? RESPECT_RULES.RED_PAYPHONE_MIN
                    : RESPECT_RULES.FINALE_MIN_RESPECT;
                const respectOk =
                  m.faction === 'all'
                    ? snapshot.finaleUnlocked
                    : snapshot.respect[m.faction] >= minRespect;
                const status = completed
                  ? 'COMPLETED'
                  : active
                  ? 'ACTIVE'
                  : failed
                  ? 'FAILED'
                  : respectOk
                  ? 'AVAILABLE'
                  : 'LOCKED';
                const statusCls =
                  status === 'COMPLETED'
                    ? 'bg-emerald-950 text-emerald-300 border-emerald-500/60'
                    : status === 'ACTIVE'
                    ? 'bg-amber-950 text-amber-300 border-amber-400'
                    : status === 'FAILED'
                    ? 'bg-red-950 text-red-300 border-red-500/60'
                    : status === 'AVAILABLE'
                    ? 'bg-cyan-950 text-cyan-300 border-cyan-500/60'
                    : 'bg-zinc-900 text-zinc-500 border-zinc-700';

                const cleanBriefing = m.briefing.replace(/[\u2018\u2019]/g, "'").replace(/[\u2013\u2014]/g, '-');

                return (
                  <div
                    key={m.id}
                    className="bg-black/70 border border-zinc-800 rounded-lg p-3 flex flex-col gap-1.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs font-black text-zinc-100">
                        <span className="text-zinc-500">#{idx + 1}</span>
                        <FactionBadgeIcon faction={m.faction} className="w-3.5 h-3.5 text-amber-300" />
                        <span>{m.title}</span>
                        <span className="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-700 text-[9px] uppercase text-zinc-300">
                          {m.faction} | {m.tier}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] font-bold">
                        <span className="text-zinc-400">
                          Gate: {m.faction === 'all' ? '+60 Rep & $250K' : `${minRespect >= 0 ? `+${minRespect}` : minRespect} Rep`}
                        </span>
                        <span className="text-emerald-400">+${m.rewardCash.toLocaleString()}</span>
                        <span className={`px-2 py-0.5 rounded border ${statusCls}`}>{status}</span>
                      </div>
                    </div>
                    <p className="text-[11px] text-zinc-300 leading-snug">{cleanBriefing}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* PAUSE & SAVE MENU (`ESC` KEY) */}
      {snapshot.screen === 'paused' && (
        <div
          data-ui-interactive="true"
          className="fixed inset-0 z-30 pointer-events-auto bg-black/82 flex items-center justify-center p-4"
        >
          <div className="w-full max-w-md bg-zinc-950 border-2 border-amber-400/80 rounded-xl p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h2 className="text-2xl font-black text-amber-400 tracking-wider">PAUSED</h2>
              <span className="text-xs text-zinc-400">
                {snapshot.completedMissions.length}/{MISSIONS.length} Missions
              </span>
            </div>

            <button
              onClick={(e) => {
                e.currentTarget.blur();
                engine.setScreen('playing');
              }}
              className="w-full py-2.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-black tracking-wider cursor-pointer flex items-center justify-center gap-2"
            >
              <Play className="w-4 h-4" fill="currentColor" />
              <span>RESUME GAME</span>
            </button>

            {/* Settings */}
            <div className="grid grid-cols-3 gap-2 text-[11px]">
              <button
                onClick={(e) => {
                  e.currentTarget.blur();
                  engine.setControlMode(snapshot.controlMode === 'directional' ? 'tank' : 'directional');
                }}
                className="py-2 px-2 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 font-bold cursor-pointer"
              >
                Move: <span className="text-cyan-300">{snapshot.controlMode.toUpperCase()}</span>
              </button>
              <button
                onClick={(e) => {
                  e.currentTarget.blur();
                  engine.cycleLightingMode();
                }}
                className="py-2 px-2 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 font-bold cursor-pointer"
              >
                Light: <span className="text-amber-200">{lightingLabel}</span>
              </button>
              <button
                onClick={(e) => {
                  e.currentTarget.blur();
                  engine.toggleMute();
                }}
                className="py-2 px-2 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 font-bold cursor-pointer"
              >
                Audio: <span className="text-amber-300">{snapshot.muted ? 'MUTED' : 'ON'}</span>
              </button>
            </div>

            {/* Save / Load Multi-Slot Panel */}
            <div className="space-y-2">
              <div className="text-[11px] font-bold text-zinc-400 uppercase">
                Multi-Slot Save / Load {snapshot.gameMode === 'casual' ? '(Free in Casual Mode)' : '(Classic: Use Sanctuary Chapels)'}
              </div>
              {[1, 2, 3].map((slot, idx) => {
                const meta = saveSlots[idx];
                return (
                  <div key={slot} className="flex items-center gap-2 bg-zinc-900/90 border border-zinc-800 rounded p-2 text-xs">
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-zinc-200">SLOT {slot}</div>
                      <div className="text-[10px] text-zinc-400 truncate">
                        {meta ? `$${meta.cash.toLocaleString()} | ${meta.districtName} | ${meta.savedAt}` : 'Empty Slot'}
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.currentTarget.blur();
                        handleSave(slot);
                      }}
                      className="px-2.5 py-1 rounded bg-cyan-700 hover:bg-cyan-600 text-white font-bold cursor-pointer"
                    >
                      SAVE
                    </button>
                    <button
                      disabled={!meta}
                      onClick={(e) => {
                        e.currentTarget.blur();
                        engine.loadFromSlot(slot);
                      }}
                      className={`px-2.5 py-1 rounded font-bold ${
                        meta
                          ? 'bg-amber-600 hover:bg-amber-500 text-black cursor-pointer'
                          : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
                      }`}
                    >
                      LOAD
                    </button>
                  </div>
                );
              })}
            </div>

            <button
              onClick={(e) => {
                e.currentTarget.blur();
                engine.setScreen('title');
              }}
              className="w-full py-2 rounded bg-zinc-900 hover:bg-red-950 border border-zinc-700 hover:border-red-500 text-zinc-300 font-bold text-xs cursor-pointer"
            >
              RETURN TO TITLE SCREEN
            </button>
          </div>
        </div>
      )}

      {/* VICTORY SCREEN: KING OF THE FIVE BOROUGHS */}
      {snapshot.screen === 'victory' && (
        <div
          data-ui-interactive="true"
          className="fixed inset-0 z-30 pointer-events-auto bg-black/88 flex items-center justify-center p-6"
        >
          <div className="max-w-lg w-full bg-zinc-950 border-4 border-amber-400 rounded-xl p-8 text-center space-y-5 shadow-[0_0_60px_rgba(251,191,36,0.45)]">
            <div className="flex justify-center">
              <Crown className="w-14 h-14 text-amber-400" />
            </div>
            <h2 className="text-3xl font-black text-amber-400 tracking-wider gta-text-shadow">
              KING OF THE FIVE BOROUGHS!
            </h2>
            <p className="text-sm text-zinc-300">
              Don Salieri, Kenji Kuroda, and Big Eddie have fallen. From Wall Street to Red Hook Docks, all of Empire City '99 answers to you!
            </p>
            <div className="grid grid-cols-2 gap-3 bg-black/70 border border-zinc-800 rounded p-3 text-xs">
              <div>TOTAL CASH: <span className="text-emerald-400 font-black">${snapshot.cash.toLocaleString()}</span></div>
              <div>MISSIONS: <span className="text-cyan-400 font-black">{snapshot.completedMissions.length}/{MISSIONS.length}</span></div>
            </div>
            <button
              onClick={(e) => {
                e.currentTarget.blur();
                engine.setScreen('playing');
              }}
              className="w-full py-3 rounded bg-amber-400 hover:bg-amber-300 text-black font-black tracking-wider cursor-pointer"
            >
              CONTINUE FREE ROAM IN EMPIRE CITY
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
