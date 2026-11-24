import type { WorldMapData } from '../types/world.types';
import { CHUNK_SIZE, CHUNKS_PER_SIDE } from '../data/districts.data';
import { PhysicsWorld } from './PhysicsWorld';

export class ChunkManager {
  private static readonly MAX_PHYSICS_CHUNKS = 49;
  private map: WorldMapData;
  private physics: PhysicsWorld;
  private activeSetA = new Set<string>();
  private activeSetB = new Set<string>();
  public activeChunkKeys: Set<string> = this.activeSetA;
  private mountedPhysicsLru = new Map<string, number>();
  private lastCenterCx = -999;
  private lastCenterCy = -999;

  constructor(map: WorldMapData, physics: PhysicsWorld) {
    this.map = map;
    this.physics = physics;
  }

  /**
   * Streams the 5x5 chunk window (320m x 320m) centered on the player.
   * Retains a 49-chunk (7x7) physics LRU to avoid Rapier collider churn when weaving across seams.
   */
  public update(playerX: number, playerY: number): boolean {
    const cx = Math.max(0, Math.min(CHUNKS_PER_SIDE - 1, Math.floor(playerX / CHUNK_SIZE)));
    const cy = Math.max(0, Math.min(CHUNKS_PER_SIDE - 1, Math.floor(playerY / CHUNK_SIZE)));

    if (cx === this.lastCenterCx && cy === this.lastCenterCy) {
      return false;
    }

    this.lastCenterCx = cx;
    this.lastCenterCy = cy;

    const nextActive = this.activeChunkKeys === this.activeSetA ? this.activeSetB : this.activeSetA;
    nextActive.clear();

    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx >= 0 && nx < CHUNKS_PER_SIDE && ny >= 0 && ny < CHUNKS_PER_SIDE) {
          const key = `${nx},${ny}`;
          nextActive.add(key);

          if (this.mountedPhysicsLru.has(key)) {
            this.mountedPhysicsLru.delete(key);
            this.mountedPhysicsLru.set(key, 1);
          } else {
            const chunk = this.map.chunks.get(key);
            if (chunk) {
              this.physics.mountChunk(chunk);
              this.mountedPhysicsLru.set(key, 1);
            }
          }
        }
      }
    }

    // Unmount oldest non-active chunks only when exceeding 49-chunk LRU capacity
    if (this.mountedPhysicsLru.size > ChunkManager.MAX_PHYSICS_CHUNKS) {
      for (const oldKey of this.mountedPhysicsLru.keys()) {
        if (this.mountedPhysicsLru.size <= ChunkManager.MAX_PHYSICS_CHUNKS) break;
        if (nextActive.has(oldKey)) continue;
        this.mountedPhysicsLru.delete(oldKey);
        this.physics.unmountChunk(oldKey);
      }
    }

    this.activeChunkKeys = nextActive;
    return true;
  }

  public isWithinActiveWindow(x: number, y: number): boolean {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cy = Math.floor(y / CHUNK_SIZE);
    return this.activeChunkKeys.has(`${cx},${cy}`);
  }

  public getActiveCount(): number {
    return this.activeChunkKeys.size;
  }

  public getTotalCount(): number {
    return this.map.chunks.size;
  }
}
