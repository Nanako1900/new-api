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
export type HomeProvider = 'claude' | 'gpt'

export const HOME_PROVIDERS: HomeProvider[] = ['claude', 'gpt']

type NamedModel = {
  model_name?: string
  vendor_name?: string
}

const VENDOR_PATTERNS: Record<HomeProvider, RegExp> = {
  claude: /anthropic|claude/i,
  gpt: /openai|gpt/i,
}

// Non-chat models (images, audio, embeddings) sort after chat models.
const SECONDARY_MODEL_PATTERN = /image|dall-e|tts|whisper|audio|embedding/i

/** Whether a model serves images, audio or embeddings rather than chat. */
export function isSecondaryModel(modelName: string): boolean {
  return SECONDARY_MODEL_PATTERN.test(modelName)
}

/** How many model names each provider card lists. */
export const PROVIDER_MODEL_LIMIT = 4

/**
 * Which home provider a model belongs to, judged by its vendor name when
 * known and by the model name otherwise.
 */
export function providerOf(
  modelName: string,
  vendorName?: string
): HomeProvider | null {
  const haystack = vendorName || modelName
  for (const provider of HOME_PROVIDERS) {
    if (VENDOR_PATTERNS[provider].test(haystack)) return provider
  }
  return null
}

/**
 * Model names to show on a provider card: chat models first, then the rest,
 * each group in the order the pricing endpoint returns.
 */
export function pickProviderModels(
  models: NamedModel[],
  provider: HomeProvider
): string[] {
  const primary: string[] = []
  const secondary: string[] = []
  for (const model of models) {
    const name = model.model_name?.trim()
    if (!name || primary.includes(name) || secondary.includes(name)) continue
    if (providerOf(name, model.vendor_name) !== provider) continue
    if (isSecondaryModel(name)) secondary.push(name)
    else primary.push(name)
  }
  return [...primary, ...secondary].slice(0, PROVIDER_MODEL_LIMIT)
}
