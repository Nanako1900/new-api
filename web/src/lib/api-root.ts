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
/**
 * An `/api/status` payload, or the legacy `{ data: ... }` wrapper around it.
 * Only `api_info` and `server_address` (or legacy `serverAddress`) are read.
 */
export type ApiAddressStatus =
  | Readonly<Record<string, unknown>>
  | null
  | undefined

// A trailing OpenAI/Gemini version segment, optionally followed by a common
// endpoint, so `https://x/v1/chat/completions` reduces to `https://x`. A `/v1`
// in the middle of a gateway path (`https://x/v1/openai`) is kept.
const VERSION_SUFFIX =
  /\/v1(?:beta)?(?:\/(?:chat\/completions|completions|responses|messages|embeddings|models))?$/

/**
 * The API root clients should call. The first "API info" entry with an
 * http(s) URL wins, so the console can advertise a dedicated API host
 * (for example `api.example.com`) while `server_address` stays the site used
 * for OAuth callbacks, emails and payment returns. Without one, the server
 * address is used, then the current origin. Anthropic-style clients
 * (Claude Code) take this root directly; OpenAI-style clients append `/v1`.
 */
export function resolveApiRoot(
  status: ApiAddressStatus,
  origin: string
): string {
  const nested = status?.data as Record<string, unknown> | undefined
  const apiInfo = status?.api_info ?? nested?.api_info
  for (const item of Array.isArray(apiInfo) ? apiInfo : []) {
    const url = (item as { url?: unknown } | null)?.url
    if (typeof url !== 'string') continue
    let parsed: URL
    try {
      parsed = new URL(url.trim())
    } catch {
      continue
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue
    const path = parsed.pathname
      .replace(/\/+$/, '')
      .replace(VERSION_SUFFIX, '')
      .replace(/\/+$/, '')
    return `${parsed.origin}${path}`
  }

  const serverAddress =
    status?.server_address ??
    status?.serverAddress ??
    nested?.server_address ??
    nested?.serverAddress
  const configured =
    typeof serverAddress === 'string' ? serverAddress.trim() : ''
  return (configured || origin).replace(/\/+$/, '')
}
