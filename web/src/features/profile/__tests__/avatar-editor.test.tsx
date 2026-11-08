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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'
import { defaultMeowChoice } from '@/lib/meow-avatar'

import { AvatarEditorDialog } from '../components/avatar-editor/avatar-editor-dialog'
import { compressAvatarImage, dataUrlByteLength } from '../lib/avatar-image'

const USER_ID = 7

afterEach(() => vi.restoreAllMocks())

function renderEditor(setting?: string) {
  const onSaved = vi.fn()
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <AvatarEditorDialog
        open
        onOpenChange={vi.fn()}
        userId={USER_ID}
        setting={setting}
        onSaved={onSaved}
      />
    </QueryClientProvider>
  )
  return { onSaved }
}

describe('AvatarEditorDialog', () => {
  test('picking a coat and saving stores the built cat', async () => {
    const put = vi
      .spyOn(api, 'put')
      .mockResolvedValue({ data: { success: true } })
    const { onSaved } = renderEditor()
    const coat =
      defaultMeowChoice(USER_ID).coat === 'tuxedo' ? 'Siamese' : 'Tuxedo'

    fireEvent.click(screen.getByRole('button', { name: coat }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(put).toHaveBeenCalledWith('/api/user/self/avatar', {
      kind: 'cat',
      cat: expect.objectContaining({ coat: coat.toLowerCase() }),
    })
  })

  test('going back to the default cat and saving removes the picked avatar', async () => {
    const remove = vi
      .spyOn(api, 'delete')
      .mockResolvedValue({ data: { success: true } })
    const setting = JSON.stringify({
      avatar: { kind: 'cat', cat: { coat: 'alien' } },
    })
    const { onSaved } = renderEditor(setting)

    fireEvent.click(screen.getByRole('button', { name: 'My default cat' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(remove).toHaveBeenCalledWith('/api/user/self/avatar')
  })

  test('the preview sits outside the part lists and stays pinned while they scroll', () => {
    renderEditor()

    const preview = screen.getByRole('img', { name: 'Avatar preview' })
    const pinned = preview.closest('[data-avatar-preview]')
    expect(pinned).toHaveClass('sticky')
    expect(pinned).not.toContainElement(
      screen.getByRole('group', { name: 'Accessory' })
    )
  })

  test('a failed save keeps the dialog work and reports nothing as saved', async () => {
    vi.spyOn(api, 'put').mockResolvedValue({
      data: { success: false, message: 'Invalid avatar' },
    })
    const { onSaved } = renderEditor()

    fireEvent.click(screen.getByRole('button', { name: 'Shuffle' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    )
    expect(onSaved).not.toHaveBeenCalled()
  })
})

describe('avatar image upload', () => {
  test('a file that is not PNG, JPEG or WebP is rejected before reading it', async () => {
    const file = new File(['<svg/>'], 'cat.svg', { type: 'image/svg+xml' })

    await expect(compressAvatarImage(file)).rejects.toMatchObject({
      reason: 'unsupported',
    })
  })

  test('data URL size counts decoded bytes', () => {
    expect(dataUrlByteLength('data:image/png;base64,QUJD')).toBe(3)
    expect(dataUrlByteLength('data:image/png;base64,QUI=')).toBe(2)
  })
})
