import {
  AppError,
  PLAYLIST_COVER_MAX_EDGE,
  PLAYLIST_COVER_MAX_LENGTH,
  toAppErrorState,
} from '@any-music/core'
import { computed, onScopeDispose, shallowRef } from 'vue'
import type { Ref } from 'vue'

import type { PlaylistCoverCrop } from './playlist-cover-crop'

export const PLAYLIST_COVER_ACCEPT = '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp'

/** Decode only admitted local images; the caller owns and releases the returned pixels. */
async function readPlaylistCover(file: File): Promise<ImageBitmap> {
  if (
    !/\.(jpe?g|png|webp)$/i.test(file.name) ||
    (file.type && !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
  )
    throw new AppError('invalid-input', '请选择 JPG、PNG 或 WebP 图片。')
  if (!file.size || file.size > 5 * 1024 ** 2)
    throw new AppError('invalid-input', '封面图片大小需在 5 MB 以内。')
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  const jpeg = header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => header[i] === byte)
  const webp =
    String.fromCharCode(...header.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...header.slice(8, 12)) === 'WEBP'
  if (!jpeg && !png && !webp) throw new AppError('invalid-input', '无法识别图片，请重新选择封面。')
  let bitmap: ImageBitmap | undefined
  try {
    bitmap = await createImageBitmap(file)
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 32_000_000)
      throw new AppError('invalid-input', '封面尺寸过大，请选择 3200 万像素以内的图片。')
    return bitmap
  } catch (cause) {
    bitmap?.close()
    if (cause instanceof AppError) throw cause
    throw new AppError('invalid-input', '无法读取图片，文件可能已损坏。', { cause })
  }
}

function encodePlaylistCover(bitmap: ImageBitmap, crop?: PlaylistCoverCrop): string {
  const region = crop ?? { x: 0, y: 0, width: bitmap.width, height: bitmap.height }
  if (
    ![region.x, region.y, region.width, region.height].every(Number.isFinite) ||
    region.x < 0 ||
    region.y < 0 ||
    region.width <= 0 ||
    region.height <= 0 ||
    region.x + region.width > bitmap.width + 0.001 ||
    region.y + region.height > bitmap.height + 0.001
  )
    throw new AppError('invalid-input', '封面裁剪范围无效，请重新调整。')
  const canvas = document.createElement('canvas')
  try {
    const scale = Math.min(1, PLAYLIST_COVER_MAX_EDGE / Math.max(region.width, region.height))
    canvas.width = Math.max(1, Math.round(region.width * scale))
    canvas.height = Math.max(1, Math.round(region.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas unavailable')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(
      bitmap,
      region.x,
      region.y,
      region.width,
      region.height,
      0,
      0,
      canvas.width,
      canvas.height,
    )
    // Bound encoding work while preferring detail over a fixed low-quality thumbnail.
    for (const quality of [0.9, 0.8, 0.7]) {
      const data = canvas.toDataURL('image/jpeg', quality)
      if (data.length <= PLAYLIST_COVER_MAX_LENGTH) return data
    }
    throw new AppError('invalid-input', '封面图片过于复杂，请选择另一张图片。')
  } catch (cause) {
    if (cause instanceof AppError) throw cause
    throw new AppError('invalid-input', '无法读取图片，文件可能已损坏。', { cause })
  } finally {
    // Release the encoder surface as soon as the bounded result has been copied out.
    canvas.width = canvas.height = 0
  }
}

/** Full-image preparation is also used independently of the interactive upload flow. */
export async function preparePlaylistCover(file: File, crop?: PlaylistCoverCrop): Promise<string> {
  const bitmap = await readPlaylistCover(file)
  try {
    return encodePlaylistCover(bitmap, crop)
  } finally {
    bitmap.close()
  }
}

export function usePlaylistCoverUpload(
  existing: () => string | undefined,
  draft?: Ref<string | null | undefined>,
) {
  const cover = draft ?? shallowRef<string | null>()
  const busy = shallowRef(false)
  const error = shallowRef('')
  const source = shallowRef<ImageBitmap | null>(null)
  let generation = 0
  function cancelCrop() {
    generation++
    source.value?.close()
    source.value = null
    busy.value = false
    error.value = ''
  }
  const reset = () => {
    cancelCrop()
    cover.value = undefined
    error.value = ''
  }
  onScopeDispose(cancelCrop)
  async function select(file?: File) {
    if (!file) return
    cancelCrop()
    const current = generation
    busy.value = true
    error.value = ''
    try {
      const bitmap = await readPlaylistCover(file)
      if (current === generation) source.value = bitmap
      else bitmap.close()
    } catch (cause) {
      if (current === generation) error.value = toAppErrorState(cause).message
    } finally {
      if (current === generation) busy.value = false
    }
  }
  function confirmCrop(crop: PlaylistCoverCrop) {
    if (!source.value || busy.value) return
    busy.value = true
    error.value = ''
    try {
      cover.value = encodePlaylistCover(source.value, crop)
      cancelCrop()
    } catch (cause) {
      error.value = toAppErrorState(cause).message
    } finally {
      busy.value = false
    }
  }
  return {
    cover,
    busy,
    error,
    select,
    source,
    confirmCrop,
    cancelCrop,
    reset,
    preview: computed(() => (cover.value === undefined ? existing() : (cover.value ?? undefined))),
    remove: () => {
      reset()
      cover.value = null
    },
  }
}
