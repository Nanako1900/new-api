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
export type SetupClient = 'claude-code' | 'codex' | 'sdk'

export const SETUP_CLIENTS: { id: SetupClient; label: string }[] = [
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' },
  { id: 'sdk', label: 'SDK' },
]

/**
 * Ready-to-paste client configuration for this site. `apiRoot` has no
 * trailing slash and no `/v1`; `apiKey` is the full key or a masked one.
 */
export function buildSetupSnippet(
  client: SetupClient,
  apiRoot: string,
  apiKey: string
): string {
  if (client === 'claude-code') {
    return [
      `export ANTHROPIC_BASE_URL=${apiRoot}`,
      `export ANTHROPIC_AUTH_TOKEN=${apiKey}`,
      'claude',
    ].join('\n')
  }
  if (client === 'codex') {
    return [
      '# ~/.codex/config.toml',
      'model_provider = "meow"',
      '',
      '[model_providers.meow]',
      `base_url = "${apiRoot}/v1"`,
      'env_key = "MEOW_API_KEY"',
    ].join('\n')
  }
  return [
    'from openai import OpenAI',
    '',
    'client = OpenAI(',
    `    base_url="${apiRoot}/v1",`,
    `    api_key="${apiKey}",`,
    ')',
  ].join('\n')
}

/** `sk-` key shortened for display, e.g. `sk-abcd…wxyz`. */
export function maskApiKey(key: string | undefined): string {
  if (!key) return 'sk-…'
  const full = key.startsWith('sk-') ? key : `sk-${key}`
  if (full.length <= 14) return full
  return `${full.slice(0, 7)}…${full.slice(-4)}`
}

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
