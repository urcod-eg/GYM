/**
 * Door sounds for the check-in screen, made with the Web Audio API (no sound files to download).
 * Success: two short rising tones. Refused: two low buzzes. Browsers only allow sound after a tap,
 * so `unlockSounds()` is called from the camera / check-in buttons.
 */
type Ctx = AudioContext;
let ctx: Ctx | null = null;

const KEY = 'gym.scanSound';

export function soundsOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setSoundsOn(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* private mode: the choice lasts for this visit only */
  }
}

function audio(): Ctx | null {
  if (typeof window === 'undefined') return null;
  const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!C) return null;
  ctx ??= new C();
  return ctx;
}

/** Call from a tap so later sounds (after a scan, without a tap) are allowed to play. */
export function unlockSounds() {
  const a = audio();
  if (a && a.state === 'suspended') a.resume().catch(() => undefined);
}

function tone(a: Ctx, freq: number, start: number, dur: number, type: OscillatorType, peak: number) {
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(gain).connect(a.destination);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

export type DoorSound = 'ok' | 'no';

export function playDoorSound(kind: DoorSound) {
  if (navigator.vibrate) navigator.vibrate(kind === 'ok' ? 80 : [120, 80, 120]);
  if (!soundsOn()) return;
  const a = audio();
  if (!a) return;
  if (a.state === 'suspended') a.resume().catch(() => undefined);
  const t = a.currentTime + 0.01;
  if (kind === 'ok') {
    tone(a, 880, t, 0.12, 'sine', 0.35); // A5
    tone(a, 1318.5, t + 0.11, 0.22, 'sine', 0.35); // E6
  } else {
    tone(a, 196, t, 0.22, 'square', 0.12); // G3
    tone(a, 155.6, t + 0.28, 0.32, 'square', 0.12); // D#3
  }
}
