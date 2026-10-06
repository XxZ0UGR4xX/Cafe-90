import { create } from 'zustand';

/** Sonidos 8-bit sintetizados con WebAudio (sin archivos). Configurables y desactivables por dispositivo. */
type Sfx = 'newOrder' | 'ready' | 'coin' | 'error';
const KEY = 'rb.sound';
const read = (): boolean => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
interface SoundState { enabled: boolean; setEnabled: (v: boolean) => void }
export const useSound = create<SoundState>((set) => ({ enabled: read(), setEnabled: (v) => { try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* */ } set({ enabled: v }); } }));

let ctx: AudioContext | null = null;
const NOTES: Record<Sfx, [number, number][]> = {
  newOrder: [[880, 0.12], [1175, 0.18]], ready: [[659, 0.1], [784, 0.1], [988, 0.22]], coin: [[988, 0.07], [1319, 0.28]], error: [[220, 0.18], [165, 0.3]],
};
export function play(sfx: Sfx) {
  if (!useSound.getState().enabled) return;
  try {
    ctx ??= new (window.AudioContext || (window as any).webkitAudioContext)();
    let t = ctx.currentTime;
    for (const [freq, dur] of NOTES[sfx]) {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = 'square'; o.frequency.value = freq; g.gain.setValueAtTime(0.06, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + dur); t += dur * 0.9;
    }
  } catch { /* autoplay bloqueado hasta interacción */ }
}
