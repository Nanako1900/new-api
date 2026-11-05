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
 * The site root clients should call: the admin-configured server address
 * when set, otherwise the current origin. Anthropic-style clients (Claude
 * Code) take this root directly; OpenAI-style clients append `/v1`.
 */
export function resolveApiRoot(serverAddress: unknown, origin: string): string {
  const configured =
    typeof serverAddress === 'string' ? serverAddress.trim() : ''
  return (configured || origin).replace(/\/+$/, '')
}

/** The OpenAI-compatible base URL (`<root>/v1`). */
export function resolveBaseUrl(serverAddress: unknown, origin: string): string {
  return `${resolveApiRoot(serverAddress, origin)}/v1`
}
