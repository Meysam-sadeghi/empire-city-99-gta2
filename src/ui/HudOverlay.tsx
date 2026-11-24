import React, { useState } from 'react';
import {
  BookOpen,
  Crown,
  Diamond,
  Flame,
  Hammer,
  Heart,
  Infinity as InfinityIcon,
  Phone,
  Shield,
  Skull,
  Star,
  Sun,
  Crosshair,
} from 'lucide-react';
import type { HudSnapshot } from '../types/state.types';
import type { WeaponId } from '../types/entity.types';
import type { FactionId, WorldMapData } from '../types/world.types';
import { GANG_LIST, RESPECT_RULES } from '../data/gangs.data';
import { WEAPONS } from '../data/weapons.data';
import { Minimap } from './Minimap';
import { PagerTicker } from './PagerTicker';

interface HudOverlayProps {
  map: WorldMapData;
  snapshot: HudSnapshot;
  onToggleDebug: () => void;
  onOpenMap: () => void;
  onOpenJournal: () => void;
  onOpenPause: () => void;
  onCycleRadio: () => void;
  onCycleLighting: () => void;
  onSelectWeapon: (weaponId: WeaponId) => void;
  onConfirmRespawn: () => void;
}

function FactionIcon({ faction, className = 'w-4 h-4' }: { faction: FactionId | 'all'; className?: string }) {
  if (faction === 'syndicate') return <Crown className={className} />;
  if (faction === 'yakuza') return <Diamond className={className} />;
  if (faction === 'brotherhood') return <Hammer className={className} />;
  return <Star className={className} fill="currentColor" />;
}

