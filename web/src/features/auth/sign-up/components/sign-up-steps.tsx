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
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

const STEPS = ['Verify email', 'Set up account'] as const

type SignUpStepsProps = {
  /** Index of the active step in STEPS. */
  current: number
  className?: string
}

/** Progress of the two-step sign-up, styled after the home page steps. */
export function SignUpSteps(props: SignUpStepsProps) {
  const { t } = useTranslation()

  return (
    <ol
      aria-label={t('Sign-up steps')}
      className={cn('grid grid-cols-2 gap-3', props.className)}
    >
      {STEPS.map((step, index) => {
        const active = index === props.current
        const done = index < props.current
        return (
          <li
            key={step}
            aria-current={active ? 'step' : undefined}
            className={cn(
              'flex items-baseline gap-2 border-t-2 pt-2 text-sm',
              active || done
                ? 'border-meow-orange text-foreground'
                : 'border-border text-muted-foreground'
            )}
          >
            <span
              aria-hidden='true'
              className={cn(
                'font-mono text-xs',
                (active || done) && 'text-meow-accent-text'
              )}
            >
              {String(index + 1).padStart(2, '0')}
            </span>
            <span className={cn(active && 'font-semibold')}>{t(step)}</span>
            {done && <span className='sr-only'>{t('Completed')}</span>}
          </li>
        )
      })}
    </ol>
  )
}
