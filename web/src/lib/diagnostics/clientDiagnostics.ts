type DiagnosticDetails = Record<string, unknown>;

interface DiagnosticEvent {
  at: string;
  sessionId: string;
  type: string;
  path: string;
  visibilityState: DocumentVisibilityState;
  details?: DiagnosticDetails;
}

interface NavigatorWithDeviceMemory extends Navigator {
  deviceMemory?: number;
}

interface PerformanceWithMemory extends Performance {
  memory?: {
    jsHeapSizeLimit: number;
    totalJSHeapSize: number;
    usedJSHeapSize: number;
  };
}

const STORAGE_KEY = 'squire_client_diagnostics';
const SESSION_KEY = 'squire_client_diagnostics_session';
const MAX_EVENTS = 150;

let installed = false;

function getSessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;

    const next = `diag_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    sessionStorage.setItem(SESSION_KEY, next);
    return next;
  } catch {
    return `diag_${Date.now()}`;
  }
}

function getMemorySnapshot(): DiagnosticDetails {
  const perf = performance as PerformanceWithMemory;
  const nav = navigator as NavigatorWithDeviceMemory;
  const details: DiagnosticDetails = {};

  if (perf.memory) {
    details.usedHeapMb = Math.round(perf.memory.usedJSHeapSize / 1024 / 1024);
    details.totalHeapMb = Math.round(perf.memory.totalJSHeapSize / 1024 / 1024);
    details.heapLimitMb = Math.round(perf.memory.jsHeapSizeLimit / 1024 / 1024);
  }

  if (nav.deviceMemory) {
    details.deviceMemoryGb = nav.deviceMemory;
  }

  return details;
}

export function recordClientDiagnostic(type: string, details: DiagnosticDetails = {}): void {
  if (typeof window === 'undefined') return;

  const event: DiagnosticEvent = {
    at: new Date().toISOString(),
    sessionId: getSessionId(),
    type,
    path: window.location.pathname,
    visibilityState: document.visibilityState,
    details: {
      ...getMemorySnapshot(),
      ...details,
    },
  };

  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    const events = existing ? (JSON.parse(existing) as DiagnosticEvent[]) : [];
    events.push(event);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events.slice(-MAX_EVENTS)));
  } catch {
    // Diagnostics must never affect app behavior.
  }

  if (
    type === 'error' ||
    type === 'unhandledrejection' ||
    type === 'pagehide' ||
    type === 'pageshow' ||
    type === 'longtask'
  ) {
    console.warn('[SquireDiagnostics]', event);
  } else {
    console.log('[SquireDiagnostics]', event);
  }
}

function getNavigationDetails(): DiagnosticDetails {
  const navEntry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  if (!navEntry) return {};

  return {
    navigationType: navEntry.type,
    domInteractiveMs: Math.round(navEntry.domInteractive),
    domCompleteMs: Math.round(navEntry.domComplete),
    transferSize: navEntry.transferSize,
    encodedBodySize: navEntry.encodedBodySize,
  };
}

export function installClientDiagnostics(): void {
  if (typeof window === 'undefined' || installed) return;
  installed = true;

  const sessionId = getSessionId();
  recordClientDiagnostic('diagnostics-installed', {
    sessionId,
    userAgent: navigator.userAgent,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    ...getNavigationDetails(),
  });

  window.addEventListener('error', (event) => {
    recordClientDiagnostic('error', {
      message: event.message,
      source: event.filename,
      line: event.lineno,
      column: event.colno,
      errorName: event.error instanceof Error ? event.error.name : undefined,
      stack: event.error instanceof Error ? event.error.stack?.slice(0, 1200) : undefined,
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    recordClientDiagnostic('unhandledrejection', {
      reason: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack?.slice(0, 1200) : undefined,
    });
  });

  document.addEventListener('visibilitychange', () => {
    recordClientDiagnostic('visibilitychange', {
      hidden: document.hidden,
      visibilityState: document.visibilityState,
    });
  });

  window.addEventListener('pagehide', (event) => {
    recordClientDiagnostic('pagehide', {
      persisted: event.persisted,
    });
  });

  window.addEventListener('pageshow', (event) => {
    recordClientDiagnostic('pageshow', {
      persisted: event.persisted,
      ...getNavigationDetails(),
    });
  });

  window.addEventListener('focus', () => {
    recordClientDiagnostic('focus');
  });

  window.addEventListener('blur', () => {
    recordClientDiagnostic('blur');
  });

  window.addEventListener('online', () => {
    recordClientDiagnostic('online');
  });

  window.addEventListener('offline', () => {
    recordClientDiagnostic('offline');
  });

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration >= 250) {
          recordClientDiagnostic('longtask', {
            name: entry.name,
            durationMs: Math.round(entry.duration),
            startTimeMs: Math.round(entry.startTime),
          });
        }
      }
    });
    observer.observe({ entryTypes: ['longtask'] });
  } catch {
    // Long task observation is not supported in every browser.
  }

  window.setInterval(() => {
    if (document.visibilityState === 'visible') {
      recordClientDiagnostic('heartbeat', {
        viewport: `${window.innerWidth}x${window.innerHeight}`,
      });
    }
  }, 60_000);

  (window as unknown as Record<string, unknown>).__SQUIRE_DIAGNOSTICS__ = {
    getEvents: () => {
      try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as DiagnosticEvent[];
      } catch {
        return [];
      }
    },
    record: recordClientDiagnostic,
    clear: () => localStorage.removeItem(STORAGE_KEY),
  };
}