export const HudOverlay: React.FC<HudOverlayProps> = ({
  map,
  snapshot,
  onToggleDebug,
  onOpenMap,
  onOpenJournal,
  onOpenPause,
  onCycleRadio,
  onCycleLighting,
  onSelectWeapon,
  onConfirmRespawn,
}) => {
  const [briefingExpanded, setBriefingExpanded] = useState(false);

  const formattedCash = `$${Math.max(0, snapshot.cash).toString().padStart(9, '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;

  const heartsRatio = Math.max(0, Math.min(1, snapshot.hp / Math.max(1, snapshot.maxHp)));
  const filledHearts = Math.ceil(heartsRatio * 5);

  const lightingLabel =
    snapshot.lightingMode === 'night' ? 'NIGHT' : snapshot.lightingMode.toUpperCase();

  return (
    <div className="fixed inset-0 pointer-events-none z-10 flex flex-col justify-between p-4 font-mono">
      {/* TOP BAR */}
      <div className="flex items-start justify-between gap-4">
        {/* TOP-LEFT: Authentic GTA 2 Respect-O-Meters (3 Vertical Segmented Bars) */}
        <div
          className="flex items-start gap-2.5 bg-[#09090b]/82 border border-zinc-700/80 rounded-lg p-2.5 backdrop-blur-xs pointer-events-auto shadow-[var(--shadow-hud-panel)]"
          data-ui-interactive="true"
        >
          {GANG_LIST.map((gang) => {
            const val = snapshot.respect[gang.id];
            const hostile = val < RESPECT_RULES.HOSTILE_THRESHOLD;
            const normalized = (val + 100) / 200;
            const litSegments = Math.round(normalized * 10);

            return (
              <div
                key={gang.id}
                title={`${gang.name}: ${val > 0 ? `+${val}` : val} Respect ${hostile ? '(HOSTILE - SHOOT ON SIGHT!)' : ''}`}
                className="flex flex-col items-center gap-1 group cursor-help"
              >
                <div
                  className="w-7 h-7 rounded flex items-center justify-center border shadow"
                  style={{
                    backgroundColor: `${gang.color}28`,
                    borderColor: gang.color,
                    color: gang.color,
                  }}
                >
                  <FactionIcon faction={gang.id} className="w-4 h-4" />
                </div>

                {/* 10 Vertical Segments */}
                <div className="flex flex-col-reverse gap-[2px] bg-zinc-950 p-1 rounded border border-zinc-800">
                  {Array.from({ length: 10 }).map((_, idx) => {
                    const active = idx < litSegments;
                    const isCenterLine = idx === 5;
                    return (
                      <div
                        key={idx}
                        className={`w-4 h-[6px] rounded-[1px] transition-colors ${isCenterLine ? 'ring-1 ring-white/25' : ''}`}
                        style={{
                          backgroundColor: active ? gang.color : '#1f2937',
                          boxShadow: active ? `0 0 6px ${gang.color}` : 'none',
                        }}
                      />
                    );
                  })}
                </div>

                <span
                  className={`text-[10px] font-bold ${
                    hostile ? 'text-red-400 animate-pulse' : 'text-zinc-300'
                  }`}
                >
                  {val > 0 ? `+${val}` : val}
                </span>
              </div>
            );
          })}
        </div>

        {/* TOP-CENTER: Mission Briefing & Stage Objective Card */}
        {snapshot.activeMission && (
          <div
            data-ui-interactive="true"
            className="pointer-events-auto bg-[#09090b]/88 border-2 border-amber-400/80 px-4 py-2 rounded-lg shadow-[var(--shadow-hud-panel)] text-center max-w-lg"
          >
            <div className="flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-widest text-amber-400">
              <FactionIcon faction={snapshot.activeMission.faction} className="w-3.5 h-3.5" />
              <span>
                {snapshot.activeMission.title} | STAGE {snapshot.activeMission.stageIndex + 1}/
                {snapshot.activeMission.totalStages}
              </span>
              <span className="px-1.5 py-0.2 rounded bg-amber-500/20 border border-amber-400/40 text-amber-200">
                +${snapshot.activeMission.rewardCash.toLocaleString()}
              </span>
            </div>
            <div className="text-xs text-white font-bold mt-1">
              {snapshot.activeMission.objective}
              {snapshot.activeMission.progressText ? ` [${snapshot.activeMission.progressText}]` : ''}
            </div>
            <div className="mt-1 flex items-center justify-center gap-2">
              <button
                onClick={(e) => {
                  e.currentTarget.blur();
                  setBriefingExpanded((v) => !v);
                }}
                className="text-[10px] text-cyan-300 hover:text-cyan-200 underline cursor-pointer"
              >
                {briefingExpanded ? 'HIDE BRIEFING' : 'SHOW BRIEFING'}
              </button>
              <button
                onClick={(e) => {
                  e.currentTarget.blur();
                  onOpenJournal();
                }}
                className="text-[10px] text-zinc-400 hover:text-zinc-200 cursor-pointer"
              >
                [J] ROSTER
              </button>
            </div>
            {briefingExpanded && (
              <div className="mt-1.5 pt-1.5 border-t border-zinc-800 text-[11px] text-zinc-300 leading-snug text-left">
                {snapshot.activeMission.briefing.replace(/[\u2018\u2019]/g, "'").replace(/[\u2013\u2014]/g, '-')}
              </div>
            )}
          </div>
        )}

        {/* TOP-RIGHT: Cash, Multiplier, 5 Hearts + Armor, 6 NYPD Wanted Stars, Weapon Strip + Vehicle */}
        <div className="flex flex-col items-end gap-1.5">
          {/* Cash Readout + Floating Popups + Multiplier */}
          <div className="relative flex items-center gap-2.5 bg-[#09090b]/82 border border-zinc-700/90 px-3.5 py-1.5 rounded-lg shadow-[var(--shadow-hud-panel)]">
            {/* Floating +$ popups */}
            <div className="absolute -bottom-7 right-3 flex flex-col items-end pointer-events-none">
              {snapshot.cashPopups.slice(-2).map((p) => (
                <div key={p.id} className="float-up text-emerald-400 font-black text-sm gta-text-shadow whitespace-nowrap">
                  +${p.amount.toLocaleString()} {p.label ? `(${p.label})` : ''}
                </div>
              ))}
            </div>

            <div className="px-2 py-0.5 rounded bg-amber-500/20 border border-amber-400 text-amber-300 font-black text-sm">
              x{snapshot.multiplier}
            </div>
            <div className="text-2xl font-black tracking-wider text-emerald-400 gta-text-shadow">
              {formattedCash}
            </div>
          </div>

          {/* 5 SVG Hearts (Health) + Blue Armor Shield Bar + Stamina */}
          <div className="flex items-center gap-3 bg-[#09090b]/82 border border-zinc-700/80 px-3 py-1.5 rounded-lg">
            <div className="flex items-center gap-1" title={`Health: ${snapshot.hp}/${snapshot.maxHp}`}>
              {Array.from({ length: 5 }).map((_, i) => (
                <Heart
                  key={i}
                  className={`w-4 h-4 ${
                    i < filledHearts
                      ? 'text-red-500 drop-shadow-[0_0_5px_rgba(239,68,68,0.85)]'
                      : 'text-zinc-700'
                  }`}
                  fill="currentColor"
                />
              ))}
            </div>

            <div className="flex flex-col gap-1 w-24">
              <div className="h-2 w-full bg-zinc-800 rounded overflow-hidden border border-sky-900" title={`Armor: ${snapshot.armor}`}>
                <div
                  className="h-full bg-sky-400 transition-all duration-150"
                  style={{ width: `${Math.min(100, (snapshot.armor / Math.max(1, snapshot.maxArmor)) * 100)}%` }}
                />
              </div>
              <div className="h-1 w-full bg-zinc-800 rounded overflow-hidden" title="Sprint Stamina">
                <div
                  className="h-full bg-amber-300 transition-all duration-100"
                  style={{ width: `${Math.min(100, (snapshot.stamina / Math.max(1, snapshot.maxStamina)) * 100)}%` }}
                />
              </div>
            </div>
            {snapshot.godMode && (
              <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-yellow-400 text-black">GOD</span>
            )}
          </div>

          {/* 6 Flashing NYPD Wanted Stars */}
          <div className="flex items-center gap-1 bg-[#09090b]/82 border border-zinc-700/80 px-2.5 py-1 rounded-lg">
            {Array.from({ length: 6 }).map((_, idx) => {
              const lit = idx < snapshot.wantedStars;
              return (
                <Star
                  key={idx}
                  className={`w-4 h-4 transition-all ${
                    lit
                      ? `text-yellow-400 drop-shadow-[0_0_6px_rgba(250,204,21,0.9)] ${
                          snapshot.wantedFlashing ? 'animate-ping' : 'star-pulse'
                        }`
                      : 'text-zinc-800'
                  }`}
                  fill="currentColor"
                />
              );
            })}
          </div>

          {/* Active Weapon Badge + Vehicle Dashboard */}
          <div className="flex items-center gap-2">
            <div className="bg-[#09090b]/85 border border-purple-500/60 px-3 py-1 rounded text-right">
              <div className="text-[10px] text-purple-300 font-bold tracking-wider flex items-center justify-end gap-1">
                <Crosshair className="w-3 h-3" />
                <span>{snapshot.activeWeaponName} [Q/E]</span>
              </div>
              <div className="text-sm font-black text-white">
                {snapshot.activeWeaponAmmo < 0 ? (
                  <InfinityIcon className="w-4 h-4 inline" />
                ) : (
                  snapshot.activeWeaponAmmo
                )}
              </div>
            </div>

            {snapshot.inVehicle && (
              <div className="bg-[#09090b]/85 border border-cyan-500/60 px-3 py-1 rounded text-right">
                <div className="text-[10px] text-cyan-300 font-bold truncate max-w-[135px]">
                  {snapshot.vehicleName}
                </div>
                <div className="flex items-center justify-end gap-2 text-xs font-black">
                  <span className="text-amber-300">{snapshot.vehicleSpeedKmh} KM/H</span>
                  <span
                    className={
                      snapshot.vehicleHpPct < 30
                        ? 'text-red-400 animate-pulse'
                        : snapshot.vehicleHpPct < 60
                        ? 'text-amber-400'
                        : 'text-emerald-400'
                    }
                  >
                    {snapshot.vehicleHpPct}% HP
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Owned Weapon Slot Strip */}
          <div
            data-ui-interactive="true"
            className="pointer-events-auto flex flex-wrap justify-end gap-1 max-w-[330px]"
          >
            {snapshot.ownedWeapons.map((wId) => {
              const spec = WEAPONS[wId];
              const ammo = snapshot.weaponAmmo[wId] ?? 0;
              const active = snapshot.activeWeapon === wId;
              return (
                <button
                  key={wId}
                  onClick={(e) => {
                    e.currentTarget.blur();
                    onSelectWeapon(wId);
                  }}
                  title={`${spec.name} (${spec.infiniteAmmo ? 'Unlimited' : ammo})`}
                  className={`px-1.5 py-0.5 rounded border text-[9px] font-bold flex items-center gap-1 cursor-pointer transition-colors ${
                    active
                      ? 'bg-cyan-950/90 border-cyan-400 text-cyan-200 shadow-[var(--shadow-neon-cyan)]'
                      : 'bg-zinc-950/85 border-zinc-700/80 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500'
                  }`}
                >
                  {spec.category === 'flame' || spec.category === 'rocket' ? (
                    <Flame className="w-2.5 h-2.5" style={{ color: spec.color }} />
                  ) : (
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: spec.color }} />
                  )}
                  <span>{spec.shortName}</span>
                  <span className="text-zinc-300">
                    {spec.infiniteAmmo ? 'INF' : ammo}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* WASTED / BUSTED STYLED INCIDENT SUMMARY CARD */}
      {snapshot.incidentSummary ? (
        <div
          data-ui-interactive="true"
          className="fixed inset-0 z-20 flex items-center justify-center bg-black/55 pointer-events-auto"
        >
          <div className="w-full max-w-md bg-[#09090b]/95 border-2 border-red-600 rounded-xl p-6 shadow-[0_0_55px_rgba(220,38,38,0.65)] retro-scanlines space-y-4">
            <div className="flex items-center justify-center gap-3">
              {snapshot.incidentSummary.kind === 'busted' ? (
                <Shield className="w-9 h-9 text-red-500" />
              ) : (
                <Skull className="w-9 h-9 text-red-500" />
              )}
              <div className="text-5xl font-black tracking-[0.2em] text-red-500 gta-text-shadow animate-pulse">
                {snapshot.incidentSummary.kind === 'busted' ? 'BUSTED' : 'WASTED'}
              </div>
            </div>

            <div className="text-center text-xs font-bold tracking-wider uppercase text-zinc-300">
              PROCESSED AT {snapshot.incidentSummary.facilityName.toUpperCase()}
            </div>

            <div className="bg-black/75 border border-zinc-800 rounded-lg p-3 text-xs space-y-1.5">
              <div className="flex justify-between">
                <span className="text-zinc-400">
                  {snapshot.incidentSummary.kind === 'busted' ? 'Precinct Bail Fee' : 'Medevac Hospital Bill'}
                </span>
                <span className="text-red-400 font-bold">
                  -${snapshot.incidentSummary.feeDeducted.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Score Multiplier</span>
                <span className="text-amber-300 font-bold">
                  x{snapshot.incidentSummary.multiplierLost} -&gt; x1
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Weapons Confiscated</span>
                <span className="text-zinc-200 font-bold">
                  {snapshot.incidentSummary.weaponsConfiscated.length > 0
                    ? snapshot.incidentSummary.weaponsConfiscated.map((w) => WEAPONS[w].shortName).join(', ')
                    : 'NONE'}
                </span>
              </div>
            </div>

            <button
              disabled={!snapshot.incidentSummary.canSkip}
              onClick={(e) => {
                e.currentTarget.blur();
                onConfirmRespawn();
              }}
              className={`w-full py-2.5 rounded-lg font-black text-xs tracking-wider uppercase border transition-colors ${
                snapshot.incidentSummary.canSkip
                  ? 'bg-red-600 hover:bg-red-500 border-red-400 text-white cursor-pointer'
                  : 'bg-zinc-900 border-zinc-800 text-zinc-500 cursor-wait'
              }`}
            >
              [SPACE / CLICK] CONTINUE ({snapshot.incidentSummary.countdownSec}s)
            </button>
          </div>
        </div>
      ) : (
        snapshot.statusBanner && (
          <div className="fixed inset-0 flex items-center justify-center pointer-events-none">
            <div className="px-10 py-5 rounded-xl bg-black/85 border-4 border-red-600 shadow-[0_0_50px_rgba(220,38,38,0.75)]">
              <div className="text-6xl font-black tracking-[0.22em] text-red-500 gta-text-shadow animate-pulse">
                {snapshot.statusBanner}
              </div>
            </div>
          </div>
        )
      )}

      {/* BOTTOM BAR */}
      <div className="flex items-end justify-between gap-4">
        {/* BOTTOM-LEFT: Updated M1/M4 Controls Legend & Quick Toggles */}
        <div
          className="bg-[#09090b]/82 border border-zinc-700/80 rounded-lg px-3 py-2 text-[10px] text-zinc-300 space-y-0.5 pointer-events-auto shadow-[var(--shadow-hud-panel)]"
          data-ui-interactive="true"
        >
          <div>
            <span className="text-amber-300 font-bold">WASD</span> Move/Drive |{' '}
            <span className="text-amber-300 font-bold">SPACE</span> Jump (Foot) / Drift (Car)
          </div>
          <div>
            <span className="text-amber-300 font-bold">LMB/Ctrl/X</span> Fire |{' '}
            <span className="text-amber-300 font-bold">SHIFT</span> Sprint |{' '}
            <span className="text-amber-300 font-bold">F</span> Car/Phone |{' '}
            <span className="text-amber-300 font-bold">CAPS</span> Job
          </div>
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <button
              onClick={(e) => {
                e.currentTarget.blur();
                onOpenMap();
              }}
              className="px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-cyan-300 font-bold cursor-pointer"
            >
              [TAB] MAP
            </button>
            <button
              onClick={(e) => {
                e.currentTarget.blur();
                onOpenJournal();
              }}
              className="px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-emerald-300 font-bold cursor-pointer inline-flex items-center gap-1"
            >
              <BookOpen className="w-3 h-3" />
              <span>[J] MISSIONS</span>
            </button>
            <button
              onClick={(e) => {
                e.currentTarget.blur();
                onCycleLighting();
              }}
              className="px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-amber-200 font-bold cursor-pointer inline-flex items-center gap-1"
            >
              <Sun className="w-3 h-3" />
              <span>[T] {lightingLabel}</span>
            </button>
            <button
              onClick={(e) => {
                e.currentTarget.blur();
                onToggleDebug();
              }}
              className="px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-amber-300 font-bold cursor-pointer"
            >
              [~] DEBUG
            </button>
            <button
              onClick={(e) => {
                e.currentTarget.blur();
                onCycleRadio();
              }}
              className="px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-purple-300 font-bold cursor-pointer"
            >
              [R] RADIO
            </button>
            <button
              onClick={(e) => {
                e.currentTarget.blur();
                onOpenPause();
              }}
              className="px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-bold cursor-pointer"
            >
              [ESC] MENU
            </button>
          </div>
        </div>

        {/* BOTTOM-CENTER: Action Prompt Pill + Rotating GPS Arrow + Retro LCD Pager Ticker */}
        <div className="flex flex-col items-center gap-1.5">
          {snapshot.nearbyPrompt && (
            <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-amber-950/90 border border-amber-400 text-amber-200 text-xs font-black tracking-wide shadow-[0_0_14px_rgba(250,204,21,0.35)]">
              <Phone className="w-3.5 h-3.5 text-amber-300 animate-pulse" />
              <span>{snapshot.nearbyPrompt.replace(/[\u2018\u2019]/g, "'").replace(/[\u2013\u2014]/g, '-')}</span>
            </div>
          )}
          {snapshot.gpsAngleRad !== null && (
            <div className="flex items-center gap-2.5 bg-black/80 border border-emerald-500/60 px-3 py-1 rounded-full">
              <div
                className="w-6 h-6 flex items-center justify-center text-emerald-400 transition-transform duration-75"
                style={{ transform: `rotate(${(snapshot.gpsAngleRad * 180) / Math.PI}deg)` }}
              >
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor" aria-hidden="true">
                  <path d="M3 12l17-8-4.5 8 4.5 8z" transform="rotate(180 12 12)" />
                </svg>
              </div>
              <div className="text-[11px] font-bold text-emerald-300 tracking-wide">
                {snapshot.gpsLabel} <span className="text-zinc-400">({snapshot.gpsDistanceM}m)</span>
              </div>
            </div>
          )}
          <PagerTicker snapshot={snapshot} />
        </div>

        {/* BOTTOM-RIGHT: Live 2D Radar Minimap */}
        <div className="pointer-events-auto" data-ui-interactive="true">
          <Minimap map={map} snapshot={snapshot} />
        </div>
      </div>
    </div>
  );
};
