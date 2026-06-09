import { afterEach, describe, expect, it } from 'vitest'
import {
  browserStorage,
  readBrowserStorageItem,
  removeBrowserStorageItem,
  writeBrowserStorageItem
} from './browser-storage'

class MemoryStorage {
  private values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }
}

const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')

function restoreLocalStorage(): void {
  if (originalLocalStorage) {
    Object.defineProperty(globalThis, 'localStorage', originalLocalStorage)
  } else {
    Reflect.deleteProperty(globalThis, 'localStorage')
  }
}

afterEach(() => {
  restoreLocalStorage()
})

describe('browserStorage', () => {
  it('does not invoke host localStorage accessors in node tests', () => {
    let getterCalls = 0
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        getterCalls += 1
        throw new Error('localStorage getter should not be called')
      }
    })

    expect(browserStorage()).toBeNull()
    expect(getterCalls).toBe(0)
  })

  it('uses data-valued test storage stubs', () => {
    const storage = new MemoryStorage()
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: storage
    })

    expect(browserStorage()).toBe(storage)
  })

  it('reads, writes, and removes values through the safe helpers', () => {
    const storage = new MemoryStorage()
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: storage
    })

    writeBrowserStorageItem('demo', 'value')
    expect(readBrowserStorageItem('demo')).toBe('value')
    removeBrowserStorageItem('demo')
    expect(readBrowserStorageItem('demo')).toBeNull()
  })
})
