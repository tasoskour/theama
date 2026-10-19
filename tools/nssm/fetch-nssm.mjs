// Downloads NSSM 2.24 and extracts the 64-bit nssm.exe to tools/nssm/bin/.
// The archive is verified against a pinned SHA-256 before anything is extracted.
//
//   SHA-256 727d1e42275c605e0f04aba98095c38a8e1e46def453cdffce42869428aa6743
//   SHA-1   be7b3577c6e3a280e5106a9e9db5b3775931cefc  (matches the value published for nssm-2.24.zip)
//
// NSSM is public domain. It has not had a release since 2014; see docs/11-risks.md.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const URL_ZIP = 'https://nssm.cc/release/nssm-2.24.zip'
const SHA256 = '727d1e42275c605e0f04aba98095c38a8e1e46def453cdffce42869428aa6743'

const here = dirname(fileURLToPath(import.meta.url))
const target = join(here, 'bin', 'nssm.exe')

if (existsSync(target) && !process.argv.includes('--force')) {
  console.log(`NSSM already present: ${target}`)
  process.exit(0)
}
if (process.platform !== 'win32') {
  console.error('NSSM is Windows-only.')
  process.exit(1)
}

console.log(`Downloading ${URL_ZIP}`)
const res = await fetch(URL_ZIP)
if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`)
const zip = Buffer.from(await res.arrayBuffer())
const actual = createHash('sha256').update(zip).digest('hex')
if (actual !== SHA256) {
  throw new Error(`Checksum mismatch for nssm-2.24.zip.\n  expected ${SHA256}\n  actual   ${actual}\nRefusing to use it.`)
}

const work = mkdtempSync(join(tmpdir(), 'theama-nssm-'))
try {
  const zipPath = join(work, 'nssm.zip')
  writeFileSync(zipPath, zip)
  execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${work}' -Force`],
    { stdio: 'inherit' },
  )
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(join(work, 'nssm-2.24', 'win64', 'nssm.exe'), target)
  console.log(`Installed ${target}`)
} finally {
  rmSync(work, { recursive: true, force: true })
}
