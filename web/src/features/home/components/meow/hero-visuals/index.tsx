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
import { useStatus } from '@/hooks/use-status'

import {
  parseHomeHeroVisual,
  type HomeHeroVisual,
} from '../../../lib/hero-visual'
import { MeowCodeCard } from '../meow-code-card'
import { BaseUrlVisual } from './base-url-visual'
import { GatewayVisual } from './gateway-visual'
import { KeyCardVisual } from './key-card-visual'

type MeowHeroVisualProps = {
  className?: string
  /** Show this visual instead of the site's saved choice (settings preview). */
  visual?: HomeHeroVisual
}

/** The visual beside the hero headline, as chosen in System Settings → Site. */
export function MeowHeroVisual(props: MeowHeroVisualProps) {
  const { status } = useStatus()
  const visual = props.visual ?? parseHomeHeroVisual(status?.home_hero_visual)

  switch (visual) {
    case 'gateway':
      return <GatewayVisual className={props.className} />
    case 'base-url':
      return <BaseUrlVisual className={props.className} />
    case 'code-card':
      return <MeowCodeCard className={props.className} />
    default:
      return <KeyCardVisual className={props.className} />
  }
}
