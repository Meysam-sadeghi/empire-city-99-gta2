import React, { useEffect, useRef } from 'react';
import type { HudSnapshot } from '../types/state.types';
import type { WorldMapData } from '../types/world.types';
import { DISTRICT_LIST } from '../data/districts.data';
import { TILE_ENUM } from '../data/mapGenerator';

interface MinimapProps {
  map: WorldMapData;
  snapshot: HudSnapshot;
  fullScreen?: boolean;
}

export const Minimap: React.FC<MinimapProps> = ({ map, snapshot, fullScreen = false }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Build static 512x512 (4m/px) NYC base bitmap directly from map.chunks
  useEffect(() => {
    const baseRes = map.chunksPerSide * map.tilesPerChunk; // 32 * 16 = 512
    const off = document.createElement('canvas');
    off.width = baseRes;
    off.height = baseRes;
    const ctx = off.getContext('2d')!;
    const img = ctx.createImageData(baseRes, baseRes);
    const data = img.data;

    for (let cy = 0; cy < map.chunksPerSide; cy++) {
      for (let cx = 0; cx < map.chunksPerSide; cx++) {
        const chunk = map.chunks.get(`${cx},${cy}`);
        if (!chunk) continue;
        for (let ty = 0; ty < map.tilesPerChunk; ty++) {
          for (let tx = 0; tx < map.tilesPerChunk; tx++) {
            const tileIdx = ty * map.tilesPerChunk + tx;
            const t = chunk.tiles[tileIdx];
            const ov = chunk.overpassTiles[tileIdx];
            let r = 38;
            let g = 42;
            let b = 48;

            if (ov > 0) {
              r = ov === 2 ? 128 : 148;
              g = ov === 2 ? 142 : 163;
              b = ov === 2 ? 162 : 184;
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
              if (chunk.district === 'financial_district') {
                r = 92;
                g = 44;
                b = 44;
              } else if (chunk.district === 'midtown') {
                r = 32;
                g = 74;
                b = 96;
              } else if (chunk.district === 'central_park') {
                r = 82;
                g = 88;
                b = 78;
              } else if (chunk.district === 'brooklyn_docks') {
                r = 96;
                g = 68;
                b = 34;
              } else {
                r = 76;
                g = 68;
                b = 56;
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

            const mx = cx * map.tilesPerChunk + tx;
            const my = cy * map.tilesPerChunk + ty;
            const pIdx = (my * baseRes + mx) * 4;
            data[pIdx] = r;
            data[pIdx + 1] = g;
            data[pIdx + 2] = b;
            data[pIdx + 3] = 255;
          }
        }
      }
    }

    ctx.putImageData(img, 0, 0);

    // Overlay translucent district gang turf tints at 512x512 scale
    const scale = baseRes / map.worldSize;
    for (const d of DISTRICT_LIST) {
      ctx.fillStyle = d.minimapTint;
      ctx.fillRect(
        d.bounds.x * scale,
        d.bounds.y * scale,
        d.bounds.w * scale,
        d.bounds.h * scale
      );
    }

    baseCanvasRef.current = off;
  }, [map]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const base = baseCanvasRef.current;
    if (!canvas || !base) return;

    const ctx = canvas.getContext('2d')!;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.009);

    if (fullScreen) {
      // Render entire 2048m x 2048m NYC map
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(base, 0, 0, w, h);

      const s = w / map.worldSize;

      // District borders & labels
      ctx.font = 'bold 13px monospace';
      ctx.textAlign = 'center';
      for (const d of DISTRICT_LIST) {
        ctx.strokeStyle = 'rgba(255,255,255,0.22)';
        ctx.lineWidth = 1;
        ctx.strokeRect(d.bounds.x * s, d.bounds.y * s, d.bounds.w * s, d.bounds.h * s);

        const cx = (d.bounds.x + d.bounds.w * 0.5) * s;
        const cy = (d.bounds.y + d.bounds.h * 0.5) * s;
        ctx.fillStyle = 'rgba(0,0,0,0.72)';
        ctx.fillRect(cx - 76, cy - 11, 152, 22);
        ctx.fillStyle = '#f8fafc';
        ctx.fillText(d.shortName, cx, cy + 4);
      }

      // Blips across entire city
      for (const b of snapshot.minimapBlips) {
        const bx = b.x * s;
        const by = b.y * s;
        drawBlip(ctx, b.type, bx, by, b.color, b.pulse ? pulse : 0, b.heading, true);
      }

      // Player marker
      drawPlayerArrow(ctx, snapshot.playerX * s, snapshot.playerY * s, snapshot.playerHeading, 9);
    } else {
      // Zoomed radar centered on player (~190m radius view, 512x512 source = 4m/px)
      const viewRadiusM = 190;
      const scale = w / (viewRadiusM * 2);
      const baseRes = base.width;
      const baseScale = baseRes / map.worldSize;

      const rawSrcX = (snapshot.playerX - viewRadiusM) * baseScale;
      const rawSrcY = (snapshot.playerY - viewRadiusM) * baseScale;
      const rawSrcSize = viewRadiusM * 2 * baseScale;

      ctx.fillStyle = '#09192b';
      ctx.fillRect(0, 0, w, h);
      ctx.imageSmoothingEnabled = false;

      // Clamp source sub-rect to [0, baseRes] cleanly for edge-of-map rendering
      const sx0 = Math.max(0, rawSrcX);
      const sy0 = Math.max(0, rawSrcY);
      const sx1 = Math.min(baseRes, rawSrcX + rawSrcSize);
      const sy1 = Math.min(baseRes, rawSrcY + rawSrcSize);
      if (sx1 > sx0 && sy1 > sy0) {
        const dx = ((sx0 - rawSrcX) / rawSrcSize) * w;
        const dy = ((sy0 - rawSrcY) / rawSrcSize) * h;
        const dw = ((sx1 - sx0) / rawSrcSize) * w;
        const dh = ((sy1 - sy0) / rawSrcSize) * h;
        ctx.drawImage(base, sx0, sy0, sx1 - sx0, sy1 - sy0, dx, dy, dw, dh);
      }

      // Draw radar scan ring
      ctx.strokeStyle = 'rgba(74, 222, 128, 0.18)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(w * 0.5, h * 0.5, w * 0.34, 0, Math.PI * 2);
      ctx.stroke();

      // Blips relative to player
      for (const b of snapshot.minimapBlips) {
        let rx = (b.x - snapshot.playerX) * scale;
        let ry = (b.y - snapshot.playerY) * scale;
        const maxR = w * 0.45;
        const dist = Math.hypot(rx, ry);

        if (dist > maxR) {
          if (b.type === 'objective' || b.type === 'payphone') {
            rx = (rx / dist) * maxR;
            ry = (ry / dist) * maxR;
          } else {
            continue;
          }
        }

        drawBlip(ctx, b.type, w * 0.5 + rx, h * 0.5 + ry, b.color, b.pulse ? pulse : 0, b.heading, false);
      }

      // Center player directional arrow
      drawPlayerArrow(ctx, w * 0.5, h * 0.5, snapshot.playerHeading, 7);

      // North compass badge
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillRect(w * 0.5 - 9, 3, 18, 14);
      ctx.fillStyle = '#facc15';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('N', w * 0.5, 13);
    }
  }, [map, snapshot, fullScreen]);

  if (fullScreen) {
    return (
      <canvas
        ref={canvasRef}
        width={640}
        height={640}
        className="w-[min(78vh,640px)] h-[min(78vh,640px)] border-2 border-cyan-400/70 shadow-[0_0_30px_rgba(6,182,212,0.35)] bg-[#06121f]"
      />
    );
  }

  return (
    <div className="relative rounded-md overflow-hidden border-2 border-zinc-500/90 shadow-[0_0_18px_rgba(0,0,0,0.85)] bg-[#06121f]">
      <canvas ref={canvasRef} width={176} height={176} className="block w-[176px] h-[176px]" />
      <div className="absolute bottom-0 inset-x-0 bg-black/75 px-1.5 py-0.5 flex items-center justify-between text-[9px] text-zinc-300 font-mono">
        <span className="truncate max-w-[116px] text-amber-300">{snapshot.districtName.split('&')[0].trim()}</span>
        <span>{snapshot.telemetry.playerX},{snapshot.telemetry.playerY}</span>
      </div>
    </div>
  );
};

