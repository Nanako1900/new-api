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

/** Side of the stored square avatar, in pixels. */
export const AVATAR_IMAGE_SIDE = 160
/** Must match maxAvatarImageBytes in controller/user_avatar.go. */
export const MAX_AVATAR_IMAGE_BYTES = 24 * 1024
export const ACCEPTED_AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp']

const QUALITY_STEPS = [0.86, 0.72, 0.58, 0.44]
const OUTPUT_TYPES = ['image/webp', 'image/jpeg']

export type AvatarImageFailure = 'unsupported' | 'too-large'

export class AvatarImageError extends Error {
  readonly reason: AvatarImageFailure

  constructor(reason: AvatarImageFailure) {
    super(reason)
    this.reason = reason
  }
}

/** Decoded size of a base64 data URL, in bytes. */
export function dataUrlByteLength(dataUrl: string): number {
  const encoded = dataUrl.slice(dataUrl.indexOf(',') + 1)
  const padding = encoded.endsWith('==') ? 2 : Number(encoded.endsWith('='))
  return Math.floor((encoded.length * 3) / 4) - padding
}

/**
 * Crops an image file to a centred square, shrinks it to the avatar size and
 * compresses it until it fits the server limit. Returns a data URL.
 */
export async function compressAvatarImage(file: File): Promise<string> {
  if (!ACCEPTED_AVATAR_TYPES.includes(file.type)) {
    throw new AvatarImageError('unsupported')
  }
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new AvatarImageError('unsupported')
  }

  const canvas = document.createElement('canvas')
  canvas.width = AVATAR_IMAGE_SIDE
  canvas.height = AVATAR_IMAGE_SIDE
  const context = canvas.getContext('2d')
  if (!context) {
    bitmap.close()
    throw new AvatarImageError('unsupported')
  }
  const side = Math.min(bitmap.width, bitmap.height)
  // JPEG has no transparency, so fill first to avoid a black background.
  context.fillStyle = '#FFFFFF'
  context.fillRect(0, 0, AVATAR_IMAGE_SIDE, AVATAR_IMAGE_SIDE)
  context.imageSmoothingQuality = 'high'
  context.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    AVATAR_IMAGE_SIDE,
    AVATAR_IMAGE_SIDE
  )
  bitmap.close()

  for (const quality of QUALITY_STEPS) {
    for (const type of OUTPUT_TYPES) {
      const url = canvas.toDataURL(type, quality)
      // A browser that cannot encode this type returns PNG instead.
      if (!url.startsWith(`data:${type};base64,`)) continue
      if (dataUrlByteLength(url) <= MAX_AVATAR_IMAGE_BYTES) return url
    }
  }
  throw new AvatarImageError('too-large')
}
