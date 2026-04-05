import { ProviderId } from './types.js';

export type RotationStrategy = 'on-429' | 'round-robin';

export type KeyStatus = 'active' | 'rate-limited' | 'exhausted';

export interface ApiKey {
  key: string;
  status: KeyStatus;
  rateLimitedUntil?: number;
  lastUsed?: number;
  requestCount: number;
  failureCount: number;
}

export interface KeyPool {
  providerId: ProviderId;
  keys: ApiKey[];
  strategy: RotationStrategy;
  currentIndex: number;
}

export interface KeyPoolStatus {
  total: number;
  active: number;
  rateLimited: number;
  exhausted: number;
}

class KeyPoolManagerImpl {
  private pools: Map<string, KeyPool> = new Map();

  discoverFromEnv(
    providerId: ProviderId,
    baseEnvVar: string,
    strategy?: RotationStrategy
  ): KeyPool | null {
    const finalStrategy = strategy || this.getRotationStrategy(providerId);
    const keys = this.discoverKeys(baseEnvVar);

    if (keys.length === 0) {
      return null;
    }

    const pool: KeyPool = {
      providerId,
      keys: keys.map(key => ({
        key,
        status: 'active',
        requestCount: 0,
        failureCount: 0,
      })),
      strategy: finalStrategy,
      currentIndex: 0,
    };

    this.pools.set(providerId, pool);
    console.log(`[KEY-POOL] ${providerId}: discovered ${keys.length} key(s), strategy: ${finalStrategy}`);
    return pool;
  }

  private discoverKeys(baseEnvVar: string): string[] {
    const pluralVar = `${baseEnvVar}S`;
    const pluralValue = process.env[pluralVar];
    if (pluralValue) {
      const keys = pluralValue.split(',').map(k => k.trim()).filter(k => k.length > 0);
      if (keys.length > 0) {
        return keys;
      }
    }

    const numberedKeys: string[] = [];
    for (let i = 1; i <= 20; i++) {
      const key = process.env[`${baseEnvVar}_${i}`];
      if (key) {
        numberedKeys.push(key);
      }
    }
    if (numberedKeys.length > 0) {
      return numberedKeys;
    }

    const singleKey = process.env[baseEnvVar];
    if (singleKey) {
      return [singleKey];
    }

    return [];
  }

  private getRotationStrategy(providerId: ProviderId): RotationStrategy {
    const providerStrategy = process.env[`${providerId.toUpperCase().replace(/-/g, '_')}_ROTATION_STRATEGY`];
    if (providerStrategy === 'round-robin' || providerStrategy === 'on-429') {
      return providerStrategy;
    }

    const globalStrategy = process.env.ROTATION_STRATEGY;
    if (globalStrategy === 'round-robin' || globalStrategy === 'on-429') {
      return globalStrategy;
    }

    return 'on-429';
  }

  getNextKey(pool: KeyPool): string | null {
    const activeKeys = pool.keys.filter(k => k.status === 'active');
    if (activeKeys.length === 0) {
      const recoveringKey = this.tryRecoverKey(pool);
      if (recoveringKey) {
        return recoveringKey.key;
      }
      return null;
    }

    let selectedKey: ApiKey;

    if (pool.strategy === 'round-robin') {
      selectedKey = activeKeys[pool.currentIndex % activeKeys.length];
      pool.currentIndex = (pool.currentIndex + 1) % activeKeys.length;
    } else {
      selectedKey = activeKeys[0];
    }

    selectedKey.lastUsed = Date.now();
    selectedKey.requestCount++;

    return selectedKey.key;
  }

  private tryRecoverKey(pool: KeyPool): ApiKey | null {
    const now = Date.now();
    for (const key of pool.keys) {
      if (key.status === 'rate-limited' && key.rateLimitedUntil && now >= key.rateLimitedUntil) {
        key.status = 'active';
        key.rateLimitedUntil = undefined;
        key.failureCount = 0;
        console.log(`[KEY-POOL] ${pool.providerId}: recovered key ${this.maskKey(key.key)}`);
        return key;
      }
    }
    return null;
  }

  markRateLimited(pool: KeyPool, keyStr: string, retryAfterSeconds?: number): void {
    const key = pool.keys.find(k => k.key === keyStr);
    if (!key) return;

    key.failureCount++;
    key.status = 'rate-limited';
    key.rateLimitedUntil = Date.now() + (retryAfterSeconds || 60) * 1000;

    console.log(`[KEY-POOL] ${pool.providerId}: key ${this.maskKey(keyStr)} rate-limited for ${retryAfterSeconds || 60}s`);

    const activeCount = pool.keys.filter(k => k.status === 'active').length;
    if (activeCount === 0) {
      console.warn(`[KEY-POOL] ${pool.providerId}: all keys rate-limited`);
    }
  }

  markSuccess(pool: KeyPool, keyStr: string): void {
    const key = pool.keys.find(k => k.key === keyStr);
    if (!key) return;

    key.failureCount = 0;
    if (key.status === 'rate-limited') {
      key.status = 'active';
      key.rateLimitedUntil = undefined;
    }
  }

  hasAvailableKey(pool: KeyPool): boolean {
    this.tryRecoverKey(pool);
    return pool.keys.some(k => k.status === 'active');
  }

  getStatus(pool: KeyPool): KeyPoolStatus {
    return {
      total: pool.keys.length,
      active: pool.keys.filter(k => k.status === 'active').length,
      rateLimited: pool.keys.filter(k => k.status === 'rate-limited').length,
      exhausted: pool.keys.filter(k => k.status === 'exhausted').length,
    };
  }

  getPool(providerId: ProviderId): KeyPool | undefined {
    return this.pools.get(providerId);
  }

  getAllPools(): Map<string, KeyPool> {
    return this.pools;
  }

  private maskKey(key: string): string {
    if (key.length <= 12) return '***';
    return `${key.substring(0, 4)}...${key.substring(key.length - 4)}`;
  }

  setPool(pool: KeyPool): void {
    this.pools.set(pool.providerId, pool);
  }
}

export const KeyPoolManager = new KeyPoolManagerImpl();
