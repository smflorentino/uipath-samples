import { describe, expect, it, beforeEach, vi } from 'vitest';

const STORAGE_KEY = 'agent-feedback-app.selectedTenant';

// Minimal in-memory localStorage shim — runs in vitest's default node env so we
// don't need jsdom. Mirrors only the methods we use.
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }
  setItem(key: string, val: string) {
    this.store.set(key, String(val));
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
  clear() {
    this.store.clear();
  }
}

describe('activeTenant', () => {
  beforeEach(() => {
    vi.resetModules();
    const ls = new MemoryStorage();
    vi.stubGlobal('window', { localStorage: ls } as unknown as typeof globalThis);
  });

  it('falls back to env default when storage is empty', async () => {
    const { getActiveTenant } = await import('./activeTenant');
    expect(typeof getActiveTenant()).toBe('string');
    expect(getActiveTenant().length).toBeGreaterThan(0);
  });

  it('persists selection to localStorage', async () => {
    const { setActiveTenant, getActiveTenant } = await import('./activeTenant');
    setActiveTenant('Memory');
    expect(getActiveTenant()).toBe('Memory');
    expect((globalThis as unknown as { window: { localStorage: MemoryStorage } }).window.localStorage.getItem(STORAGE_KEY)).toBe('Memory');
  });

  it('reads previously stored tenant on next module load', async () => {
    (globalThis as unknown as { window: { localStorage: MemoryStorage } }).window.localStorage.setItem(STORAGE_KEY, 'Memory');
    const { getActiveTenant } = await import('./activeTenant');
    expect(getActiveTenant()).toBe('Memory');
  });

  it('_resetActiveTenant clears storage and reverts to env default', async () => {
    const { setActiveTenant, _resetActiveTenant, getActiveTenant } = await import('./activeTenant');
    // Use a sentinel tenant name that won't match whatever env default the
    // build is using — so the assertion below is env-agnostic.
    const SENTINEL = 'TenantFromTestOnly';
    setActiveTenant(SENTINEL);
    _resetActiveTenant();
    const ls = (globalThis as unknown as { window: { localStorage: MemoryStorage } }).window.localStorage;
    expect(ls.getItem(STORAGE_KEY)).toBeNull();
    expect(getActiveTenant()).not.toBe(SENTINEL);
  });
});
