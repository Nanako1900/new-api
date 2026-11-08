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
import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import {
  ACCEPTED_AVATAR_TYPES,
  AvatarImageError,
  compressAvatarImage,
} from '../../lib/avatar-image'

type AvatarUploadPanelProps = {
  onImage: (image: string) => void
}

export function AvatarUploadPanel(props: AvatarUploadPanelProps) {
  const { t } = useTranslation()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleFile(file: File | undefined) {
    if (!file) return
    setError('')
    setBusy(true)
    try {
      props.onImage(await compressAvatarImage(file))
    } catch (caught) {
      const tooLarge =
        caught instanceof AvatarImageError && caught.reason === 'too-large'
      setError(
        tooLarge
          ? t(
              'This image is still too large after compression. Try a simpler picture.'
            )
          : t('This image could not be read. Try a PNG, JPEG or WebP file.')
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className='flex flex-col gap-2'>
      <Label htmlFor='meow-avatar-upload'>{t('Choose an image')}</Label>
      <Input
        id='meow-avatar-upload'
        type='file'
        accept={ACCEPTED_AVATAR_TYPES.join(',')}
        disabled={busy}
        aria-invalid={error ? true : undefined}
        aria-describedby='meow-avatar-upload-hint'
        onChange={(event) => {
          void handleFile(event.target.files?.[0])
          event.target.value = ''
        }}
      />
      <p id='meow-avatar-upload-hint' className='text-muted-foreground text-xs'>
        {t('PNG, JPEG or WebP. It is cropped to a square and shrunk to fit.')}
      </p>
      {error && (
        <p role='alert' className='text-destructive text-sm'>
          {error}
        </p>
      )}
    </div>
  )
}
