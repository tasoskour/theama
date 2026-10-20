import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The installed service runs from "C:\Program Files\...", a path with a space. NSSM does not quote what follows the
// program, so passing the server path to "nssm install" made Node look for the module "C:\Program" (found by the first
// real install). The script must write the quoted value itself.
describe('service-admin.ps1', () => {
  const script = readFileSync(join(__dirname, '..', '..', '..', '..', '..', 'tools', 'nssm', 'service-admin.ps1'), 'utf8')

  it('does not hand the server path to nssm as a bare argument', () => {
    expect(script).not.toMatch(/Invoke-Nssm install \$ServiceName \$NodeExe \$ServerEntry/)
  })

  it('writes the server path quoted into AppParameters', () => {
    expect(script).toMatch(/-Name AppParameters -Value \('"' \+ \$ServerEntry \+ '"'\)/)
  })
})
