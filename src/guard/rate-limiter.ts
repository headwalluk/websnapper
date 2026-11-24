const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60_000;

export interface RateLimitSettings {
  perMinute: number;
  burst: number;
  banStrikes: number;
  banWindowSeconds: number;
}

interface ClientState {
  tokens: number;
  refilledAt: number;
  strikes: number[];
}

/** In-memory token bucket and strike counter per client address. State is per process. */
export class RateLimiter {
  private readonly settings: RateLimitSettings;
  private readonly clients = new Map<string, ClientState>();

  constructor(settings: RateLimitSettings) {
    this.settings = settings;
  }

  /** Returns the client's state, refilling its bucket for the time elapsed. */
  private stateFor(ip: string, now: number): ClientState {
    const existing = this.clients.get(ip);
    const state = existing ?? { tokens: this.settings.burst, refilledAt: now, strikes: [] };
    const refill = ((now - state.refilledAt) / MS_PER_MINUTE) * this.settings.perMinute;
    state.tokens = Math.min(this.settings.burst, state.tokens + refill);
    state.refilledAt = now;
    this.clients.set(ip, state);
    return state;
  }

  /** Takes one token; returns 0 when allowed, otherwise the seconds until a token is available. */
  consume(ip: string, now: number): number {
    const state = this.stateFor(ip, now);
    let retryAfterSeconds = 0;
    if (state.tokens >= 1) {
      state.tokens -= 1;
    } else {
      const msPerToken = MS_PER_MINUTE / this.settings.perMinute;
      retryAfterSeconds = Math.max(1, Math.ceil(((1 - state.tokens) * msPerToken) / MS_PER_SECOND));
    }
    return retryAfterSeconds;
  }

  /** Records a strike; returns true (and clears the strikes) when the ban threshold is reached. */
  strike(ip: string, now: number): boolean {
    const state = this.stateFor(ip, now);
    const windowStart = now - this.settings.banWindowSeconds * MS_PER_SECOND;
    state.strikes = state.strikes.filter((strikeAt) => strikeAt > windowStart);
    state.strikes.push(now);
    const shouldBan = state.strikes.length >= this.settings.banStrikes;
    if (shouldBan) {
      state.strikes = [];
    }
    return shouldBan;
  }

  /** Forgets clients whose bucket is full and who have no recent strikes, so memory stays bounded. */
  sweep(now: number): number {
    const windowStart = now - this.settings.banWindowSeconds * MS_PER_SECOND;
    let removed = 0;
    for (const ip of [...this.clients.keys()]) {
      const state = this.stateFor(ip, now);
      if (state.tokens >= this.settings.burst && state.strikes.every((strikeAt) => strikeAt <= windowStart)) {
        this.clients.delete(ip);
        removed += 1;
      }
    }
    return removed;
  }

  /** Number of clients currently tracked. */
  size(): number {
    return this.clients.size;
  }
}
