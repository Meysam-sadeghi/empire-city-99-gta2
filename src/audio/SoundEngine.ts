import type { WeaponId } from '../types/entity.types';
import type { RadioStationId } from '../types/state.types';

export const RADIO_LABELS: Record<RadioStationId, string> = {
  off: 'RADIO OFF',
  head_radio: 'HEAD RADIO 98.7',
  funk_fm: 'FUNK FM 101.5',
  neon_synth_99: 'NEON SYNTH 99',
};

export const RADIO_ORDER: RadioStationId[] = ['neon_synth_99', 'head_radio', 'funk_fm', 'off'];

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private radioGain: GainNode | null = null;

  // Continuous engine synth
  private engineOsc1: OscillatorNode | null = null;
  private engineOsc2: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineGain: GainNode | null = null;

  // Continuous tire drift screech
  private driftNoise: AudioBufferSourceNode | null = null;
  private driftFilter: BiquadFilterNode | null = null;
  private driftGain: GainNode | null = null;

  // Continuous siren
  private sirenOsc: OscillatorNode | null = null;
  private sirenGain: GainNode | null = null;
  private sirenPhase = 0;

  // Noise buffer reused for explosions, guns, screech
  private noiseBuffer: AudioBuffer | null = null;

  private muted = false;
  private initialized = false;
  private radioStation: RadioStationId = 'neon_synth_99';
  private radioStep = 0;
  private radioAccum = 0;
  private payphoneRingTimer = 0;

  public unlock(): void {
    if (this.initialized) {
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      return;
    }

    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    try {
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : 0.45;
      this.masterGain.connect(this.ctx.destination);

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = 0.85;
      this.sfxGain.connect(this.masterGain);

      this.radioGain = this.ctx.createGain();
      this.radioGain.gain.value = 0.28;
      this.radioGain.connect(this.masterGain);

      // Build 2-second white noise buffer
      const sr = this.ctx.sampleRate;
      this.noiseBuffer = this.ctx.createBuffer(1, sr * 2, sr);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        data[i] = Math.random() * 2 - 1;
      }

      // Continuous engine oscillators
      this.engineOsc1 = this.ctx.createOscillator();
      this.engineOsc1.type = 'sawtooth';
      this.engineOsc1.frequency.value = 55;

      this.engineOsc2 = this.ctx.createOscillator();
      this.engineOsc2.type = 'triangle';
      this.engineOsc2.frequency.value = 110;

      this.engineFilter = this.ctx.createBiquadFilter();
      this.engineFilter.type = 'lowpass';
      this.engineFilter.frequency.value = 280;

      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0;

      this.engineOsc1.connect(this.engineFilter);
      this.engineOsc2.connect(this.engineFilter);
      this.engineFilter.connect(this.engineGain);
      this.engineGain.connect(this.sfxGain);

      this.engineOsc1.start();
      this.engineOsc2.start();

      // Continuous drift screech loop
      this.driftNoise = this.ctx.createBufferSource();
      this.driftNoise.buffer = this.noiseBuffer;
      this.driftNoise.loop = true;

      this.driftFilter = this.ctx.createBiquadFilter();
      this.driftFilter.type = 'bandpass';
      this.driftFilter.frequency.value = 1850;
      this.driftFilter.Q.value = 7;

      this.driftGain = this.ctx.createGain();
      this.driftGain.gain.value = 0;

      this.driftNoise.connect(this.driftFilter);
      this.driftFilter.connect(this.driftGain);
      this.driftGain.connect(this.sfxGain);
      this.driftNoise.start();

      // Continuous police siren oscillator
      this.sirenOsc = this.ctx.createOscillator();
      this.sirenOsc.type = 'sawtooth';
      this.sirenOsc.frequency.value = 660;

      const sirenFilter = this.ctx.createBiquadFilter();
      sirenFilter.type = 'lowpass';
      sirenFilter.frequency.value = 1600;

      this.sirenGain = this.ctx.createGain();
      this.sirenGain.gain.value = 0;

      this.sirenOsc.connect(sirenFilter);
      sirenFilter.connect(this.sirenGain);
      this.sirenGain.connect(this.sfxGain);
      this.sirenOsc.start();

      this.initialized = true;
    } catch {
      // AudioContext unavailable in headless environment
    }
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : 0.45, this.ctx.currentTime, 0.03);
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public setRadioStation(station: RadioStationId): void {
    this.radioStation = station;
    this.radioStep = 0;
  }

  public getRadioStation(): RadioStationId {
    return this.radioStation;
  }

  public cycleRadioStation(): RadioStationId {
    const idx = RADIO_ORDER.indexOf(this.radioStation);
    const next = RADIO_ORDER[(idx + 1) % RADIO_ORDER.length];
    this.setRadioStation(next);
    this.playUiBeep(660, 0.07);
    return next;
  }

  public updateContinuous(
    dt: number,
    inVehicle: boolean,
    speedNorm: number,
    drifting: boolean,
    sirenIntensity: number,
    nearRingingPayphone: boolean,
    radioActive: boolean
  ): void {
    if (!this.initialized || !this.ctx) return;
    const now = this.ctx.currentTime;

    // 1. Engine RPM with simulated 4-speed gear shift curve
    if (this.engineOsc1 && this.engineOsc2 && this.engineFilter && this.engineGain) {
      if (inVehicle) {
        const clamped = Math.max(0, Math.min(1, speedNorm));
        const gearSpeed = (clamped * 3.6) % 1;
        const gearBase = 48 + Math.floor(clamped * 3.6) * 14;
        const rpmFreq = gearBase + gearSpeed * 68;
        this.engineOsc1.frequency.setTargetAtTime(rpmFreq, now, 0.05);
        this.engineOsc2.frequency.setTargetAtTime(rpmFreq * 2.02, now, 0.05);
        this.engineFilter.frequency.setTargetAtTime(240 + clamped * 640, now, 0.06);
        this.engineGain.gain.setTargetAtTime(0.11 + clamped * 0.09, now, 0.05);
      } else {
        this.engineGain.gain.setTargetAtTime(0, now, 0.06);
      }
    }

    // 2. Tire drift screech
    if (this.driftGain && this.driftFilter) {
      const screech = inVehicle && drifting && speedNorm > 0.18 ? Math.min(0.16, speedNorm * 0.22) : 0;
      this.driftGain.gain.setTargetAtTime(screech, now, 0.04);
      this.driftFilter.frequency.setTargetAtTime(1600 + speedNorm * 700, now, 0.05);
    }

    // 3. Police / FDNY Siren
    if (this.sirenOsc && this.sirenGain) {
      if (sirenIntensity > 0.02) {
        this.sirenPhase += dt * 2.8;
        const wail = Math.sin(this.sirenPhase) * 0.5 + 0.5;
        this.sirenOsc.frequency.setTargetAtTime(580 + wail * 520, now, 0.03);
        this.sirenGain.gain.setTargetAtTime(Math.min(0.12, sirenIntensity * 0.12), now, 0.06);
      } else {
        this.sirenGain.gain.setTargetAtTime(0, now, 0.08);
      }
    }

    // 4. Payphone ring cadence
    if (nearRingingPayphone) {
      this.payphoneRingTimer -= dt;
      if (this.payphoneRingTimer <= 0) {
        this.playPayphoneRing();
        this.payphoneRingTimer = 2.4;
      }
    } else {
      this.payphoneRingTimer = 0.2;
    }

    // 5. Procedural Radio Sequencer (plays inside vehicles or softly if selected)
    if (radioActive && this.radioStation !== 'off' && !this.muted) {
      const bpm =
        this.radioStation === 'neon_synth_99'
          ? 122
          : this.radioStation === 'funk_fm'
          ? 108
          : 128;
      const stepSec = 60 / bpm / 2; // 8th notes
      this.radioAccum += dt;
      if (this.radioAccum >= stepSec) {
        this.radioAccum -= stepSec;
        this.triggerRadioStep(this.radioStep++);
      }
    }
  }

  private triggerRadioStep(step: number): void {
    if (!this.ctx || !this.radioGain) return;
    const now = this.ctx.currentTime;
    const s = step % 16;

    if (this.radioStation === 'neon_synth_99') {
      // Dark 1999 cyberpunk synthwave arpeggio + punchy kick
      const bassNotes = [55, 55, 55, 55, 65.41, 65.41, 73.42, 73.42, 49, 49, 49, 49, 61.74, 61.74, 55, 55];
      const arpNotes = [220, 261.63, 329.63, 440, 261.63, 329.63, 392, 523.25];
      this.playSynthNote(bassNotes[s], 0.19, 'sawtooth', 0.16, 420);
      this.playSynthNote(arpNotes[s % arpNotes.length], 0.14, 'square', 0.07, 1400);
      if (s % 4 === 0) this.playKick(now, 0.2);
      if (s % 4 === 2) this.playSnare(now, 0.08);
    } else if (this.radioStation === 'funk_fm') {
      // Groovy NYC funk bassline + syncopated chords
      const bass = [73.42, 0, 73.42, 87.31, 98, 0, 87.31, 73.42, 65.41, 0, 73.42, 87.31, 110, 0, 98, 87.31];
      if (bass[s] > 0) this.playSynthNote(bass[s], 0.16, 'triangle', 0.24, 900);
      if (s % 4 === 1 || s === 11) {
        this.playSynthNote(293.66, 0.12, 'sine', 0.09, 1800);
        this.playSynthNote(349.23, 0.12, 'sine', 0.08, 1800);
      }
      if (s % 4 === 0 || s === 10) this.playKick(now, 0.18);
      if (s % 4 === 2) this.playSnare(now, 0.09);
    } else if (this.radioStation === 'head_radio') {
      // Upbeat retro GTA 2 Head Radio pop-rock synth
      const lead = [329.63, 392, 440, 392, 329.63, 293.66, 329.63, 0, 261.63, 329.63, 392, 440, 493.88, 440, 392, 329.63];
      const bass = [130.81, 130.81, 146.83, 146.83, 164.81, 164.81, 110, 110];
      if (lead[s] > 0) this.playSynthNote(lead[s], 0.15, 'triangle', 0.11, 1900);
      this.playSynthNote(bass[Math.floor(s / 2)], 0.2, 'sawtooth', 0.12, 520);
      if (s % 4 === 0) this.playKick(now, 0.16);
      if (s % 4 === 2) this.playSnare(now, 0.07);
    }
  }

  private canPlaySfx(needsNoise = false): boolean {
    return Boolean(
      this.initialized &&
      this.ctx &&
      this.ctx.state !== 'closed' &&
      this.sfxGain &&
      !this.muted &&
      (!needsNoise || this.noiseBuffer)
    );
  }

  private playSynthNote(
    freq: number,
    dur: number,
    type: OscillatorType,
    vol: number,
    cutoff: number
  ): void {
    if (!this.ctx || !this.radioGain || this.ctx.state === 'closed') return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.radioGain);
    osc.onended = () => {
      osc.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
    osc.start(now);
    osc.stop(now + dur + 0.01);
  }

  private playKick(now: number, vol: number): void {
    if (!this.ctx || !this.radioGain || this.ctx.state === 'closed') return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(38, now + 0.11);
    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    osc.connect(gain);
    gain.connect(this.radioGain);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
    osc.start(now);
    osc.stop(now + 0.15);
  }

  private playSnare(now: number, vol: number): void {
    if (!this.ctx || !this.radioGain || !this.noiseBuffer || this.ctx.state === 'closed') return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 1100;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.radioGain);
    src.onended = () => {
      src.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
    src.start(now);
    src.stop(now + 0.11);
  }

  public playWeaponSound(weaponId: WeaponId, volumeScale = 1): void {
    if (!this.canPlaySfx(true)) return;
    const v = Math.max(0.08, Math.min(1, volumeScale));

    if (weaponId === 'fists') {
      this.playTone(130, 55, 0.09, 'sine', 0.28 * v);
      return;
    }

    if (weaponId === 'flamethrower') {
      this.playNoiseBurst(0.14, 520, 'bandpass', 0.18 * v);
      return;
    }

    if (weaponId === 'molotov' || weaponId === 'grenade') {
      this.playTone(320, 140, 0.14, 'triangle', 0.15 * v);
      return;
    }

    if (weaponId === 'rpg') {
      this.playNoiseBurst(0.38, 380, 'lowpass', 0.35 * v);
      this.playTone(180, 75, 0.32, 'sawtooth', 0.25 * v);
      return;
    }

    if (weaponId === 'shotgun') {
      this.playNoiseBurst(0.24, 900, 'lowpass', 0.45 * v);
      this.playTone(145, 36, 0.2, 'sawtooth', 0.35 * v);
      return;
    }

    if (weaponId === 'm4') {
      this.playNoiseBurst(0.09, 1800, 'bandpass', 0.32 * v);
      this.playTone(210, 65, 0.07, 'square', 0.18 * v);
      return;
    }

    if (weaponId === 'dual_uzis') {
      this.playNoiseBurst(0.06, 2400, 'bandpass', 0.22 * v);
      this.playTone(260, 100, 0.05, 'square', 0.12 * v);
      return;
    }

    // Pistol default
    this.playNoiseBurst(0.1, 1500, 'bandpass', 0.28 * v);
    this.playTone(190, 58, 0.08, 'triangle', 0.2 * v);
  }

  public playExplosion(volumeScale = 1): void {
    if (!this.canPlaySfx(true)) return;
    const v = Math.max(0.1, Math.min(1, volumeScale));
    this.playNoiseBurst(0.28, 950, 'bandpass', 0.42 * v, 0);
    this.playTone(125, 22, 0.72, 'sine', 0.55 * v, 0);
    this.playNoiseBurst(0.85, 360, 'lowpass', 0.55 * v, 0.04);
    this.playNoiseBurst(0.45, 240, 'lowpass', 0.32 * v, 0.14);
  }

  public playCollision(severity: number): void {
    if (!this.canPlaySfx(true)) return;
    const s = Math.max(0.1, Math.min(1, severity));
    const v = 0.12 + s * 0.30;
    this.playNoiseBurst(0.13, 680 + s * 320, 'bandpass', v, 0);
    this.playTone(115, 38, 0.14, 'triangle', v * 0.95, 0);
    if (s > 0.55) {
      this.playNoiseBurst(0.09, 1450, 'highpass', v * 0.45, 0.035);
    }
  }

  public playJump(): void {
    if (!this.canPlaySfx(true)) return;
    this.playTone(170, 420, 0.11, 'triangle', 0.16, 0);
    this.playNoiseBurst(0.08, 1200, 'bandpass', 0.08, 0);
  }

  public playLand(): void {
    if (!this.canPlaySfx(true)) return;
    this.playTone(125, 48, 0.09, 'sine', 0.22, 0);
    this.playNoiseBurst(0.06, 480, 'lowpass', 0.12, 0);
  }

  public playPedSplat(volumeScale = 1): void {
    if (!this.canPlaySfx(true)) return;
    const v = Math.max(0.25, Math.min(1, volumeScale));
    this.playTone(145, 38, 0.13, 'sawtooth', 0.26 * v, 0);
    this.playNoiseBurst(0.11, 720, 'bandpass', 0.24 * v, 0);
    this.playNoiseBurst(0.07, 1900, 'highpass', 0.12 * v, 0.02);
  }

  public playDoorSlam(entering = true): void {
    if (!this.canPlaySfx(true)) return;
    if (entering) {
      this.playTone(420, 260, 0.035, 'square', 0.11, 0);
      this.playTone(135, 42, 0.11, 'triangle', 0.24, 0.055);
      this.playNoiseBurst(0.06, 520, 'lowpass', 0.18, 0.055);
    } else {
      this.playTone(145, 46, 0.10, 'triangle', 0.22, 0);
      this.playNoiseBurst(0.055, 580, 'lowpass', 0.16, 0);
      this.playTone(360, 220, 0.03, 'square', 0.09, 0.065);
    }
  }

  public playHorn(): void {
    if (!this.canPlaySfx()) return;
    this.playTone(370, 365, 0.22, 'sawtooth', 0.14);
    this.playTone(466, 462, 0.22, 'sawtooth', 0.12);
  }

  public playPayphoneRing(): void {
    if (!this.canPlaySfx()) return;
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    for (let burst = 0; burst < 2; burst++) {
      const start = now + burst * 0.28;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(1180, start);
      osc.frequency.setValueAtTime(1420, start + 0.06);
      osc.frequency.setValueAtTime(1180, start + 0.12);
      gain.gain.setValueAtTime(0.09, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.2);
      osc.connect(gain);
      gain.connect(this.sfxGain!);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
      osc.start(start);
      osc.stop(start + 0.22);
    }
  }

  public playCashChime(delaySec = 0): void {
    if (!this.canPlaySfx()) return;
    this.playTone(880, 880, 0.08, 'triangle', 0.16, delaySec);
    this.playTone(1318.5, 1318.5, 0.16, 'triangle', 0.18, delaySec + 0.075);
  }

  public playPayNSpray(): void {
    if (!this.canPlaySfx(true)) return;
    this.playNoiseBurst(0.45, 2800, 'highpass', 0.22);
    this.playCashChime();
  }

  public playCarCrusher(): void {
    if (!this.canPlaySfx(true)) return;
    this.playNoiseBurst(0.5, 320, 'bandpass', 0.45, 0);
    this.playTone(90, 32, 0.48, 'sawtooth', 0.35, 0);
    this.playCashChime(0.36);
  }

  public playMissionComplete(): void {
    if (!this.canPlaySfx()) return;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((n, idx) => {
      this.playTone(n, n, 0.22, 'triangle', 0.2, idx * 0.11);
    });
  }

  public playUiBeep(freq = 740, dur = 0.08): void {
    if (!this.canPlaySfx()) return;
    this.playTone(freq, freq * 1.05, dur, 'square', 0.09);
  }

  public playWastedSting(): void {
    if (!this.canPlaySfx()) return;
    this.playTone(220, 78, 0.9, 'sawtooth', 0.26);
  }

  private playTone(
    startFreq: number,
    endFreq: number,
    dur: number,
    type: OscillatorType,
    vol: number,
    delaySec = 0
  ): void {
    if (!this.canPlaySfx()) return;
    const ctx = this.ctx!;
    const start = ctx.currentTime + Math.max(0, delaySec);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(startFreq, start);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), start + dur);
    gain.gain.setValueAtTime(Math.max(0.001, vol), start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
    osc.connect(gain);
    gain.connect(this.sfxGain!);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
    osc.start(start);
    osc.stop(start + dur + 0.02);
  }

  private playNoiseBurst(
    dur: number,
    freq: number,
    filterType: BiquadFilterType,
    vol: number,
    delaySec = 0
  ): void {
    if (!this.canPlaySfx(true)) return;
    const ctx = this.ctx!;
    const start = ctx.currentTime + Math.max(0, delaySec);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer!;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(Math.max(0.001, vol), start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain!);
    src.onended = () => {
      src.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
    src.start(start);
    src.stop(start + dur + 0.02);
  }
}
