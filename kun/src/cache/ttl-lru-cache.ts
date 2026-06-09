import { LruCache } from './lru-cache.js'

type Entry<V> = { value: V; expiresAt: number }

/**
 * Bounded cache with both TTL expiry and LRU eviction.
 *
 * `get` returns `undefined` for both misses and expired entries. When
 * an entry expires it is treated as a miss; the next `set` may evict
 * a still-valid entry if the cache is full.
 */
export class TtlLruCache<K, V> {
  private readonly cache: LruCache<K, Entry<V>>
  private readonly ttlMs: number
  private readonly now: () => number

  constructor(options: { limit: number; ttlMs: number; now?: () => number }) {
    if (!Number.isFinite(options.ttlMs) || options.ttlMs <= 0) {
      throw new Error('TtlLruCache requires ttlMs > 0')
    }
    this.cache = new LruCache<K, Entry<V>>(options.limit)
    this.ttlMs = options.ttlMs
    this.now = options.now ?? Date.now
  }

  get size(): number {
    return this.cache.size
  }

  has(key: K): boolean {
    return this.get(key) !== undefined
  }

  get(key: K): V | undefined {
    const entry = this.cache.get(key)
    if (!entry) return undefined
    if (entry.expiresAt <= this.now()) {
      this.cache.delete(key)
      return undefined
    }
    return entry.value
  }

  set(key: K, value: V): V | undefined {
    const expiresAt = this.now() + this.ttlMs
    const evicted = this.cache.set(key, { value, expiresAt })
    return evicted?.value
  }

  delete(key: K): boolean {
    return this.cache.delete(key)
  }

  clear(): void {
    this.cache.clear()
  }

  /** Sweep all expired entries. Returns the number of entries dropped. */
  sweep(): number {
    const now = this.now()
    let dropped = 0
    for (const key of [...this.cache.keys()]) {
      const entry = this.cache.get(key)
      if (!entry) continue
      if (entry.expiresAt <= now) {
        this.cache.delete(key)
        dropped += 1
      }
    }
    return dropped
  }
}
