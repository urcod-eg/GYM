import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GYM_LOGO_GATE, TapGate, URCOD_LOGO_GATE } from './tapGate';

describe('TapGate', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const tapN = (gate: { tap: () => void }, n: number, gapMs = 150) => {
    for (let i = 0; i < n; i++) {
      gate.tap();
      vi.advanceTimersByTime(gapMs);
    }
  };

  it('3 taps resolve to cashier only after the pause', () => {
    const hit = vi.fn();
    const gate = new TapGate(GYM_LOGO_GATE, hit, () => Date.now());
    tapN(gate, 3);
    expect(hit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(800);
    expect(hit).toHaveBeenCalledWith('cashier');
  });

  it('5 taps resolve to admin and never fire cashier on the way', () => {
    const hit = vi.fn();
    const gate = new TapGate(GYM_LOGO_GATE, hit, () => Date.now());
    tapN(gate, 5);
    vi.advanceTimersByTime(800);
    expect(hit).toHaveBeenCalledTimes(1);
    expect(hit).toHaveBeenCalledWith('admin');
  });

  it('4 taps do nothing', () => {
    const hit = vi.fn();
    const gate = new TapGate(GYM_LOGO_GATE, hit, () => Date.now());
    tapN(gate, 4);
    vi.advanceTimersByTime(800);
    expect(hit).not.toHaveBeenCalled();
  });

  it('slow taps spread over more than the window do not count', () => {
    const hit = vi.fn();
    const gate = new TapGate(GYM_LOGO_GATE, hit, () => Date.now());
    tapN(gate, 3, 650); // ~1.95 s, fine
    vi.advanceTimersByTime(800);
    expect(hit).toHaveBeenCalledWith('cashier');
    hit.mockClear();
    gate.tap();
    vi.advanceTimersByTime(3500);
    gate.tap();
    gate.tap();
    vi.advanceTimersByTime(800);
    expect(hit).not.toHaveBeenCalled();
  });

  it('10 taps on the urcod logo open the developer gate', () => {
    const hit = vi.fn();
    const gate = new TapGate(URCOD_LOGO_GATE, hit, () => Date.now());
    tapN(gate, 10, 120);
    vi.advanceTimersByTime(900);
    expect(hit).toHaveBeenCalledWith('developer');
  });
});
