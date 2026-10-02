'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchCredits, type CreditBalance } from './api';
import { useToken } from './useToken';

let cache: CreditBalance | null = null;
const listeners = new Set<(value: CreditBalance | null) => void>();

function publish(value: CreditBalance | null) {
  cache = value;
  for (const listener of listeners) listener(value);
}

export function useCredits() {
  const getToken = useToken();
  const [credits, setCredits] = useState<CreditBalance | null>(cache);

  const refresh = useCallback(async () => {
    const value = await fetchCredits(await getToken());
    if (value) publish(value);
    return value;
  }, [getToken]);

  useEffect(() => {
    listeners.add(setCredits);
    if (!cache) void refresh();
    return () => {
      listeners.delete(setCredits);
    };
  }, [refresh]);

  return { credits, refresh };
}
