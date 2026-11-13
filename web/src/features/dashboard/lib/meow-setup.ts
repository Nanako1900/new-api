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
/** Greeting bucket for the local hour (0-23). */
export function greetingFor(hour: number): 'morning' | 'afternoon' | 'evening' {
  if (hour >= 5 && hour < 12) return 'morning'
  if (hour >= 12 && hour < 18) return 'afternoon'
  return 'evening'
}

const NAME_PLACEHOLDER = '⁣meow-name⁣'

/**
 * Split a translated greeting around the user's name, so the name can be
 * styled wherever a locale places it. `translate` receives the placeholder
 * to interpolate as the name.
 */
export function splitAroundName(translate: (placeholder: string) => string): {
  before: string
  after: string
} {
  const text = translate(NAME_PLACEHOLDER)
  const index = text.indexOf(NAME_PLACEHOLDER)
  if (index === -1) return { before: text, after: '' }
  return {
    before: text.slice(0, index),
    after: text.slice(index + NAME_PLACEHOLDER.length),
  }
}

export type HealthBadge = 'healthy' | 'degraded' | 'unstable' | 'unknown'

/** Provider status badge for a success-rate level. */
export function healthBadge(
  level: 'excellent' | 'good' | 'warning' | 'critical' | 'unknown'
): HealthBadge {
  if (level === 'excellent' || level === 'good') return 'healthy'
  if (level === 'warning') return 'degraded'
  if (level === 'critical') return 'unstable'
  return 'unknown'
}
