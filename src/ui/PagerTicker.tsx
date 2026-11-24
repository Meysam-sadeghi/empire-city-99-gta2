import React from 'react';
import { Clock, Radio, Shield, Skull } from 'lucide-react';
import type { HudSnapshot } from '../types/state.types';

interface PagerTickerProps {
  snapshot: HudSnapshot;
}

export const PagerTicker: React.FC<PagerTickerProps> = ({ snapshot }) => {
  const latestMsg = snapshot.pagerMessages[snapshot.pagerMessages.length - 1] ?? null;

  const rawText =
    latestMsg?.text ??
    (snapshot.activeKillFrenzy
      ? `KILL FRENZY [${snapshot.activeKillFrenzy.title.toUpperCase()}]: ${snapshot.activeKillFrenzy.progress}/${snapshot.activeKillFrenzy.target} - ${snapshot.activeKillFrenzy.timeLeft}s LEFT`
      : snapshot.activeMission
      ? `${snapshot.activeMission.title.toUpperCase()}: ${snapshot.activeMission.objective}${
          snapshot.activeMission.progressText ? ` (${snapshot.activeMission.progressText})` : ''
        }`
      : snapshot.activeSideJob
      ? `${snapshot.activeSideJob.description.toUpperCase()} - ${snapshot.activeSideJob.timeLeft}s`
      : snapshot.nearbyPrompt
      ? snapshot.nearbyPrompt
      : `${snapshot.districtName.toUpperCase()} | ${snapshot.districtSubtitle}`);

  const text = rawText.replace(/[\u2018\u2019]/g, "'").replace(/[\u2013\u2014]/g, '-').replace(/\u2022/g, '|');

  const toneClass =
    latestMsg?.tone === 'red' || snapshot.activeKillFrenzy
      ? 'text-rose-400 border-rose-500/60'
      : latestMsg?.tone === 'amber'
      ? 'text-amber-300 border-amber-500/60 amber-glow'
      : latestMsg?.tone === 'cyan'
      ? 'text-cyan-300 border-cyan-500/60'
      : 'text-emerald-400 border-emerald-500/60 lcd-glow';

  return (
    <div className="flex flex-col items-center gap-1 w-[min(620px,62vw)]">
      {/* Radio Station & Mission Timer Mini-Bar */}
      <div className="flex items-center gap-3 text-[11px] font-bold tracking-wider uppercase">
        {snapshot.inVehicle && (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-black/80 border border-cyan-500/50 text-cyan-300">
            <Radio className="w-3.5 h-3.5" />
            <span>{snapshot.radioLabel} [R]</span>
          </span>
        )}
        {snapshot.activeMission?.timerSec !== null && snapshot.activeMission?.timerSec !== undefined && (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-red-950/90 border border-red-500 text-red-300 animate-pulse">
            <Clock className="w-3.5 h-3.5" />
            <span>{formatTime(snapshot.activeMission.timerSec)}</span>
          </span>
        )}
        {snapshot.activeKillFrenzy && (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-rose-950/90 border border-rose-400 text-yellow-300 animate-pulse">
            <Skull className="w-3.5 h-3.5" />
            <span>{snapshot.activeKillFrenzy.progress}/{snapshot.activeKillFrenzy.target} | {snapshot.activeKillFrenzy.timeLeft}s</span>
          </span>
        )}
        {snapshot.activeSideJob && (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-sky-950/90 border border-sky-400 text-sky-200">
            <Shield className="w-3.5 h-3.5" />
            <span>{snapshot.activeSideJob.type.toUpperCase()} L{snapshot.activeSideJob.level} | {snapshot.activeSideJob.timeLeft}s</span>
          </span>
        )}
      </div>

      {/* Classic 1999 LCD Pager Display (unclipped wrapping for full briefings) */}
      <div
        className={`relative w-full px-3.5 py-2 rounded bg-[#07110b]/92 border-2 shadow-[0_0_20px_rgba(0,0,0,0.85)] retro-scanlines ${toneClass}`}
      >
        <div className="flex items-start gap-2 text-xs font-mono font-bold tracking-wide leading-snug">
          <span className="shrink-0 mt-0.5 px-1.5 py-0.5 text-[9px] rounded bg-emerald-500/20 border border-emerald-400/50 text-emerald-300">
            PAGER 99
          </span>
          <span className="whitespace-normal break-words">{text}</span>
        </div>
      </div>
    </div>
  );
};

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
