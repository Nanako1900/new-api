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
import { useRouterState } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { useAuthStore } from '@/stores/auth-store'
import {
  selectOnboardingProgress,
  useOnboardingStore,
} from '@/stores/onboarding-store'

import {
  currentTourStep,
  DIALOG_STEPS,
  readTourPage,
  TOUR_TARGETS,
  type TourRect,
  type TourStepId,
} from '../lib/tour'
import { TourLayer } from './tour-layer'
import { TourStepContent } from './tour-step-content'

// Wide enough for the desktop sidebar; smaller screens start the tour by hand.
const AUTO_START_QUERY = '(min-width: 768px)'

type TourView = { step: TourStepId | null; target: TourRect | null }

/** The highlighted element's box, or null when it is missing or off screen. */
function findTarget(step: TourStepId | null): TourRect | null {
  const selector = step ? TOUR_TARGETS[step] : undefined
  const box = selector
    ? document.querySelector(selector)?.getBoundingClientRect()
    : undefined
  if (!box || box.width === 0 || box.height === 0) return null
  if (box.right <= 0 || box.left >= window.innerWidth) return null
  return { top: box.top, left: box.left, width: box.width, height: box.height }
}

/**
 * The console onboarding tour: opens once per account in each browser and
 * walks the user from a new key to CC Switch, one highlighted click at a
 * time. Mounted once in the console layout.
 */
export function OnboardingTour() {
  const { t } = useTranslation()
  const userId = useAuthStore((state) => state.auth.user?.id)
  const seen = useOnboardingStore(selectOnboardingProgress(userId)).seen
  const run = useOnboardingStore((state) => state.run)
  const startTour = useOnboardingStore((state) => state.startTour)
  const endTour = useOnboardingStore((state) => state.endTour)
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const [view, setView] = useState<TourView>({ step: null, target: null })
  const [confirmingSkip, setConfirmingSkip] = useState(false)
  const [nudge, setNudge] = useState(0)

  const activeRun = run && run.userId === userId ? run : null

  useEffect(() => {
    if (userId === undefined || seen || activeRun) return
    if (!window.matchMedia(AUTO_START_QUERY).matches) return
    startTour(userId)
  }, [userId, seen, activeRun, startTour])

  // Steps follow drawers and dialogs opening, and targets move while they
  // animate in, so the page is read on every frame while the tour runs.
  useEffect(() => {
    if (!activeRun) return
    let frame = 0
    let shown = ''
    const follow = () => {
      const step = currentTourStep(activeRun, readTourPage(pathname))
      const next = { step, target: findTarget(step) }
      // Re-render only when the step or the element's box changed.
      const key = JSON.stringify(next)
      if (key !== shown) {
        shown = key
        setView(next)
      }
      frame = requestAnimationFrame(follow)
    }
    follow()
    return () => cancelAnimationFrame(frame)
  }, [activeRun, pathname])

  if (!activeRun) return null

  const skipDialog = (
    <ConfirmDialog
      open={confirmingSkip}
      onOpenChange={setConfirmingSkip}
      title={t('Skip the guide?')}
      desc={t(
        'You can open it again any time from Getting started at the bottom of the left sidebar.'
      )}
      confirmText={t('Skip')}
      cancelBtnText={t('Keep going')}
      handleConfirm={() => {
        setConfirmingSkip(false)
        endTour()
      }}
    />
  )

  // A pointing step waits for its element, except the sidebar link: on a
  // narrow screen it is hidden, and the step offers a button instead.
  const step = view.step
  if (confirmingSkip || step === null) return skipDialog
  const waitingForTarget =
    TOUR_TARGETS[step] !== undefined &&
    view.target === null &&
    step !== 'open-keys'
  if (waitingForTarget) return skipDialog

  return (
    <>
      {skipDialog}
      {/* Keyed by step: a fresh node counts as outside an open dialog, so
          clicks on it do not close the dialog. */}
      {createPortal(
        <TourLayer
          key={step}
          target={view.target}
          nudge={nudge}
          inDialog={DIALOG_STEPS.has(step)}
          card={view.target === null}
          label={t('Getting started')}
          onBlockedClick={() => setNudge((value) => value + 1)}
        >
          <TourStepContent
            step={step}
            targetFound={view.target !== null}
            card={view.target === null}
            onSkip={() => setConfirmingSkip(true)}
          />
        </TourLayer>,
        document.body
      )}
    </>
  )
}
