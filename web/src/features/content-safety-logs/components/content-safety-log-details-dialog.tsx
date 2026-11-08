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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { AuditDetailValue } from '@/features/usage-logs/audit/components/audit-detail-value'
import {
  DetailRow,
  DetailSection,
} from '@/features/usage-logs/components/dialogs/log-detail-layout'
import { toIntlLocale } from '@/i18n/languages'
import dayjs from '@/lib/dayjs'
import { formatNumber } from '@/lib/format'
import { translateServerText } from '@/lib/server-error-message'

import {
  decisionPresentation,
  failureReasonLabelKey,
  parseStringList,
} from '../lib/log-fields'
import type { ContentSafetyLog } from '../types'

export function ContentSafetyLogDetailsDialog(props: {
  entry: ContentSafetyLog
}) {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const decision = decisionPresentation(props.entry.decision)
  const hitWords = parseStringList(props.entry.hit_words, { unique: true })
  // Every stored snippet is listed in order, so repeated text needs an index key.
  const snippets = parseStringList(props.entry.snippets).map(
    (text, position) => ({ key: `snippet-${position}`, text })
  )
  const reviewed = props.entry.decision !== 'keyword_blocked'

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={t('Log Details')}
      description={t('View the complete details for this log entry')}
      descriptionClassName='sr-only'
      trigger={
        <Button variant='ghost' size='sm' className='h-7 px-2'>
          {t('Details')}
        </Button>
      }
      contentClassName='min-w-0 sm:max-w-lg max-sm:max-h-(--dialog-available-height) max-sm:w-[calc(100vw-1.5rem)] max-sm:max-w-[calc(100vw-1.5rem)]'
      titleClassName='text-base'
      contentHeight='auto'
      bodyClassName='space-y-3'
    >
      <div className='flex flex-wrap items-center gap-2 text-xs'>
        <StatusBadge
          label={translateServerText(t, decision.labelKey)}
          variant={decision.variant}
          copyable={false}
        />
        {props.entry.failure_reason && (
          <span>
            {translateServerText(
              t,
              failureReasonLabelKey(props.entry.failure_reason)
            )}
          </span>
        )}
        <span className='text-muted-foreground tabular-nums'>
          {dayjs.unix(props.entry.created_at).format('YYYY-MM-DD HH:mm:ss')}
        </span>
      </div>
      <DetailSection label={t('Request')}>
        <DetailRow
          label={t('User')}
          value={`${props.entry.username || '—'} (#${props.entry.user_id})`}
        />
        <DetailRow
          label={t('Token Name')}
          value={props.entry.token_name || '—'}
        />
        <DetailRow label={t('Group')} value={props.entry.group || '—'} />
        <DetailRow label={t('Model')} value={props.entry.model || '—'} mono />
        <DetailRow
          label={t('Request Path')}
          value={props.entry.request_path || '—'}
          mono
        />
        {props.entry.request_id && (
          <DetailRow
            label={t('Request ID')}
            value={
              <AuditDetailValue
                label={t('Request ID')}
                value={props.entry.request_id}
                mono
                copyable
              />
            }
          />
        )}
      </DetailSection>
      <DetailSection label={t('Matched content')}>
        <DetailRow
          label={t('Hit words')}
          value={
            hitWords.length > 0 ? (
              <ul aria-label={t('Hit words')} className='flex flex-wrap gap-1'>
                {hitWords.map((word) => (
                  <li key={word}>
                    <StatusBadge
                      label={word}
                      variant='neutral'
                      copyable={false}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              '—'
            )
          }
        />
        <DetailRow
          label={t('Snippets')}
          value={
            snippets.length > 0 ? (
              <ul aria-label={t('Snippets')} className='space-y-1.5'>
                {snippets.map((snippet) => (
                  <li key={snippet.key}>
                    <AuditDetailValue
                      label={t('Snippets')}
                      value={snippet.text}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              '—'
            )
          }
        />
      </DetailSection>
      {reviewed && (
        <DetailSection label={t('AI review')}>
          <DetailRow
            label={t('Category')}
            value={props.entry.ai_category || '—'}
          />
          <DetailRow
            label={t('Reason')}
            value={
              props.entry.ai_reason ? (
                <AuditDetailValue
                  label={t('Reason')}
                  value={props.entry.ai_reason}
                />
              ) : (
                '—'
              )
            }
          />
          <DetailRow
            label={t('Review model')}
            value={props.entry.review_model || '—'}
            mono
          />
          <DetailRow
            label={t('Review channel')}
            value={
              props.entry.review_channel_id > 0
                ? `#${props.entry.review_channel_id}`
                : '—'
            }
            mono
          />
          <DetailRow
            label={t('Latency')}
            value={`${formatNumber(props.entry.latency_ms, locale)} ${t('ms')}`}
          />
          <DetailRow
            label={t('Review tokens')}
            value={formatNumber(props.entry.review_tokens, locale)}
          />
          <DetailRow
            label={t('Cache hit')}
            value={props.entry.cache_hit ? t('Yes') : t('No')}
          />
        </DetailSection>
      )}
    </Dialog>
  )
}
