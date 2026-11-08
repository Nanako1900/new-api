/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
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
