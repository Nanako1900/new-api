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
import { motion, useReducedMotion } from 'motion/react'
import {
  type ReactNode,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

import { placeTourBubble, type TourRect } from '../lib/tour'

// Room left around the highlighted element.
const HOLE_PADDING = 6

type TourLayerProps = {
  /** The highlighted element; null dims the whole window. */
  target: TourRect | null
  /** Clicks on the dimmed area are blocked; this tells the user why. */
  onBlockedClick: () => void
  /** Bumped on each blocked click to shake the bubble. */
  nudge: number
  /**
   * The highlight is inside an open dialog. The layer then shares the
   * dialog's level: mounted after the dialog it still covers it, and a
   * dropdown opened later from the highlighted form covers the layer.
   */
  inDialog: boolean
  /** A card in the middle of the window, larger than a pointing bubble. */
  card: boolean
  label: string
  children: ReactNode
}

/**
 * The tour's screen layer: dims everything except the highlighted element,
 * which stays clickable, and shows the guide bubble beside it. It sits
 * above dialogs and drawers so it can point inside them.
 */
export function TourLayer(props: TourLayerProps) {
  const reduceMotion = useReducedMotion()
  const bubbleRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ top: number; left: number }>()

  // The tour hands over a new target object only when the box moved.
  const hole = useMemo(
    () =>
      props.target && {
        top: props.target.top - HOLE_PADDING,
        left: props.target.left - HOLE_PADDING,
        width: props.target.width + HOLE_PADDING * 2,
        height: props.target.height + HOLE_PADDING * 2,
      },
    [props.target]
  )

  // Re-place the bubble when the hole moves, the bubble changes size or the
  // window is resized. The nudge remounts the bubble, so it re-observes.
  useLayoutEffect(() => {
    const bubble = bubbleRef.current
    if (!bubble) return
    const place = () => {
      const next = placeTourBubble(
        hole,
        { width: bubble.offsetWidth, height: bubble.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight }
      )
      setPosition((prev) =>
        prev?.top === next.top && prev.left === next.left ? prev : next
      )
    }
    place()
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place)
    observer?.observe(bubble)
    window.addEventListener('resize', place)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', place)
    }
  }, [hole, props.nudge])

  // Four transparent strips around the hole catch clicks on the dimmed area.
  const blockers = hole
    ? [
        {
          id: 'above',
          top: 0,
          left: 0,
          right: 0,
          height: Math.max(hole.top, 0),
        },
        {
          id: 'below',
          top: hole.top + hole.height,
          left: 0,
          right: 0,
          bottom: 0,
        },
        {
          id: 'left',
          top: hole.top,
          left: 0,
          width: Math.max(hole.left, 0),
          height: hole.height,
        },
        {
          id: 'right',
          top: hole.top,
          left: hole.left + hole.width,
          right: 0,
          height: hole.height,
        },
      ]
    : [{ id: 'all', top: 0, left: 0, right: 0, bottom: 0 }]

  return (
    // The layer itself lets clicks through, so the hole reaches the element
    // underneath; only the strips and the bubble take clicks.
    <div
      className={cn(
        'pointer-events-none fixed inset-0',
        props.inDialog ? 'z-50' : 'z-[80]'
      )}
    >
      {blockers.map(({ id, ...style }) => (
        <div
          key={id}
          aria-hidden='true'
          className={cn(
            'pointer-events-auto absolute',
            !hole && 'bg-[rgb(20_17_13/0.55)] dark:bg-[rgb(0_0_0/0.7)]'
          )}
          style={style}
          onClick={props.onBlockedClick}
        />
      ))}
      {hole && (
        <div
          aria-hidden='true'
          className='ring-primary pointer-events-none absolute rounded-[14px] shadow-[0_0_0_9999px_rgb(20_17_13/0.55)] ring-2 transition-[top,left,width,height] duration-200 ease-out dark:shadow-[0_0_0_9999px_rgb(0_0_0/0.7)]'
          style={hole}
        />
      )}
      <motion.div
        key={props.nudge}
        ref={bubbleRef}
        role='dialog'
        aria-label={props.label}
        animate={
          props.nudge && !reduceMotion ? { x: [0, -7, 7, -4, 0] } : undefined
        }
        transition={{ duration: 0.32 }}
        className={cn(
          'bg-popover text-popover-foreground border-border pointer-events-auto absolute flex flex-col border shadow-[0_24px_60px_-20px_rgba(30,27,23,0.5)]',
          props.card
            ? 'w-[min(28rem,calc(100vw-2rem))] gap-5 rounded-[24px] p-7'
            : 'w-[min(24rem,calc(100vw-2rem))] gap-4 rounded-[20px] p-5'
        )}
        style={{
          top: position?.top ?? 0,
          left: position?.left ?? 0,
          visibility: position ? 'visible' : 'hidden',
        }}
      >
        {props.children}
      </motion.div>
    </div>
  )
}
