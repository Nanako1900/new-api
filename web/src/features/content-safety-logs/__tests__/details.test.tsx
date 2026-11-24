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
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { afterEach, expect, it } from 'vitest'

import { ContentSafetyLogDetailsDialog } from '../components/content-safety-log-details-dialog'
import type { ContentSafetyLog } from '../types'

const rejected: ContentSafetyLog = {
  id: 1,
  event_id: 'event-rejected',
  created_at: 1788600600,
  request_id: 'req-42',
  user_id: 7,
  username: 'alice',
  token_id: 3,
  token_name: 'prod-key',
  group: 'default',
  model: 'custom-chat-model',
  request_path: '/v1/chat/completions',
  decision: 'review_rejected',
  failure_reason: '',
  hit_words: '["knife"]',
  snippets: '["how to sharpen a kitchen knife","then use the knife on him"]',
  ai_category: 'violence',
  ai_reason: 'Describes hurting a person',
  review_channel_id: 12,
  review_model: 'judge-model',
  latency_ms: 1350,
  review_tokens: 210,
  cache_hit: true,
  mode: 'sync',
  unit_count: 2,
  truncated: false,
  weight: 1,
}

async function openDetails(entry: ContentSafetyLog) {
  render(<ContentSafetyLogDetailsDialog entry={entry} />)
  await userEvent.click(screen.getByRole('button', { name: 'Details' }))
  return screen.findByRole('dialog', { name: 'Log Details' })
}

it('lists every stored snippet of a reviewed request in order', async () => {
  const dialog = await openDetails(rejected)
  const snippets = within(dialog).getByRole('list', { name: 'Snippets' })
  expect(
    within(snippets)
      .getAllByRole('listitem')
      .map((item) => item.textContent)
  ).toEqual(['how to sharpen a kitchen knife', 'then use the knife on him'])
})

it('shows the AI verdict, review channel, latency, tokens and cache use', async () => {
  const dialog = await openDetails(rejected)
  expect(within(dialog).getByText('violence')).toBeVisible()
  expect(within(dialog).getByText('Describes hurting a person')).toBeVisible()
  expect(within(dialog).getByText('judge-model')).toBeVisible()
  expect(within(dialog).getByText('#12')).toBeVisible()
  expect(within(dialog).getByText('1,350 ms')).toBeVisible()
  expect(within(dialog).getByText('210')).toBeVisible()
  expect(within(dialog).getByText('Yes')).toBeVisible()
})

it('opens a record whose hit words and snippets are not valid JSON and shows the stored text', async () => {
  const dialog = await openDetails({
    ...rejected,
    hit_words: 'knife,gun',
    snippets: '["a knife"',
  })
  const words = within(dialog).getByRole('list', { name: 'Categories' })
  expect(within(words).getByRole('listitem')).toHaveTextContent('knife,gun')
  const snippets = within(dialog).getByRole('list', { name: 'Snippets' })
  expect(within(snippets).getByRole('listitem')).toHaveTextContent('["a knife"')
})

it('a keyword block shows its decision without an AI review section', async () => {
  const dialog = await openDetails({
    ...rejected,
    decision: 'keyword_blocked',
    ai_category: '',
    ai_reason: '',
    review_model: '',
    review_channel_id: 0,
    latency_ms: 0,
    review_tokens: 0,
    cache_hit: false,
  })
  expect(within(dialog).getByText('Blocked by keyword')).toBeVisible()
  expect(within(dialog).queryByText('AI review')).not.toBeInTheDocument()
})

it('keeps repeated snippets and de-duplicates repeated hit words', async () => {
  const dialog = await openDetails({
    ...rejected,
    hit_words: '["knife","knife"]',
    snippets: '["same text","same text"]',
  })
  const words = within(dialog).getByRole('list', { name: 'Categories' })
  expect(within(words).getAllByRole('listitem')).toHaveLength(1)
  const snippets = within(dialog).getByRole('list', { name: 'Snippets' })
  expect(within(snippets).getAllByRole('listitem')).toHaveLength(2)
})

it('shows server text containing interpolation braces exactly as stored', async () => {
  const dialog = await openDetails({
    ...rejected,
    decision: 'new_{{count}}_decision',
    failure_reason: 'odd_{{reason}}',
    ai_reason: 'Said {{name}} twice',
    ai_category: '{{category}}',
  })
  expect(within(dialog).getByText('new_{{count}}_decision')).toBeVisible()
  expect(within(dialog).getByText('odd_{{reason}}')).toBeVisible()
  expect(within(dialog).getByText('Said {{name}} twice')).toBeVisible()
  expect(within(dialog).getByText('{{category}}')).toBeVisible()
})

it('gives each long snippet its own numbered copy button', async () => {
  const dialog = await openDetails({
    ...rejected,
    snippets: JSON.stringify(['a'.repeat(60), 'b'.repeat(60)]),
  })
  expect(
    within(dialog).getByRole('button', { name: 'Copy Snippet 1' })
  ).toBeVisible()
  expect(
    within(dialog).getByRole('button', { name: 'Copy Snippet 2' })
  ).toBeVisible()
})

it('lets a long hit word wrap and keeps its full text as the title', async () => {
  const word = 'x'.repeat(120)
  const dialog = await openDetails({
    ...rejected,
    hit_words: JSON.stringify([word]),
  })
  const badge = within(dialog).getByTitle(word)
  expect(badge).toHaveClass('whitespace-normal', 'h-auto')
})

it('omits the time of a record whose timestamp is not a number', async () => {
  const dialog = await openDetails({
    ...rejected,
    created_at: Number.NaN,
  })
  expect(within(dialog).queryByText('Invalid Date')).not.toBeInTheDocument()
})

it('an AI review shows its mode, pieces reviewed and truncation', async () => {
  const dialog = await openDetails({
    ...rejected,
    mode: 'async',
    unit_count: 12,
    truncated: true,
  })
  expect(within(dialog).getByText('Background')).toBeVisible()
  expect(within(dialog).getByText('12')).toBeVisible()
  expect(within(dialog).getByText('Truncated')).toBeVisible()
})

const REFUSED = 'The review channel refused to review this text'

async function openDetailsInChinese(entry: ContentSafetyLog) {
  i18next.addResourceBundle('zh', 'translation', {
    [REFUSED]: '审核渠道拒绝审核此文本',
    'Describes hurting a person': '不应出现的译文',
  })
  await i18next.changeLanguage('zh')
  return openDetails(entry)
}

afterEach(async () => {
  await i18next.changeLanguage('en')
  i18next.removeResourceBundle('zh', 'translation')
})

it('translates the reason the gateway stores for a refused text', async () => {
  const dialog = await openDetailsInChinese({
    ...rejected,
    decision: 'review_controversial',
    failure_reason: 'refused',
    ai_category: 'other',
    ai_reason: REFUSED,
  })
  expect(within(dialog).getByText('审核渠道拒绝审核此文本')).toBeVisible()
})

it('shows a reason the reviewer wrote as stored, even when it matches a translation key', async () => {
  const dialog = await openDetailsInChinese(rejected)
  expect(within(dialog).getByText('Describes hurting a person')).toBeVisible()
})

it('a keyword block labels its matches as hit words, not categories', async () => {
  const dialog = await openDetails({
    ...rejected,
    decision: 'keyword_blocked',
    mode: '',
  })
  expect(within(dialog).getByRole('list', { name: 'Hit words' })).toBeVisible()
  expect(
    within(dialog).queryByRole('list', { name: 'Categories' })
  ).not.toBeInTheDocument()
})
