import {
  compileSegmentRecipe as compileAudioRecipe,
  SegmentRecipeError as AudioRecipeError,
} from '@any-music/audio-composition'

import { AppError } from '../errors/app-error'
import type { AppErrorCode } from '../errors/app-error'
import type { Track } from '../models/track'
import type { CompiledSegmentRecipe, CustomTrackDefinition, SegmentRecipe } from './models'

// Preserve the music-domain API and AppError identity for existing consumers.
export { getCompiledDurationMs, locateCompiledSegment } from '@any-music/audio-composition'
export type SegmentRecipeErrorCode = Extract<
  AppErrorCode,
  'empty-recipe' | 'invalid-range' | 'source-not-found' | 'duration-exceeded' | 'circular-reference'
>

export class SegmentRecipeError extends AppError {
  declare readonly code: SegmentRecipeErrorCode
  readonly sourceTrackId?: string

  constructor(code: SegmentRecipeErrorCode, message: string, sourceTrackId?: string) {
    super(code, message)
    this.name = 'SegmentRecipeError'
    this.sourceTrackId = sourceTrackId
  }
}

export interface CompileSegmentRecipeOptions {
  customTrackId?: string
  resolveTrack: (trackId: string) => Track | undefined
  /** Standard published recipes compile independently of editing state or caches. */
  resolveCustomTrack: (trackId: string) => Pick<CustomTrackDefinition, 'recipe'> | undefined
}

/** Music policy stays here; recursive slicing and concatenation belong to the reusable engine. */
export function compileSegmentRecipe(
  recipe: readonly SegmentRecipe[],
  options: CompileSegmentRecipeOptions,
): readonly CompiledSegmentRecipe[] {
  try {
    return compileAudioRecipe(recipe, {
      ...options,
      resolveTrack: (id) => {
        const track = options.resolveTrack(id)
        return track?.source.mediaKind === 'custom' ? undefined : track
      },
    })
  } catch (error) {
    if (error instanceof AudioRecipeError)
      throw new SegmentRecipeError(error.code, error.message, error.sourceTrackId)
    throw error
  }
}
