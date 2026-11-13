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

/** The clients the CC Switch import offers. */
export type CCSwitchApp = 'claude' | 'codex'

/** Model fields of a CC Switch import, keyed by its deep-link parameter. */
export type CCSwitchModels = Record<string, string>

// Undated Claude family names (`claude-opus-5-5`, `claude-haiku-4`) or a bare
// family alias (`claude-opus`), which ranks below any versioned name.
// Version parts are short, so a dated snapshot (`-20270101`) never matches.
const CLAUDE_OPUS = /^claude-opus(?:-(\d{1,2}(?:[-.]\d{1,2})*))?$/
const CLAUDE_SONNET = /^claude-sonnet(?:-(\d{1,2}(?:[-.]\d{1,2})*))?$/
const CLAUDE_HAIKU = /^claude-haiku(?:-(\d{1,2}(?:[-.]\d{1,2})*))?$/
// Codex prefers the newest `sol` tier, then the newest GPT model of any tier.
const GPT_SOL = /^gpt-(\d+(?:\.\d+)*)-sol$/
/** A GPT chat model with a version and an optional tier: `gpt-6.1-terra`. */
export const GPT_MODEL = /^gpt-(\d+(?:\.\d+)*)(?:-[a-z]+)?$/

/**
 * The newest model whose name matches `pattern`, comparing the version that
 * the first capture group holds part by part (`5-5` beats `4-6`, `6.1`
 * beats `6`; no version ranks lowest). Returns an empty string when nothing
 * matches.
 */
export function newestModel(models: readonly string[], pattern: RegExp) {
  let best = ''
  let bestVersion: number[] = []
  for (const model of models) {
    const match = pattern.exec(model)
    if (!match) continue
    const version = match[1] ? match[1].split(/[-.]/).map(Number) : []
    let order = 0
    for (let i = 0; i < Math.max(version.length, bestVersion.length); i++) {
      order = (version[i] ?? 0) - (bestVersion[i] ?? 0)
      if (order !== 0) break
    }
    if (!best || order > 0) {
      best = model
      bestVersion = version
    }
  }
  return best
}

// The models each client can run: Claude Code speaks the Anthropic API and
// Codex the OpenAI one, so a model from the other family breaks the client.
const APP_MODELS: Record<CCSwitchApp, RegExp> = {
  claude: /^claude-/,
  codex: /^(?:gpt|codex)-/,
}

/** The user's models a CC Switch import may pick for `app`. */
export function ccSwitchModelChoices(
  app: CCSwitchApp,
  models: readonly string[]
): string[] {
  return models.filter((model) => APP_MODELS[app].test(model))
}

/**
 * Models a CC Switch import starts with, picked from the user's models so a
 * new model version is chosen without a code change: Claude runs on Opus
 * and fills each family slot with its newest model; Codex runs on the newest
 * GPT `sol` model. A field is empty when no model fits.
 */
export function defaultCCSwitchModels(
  app: CCSwitchApp,
  models: readonly string[]
): CCSwitchModels {
  if (app === 'codex') {
    return {
      model: newestModel(models, GPT_SOL) || newestModel(models, GPT_MODEL),
    }
  }

  const opus = newestModel(models, CLAUDE_OPUS)
  const sonnet = newestModel(models, CLAUDE_SONNET)
  const haiku = newestModel(models, CLAUDE_HAIKU)
  return {
    model: opus || sonnet || haiku,
    haikuModel: haiku,
    sonnetModel: sonnet,
    opusModel: opus,
  }
}
