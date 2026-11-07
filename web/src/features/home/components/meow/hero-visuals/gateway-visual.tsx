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
import {
  CherryStudio,
  Claude,
  ClaudeCode,
  Codex,
  Cursor,
  OpenAI,
} from '@lobehub/icons'
import type { ComponentType } from 'react'
import { useTranslation } from 'react-i18next'

import { CatEyes } from '@/components/cat-art'
import { cn } from '@/lib/utils'

import { HERO_GLASS, HeroStage } from './hero-stage'

/*
 * Layout in stage percentages. The SVG's viewBox is 100 x 90, the stage's
 * aspect ratio, so an SVG point (x, y) sits at (x%, y / 0.9 %) of the stage.
 */
const CLIENT_X = 17
const HUB_X = 50
const PROVIDER_X = 83
const HUB_Y = 45

type Node = {
  name: string
  icon: ComponentType<{ size?: number }>
  /** SVG y of the node's centre. */
  y: number
  /** Tailwind `top` matching `y` (Tailwind needs the literal class). */
  top: string
}

const CLIENTS: Node[] = [
  { name: 'Claude Code', icon: ClaudeCode, y: 18, top: 'top-[20%]' },
  { name: 'Codex', icon: Codex, y: 36, top: 'top-[40%]' },
  { name: 'Cursor', icon: Cursor, y: 54, top: 'top-[60%]' },
  { name: 'Cherry Studio', icon: CherryStudio, y: 72, top: 'top-[80%]' },
]

const PROVIDERS: Array<Node & { vendor: string; tile: string }> = [
  {
    name: 'Claude',
    vendor: 'Anthropic',
    icon: Claude,
    y: 27,
    top: 'top-[30%]',
    tile: 'bg-meow-orange text-meow-ink',
  },
  {
    name: 'GPT',
    vendor: 'OpenAI',
    icon: OpenAI,
    y: 63,
    top: 'top-[70%]',
    tile: 'bg-meow-ink text-white dark:bg-white/15',
  },
]

/** A horizontal S-curve between two centres; nodes cover its ends. */
function edgePath(x1: number, y1: number, x2: number, y2: number): string {
  const mid = (x1 + x2) / 2
  return `M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`
}

// Requests leave the tools in turn, then the hub relays them upstream.
// Delays are applied as negative offsets, so every pulse is already moving.
const EDGES = [
  ...CLIENTS.map((client, index) => ({
    id: `client-${client.name}`,
    d: edgePath(CLIENT_X, client.y, HUB_X, HUB_Y),
    delay: index * 0.7,
  })),
  ...PROVIDERS.map((provider, index) => ({
    id: `provider-${provider.name}`,
    d: edgePath(HUB_X, HUB_Y, PROVIDER_X, provider.y),
    delay: 1.4 + index * 1.4,
  })),
]

const NODE_GLASS =
  'border border-white/80 bg-white/75 shadow-[0_10px_24px_-14px_rgba(30,27,23,0.35)] backdrop-blur-md dark:border-white/10 dark:bg-white/[0.08] dark:shadow-none'

type GatewayVisualProps = {
  className?: string
}

/**
 * The gateway as a routing map: the tools on the left, one key in the
 * middle, Claude and GPT on the right, with requests travelling the lines.
 */
export function GatewayVisual(props: GatewayVisualProps) {
  const { t } = useTranslation()

  return (
    <HeroStage
      className={props.className}
      label={t(
        'A routing map: Claude Code, Codex, Cursor and Cherry Studio reach Claude and GPT through one API key'
      )}
    >
      <div
        className={cn(
          '@container relative mx-auto aspect-[10/9] w-full max-w-[34rem] overflow-hidden rounded-[26px]',
          HERO_GLASS
        )}
      >
        {/* Dot grid, fading out towards the edges. */}
        <div className='absolute inset-0 bg-[radial-gradient(rgba(30,27,23,0.14)_1px,transparent_1px)] [mask-image:radial-gradient(ellipse_at_center,black_35%,transparent_78%)] bg-size-[18px_18px] dark:bg-[radial-gradient(rgba(255,255,255,0.12)_1px,transparent_1px)]' />

        <svg
          viewBox='0 0 100 90'
          className='absolute inset-0 size-full'
          aria-hidden='true'
        >
          {EDGES.map((edge) => (
            <g key={edge.id}>
              <path
                d={edge.d}
                fill='none'
                strokeWidth={0.4}
                className='stroke-meow-ink/25 dark:stroke-white/20'
              />
              <path
                d={edge.d}
                fill='none'
                pathLength={100}
                strokeWidth={0.8}
                strokeLinecap='round'
                className='meow-flow stroke-meow-orange'
                style={{ animationDelay: `-${edge.delay}s` }}
              />
            </g>
          ))}
        </svg>

        <span className='text-muted-foreground absolute top-[6%] left-[17%] -translate-x-1/2 text-[10px] font-bold tracking-[0.16em] whitespace-nowrap uppercase'>
          {t('Your tools')}
        </span>
        <span className='text-muted-foreground absolute top-[6%] left-[83%] -translate-x-1/2 text-[10px] font-bold tracking-[0.16em] whitespace-nowrap uppercase'>
          {t('Official channels')}
        </span>

        {CLIENTS.map((client) => {
          const Icon = client.icon
          return (
            <span
              key={client.name}
              className={cn(
                'absolute left-[17%] flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-full py-1.5 pr-3 pl-1.5 @max-md:pr-1.5',
                client.top,
                NODE_GLASS
              )}
            >
              <span className='flex size-6 shrink-0 items-center justify-center rounded-full bg-white dark:bg-white/10'>
                <Icon size={14} />
              </span>
              <span className='text-[12px] font-bold whitespace-nowrap @max-md:hidden'>
                {client.name}
              </span>
            </span>
          )
        })}

        <div className='absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2.5'>
          <div className='relative'>
            <span className='bg-meow-orange/35 absolute -inset-4 rounded-full blur-xl' />
            <span className='meow-hub-ring border-meow-orange/60 absolute -inset-1.5 rounded-[clamp(18px,6cqw,26px)] border' />
            <div className='relative flex size-[clamp(58px,17cqw,84px)] items-center justify-center rounded-[clamp(16px,5cqw,24px)] bg-[#1e1b17] shadow-[0_20px_36px_-18px_rgba(30,27,23,0.7),inset_0_1px_0_rgba(255,255,255,0.14)] ring-1 ring-white/10'>
              <CatEyes onInk className='scale-[1.6]' />
            </div>
          </div>
          <span
            className={cn(
              'rounded-full px-2.5 py-1 font-mono text-[11px] font-semibold whitespace-nowrap',
              NODE_GLASS
            )}
          >
            sk-••••7f3a
          </span>
        </div>

        {PROVIDERS.map((provider) => {
          const Icon = provider.icon
          return (
            <div
              key={provider.name}
              className={cn(
                'absolute left-[83%] flex -translate-x-1/2 -translate-y-1/2 items-center gap-2.5 rounded-[16px] p-2 pr-3.5 @max-md:pr-2',
                provider.top,
                NODE_GLASS
              )}
            >
              <span
                className={cn(
                  'flex size-9 shrink-0 items-center justify-center rounded-[11px]',
                  provider.tile
                )}
              >
                <Icon size={20} />
              </span>
              <span className='flex flex-col @max-md:hidden'>
                <span className='text-sm leading-tight font-extrabold'>
                  {provider.name}
                </span>
                <span className='text-muted-foreground text-[11px]'>
                  {provider.vendor}
                </span>
              </span>
            </div>
          )
        })}
      </div>
    </HeroStage>
  )
}
