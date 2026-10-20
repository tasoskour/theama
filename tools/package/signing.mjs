// Code-signing helper for the installer.
//   node tools/package/signing.mjs check    -> is a certificate configured? (exit 1 if not)
//   node tools/package/signing.mjs verify   -> is build/installer/Theama-Setup-<version>.exe signed? (exit 1 if not)
// The certificate is never stored in the repository: electron-builder reads it from the environment.
//   CSC_LINK          path to a .pfx/.p12 file (or an https URL, or base64 of the file)
//   CSC_KEY_PASSWORD  its password
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const mode = process.argv[2]

function check() {
  const link = process.env.CSC_LINK
  if (!link) return fail('CSC_LINK is not set. Point it at your code-signing certificate (.pfx), and set CSC_KEY_PASSWORD.')
  const isFile = !/^(https:|data:|[A-Za-z0-9+/=]{200,}$)/.test(link)
  if (isFile && !existsSync(link)) return fail(`CSC_LINK points at "${link}", which does not exist.`)
  if (!process.env.CSC_KEY_PASSWORD) return fail('CSC_KEY_PASSWORD is not set.')
  console.log('Code signing: certificate configured (the password is not shown).')
}

function verify() {
  const dir = join(root, 'build', 'installer')
  const version = JSON.parse(readFileSync(join(root, 'apps', 'desktop', 'package.json'), 'utf8')).version
  const name = `Theama-Setup-${version}.exe`
  const file = join(dir, name)
  if (!existsSync(file)) return fail(`${file} not found${existsSync(dir) ? ` (found: ${readdirSync(dir).join(', ')})` : ''}. Run "yarn dist:signed" first.`)
  const script =
    "$s = Get-AuthenticodeSignature -LiteralPath $env:THEAMA_SIGN_FILE; " +
    "[pscustomobject]@{ status = [string]$s.Status; signer = $s.SignerCertificate.Subject; thumbprint = $s.SignerCertificate.Thumbprint; " +
    "timestamp = if ($s.TimeStamperCertificate) { $s.TimeStamperCertificate.Subject } else { $null } } | ConvertTo-Json -Compress"
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    env: { ...process.env, THEAMA_SIGN_FILE: file },
  })
  const r = JSON.parse(out)
  console.log(`${name}: ${r.status}`)
  if (r.signer) console.log(`  signed by ${r.signer}\n  thumbprint ${r.thumbprint}`)
  if (r.signer) console.log(r.timestamp ? `  timestamped by ${r.timestamp}` : '  NOT timestamped: the signature stops being valid when the certificate expires.')
  // "Valid" = signed and trusted. "UnknownError" with a signer = signed by a certificate this machine does not trust (a self-signed test certificate).
  if (r.status === 'NotSigned') return fail('The installer is not signed.')
  if (r.status !== 'Valid') console.log('  (signed, but this machine does not trust the certificate; expected for a self-signed test certificate)')
}

function fail(message) {
  console.error(message)
  process.exitCode = 1
}

if (mode === 'check') check()
else if (mode === 'verify') verify()
else fail('Usage: signing.mjs check|verify')
