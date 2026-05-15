import type { CapabilityVisibility } from './capabilityRegistry.js';

export type CapabilityPackage = 'core' | 'private-business';

export interface CapabilityBoundary {
  visibility: CapabilityVisibility;
  package: CapabilityPackage;
}

export const publicCoreCapabilityNames = [
  'time',
  'notes',
  'lists',
  'trackers',
  'calendar',
  'commitments',
  'reminders',
  'coding',
  'steward',
  'mandrel',
  'memory',
  'email',
  'search',
  'scratchpad',
  'commune',
  'images',
  'report',
  'page',
  'goals',
  'continuity',
  'pdf',
  'scout',
  'sandbox',
  'jobs',
  'browser',
] as const;

export const privateBusinessCapabilityNames = [
  'squire_email',
  'dealer_foundation',
] as const;

export const capabilityBoundaries: Record<string, CapabilityBoundary> = {
  ...Object.fromEntries(
    publicCoreCapabilityNames.map((name) => [
      name,
      { visibility: 'public', package: 'core' } satisfies CapabilityBoundary,
    ])
  ),
  ...Object.fromEntries(
    privateBusinessCapabilityNames.map((name) => [
      name,
      { visibility: 'private', package: 'private-business' } satisfies CapabilityBoundary,
    ])
  ),
};
