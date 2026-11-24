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
import type { Table } from '@tanstack/react-table'
import { useId, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { Combobox } from '@/components/ui/combobox'
import { FieldError } from '@/components/ui/field'
import {
  LogsFilterField,
  LogsFilterInput,
  LogsFilterToolbar,
} from '@/features/usage-logs/components/logs-filter-toolbar'

import { RISK_LEVEL_PRESENTATION, RISK_LEVELS } from '../constants'
import type { RiskProfile, RiskProfileFilters } from '../types'

type FilterPatch = Partial<
  Pick<RiskProfileFilters, 'level' | 'trusted' | 'user_id' | 'username'>
>

// The typed text of the inputs, tied to the applied values it started from.
type TextDraft = { source: string; userId: string; username: string }

const USER_ID_PATTERN = /^[1-9]\d*$/
const EMPTY_SOURCE = '\n'

export function RiskProfileFilterBar(props: {
  table: Table<RiskProfile>
  filters: RiskProfileFilters
  onChange: (patch: FilterPatch) => void
  isFetching: boolean
  onRefresh: () => void
  onReset: () => void
}) {
  const { t } = useTranslation()
  const idPrefix = useId()
  const userIdErrorId = `${idPrefix}-user-id-error`
  const appliedUserId =
    props.filters.user_id === undefined ? '' : String(props.filters.user_id)
  const appliedUsername = props.filters.username ?? ''
  const source = `${appliedUserId}\n${appliedUsername}`
  const [draft, setDraft] = useState<TextDraft>({
    source,
    userId: appliedUserId,
    username: appliedUsername,
  })
  // New applied values (a link, Reset, Back) replace what was typed.
  const text =
    draft.source === source
      ? draft
      : { source, userId: appliedUserId, username: appliedUsername }
  let userIdError: string | undefined
  if (text.userId !== '' && !USER_ID_PATTERN.test(text.userId)) {
    userIdError = t('User ID must be a positive integer')
  } else if (text.userId !== '' && !Number.isSafeInteger(Number(text.userId))) {
    userIdError = t('User ID is too long')
  }

  const applyText = () => {
    if (userIdError) return
    const username = text.username.trim()
    if (text.userId === appliedUserId && username === appliedUsername) {
      props.onRefresh()
      return
    }
    props.onChange({
      user_id: text.userId === '' ? undefined : Number(text.userId),
      username: username || undefined,
    })
  }
  const applyOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') applyText()
  }

  const levelOptions = [
    { value: 'all', label: t('All levels') },
    ...RISK_LEVELS.map((level) => ({
      value: level,
      label: t(RISK_LEVEL_PRESENTATION[level].labelKey),
    })),
  ]
  const trustOptions = [
    { value: 'all', label: t('All') },
    { value: 'true', label: t('Trusted') },
    { value: 'false', label: t('Not trusted') },
  ]
  let trustValue = 'all'
  if (props.filters.trusted !== undefined) {
    trustValue = String(props.filters.trusted)
  }
  const filterCount = [
    props.filters.level,
    props.filters.trusted,
    props.filters.user_id,
    props.filters.username,
  ].filter((value) => value !== undefined).length

  return (
    <LogsFilterToolbar
      table={props.table}
      primaryFilters={
        <>
          <LogsFilterField>
            <Combobox
              options={levelOptions}
              value={props.filters.level ?? 'all'}
              onValueChange={(value) => {
                if (value === null) return
                props.onChange({
                  level: RISK_LEVELS.find((level) => level === value),
                })
              }}
              aria-label={t('Level')}
              className='w-full'
            />
          </LogsFilterField>
          <LogsFilterField>
            <Combobox
              options={trustOptions}
              value={trustValue}
              onValueChange={(value) => {
                if (value === null) return
                props.onChange({
                  trusted: value === 'all' ? undefined : value === 'true',
                })
              }}
              aria-label={t('Trusted')}
              className='w-full'
            />
          </LogsFilterField>
          <LogsFilterField>
            <LogsFilterInput
              aria-label={t('User ID')}
              placeholder={t('User ID')}
              inputMode='numeric'
              aria-invalid={userIdError ? true : undefined}
              aria-describedby={userIdError ? userIdErrorId : undefined}
              value={text.userId}
              onChange={(event) =>
                setDraft({ ...text, userId: event.target.value.trim() })
              }
              onKeyDown={applyOnEnter}
            />
            <FieldError id={userIdErrorId} className='mt-1 text-xs'>
              {userIdError}
            </FieldError>
          </LogsFilterField>
          <LogsFilterField>
            <LogsFilterInput
              aria-label={t('Username')}
              placeholder={t('Username')}
              value={text.username}
              onChange={(event) =>
                setDraft({ ...text, username: event.target.value })
              }
              onKeyDown={applyOnEnter}
            />
          </LogsFilterField>
        </>
      }
      hasActiveFilters={
        filterCount > 0 || text.userId !== '' || text.username !== ''
      }
      searchLoading={props.isFetching}
      onSearch={applyText}
      onReset={() => {
        setDraft({ source: EMPTY_SOURCE, userId: '', username: '' })
        props.onReset()
      }}
    />
  )
}
