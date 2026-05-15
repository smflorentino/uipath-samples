/**
 * Single source of truth for the active tenant name. Persists to localStorage
 * so the user lands on their last-selected tenant on the next visit.
 *
 * Used by hooks and API helpers that build URLs at call time — reading
 * `import.meta.env.VITE_UIPATH_TENANT_NAME` directly would freeze the value
 * at build time and break tenant switching.
 */

const STORAGE_KEY = 'agent-feedback-app.selectedTenant';

const envFallback = (): string => {
  try {
    return import.meta.env.VITE_UIPATH_TENANT_NAME ?? 'DefaultTenant';
  } catch {
    return 'DefaultTenant';
  }
};

const readFromStorage = (): string | null => {
  try {
    return typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
  } catch {
    return null;
  }
};

let active: string = readFromStorage() ?? envFallback();

export function getActiveTenant(): string {
  return active;
}

export function setActiveTenant(name: string): void {
  active = name;
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, name);
    }
  } catch {
    // ignore storage failures (private mode, quota, etc.) — in-memory copy still works
  }
}

/** Test/debug helper. Resets the in-memory state and clears storage. */
export function _resetActiveTenant(): void {
  active = envFallback();
  try {
    if (typeof window !== 'undefined') window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
