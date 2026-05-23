'use client';

import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';

export const isNative = (): boolean => Capacitor.isNativePlatform();

// Hydration-safe native check for rendering: returns false during SSR + the
// first client render (so server and client markup match), then flips to the
// real value after mount. Use this to hide in-app purchase surfaces on iOS/
// Android — Apple Guideline 3.1.1 forbids non-IAP digital-subscription
// purchases inside the app, so trainers manage billing on the web instead.
export function useIsNative(): boolean {
  const [native, setNative] = useState(false);
  useEffect(() => {
    // One-time mount detection — intentionally sets state in the effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNative(Capacitor.isNativePlatform());
  }, []);
  return native;
}

export const nativePlatform = (): 'ios' | 'android' | 'web' => {
  const p = Capacitor.getPlatform();
  return p === 'ios' || p === 'android' ? p : 'web';
};
