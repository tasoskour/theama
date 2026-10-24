import { z } from 'zod'
import { MetadataLanguage } from './metadata'
import { DEFAULT_EPISODE_TEMPLATE, DEFAULT_MOVIE_TEMPLATE, Template } from './rename'

export const UiLanguage = z.enum(['en', 'el'])
export type UiLanguage = z.infer<typeof UiLanguage>

export const ThemePreference = z.enum(['system', 'dark', 'light'])
export type ThemePreference = z.infer<typeof ThemePreference>

/** `immersive` adds the optional three.js backdrop and 3D poster effects; `standard` is the plain interface. */
export const VisualMode = z.enum(['standard', 'immersive'])
export type VisualMode = z.infer<typeof VisualMode>

/** How much the immersive mode asks of the graphics card. */
export const GraphicsQuality = z.enum(['low', 'medium', 'high'])
export type GraphicsQuality = z.infer<typeof GraphicsQuality>

/**
 * The 3D backdrop scenes. `classic` is the original one and the default; the kind scenes (movie, series, video)
 * and the genre scenes are chosen by hand or, with `auto`, follow what is on screen.
 */
export const SCENE_IDS = [
  'classic',
  'movie',
  'series',
  'video',
  'action',
  'animation',
  'comedy',
  'crime',
  'documentary',
  'drama',
  'family',
  'fantasy',
  'horror',
  'romance',
  'scifi',
  'history',
  'western',
] as const
export const SceneId = z.enum(SCENE_IDS)
export type SceneId = z.infer<typeof SceneId>

/** A fixed scene, or `auto` to follow the genre and the kind of title being looked at. */
export const BackdropScene = z.enum(['auto', ...SCENE_IDS])
export type BackdropScene = z.infer<typeof BackdropScene>

/** Days of rotated NDJSON log files kept on disk. */
/** How much the service writes to the log history. `debug` is for finding a problem and makes the logs large. */
export const LogDetail = z.enum(['error', 'warn', 'info', 'debug'])
export type LogDetail = z.infer<typeof LogDetail>

const LogRetentionDays = z.number().int().min(1).max(365)

const NextEpisodeCountdown = z.number().int().min(0).max(30)

const SubtitleLanguages = z.array(z.string().regex(/^[a-z]{2}$/)).max(6)

export const AppSettings = z.object({
  language: UiLanguage.default('en'),
  theme: ThemePreference.default('system'),
  visualMode: VisualMode.default('standard'),
  graphicsQuality: GraphicsQuality.default('medium'),
  backdropScene: BackdropScene.default('classic'),
  /** With `auto`: let the genre of what is on screen pick the scene. */
  backdropByGenre: z.boolean().default(true),
  /** With `auto`: let movie / series / video pick the scene. */
  backdropByKind: z.boolean().default(true),
  logRetentionDays: LogRetentionDays.default(14),
  logDetail: LogDetail.default('info'),
  /** Language requested from the metadata provider; independent of the interface language. */
  metadataLanguage: MetadataLanguage.default('en'),
  /** Subtitle languages to prefer when starting a video, most wanted first (ISO 639-1). */
  subtitleLanguages: SubtitleLanguages.default(['el', 'en']),
  /** When a series episode ends, offer the next one and start it automatically after a short countdown. */
  autoPlayNext: z.boolean().default(true),
  /** Length of that countdown; 0 starts the next episode at once. */
  nextEpisodeCountdownSeconds: NextEpisodeCountdown.default(5),
  renameMovieTemplate: Template.default(DEFAULT_MOVIE_TEMPLATE),
  renameEpisodeTemplate: Template.default(DEFAULT_EPISODE_TEMPLATE),
})
export type AppSettings = z.infer<typeof AppSettings>

/** Defaults are deliberately absent here: a patch only carries what the caller sets. */
export const AppSettingsPatch = z.object({
  language: UiLanguage.optional(),
  theme: ThemePreference.optional(),
  visualMode: VisualMode.optional(),
  graphicsQuality: GraphicsQuality.optional(),
  backdropScene: BackdropScene.optional(),
  backdropByGenre: z.boolean().optional(),
  backdropByKind: z.boolean().optional(),
  logRetentionDays: LogRetentionDays.optional(),
  logDetail: LogDetail.optional(),
  metadataLanguage: MetadataLanguage.optional(),
  subtitleLanguages: SubtitleLanguages.optional(),
  autoPlayNext: z.boolean().optional(),
  nextEpisodeCountdownSeconds: NextEpisodeCountdown.optional(),
  renameMovieTemplate: Template.optional(),
  renameEpisodeTemplate: Template.optional(),
})
export type AppSettingsPatch = z.infer<typeof AppSettingsPatch>

export const DEFAULT_SETTINGS: AppSettings = AppSettings.parse({})
