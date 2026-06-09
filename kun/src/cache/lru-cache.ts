/**
 * Bounded least-recently-used cache.
 *
 * `set` promotes the entry to the most-recent slot. `get` promotes and
 * returns the stored value. When the cache is full, the least-recently
 * used entry is evicted. The cache never throws; it always returns
 * `undefined` for misses.
 */
export class LruCache<K, V> {
  private readonly limit: number
  private readonly entries = new Map<K, V>()

  constructor(limit: number) {
    if (!Number.isFinite(limit) || limit <= 0) {
      throw new Error('LruCache requires limit > 0')
    }
    this.limit = limit
  }

  get size(): number {
    return this.entries.size
  }

  has(key: K): boolean {
    return this.entries.has(key)
  }

  get(key: K): V | undefined {
    if (!this.entries.has(key)) return undefined
    const value = this.entries.get(key) as V
    this.entries.delete(key)
    this.entries.set(key, value)
    return value
  }

  set(key: K, value: V): V | undefined {
    let evicted: V | undefined
    if (this.entries.has(key)) {
      this.entries.delete(key)
    } else if (this.entries.size >= this.limit) {
      const oldestKey = this.entries.keys().next().value as K | undefined
      if (oldestKey !== undefined) {
        evicted = this.entries.get(oldestKey)
        this.entries.delete(oldestKey)
      }
    }
    this.entries.set(key, value)
    return evicted
  }

  delete(key: K): boolean {
    return this.entries.delete(key)
  }

  clear(): void {
    this.entries.clear()
  }

  keys(): IterableIterator<K> {
    return this.entries.keys()
  }

  values(): IterableIterator<V> {
    return this.entries.values()
  }
}
