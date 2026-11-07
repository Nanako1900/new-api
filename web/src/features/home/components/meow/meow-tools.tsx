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
import { CherryStudio, ClaudeCode, Cline, Codex, Cursor } from '@lobehub/icons'
import { ArrowRight } from 'lucide-react'
import type { ComponentType } from 'react'
import { useTranslation } from 'react-i18next'

import { useStatus } from '@/hooks/use-status'

type Tool = {
  name: string
  icon?: ComponentType<{ size?: number }>
}

const TOOLS: Tool[] = [
  { name: 'Claude Code', icon: ClaudeCode },
  { name: 'Codex', icon: Codex },
  { name: 'Cherry Studio', icon: CherryStudio },
  { name: 'CC Switch' },
  { name: 'Cursor', icon: Cursor },
  { name: 'Cline', icon: Cline },
]

/** Row of common clients that work with the site out of the box. */
export function MeowTools() {
  const { t } = useTranslation()
  const { status } = useStatus()
  const docsUrl =
    (status?.docs_link as string | undefined) || 'https://docs.newapi.pro'

  return (
    <section className='mx-auto flex max-w-6xl flex-col gap-6 px-4 pb-20 sm:px-8'>
      <div className='flex flex-wrap items-end justify-between gap-4'>
        <h2 className='text-2xl font-extrabold tracking-[-0.03em] md:text-3xl'>
          {t('Works with the tools you use')}
        </h2>
        <a
          href={docsUrl}
          target='_blank'
          rel='noopener noreferrer'
          className='text-primary inline-flex items-center gap-1.5 text-[15px] font-bold'
        >
          {t('Setup docs')}
          <ArrowRight className='size-4' aria-hidden='true' />
        </a>
      </div>
      <div className='relative'>
        <ul className='relative grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6'>
          {TOOLS.map((tool) => {
            const Icon = tool.icon
            return (
              <li
                key={tool.name}
                className='flex min-w-0 items-center gap-2.5 rounded-2xl border border-white/75 bg-white/30 px-3.5 py-3 text-sm font-bold whitespace-nowrap shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_14px_28px_-20px_rgba(30,27,23,0.28)] dark:border-white/10 dark:bg-white/[0.04] dark:shadow-none'
              >
                <span className='flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-white/60 dark:bg-white/10'>
                  {Icon ? (
                    <Icon size={20} />
                  ) : (
                    <span className='text-meow-accent-text text-xs font-extrabold'>
                      CC
                    </span>
                  )}
                </span>
                <span className='truncate'>{tool.name}</span>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}
