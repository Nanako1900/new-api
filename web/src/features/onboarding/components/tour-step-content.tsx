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
import { useNavigate } from '@tanstack/react-router'
import { Compass, ExternalLink } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import { useOnboardingStore } from '@/stores/onboarding-store'

import {
  CC_SWITCH_DOWNLOAD_URL,
  KEY_GROUP_TRIGGER,
  KEY_NAME_INPUT,
  KEYS_PATH,
  TOUR_STEPS,
  type TourStepId,
} from '../lib/tour'

// i18n keys of each step's title and line.
const STEP_COPY: Record<TourStepId, { title: string; body: string }> = {
  welcome: {
    title: 'Welcome to MeowAPI',
    body: 'A few clicks connect Claude Code or Codex. The spot to click lights up each time.',
  },
  install: {
    title: 'First, install CC Switch',
    body: 'CC Switch is a free desktop app. It fills the MeowAPI address and your key into Claude Code and Codex.',
  },
  'open-keys': {
    title: 'Open API Keys',
    body: 'Your keys live here. Click it.',
  },
  'create-key': {
    title: 'Create a key',
    body: 'Click here to make your first key.',
  },
  'name-key': {
    title: 'Name your key',
    body: 'Give it a name you will recognize, like My laptop, then click Next.',
  },
  'pick-group': {
    title: 'Pick a group',
    body: "The group decides which models this key can use and at what rate; each group's note is in the list. Claude Code needs a Claude group, Codex a GPT group. Using both? Make one key for each.",
  },
  'save-key': {
    title: 'Save the key',
    body: 'Click Save changes to create the key.',
  },
  'open-cc-switch': {
    title: 'Send the key to CC Switch',
    body: 'Click CC Switch on your key.',
  },
  'pick-app': {
    title: 'Pick your tool and models',
    body: "Match the key's group: Claude for a Claude group (Claude Code), Codex for a GPT group. Default models are filled in; open a list to pick another.",
  },
  import: {
    title: 'Open CC Switch',
    body: 'Click here. If the browser asks whether to open CC Switch, allow it.',
  },
  done: {
    title: 'Last step, in CC Switch',
    body: 'Click Import in the CC Switch window and you are set. Then send a message from Claude Code or Codex.',
  },
}

type TourStepContentProps = {
  step: TourStepId
  /** False when the highlighted element is not on screen. */
  targetFound: boolean
  /** A card in the middle of the window: larger type and buttons. */
  card: boolean
  onSkip: () => void
}

/** The guide bubble's text and buttons for one tour step. */
export function TourStepContent(props: TourStepContentProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const userId = useAuthStore((state) => state.auth.user?.id)
  const updateRun = useOnboardingStore((state) => state.updateRun)
  const markProgress = useOnboardingStore((state) => state.markProgress)
  const endTour = useOnboardingStore((state) => state.endTour)

  const passInstall = () => {
    if (userId !== undefined) markProgress(userId, { installed: true })
    updateRun({ installed: true })
  }

  const downloadLink = (
    <a href={CC_SWITCH_DOWNLOAD_URL} target='_blank' rel='noreferrer' />
  )
  // The sidebar is hidden on narrow screens, so the step links the page.
  const linkKeysPage = props.step === 'open-keys' && !props.targetFound
  const copy = STEP_COPY[props.step]
  const progress = TOUR_STEPS.indexOf(props.step) / (TOUR_STEPS.length - 1)
  const size = props.card ? 'default' : 'sm'

  let actions: ReactNode = null
  if (props.step === 'welcome') {
    actions = (
      <Button size={size} onClick={() => updateRun({ welcomed: true })}>
        {t('Start')}
      </Button>
    )
  } else if (props.step === 'install') {
    actions = (
      <>
        <Button variant='outline' size={size} onClick={passInstall}>
          {t('Already installed')}
        </Button>
        <Button size={size} render={downloadLink} onClick={passInstall}>
          {t('Download CC Switch')}
          <ExternalLink aria-hidden='true' />
        </Button>
      </>
    )
  } else if (props.step === 'name-key') {
    // The step moves on once the named field loses focus, so Next hands
    // focus to the group field, or back to an empty name field.
    const finishNaming = () => {
      const input = document.querySelector<HTMLInputElement>(KEY_NAME_INPUT)
      if (!input?.value.trim()) {
        input?.focus()
        return
      }
      document.querySelector<HTMLElement>(KEY_GROUP_TRIGGER)?.focus()
    }
    actions = (
      <Button size={size} onClick={finishNaming}>
        {t('Next')}
      </Button>
    )
  } else if (props.step === 'pick-app') {
    actions = (
      <Button size={size} onClick={() => updateRun({ pickedApp: true })}>
        {t('Next')}
      </Button>
    )
  } else if (props.step === 'done') {
    actions = (
      <Button size={size} onClick={endTour}>
        {t('Done')}
      </Button>
    )
  } else if (linkKeysPage) {
    actions = (
      <Button size={size} onClick={() => navigate({ to: KEYS_PATH })}>
        {t('Take me there')}
      </Button>
    )
  }

  return (
    <>
      <div
        aria-hidden='true'
        className='bg-muted h-1.5 overflow-hidden rounded-full'
      >
        <div
          className='bg-primary h-full rounded-full transition-[width] duration-300'
          style={{ width: `${Math.max(progress, 0.06) * 100}%` }}
        />
      </div>
      <div className={cn('flex flex-col', props.card ? 'gap-2.5' : 'gap-2')}>
        <h2
          className={cn(
            'font-extrabold tracking-[-0.01em]',
            props.card ? 'text-[22px] leading-tight' : 'text-[17px]'
          )}
        >
          {t(copy.title)}
        </h2>
        <p
          className={cn(
            'text-muted-foreground leading-relaxed',
            props.card ? 'text-base' : 'text-[15px]'
          )}
        >
          {linkKeysPage
            ? t('Your keys live on the API Keys page.')
            : t(copy.body)}
        </p>
        {props.step === 'done' && (
          <a
            href={CC_SWITCH_DOWNLOAD_URL}
            target='_blank'
            rel='noreferrer'
            className='text-primary text-sm font-bold underline-offset-4 hover:underline'
          >
            {t('Nothing happened? Install CC Switch first.')}
          </a>
        )}
      </div>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        {props.step === 'done' ? (
          <span className='text-muted-foreground inline-flex min-w-0 flex-1 items-center gap-1.5 text-sm'>
            <Compass
              className='text-primary size-4 shrink-0'
              aria-hidden='true'
            />
            {t(
              'Want to see this again? Click Getting started at the bottom left.'
            )}
          </span>
        ) : (
          <Button
            variant='ghost'
            size={size}
            className='text-muted-foreground -ml-2'
            onClick={props.onSkip}
          >
            {props.step === 'welcome' ? t('Skip') : t('Skip guide')}
          </Button>
        )}
        <div className='flex flex-wrap gap-2'>{actions}</div>
      </div>
    </>
  )
}
