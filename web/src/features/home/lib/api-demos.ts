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
export type ApiDemoId = 'claude' | 'chat' | 'responses'

export type ApiDemo = {
  id: ApiDemoId
  label: string
  endpoint: string
  /** Request lines; `{root}` is replaced with the site root. */
  request: string[]
  response: string[]
  latencyMs: number
  tokens: number
}

export const API_DEMOS: ApiDemo[] = [
  {
    id: 'claude',
    label: 'Claude',
    endpoint: '/v1/messages',
    request: [
      'curl -X POST "{root}/v1/messages" \\',
      '  -H "x-api-key: sk-••••" \\',
      '  -H "anthropic-version: 2023-06-01" \\',
      "  -d '{",
      '    "model": "your-model",',
      '    "max_tokens": 1024,',
      '    "messages": [',
      '      { "role": "user", "content": "..." }',
      '    ]',
      "  }'",
    ],
    response: [
      '{',
      '  "content": [{ "type": "text", "text": "Claude message routed." }],',
      '  "usage": { "input_tokens": 12, "output_tokens": 17 }',
      '}',
    ],
    latencyMs: 156,
    tokens: 29,
  },
  {
    id: 'chat',
    label: 'Chat',
    endpoint: '/v1/chat/completions',
    request: [
      'curl -X POST "{root}/v1/chat/completions" \\',
      '  -H "Authorization: Bearer sk-••••" \\',
      "  -d '{",
      '    "model": "your-model",',
      '    "messages": [',
      '      { "role": "user", "content": "..." }',
      '    ]',
      "  }'",
    ],
    response: [
      '{',
      '  "choices": [{ "message": { "content": "Chat request routed." } }],',
      '  "usage": { "total_tokens": 27 }',
      '}',
    ],
    latencyMs: 142,
    tokens: 27,
  },
  {
    id: 'responses',
    label: 'Responses',
    endpoint: '/v1/responses',
    request: [
      'curl -X POST "{root}/v1/responses" \\',
      '  -H "Authorization: Bearer sk-••••" \\',
      "  -d '{",
      '    "model": "your-model",',
      '    "input": "..."',
      "  }'",
    ],
    response: [
      '{',
      '  "output": [{ "type": "output_text", "text": "Response ready." }],',
      '  "usage": { "total_tokens": 31 }',
      '}',
    ],
    latencyMs: 168,
    tokens: 31,
  },
]

export function renderDemoRequest(demo: ApiDemo, apiRoot: string): string[] {
  return demo.request.map((line) => line.replace('{root}', apiRoot))
}

export type KeyedLine = {
  /** Character offset of the line in the joined text; stable per content. */
  offset: number
  text: string
}

/** Lines paired with their offset in the joined text, for React keys. */
export function keyLines(lines: string[]): KeyedLine[] {
  const keyed: KeyedLine[] = []
  let offset = 0
  for (const text of lines) {
    keyed.push({ offset, text })
    offset += text.length + 1
  }
  return keyed
}

export type CodeTokenKind = 'key' | 'string' | 'number' | 'flag' | 'plain'

export type CodeToken = {
  kind: CodeTokenKind
  text: string
  /** Character offset of the token within its line. */
  start: number
}

// Quoted strings, numbers, curl flags; everything else is plain.
const TOKEN_PATTERN =
  /("(?:[^"\\]|\\.)*")|(\b\d+(?:\.\d+)?\b)|((?:^|\s)-[A-Za-z]\b)/g

/**
 * Split one line of a curl command or JSON body into highlightable tokens.
 * A quoted string followed by `:` is a key; other quoted strings are values.
 */
export function tokenizeCodeLine(line: string): CodeToken[] {
  const tokens: CodeToken[] = []
  let cursor = 0
  for (const match of line.matchAll(TOKEN_PATTERN)) {
    const start = match.index ?? 0
    if (start > cursor) {
      tokens.push({
        kind: 'plain',
        text: line.slice(cursor, start),
        start: cursor,
      })
    }
    const text = match[0]
    if (match[1]) {
      const isKey = line
        .slice(start + text.length)
        .trimStart()
        .startsWith(':')
      tokens.push({ kind: isKey ? 'key' : 'string', text, start })
    } else if (match[2]) {
      tokens.push({ kind: 'number', text, start })
    } else {
      tokens.push({ kind: 'flag', text, start })
    }
    cursor = start + text.length
  }
  if (cursor < line.length) {
    tokens.push({ kind: 'plain', text: line.slice(cursor), start: cursor })
  }
  return tokens
}
