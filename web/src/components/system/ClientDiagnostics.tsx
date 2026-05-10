'use client';

import { useEffect } from 'react';
import { installClientDiagnostics } from '@/lib/diagnostics/clientDiagnostics';

export function ClientDiagnostics() {
  useEffect(() => {
    installClientDiagnostics();
  }, []);

  return null;
}
