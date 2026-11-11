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

import { CopyButton } from '@/components/copy-button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useStatus } from '@/hooks/use-status'
import { resolveApiRoot } from '@/lib/api-root'
import { cn } from '@/lib/utils'

import {
  API_DEMOS,
  type ApiDemo,
  type ApiDemoId,
  type CodeTokenKind,
  keyLines,
  renderDemoRequest,
  tokenizeCodeLine,
} from '../../lib/api-demos'
import { HERO_GLASS, HeroStage } from './hero-visuals/hero-stage'

const TOKEN_CLASS: Record<CodeTokenKind, string> = {
  key: 'text-meow-syn-key',
  string: 'text-meow-syn-string',
  number: 'text-meow-syn-number',
  flag: 'text-meow-syn-flag',
  plain: 'text-foreground/80',
}

function CodeLines(props: { lines: string[] }) {
  return (
    <code className='block font-mono text-[12.5px] leading-[1.75] break-words whitespace-pre-wrap'>
      {keyLines(props.lines).map((line) => (
        <span key={line.offset} className='block'>
          {tokenizeCodeLine(line.text).map((token) => (
            <span key={token.start} className={TOKEN_CLASS[token.kind]}>
              {token.text}
            </span>
          ))}
        </span>
      ))}
    </code>
  )
}

/**
 * Every demo shares one grid cell and only the selected one is shown, so the
 * block keeps the tallest demo's height at any width and switching tabs does
 * not shift the hero.
 */
function DemoStack(props: {
  selectedId: ApiDemoId
  linesOf: (demo: ApiDemo) => string[]
}) {
  return (
    <div className='grid'>
      {API_DEMOS.map((item) => {
        const selected = item.id === props.selectedId
        return (
          <div
            key={item.id}
            aria-hidden={selected ? undefined : true}
            className={cn('col-start-1 row-start-1', !selected && 'invisible')}
          >
            <CodeLines lines={props.linesOf(item)} />
          </div>
        )
      })}
    </div>
  )
}

function SectionLabel(props: { children: string }) {
  return (
    <span className='text-meow-syn-muted font-sans text-[10px] font-bold tracking-[0.18em] uppercase'>
      {props.children}
    </span>
  )
}

type MeowCodeCardProps = {
  className?: string
}

/**
 * Frosted-glass API demo: request, response and timing for Claude and the
 * two OpenAI protocols. The blurred orange glow (top left) and dark glow
 * (right) sit where the logo's calico patches are.
 */
export function MeowCodeCard(props: MeowCodeCardProps) {
  const { status } = useStatus()
  const [demoId, setDemoId] = useState<ApiDemoId>('claude')
  const apiRoot = resolveApiRoot(status, window.location.origin)
  const demo = API_DEMOS.find((item) => item.id === demoId) ?? API_DEMOS[0]
  const request = renderDemoRequest(demo, apiRoot)

  return (
    <HeroStage className={props.className}>
      <div
        className={cn('relative overflow-hidden rounded-[22px]', HERO_GLASS)}
      >
        {/* Protocol tabs */}
        <Tabs
          value={demoId}
          onValueChange={(value) => setDemoId(value as ApiDemoId)}
        >
          <div className='flex items-center gap-2 border-b border-black/5 px-3 py-2.5 dark:border-white/10'>
            <TabsList variant='line' className='h-auto gap-1 p-0'>
              {API_DEMOS.map((item) => (
                <TabsTrigger
                  key={item.id}
                  value={item.id}
                  className='data-active:bg-primary! data-active:text-primary-foreground! h-8 rounded-[9px] px-3 text-[13px] font-bold after:hidden'
                >
                  {item.label}
                </TabsTrigger>
              ))}
            </TabsList>
            <CopyButton
              value={request.join('\n')}
              variant='ghost'
              size='icon'
              className='ml-auto'
            />
          </div>
        </Tabs>

        {/* Endpoint */}
        <div className='flex items-center gap-2.5 border-b border-black/5 px-5 py-3 dark:border-white/10'>
          <span className='bg-primary/20 text-meow-syn-key rounded-md px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-wider'>
            POST
          </span>
          <code className='truncate font-mono text-[12.5px]'>
            {demo.endpoint}
          </code>
          <span className='text-meow-syn-muted ml-auto flex items-center gap-1.5 font-mono text-[10px] tracking-wider uppercase'>
            <span className='bg-success size-1.5 rounded-full' />
            200 ok
          </span>
        </div>

        {/* Request */}
        <div className='flex flex-col gap-2 px-5 py-4'>
          <SectionLabel>Request</SectionLabel>
          <DemoStack
            selectedId={demo.id}
            linesOf={(item) => renderDemoRequest(item, apiRoot)}
          />
        </div>

        {/* Response */}
        <div className='flex flex-col gap-2 border-t border-black/5 bg-white/35 px-5 py-4 dark:border-white/10 dark:bg-black/20'>
          <SectionLabel>Response</SectionLabel>
          <DemoStack selectedId={demo.id} linesOf={(item) => item.response} />
        </div>

        {/* Metrics */}
        <div className='text-meow-syn-muted flex items-center gap-3 border-t border-black/5 px-5 py-2.5 font-mono text-[10px] tracking-wider uppercase tabular-nums dark:border-white/10'>
          <span>{demo.latencyMs} ms</span>
          <span aria-hidden='true'>·</span>
          <span>{demo.tokens} tokens</span>
          <span className='ml-auto'>stream · sse</span>
        </div>
      </div>
    </HeroStage>
  )
}
