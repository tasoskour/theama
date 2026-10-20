import { readAppLogs } from '@theama/logs'
import type { BackupInfo, LibraryStatus, MetadataStatus, ServiceEvent, SystemInfo } from '@theama/contracts'

export interface ReportInput {
  info: SystemInfo
  library: LibraryStatus
  metadata: MetadataStatus
  backups: BackupInfo[]
  serviceEvents: ServiceEvent[]
  ffprobeFound: boolean
  logsDir: string
  /** Secrets that must never appear in the report, whatever the logs happened to contain. */
  secrets: (string | null)[]
  now: Date
}

/** Replaces every occurrence of a secret with a marker. Short strings are ignored: they would match by accident. */
export function redact(text: string, secrets: readonly (string | null)[]): string {
  let out = text
  for (const s of secrets) if (s && s.length >= 8) out = out.split(s).join('[hidden]')
  return out
}

/**
 * A plain-text report a person can read and paste into a message when something is wrong: versions, what is
 * running, counts, recent warnings and errors. It contains file paths (they are in the logs) but never the API
 * token or the TMDB key. Nothing is sent anywhere; Theama only builds the text when asked.
 */
export function buildReport(i: ReportInput): string {
  const lines: string[] = []
  const add = (s = ''): void => void lines.push(s)

  add('Theama diagnostics report')
  add(`Made ${i.now.toISOString()}`)
  add()
  add('== Application ==')
  add(`Version: ${i.info.version}`)
  add(`Database layout: v${i.info.schemaVersion}`)
  add(`Node.js: ${i.info.nodeVersion}`)
  add(`Host: ${i.info.hostMode === 'service' ? 'Windows service' : 'foreground process'} (pid ${i.info.pid})`)
  add(`Running for: ${Math.round(i.info.uptimeSeconds / 60)} min`)
  add(`Data folder: ${i.info.paths.dataDir}`)
  add(`FFprobe: ${i.ffprobeFound ? 'found' : 'not found (duration, resolution and codecs are unavailable)'}`)
  add()
  add('== Library ==')
  add(`Scanning now: ${i.library.scanning ? 'yes' : 'no'}`)
  add(`Metadata: ${i.metadata.configured ? i.metadata.state : 'no TMDB key'}; identified ${i.metadata.matched}, need choice ${i.metadata.ambiguous}, not found ${i.metadata.unmatched}, waiting ${i.metadata.pending}${i.metadata.message ? ` (${i.metadata.message})` : ''}`)
  add()
  add('== Backups ==')
  if (i.backups.length === 0) add('None')
  for (const b of i.backups.slice(0, 5)) add(`${b.createdAt}  ${b.kind}  v${b.schemaVersion}  ${Math.round(b.size / 1024)} KB`)
  add()
  add('== Service history (newest first) ==')
  for (const e of i.serviceEvents.slice(0, 15)) add(`${e.time}  ${e.kind}${e.reason ? `  ${e.reason}` : ''}`)
  if (i.serviceEvents.length === 0) add('None')
  add()
  add('== Recent warnings and errors (newest first) ==')
  const recent = readAppLogs(i.logsDir, { level: 'warn', limit: 100 }).items
  if (recent.length === 0) add('None')
  for (const e of recent) {
    const ctx = e.context ? ` ${JSON.stringify(e.context).slice(0, 400)}` : ''
    add(`${e.time}  ${e.level.toUpperCase().padEnd(5)}  ${e.message}${ctx}`)
  }
  return redact(lines.join('\n') + '\n', i.secrets)
}
