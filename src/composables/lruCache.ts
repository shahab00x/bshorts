import type { Ref } from 'vue'

export interface LruOptions {
  // Maximum number of entries to retain; older (least-recently-used) entries are evicted on set
  maxSize: number
  // Optional sliding TTL in milliseconds. Entry expires if not accessed within ttlMs
  ttlMs?: number
}

export interface LruRef<T> {
  // The original ref that is now backed by an LRU-aware proxy object
  ref: Ref<Record<string, T>>
  // Force a prune pass (expire TTL and enforce max size)
  prune: (now?: number) => void
  // Current number of keys
  size: () => number
}

// Wrap a Ref<Record<string, T>> so all property get/set go through an LRU + TTL policy
// This keeps existing call sites working (obj[key] read/write) while enforcing bounds
export function wrapRefAsLru<T>(storeRef: Ref<Record<string, T>>, opts: LruOptions): LruRef<T> {
  const maxSize = Math.max(0, Math.floor(opts.maxSize || 0))
  const ttlMs = typeof opts.ttlMs === 'number' && opts.ttlMs > 0 ? Math.floor(opts.ttlMs) : 0

  // Metadata for LRU order and last access time
  const lruOrder = new Map<string, number>() // key -> lastAccessAtMs, insertion order = LRU order
  let size = 0

  const target = storeRef.value || {}
  // Initialize metadata from existing entries if any
  for (const k of Object.keys(target))
    lruOrder.set(k, Date.now())

  size = Object.keys(target).length

  const touch = (key: string, now: number) => {
    // Move key to the back (most recently used)
    lruOrder.delete(key)
    lruOrder.set(key, now)
  }

  const isExpired = (last: number, now: number) => ttlMs > 0 && (now - last) > ttlMs

  const proxyTarget: Record<string, T> = target

  const evictToMax = (_now: number) => {
    if (maxSize <= 0)
      return
    while (size > maxSize) {
      const it = lruOrder.keys().next()
      if (it.done)
        break
      const k = it.value
      lruOrder.delete(k)
      if (Object.prototype.hasOwnProperty.call(proxyTarget, k)) {
        delete proxyTarget[k]
        size--
      }
    }
  }

  const pruneExpired = (now: number) => {
    if (ttlMs <= 0)
      return
    for (const [k, last] of lruOrder) {
      if (isExpired(last, now)) {
        lruOrder.delete(k)
        if (Object.prototype.hasOwnProperty.call(proxyTarget, k)) {
          delete proxyTarget[k]
          size--
        }
      }
    }
  }

  const proxy = new Proxy(proxyTarget as Record<string, T>, {
    get(t, p, r) {
      if (typeof p !== 'string')
        return Reflect.get(t, p, r)
      const now = Date.now()
      if (!Object.prototype.hasOwnProperty.call(t, p))
        return undefined
      const last = lruOrder.get(p) || now
      // Expire on access if TTL elapsed
      if (isExpired(last, now)) {
        lruOrder.delete(p)
        delete t[p]
        size--
        return undefined
      }
      touch(p, now)
      return t[p]
    },
    set(t, p, value, r) {
      if (typeof p !== 'string')
        return Reflect.set(t, p, value, r)
      const now = Date.now()
      const existed = Object.prototype.hasOwnProperty.call(t, p)
      t[p] = value
      if (!existed)
        size++
      touch(p, now)
      // Opportunistically prune a few expired and enforce max size
      pruneExpired(now)
      evictToMax(now)
      return true
    },
    deleteProperty(t, p) {
      if (typeof p !== 'string')
        return Reflect.deleteProperty(t, p)
      const existed = Object.prototype.hasOwnProperty.call(t, p)
      if (existed) {
        delete t[p]
        lruOrder.delete(p)
        size--
      }
      return true
    },
    has(t, p) {
      if (typeof p !== 'string')
        return Reflect.has(t, p)
      const now = Date.now()
      const existed = Object.prototype.hasOwnProperty.call(t, p)
      if (!existed)
        return false
      const last = lruOrder.get(p) || now
      if (isExpired(last, now)) {
        lruOrder.delete(p)
        delete t[p]
        size--
        return false
      }
      touch(p, now)
      return true
    },
    ownKeys(t) {
      // No TTL checks here to keep iteration fast; consumers rarely enumerate
      return Reflect.ownKeys(t)
    },
    getOwnPropertyDescriptor(t, p) {
      return Object.getOwnPropertyDescriptor(t, p)
    },
  })

  // Replace the original value with our proxy so call sites keep working
  storeRef.value = proxy

  const prune = (nowInput?: number) => {
    const now = nowInput ?? Date.now()
    pruneExpired(now)
    evictToMax(now)
  }

  return {
    ref: storeRef,
    prune,
    size: () => size,
  }
}
