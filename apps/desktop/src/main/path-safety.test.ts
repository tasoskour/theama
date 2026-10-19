import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { UnsafePathError, assertSafeUserPath } from './path-safety'

const dir = mkdtempSync(join(tmpdir(), 'theama-path-'))
const video = join(dir, 'Interstellar (2014).mkv')
writeFileSync(video, '')
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('assertSafeUserPath', () => {
  it('accepts an existing absolute file, including Unicode names', () => {
    const greek = join(dir, 'Ταινία (2020).mkv')
    writeFileSync(greek, '')
    expect(assertSafeUserPath(video)).toBe(video)
    expect(assertSafeUserPath(greek)).toBe(greek)
  })

  it.each([
    ['relative path', 'movies\\a.mkv'],
    ['traversal', 'C:\\Movies\\..\\Windows\\win.ini'],
    ['control chars', 'C:\\Movies\\a\u0000.mkv'],
    ['device path', '\\\\.\\C:\\file'],
    ['empty', ''],
  ])('rejects %s', (_label, input) => {
    expect(() => assertSafeUserPath(input, { mustExist: false })).toThrow(UnsafePathError)
  })

  it.each(['C:\\x\\setup.exe', 'C:\\x\\run.BAT', 'C:\\x\\a.ps1', 'C:\\x\\a.lnk'])('refuses to open %s', (p) => {
    expect(() => assertSafeUserPath(p, { mustExist: false })).toThrow(/Executable/)
  })

  it('rejects missing paths unless told otherwise', () => {
    expect(() => assertSafeUserPath(join(dir, 'nope.mkv'))).toThrow(/does not exist/)
    expect(assertSafeUserPath(join(dir, 'nope.mkv'), { mustExist: false })).toContain('nope.mkv')
  })
})
