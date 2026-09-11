'use client';

import { useAuth } from '@clerk/nextjs';
import { useCallback } from 'react';
import type { Token } from './api';

export function useToken(): () => Promise<Token> {
  const { getToken } = useAuth();
  return useCallback(async () => (await getToken()) ?? null, [getToken]);
}
