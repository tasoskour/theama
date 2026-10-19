// Downloads FFmpeg 9.0.2 ("essentials" build for Windows, from gyan.dev), verifies it against a pinned
// SHA-256 and extracts only ffprobe.exe to tools/ffprobe/bin/. Nothing else from the archive is kept.
//
//   SHA-256 60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba
//   (the checksum published by gyan.dev next to the archive: <zip url>.sha256)
//
// FFprobe is invoked by Theama as a separate process (never linked), which is how the
// GPL/LGPL terms of FFmpeg are kept at arm's length. See docs/11-risks.md.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const VERSION = '9.0.2'
const URL_ZIP = `https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-${VERSION}-essentials_build.zip`
const SHA256 = '60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba'
const ENTRY = `ffmpeg-${VERSION}-essentials_build/bin/ffprobe.exe`

const here = dirname(fileURLToPath(import.meta.url))
const target = join(here, 'bin', 'ffprobe.exe')

if (existsSync(target) && !process.argv.includes('--force')) {
  console.log(`FFprobe already present: ${target}`)
  process.exit(0)
}
if (process.platform !== 'win32') {
  console.error('This script fetches the Windows build of FFprobe.')
  process.exit(1)
}

console.log(`Downloading ${URL_ZIP}`)
const res = await fetch(URL_ZIP)
if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`)
const total = Number(res.headers.get('content-length') ?? 0)
const hash = createHash('sha256')
const chunks = []
let received = 0
let lastPrinted = 0
for await (const chunk of res.body) {
  hash.update(chunk)
  chunks.push(chunk)
  received += chunk.length
  if (received - lastPrinted > 8 * 1024 * 1024) {
    lastPrinted = received
    process.stdout.write(`\r  ${(received / 1048576).toFixed(0)} MB${total ? ` / ${(total / 1048576).toFixed(0)} MB` : ''}   `)
  }
}
process.stdout.write('\n')
const actual = hash.digest('hex')
if (actual !== SHA256) {
  throw new Error(`Checksum mismatch for the FFmpeg archive.\n  expected ${SHA256}\n  actual   ${actual}\nRefusing to use it.`)
}
console.log('Checksum verified.')

const work = mkdtempSync(join(tmpdir(), 'theama-ffprobe-'))
try {
  const zipPath = join(work, 'ffmpeg.zip')
  writeFileSync(zipPath, Buffer.concat(chunks))
  mkdirSync(dirname(target), { recursive: true })
  // Extract the single entry; the archive's other ~300 MB is never written to disk.
  const script = [
    'Add-Type -AssemblyName System.IO.Compression.FileSystem',
    `$zip = [System.IO.Compression.ZipFile]::OpenRead('${zipPath}')`,
    'try {',
    `  $entry = $zip.GetEntry('${ENTRY}')`,
    `  if (-not $entry) { throw 'ffprobe.exe was not found in the archive' }`,
    `  [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, '${target}', $true)`,
    '} finally { $zip.Dispose() }',
  ].join('\n')
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'inherit' })
  console.log(`Installed ${target}`)
} finally {
  rmSync(work, { recursive: true, force: true })
}
