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

/** The clients the CC Switch import offers; `agy` is the Antigravity CLI. */
export type CCSwitchApp = 'claude' | 'codex' | 'gemini' | 'agy'

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
// Gemini CLI and Antigravity prefer the newest `neon` tier, then the newest
// Gemini model of any tier (`gemini-4-carbon`, `gemini-3.8-flash`).
const GEMINI_NEON = /^gemini-(\d+(?:\.\d+)*)-neon$/
const GEMINI_MODEL = /^gemini-(\d+(?:\.\d+)*)(?:-[a-z]+)?$/

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

/** The clients in the order the import offers them. */
export const CC_SWITCH_APPS: readonly CCSwitchApp[] = [
  'claude',
  'codex',
  'gemini',
  'agy',
]

// The model families each client can run, its own family first. Claude Code
// speaks the Anthropic API and keeps to Claude models. Codex keeps to GPT and
// codex models: Gemini models did not work in Codex in testing, so they are
// not offered. Gemini CLI and the Antigravity CLI speak the Gemini API and
// keep to Gemini models.
const APP_MODELS: Record<CCSwitchApp, readonly RegExp[]> = {
  claude: [/^claude-/],
  codex: [/^(?:gpt|codex)-/],
  gemini: [/^gemini-/],
  agy: [/^gemini-/],
}

/** The models of `models` that a CC Switch import may pick for `app`. */
export function ccSwitchModelChoices(
  app: CCSwitchApp,
  models: readonly string[]
): string[] {
  return APP_MODELS[app].flatMap((family) =>
    models.filter((model) => family.test(model))
  )
}

/** The group settings of a key that decide which models it can call. */
export type CCSwitchKey = {
  group?: string | null
  auto_groups?: readonly string[] | null
  model_limits_enabled?: boolean
  model_limits?: string | null
}

/** A `/api/pricing` model: its name and the groups that serve it. */
export type CCSwitchPricedModel = {
  model_name: string
  enable_groups?: readonly string[] | null
}

/**
 * The groups a key's requests run in, as the gateway resolves them: an empty
 * group means the user's own group, and `auto` means the key's Auto list, or
 * the user's global Auto list when the key has none.
 */
export function keyRequestGroups(
  key: CCSwitchKey,
  userGroup: string,
  globalAutoGroups: readonly string[]
): string[] {
  const group = key.group ?? ''
  if (group === '') return userGroup ? [userGroup] : []
  if (group !== 'auto') return [group]
  return [...(key.auto_groups?.length ? key.auto_groups : globalAutoGroups)]
}

/**
 * The models a key can call: those served in any of `groups`, narrowed to
 * the key's model limits when it has them.
 */
export function keyModels(
  key: CCSwitchKey,
  groups: readonly string[],
  pricing: readonly CCSwitchPricedModel[]
): string[] {
  const limits = key.model_limits_enabled
    ? new Set(
        (key.model_limits ?? '')
          .split(',')
          .map((name) => name.trim())
          .filter(Boolean)
      )
    : null
  return pricing
    .filter((model) =>
      (model.enable_groups ?? []).some((group) => groups.includes(group))
    )
    .map((model) => model.model_name)
    .filter((name) => !limits || limits.has(name))
}

/**
 * The client a key's models suit: the first whose own family the key can
 * call (Claude, then GPT, then Gemini, which goes to Gemini CLI before
 * Antigravity), else the first with any model it can run. Null when the key
 * reaches no model any client runs.
 */
export function defaultCCSwitchApp(
  models: readonly string[]
): CCSwitchApp | null {
  const own = CC_SWITCH_APPS.find((app) =>
    models.some((model) => APP_MODELS[app][0].test(model))
  )
  return (
    own ??
    CC_SWITCH_APPS.find(
      (app) => ccSwitchModelChoices(app, models).length > 0
    ) ??
    null
  )
}

/**
 * Models a CC Switch import starts with, picked from the user's models so a
 * new model version is chosen without a code change: Claude runs on Opus
 * and fills each family slot with its newest model; Codex runs on the newest
 * GPT `sol` model; Gemini CLI and Antigravity on the newest Gemini `neon`
 * model. A field is empty when no model fits.
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
  if (app === 'gemini' || app === 'agy') {
    return {
      model:
        newestModel(models, GEMINI_NEON) || newestModel(models, GEMINI_MODEL),
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

/**
 * The name the Antigravity CLI knows a Gemini model by. It lists models by
 * display name with a reasoning effort (`Gemini 4 Neon (High)`) and ignores
 * a model ID, so a CC Switch import for it carries that name. Every Gemini
 * model it lists has a High effort. Anything that is not a Gemini model ID,
 * such as a display name the user typed, is kept as it is.
 */
export function antigravityModelName(model: string): string {
  if (!/^gemini-[a-z0-9.-]+$/.test(model)) return model
  const words = model
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
  return `${words.join(' ')} (High)`
}
