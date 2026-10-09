// A pairing link (#/coach/pair/<code>) is read as soon as it arrives (at startup,
// or in a window that's already open) and taken out of the address straight
// away, so the secret doesn't linger in the address bar or the browser's
// history. Imported first in main.tsx, before routing starts.
import { create } from 'zustand';

export const usePendingPair = create<{ code: string | null; clear: () => void }>((set) => ({ code: null, clear: () => set({ code: null }) }));

/** Takes a pairing code out of the address if there is one. */
export function capturePairLink(): boolean {
  if (typeof location === 'undefined') return false;
  const m = /^#\/?coach\/pair\/(.+)$/.exec(location.hash);
  if (!m) return false;
  usePendingPair.setState({ code: decodeURIComponent(m[1]) });
  history.replaceState(null, '', '#/coach');
  return true;
}

capturePairLink();

/** The link a coach's phone camera opens: this app, with the code after the #. */
export function pairingLink(code: string): string {
  return `${location.origin}${location.pathname}#/coach/pair/${code}`;
}
