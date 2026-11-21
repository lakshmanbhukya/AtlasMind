import { lazy } from 'react';

const RELOAD_FLAG = 'am:lazy-reload';

function readFlag() {
  try {
    return sessionStorage.getItem(RELOAD_FLAG) === '1';
  } catch {
    return false;
  }
}

function writeFlag(on) {
  try {
    if (on) sessionStorage.setItem(RELOAD_FLAG, '1');
    else sessionStorage.removeItem(RELOAD_FLAG);
  } catch {
    // Storage blocked: we still reload at most once per page load below.
  }
}

let reloadedThisPage = false;

/**
 * React.lazy that reloads the page once if a chunk fails to load.
 *
 * A chunk import fails when the tab still runs an older index.html after a new
 * deploy (its hashed chunks are gone), or when the Vite dev server re-optimizes
 * dependencies mid-load. A single reload fetches the current chunks; if the
 * import fails again, the error goes to the nearest ErrorBoundary.
 */
export function lazyWithReload(factory) {
  return lazy(async () => {
    try {
      const mod = await factory();
      writeFlag(false);
      return mod;
    } catch (err) {
      if (typeof window === 'undefined' || reloadedThisPage || readFlag()) {
        writeFlag(false);
        throw err;
      }
      reloadedThisPage = true;
      writeFlag(true);
      window.location.reload();
      // Keep Suspense showing its fallback until the reload happens.
      return new Promise(() => {});
    }
  });
}
