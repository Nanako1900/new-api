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
import { render } from '@testing-library/react'
import { expect, test } from 'vitest'

import { SleepingCat } from '../cat-art'

test('the sleeping cat is decorative: hidden from assistive tech, images without alt text', () => {
  const { container } = render(<SleepingCat />)
  const root = container.firstElementChild
  const images = [...container.querySelectorAll('img')]

  expect(root).toHaveAttribute('aria-hidden', 'true')
  expect(images).toHaveLength(2)
  for (const image of images) expect(image).toHaveAttribute('alt', '')
})
