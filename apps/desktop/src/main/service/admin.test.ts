import { describe, expect, it } from 'vitest'
import { AdminInputError, buildElevationCommand, type AdminPaths, type AdminUser } from './admin'

const paths: AdminPaths = {
  nssmExe: 'C:\\Program Files\\Theama\\nssm.exe',
  nodeExe: 'C:\\Program Files\\Theama\\node.exe',
  serverEntry: 'C:\\Program Files\\Theama\\server.cjs',
  scriptPath: 'C:\\Program Files\\Theama\\service-admin.ps1',
  dataDir: 'C:\\ProgramData\\Theama',
}
const user: AdminUser = { name: 'DESKTOP-1\\Tasos', sid: 'S-1-5-21-1111111111-2222222222-3333333333-1001' }

describe('buildElevationCommand', () => {
  it('builds an elevated Start-Process call with quoted arguments', () => {
    const cmd = buildElevationCommand('install', { kind: 'current-user' }, paths, user, 'C:\\Temp\\r.json')
    expect(cmd).toContain('-Verb RunAs -Wait -PassThru')
    expect(cmd).toContain('-Action install')
    expect(cmd).toContain('-Account current-user')
    expect(cmd).toContain('-File "C:\\Program Files\\Theama\\service-admin.ps1"')
    expect(cmd).toContain('-UserSid "S-1-5-21-1111111111-2222222222-3333333333-1001"')
    expect(cmd.trimEnd().endsWith('exit $p.ExitCode')).toBe(true)
  })

  it('doubles single quotes so a name like O\'Brien cannot break out of the literal', () => {
    const cmd = buildElevationCommand('install', { kind: 'local-system' }, paths, { ...user, name: "PC\\O'Brien" }, 'C:\\Temp\\r.json')
    expect(cmd).toContain("PC\\O''Brien")
    expect(cmd).toContain('-Account local-system')
  })

  it.each([
    ['double quote', { ...paths, dataDir: 'C:\\x" -Action uninstall' }],
    ['dollar sign', { ...paths, dataDir: 'C:\\$env:TEMP' }],
    ['backtick', { ...paths, nodeExe: 'C:\\a`b\\node.exe' }],
    ['newline', { ...paths, serverEntry: 'C:\\a\nb.cjs' }],
    ['empty', { ...paths, nssmExe: '' }],
  ])('rejects %s in a path', (_label, bad) => {
    expect(() => buildElevationCommand('install', null, bad, user, 'C:\\r.json')).toThrow(AdminInputError)
  })

  it('rejects an unexpected SID for install/repair but not for uninstall', () => {
    expect(() => buildElevationCommand('install', null, paths, { ...user, sid: 'S-1-5-21-1; calc' }, 'C:\\r.json')).toThrow(/SID/)
    expect(() => buildElevationCommand('uninstall', null, paths, { name: user.name, sid: '' }, 'C:\\r.json')).not.toThrow()
  })

  it('rejects an unknown action', () => {
    // @ts-expect-error deliberately invalid
    expect(() => buildElevationCommand('format', null, paths, user, 'C:\\r.json')).toThrow(AdminInputError)
  })
})
