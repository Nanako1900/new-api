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
import { Claude, OpenAI } from '@lobehub/icons'
import { Check } from 'lucide-react'
import { useReducedMotion } from 'motion/react'
import { useEffect, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

import { formatLatency } from '@/features/performance-metrics/lib/format'
import { useStatus } from '@/hooks/use-status'
import { cn } from '@/lib/utils'

import { resolveApiRoot } from '../../../lib/base-url'
import { HERO_GLASS, HeroStage } from './hero-stage'

/** Delay before the first replaced URL starts typing. */
const TYPE_START_S = 0.5
const TYPE_CHAR_S = 0.045
/** Pause before a reply starts streaming, while the model "thinks". */
const THINK_MS = 900
const STREAM_TICK_MS = 34
/** How long a finished reply stays before the next question. */
const HOLD_MS = 3400

type EnvLine = {
  kind: 'removed' | 'added'
  name: string
  value: string
}

type Exchange = {
  provider: 'claude' | 'gpt'
  question: string
  answer: string
  latencyMs: number
}

const PROVIDER_META = {
  claude: {
    name: 'Claude',
    icon: Claude,
    tile: 'bg-meow-orange text-meow-ink',
  },
  gpt: {
    name: 'GPT',
    icon: OpenAI,
    tile: 'bg-meow-ink text-white dark:bg-white/15',
  },
} as const

/** One `.env` line of the diff; added URLs type themselves out once. */
function EnvDiffLine(props: { line: EnvLine; typeDelayS: number }) {
  const added = props.line.kind === 'added'
  const typeStyle = {
    '--chars': props.line.value.length,
    '--type-delay': `${props.typeDelayS}s`,
    '--type-duration': `${props.line.value.length * TYPE_CHAR_S}s`,
  } as CSSProperties

  return (
    <span
      className={cn(
        'flex gap-3 px-4 py-[3px] whitespace-nowrap',
        added && 'bg-meow-code-accent/10'
      )}
    >
      <span
        className={cn(
          'w-2 shrink-0 select-none',
          added ? 'text-meow-code-number' : 'text-[#e98f80]'
        )}
      >
        {added ? '+' : '-'}
      </span>
      <span
        className={cn(
          added
            ? 'text-meow-code-key'
            : 'text-meow-code-muted decoration-meow-code-muted/70 line-through'
        )}
      >
        {props.line.name}=
        <span
          className={cn(
            added && 'meow-type text-meow-code-accent inline-block'
          )}
          style={added ? typeStyle : undefined}
        >
          {props.line.value}
        </span>
      </span>
    </span>
  )
}

/**
 * Change one line, keep the rest: a `.env` diff swapping the official base
 * URLs for this site's, over a chat where Claude and GPT take turns
 * answering through it.
 */
export function BaseUrlVisual(props: { className?: string }) {
  const { t } = useTranslation()
  const reduceMotion = useReducedMotion()
  const { status } = useStatus()
  const [index, setIndex] = useState(0)
  const [streamed, setStreamed] = useState(0)

  const root = resolveApiRoot(status?.server_address, window.location.origin)
  const envLines: EnvLine[] = [
    {
      kind: 'removed',
      name: 'ANTHROPIC_BASE_URL',
      value: 'https://api.anthropic.com',
    },
    { kind: 'added', name: 'ANTHROPIC_BASE_URL', value: root },
    {
      kind: 'removed',
      name: 'OPENAI_BASE_URL',
      value: 'https://api.openai.com/v1',
    },
    { kind: 'added', name: 'OPENAI_BASE_URL', value: `${root}/v1` },
  ]
  const exchanges: Exchange[] = [
    {
      provider: 'claude',
      question: t('Hi Claude, are you there?'),
      answer: t('Here and ready. Same SDK, same code, just a new Base URL.'),
      latencyMs: 640,
    },
    {
      provider: 'gpt',
      question: t('And you, GPT?'),
      answer: t('Same key, same endpoint. Each call lands in your usage log.'),
      latencyMs: 520,
    },
  ]
  const exchange = exchanges[index]
  const answer = exchange.answer

  // Stream the current answer, hold it, then move to the next exchange.
  useEffect(() => {
    if (reduceMotion) return
    // A new answer (next exchange or another language) streams from the start.
    setStreamed(0)
    let shown = 0
    let timer = 0
    const tick = () => {
      shown += 1
      setStreamed(shown)
      if (shown < answer.length) {
        timer = window.setTimeout(tick, STREAM_TICK_MS)
        return
      }
      timer = window.setTimeout(() => {
        setStreamed(0)
        setIndex((value) => (value + 1) % 2)
      }, HOLD_MS)
    }
    timer = window.setTimeout(tick, THINK_MS)
    return () => window.clearTimeout(timer)
  }, [answer, reduceMotion])

  const visibleChars = reduceMotion ? answer.length : streamed
  const thinking = visibleChars === 0
  const done = visibleChars >= answer.length
  const provider = PROVIDER_META[exchange.provider]
  const ProviderIcon = provider.icon

  // The second added URL starts typing once the first one has finished.
  const secondTypeDelayS = TYPE_START_S + root.length * TYPE_CHAR_S + 0.3

  return (
    <HeroStage
      className={props.className}
      label={t(
        'A .env file swapping the official base URLs for this site, above a chat answered by Claude and GPT'
      )}
    >
      <div className='relative mx-auto flex w-full max-w-[34rem] flex-col'>
        <div className='bg-meow-code text-meow-code-fg relative mr-[6%] overflow-hidden rounded-[20px] shadow-[0_30px_60px_-30px_rgba(30,27,23,0.6)] ring-1 ring-white/10'>
          <div className='flex items-center gap-3 border-b border-white/[0.08] px-4 py-3'>
            <span className='flex gap-1.5'>
              <span className='bg-meow-code-accent size-2.5 rounded-full' />
              <span className='size-2.5 rounded-full bg-[#f3efe8]/80' />
              <span className='size-2.5 rounded-full bg-white/20' />
            </span>
            <span className='text-meow-code-muted font-mono text-[12px]'>
              .env
            </span>
            <span className='text-meow-code-muted ml-auto text-[11px] font-bold'>
              {t('One line per SDK')}
            </span>
          </div>
          <code className='no-scrollbar block overflow-x-auto pt-3 pb-11 font-mono text-[10.5px] leading-[1.7] sm:text-[12.5px]'>
            {envLines.map((line, lineIndex) => (
              <EnvDiffLine
                // Keyed by value: when the site address arrives after mount,
                // the line types out again with timing for its new length.
                key={`${line.kind}-${line.name}-${line.value}`}
                line={line}
                typeDelayS={lineIndex < 2 ? TYPE_START_S : secondTypeDelayS}
              />
            ))}
          </code>
        </div>

        <div
          className={cn(
            'relative z-10 -mt-7 ml-[6%] flex flex-col gap-3 rounded-[22px] p-4',
            HERO_GLASS
          )}
        >
          <span className='bg-meow-ink max-w-[80%] self-end rounded-[16px] rounded-br-[6px] px-3.5 py-2 text-[13.5px] text-white dark:bg-[#2e2924]'>
            {exchange.question}
          </span>

          <div className='flex items-start gap-2.5'>
            <span
              className={cn(
                'flex size-8 shrink-0 items-center justify-center rounded-[10px]',
                provider.tile
              )}
            >
              <ProviderIcon size={16} />
            </span>
            <div className='flex min-w-0 flex-1 flex-col gap-1.5'>
              <span className='min-h-[2.75rem] rounded-[16px] rounded-tl-[6px] bg-white/75 px-3.5 py-2 text-[13.5px] leading-relaxed dark:bg-white/[0.07]'>
                {thinking ? (
                  <span className='flex h-[1.4rem] items-center gap-1'>
                    <span className='bg-muted-foreground/60 size-1.5 rounded-full motion-safe:animate-bounce' />
                    <span className='bg-muted-foreground/60 size-1.5 rounded-full [animation-delay:120ms] motion-safe:animate-bounce' />
                    <span className='bg-muted-foreground/60 size-1.5 rounded-full [animation-delay:240ms] motion-safe:animate-bounce' />
                  </span>
                ) : (
                  <>
                    {answer.slice(0, visibleChars)}
                    {!done && (
                      <span className='bg-primary terminal-demo-blink ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[2px]' />
                    )}
                  </>
                )}
              </span>
              <span
                className={cn(
                  'text-muted-foreground flex items-center gap-1.5 px-1 text-[11px] font-semibold transition-opacity duration-300',
                  done ? 'opacity-100' : 'opacity-0'
                )}
              >
                {provider.name}
                <span>·</span>
                <span className='tabular-nums'>
                  {formatLatency(exchange.latencyMs)}
                </span>
                <span>·</span>
                <Check className='text-success size-3' aria-hidden='true' />
                <span>{t('Logged to usage')}</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </HeroStage>
  )
}
