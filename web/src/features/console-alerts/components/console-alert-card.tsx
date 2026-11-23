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
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { RichContent } from '@/components/rich-content'
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert'
import { cn } from '@/lib/utils'

import {
  ALERT_LEVEL_CLASS,
  ALERT_LEVEL_ICON,
  ALERT_LEVEL_META,
} from '../constants'
import type { ConsoleAlert } from '../types'

type ConsoleAlertCardProps = {
  alert: Pick<ConsoleAlert, 'title' | 'content' | 'level'>
  /** Prefix of the title and content element ids (`<prefix>-title`). */
  idPrefix: string
  className?: string
  /** Shown under the content, e.g. when the alert was published */
  footer?: ReactNode
  /**
   * Live-region role for alerts that appear on their own; omit it in a list
   * the user opened on purpose, so screen readers do not announce it again.
   */
  role?: 'alert' | 'status'
  action?: ReactNode
}

/** One console alert: level icon and label, optional title, Markdown body. */
export function ConsoleAlertCard(props: ConsoleAlertCardProps) {
  const { t } = useTranslation()
  const LevelIcon = ALERT_LEVEL_ICON[props.alert.level]
  return (
    <Alert
      // Alert defaults to role="alert"; an explicit undefined drops it.
      role={props.role}
      className={cn(ALERT_LEVEL_CLASS[props.alert.level], props.className)}
    >
      <LevelIcon aria-hidden='true' />
      <span className='sr-only'>
        {t(ALERT_LEVEL_META[props.alert.level].labelKey)}
      </span>
      {props.alert.title ? (
        <AlertTitle
          id={`${props.idPrefix}-title`}
          className='[overflow-wrap:anywhere]'
        >
          {props.alert.title}
        </AlertTitle>
      ) : null}
      <AlertDescription id={`${props.idPrefix}-content`}>
        <RichContent
          breaks
          content={props.alert.content}
          className='[&_a]:text-foreground'
        />
        {props.footer ? (
          <div className='mt-1 text-xs'>{props.footer}</div>
        ) : null}
      </AlertDescription>
      {props.action ? <AlertAction>{props.action}</AlertAction> : null}
    </Alert>
  )
}