function drawPlayerArrow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  heading: number,
  size: number
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(size, 0);
  ctx.lineTo(-size * 0.75, -size * 0.65);
  ctx.lineTo(-size * 0.35, 0);
  ctx.lineTo(-size * 0.75, size * 0.65);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawBlip(
  ctx: CanvasRenderingContext2D,
  type: string,
  x: number,
  y: number,
  color: string,
  pulse: number,
  heading: number | undefined,
  large: boolean
): void {
  const baseR = large ? 5.5 : 4;

  // Police vision cone on radar
  if (type === 'cop' && heading !== undefined && !large) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(heading);
    ctx.fillStyle = 'rgba(59, 130, 246, 0.28)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 20, -0.45, 0.45);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1.4;

  if (type === 'objective' || type === 'boss') {
    const r = baseR + 1.5 + pulse * 3;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, baseR, 0, Math.PI * 2);
    ctx.fill();
  } else if (type === 'payphone') {
    const r = baseR + pulse * 2;
    ctx.fillRect(x - r * 0.8, y - r * 0.8, r * 1.6, r * 1.6);
    ctx.strokeRect(x - r * 0.8, y - r * 0.8, r * 1.6, r * 1.6);
  } else if (type === 'pay_n_spray') {
    ctx.fillStyle = '#22c55e';
    ctx.fillRect(x - 4, y - 4, 8, 8);
    ctx.fillStyle = '#000';
    ctx.font = 'bold 8px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('P', x, y + 3);
  } else if (type === 'car_crusher') {
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(x - 4, y - 4, 8, 8);
    ctx.fillStyle = '#000';
    ctx.font = 'bold 8px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('C', x, y + 3);
  } else if (type === 'chapel') {
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(x - 4, y - 4, 8, 8);
    ctx.fillStyle = '#000';
    ctx.font = 'bold 8px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('+', x, y + 3);
  } else if (type === 'kill_frenzy') {
    ctx.fillStyle = '#f43f5e';
    ctx.beginPath();
    ctx.arc(x, y, baseR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(x, y, baseR * 0.85, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  ctx.restore();
}
