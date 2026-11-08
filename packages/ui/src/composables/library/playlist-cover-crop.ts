export interface PlaylistCoverCrop {
  x: number
  y: number
  width: number
  height: number
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

/** Coordinates stay in source pixels, independent of preview size and device pixel ratio. */
export function getPlaylistCoverCrop(
  width: number,
  height: number,
  ratio: number,
  zoom = 1,
  x = 0.5,
  y = 0.5,
): PlaylistCoverCrop {
  const cropWidth = Math.min(width, height * ratio) / clamp(zoom, 1, 3)
  const cropHeight = cropWidth / ratio
  return {
    x: (width - cropWidth) * clamp(x, 0, 1),
    y: (height - cropHeight) * clamp(y, 0, 1),
    width: cropWidth,
    height: cropHeight,
  }
}

/** Keep the same source focal point when switching shape or zooming. */
export function getPlaylistCoverCropPosition(
  width: number,
  height: number,
  crop: PlaylistCoverCrop,
  centerX: number,
  centerY: number,
): { x: number; y: number } {
  return {
    x: width > crop.width ? clamp((centerX - crop.width / 2) / (width - crop.width), 0, 1) : 0.5,
    y:
      height > crop.height
        ? clamp((centerY - crop.height / 2) / (height - crop.height), 0, 1)
        : 0.5,
  }
}
