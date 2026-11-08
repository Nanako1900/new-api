import { expect, test } from 'vitest'

import { getAlertStatus } from '../lib/alert-status'

const NOW = Date.parse('2026-11-07T12:00:00Z')

test.each([
  ['a disabled alert', { enabled: false }, 'disabled'],
  ['an alert without schedule', { enabled: true }, 'live'],
  [
    'an alert starting exactly now',
    { enabled: true, startsAt: '2026-11-07T12:00:00Z' },
    'live',
  ],
  [
    'an alert starting now written with milliseconds and an offset',
    { enabled: true, startsAt: '2026-11-07T20:00:00.000+08:00' },
    'live',
  ],
  [
    'an alert starting later',
    { enabled: true, startsAt: '2026-11-07T12:00:01Z' },
    'scheduled',
  ],
  [
    'an alert ending exactly now',
    { enabled: true, endsAt: '2026-11-07T12:00:00Z' },
    'expired',
  ],
  [
    'an alert ending later',
    { enabled: true, endsAt: '2026-11-07T12:00:01Z' },
    'live',
  ],
] as const)('%s is reported as %s', (_, alert, expected) => {
  expect(getAlertStatus(alert, NOW)).toBe(expected)
})
