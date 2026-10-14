/**
 * Hidden role entrances (spec addendum 1.1 §A). This is a visual shortcut only — never a security
 * boundary. Taps are collected until the user pauses (settleMs) or the window closes (windowMs);
 * only then is the FINAL count resolved, so 3 taps (cashier) never fires on the way to 5 (admin).
 */
export interface TapGateOptions<T extends string> {
  windowMs: number;
  settleMs: number;
  targets: Partial<Record<number, T>>;
}

export function resolveTaps<T extends string>(count: number, opts: TapGateOptions<T>): T | null {
  return opts.targets[count] ?? null;
}

export class TapGate<T extends string> {
  private count = 0;
  private firstAt = 0;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly opts: TapGateOptions<T>,
    private readonly onResolve: (target: T) => void,
    private readonly now: () => number = () => Date.now(),
  ) {}

  tap(): void {
    const t = this.now();
    if (this.count === 0 || t - this.firstAt > this.opts.windowMs) {
      this.count = 0;
      this.firstAt = t;
    }
    this.count += 1;
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => this.settle(), this.opts.settleMs);
  }

  private settle(): void {
    const withinWindow = this.now() - this.firstAt <= this.opts.windowMs + this.opts.settleMs;
    const target = withinWindow ? resolveTaps(this.count, this.opts) : null;
    this.reset();
    if (target) this.onResolve(target);
  }

  reset(): void {
    this.count = 0;
    this.firstAt = 0;
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = null;
  }
}

export const GYM_LOGO_GATE: TapGateOptions<'cashier' | 'admin'> = {
  windowMs: 3000,
  settleMs: 700,
  targets: { 3: 'cashier', 5: 'admin' },
};

export const URCOD_LOGO_GATE: TapGateOptions<'developer'> = {
  windowMs: 5000,
  settleMs: 800,
  targets: { 10: 'developer' },
};
