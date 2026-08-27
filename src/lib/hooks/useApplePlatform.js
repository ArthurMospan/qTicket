'use client';

// src/lib/hooks/useApplePlatform.js — is there a ⌘ key on this keyboard?
//
// The server cannot know the platform, so the first paint has to pick one: Ctrl
// is the safe choice, because Ctrl+K opens the palette on a Mac too, while ⌘ on
// Windows names a key that does not exist. `useSyncExternalStore` is what makes
// that a hydration-safe answer rather than a mismatch — it renders the server
// snapshot during hydration and the real one immediately after.
//
// It never changes while the page is open, so the subscription is a no-op.
import { useSyncExternalStore } from 'react';
import { isApplePlatform } from '@/lib/utils/platformKeys.mjs';

const subscribe = () => () => {};

// `userAgentData.platform` is Chromium-only; `navigator.platform` is deprecated
// but present everywhere. Whichever answers first wins.
const getSnapshot = () => isApplePlatform(
  navigator.userAgentData?.platform || navigator.platform || navigator.userAgent,
);

const getServerSnapshot = () => false;

export function useApplePlatform() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export default useApplePlatform;
