import { describe, expect, it } from 'vitest'
import { parseScAccount, parseScQuery } from './sc-parse'

const running = `
SERVICE_NAME: Theama
        TYPE               : 10  WIN32_OWN_PROCESS
        STATE              : 4  RUNNING
                                (STOPPABLE, NOT_PAUSABLE, ACCEPTS_SHUTDOWN)
        WIN32_EXIT_CODE    : 0  (0x0)
        SERVICE_EXIT_CODE  : 0  (0x0)
        CHECKPOINT         : 0x0
        WAIT_HINT          : 0x0
        PID                : 4321
        FLAGS              :
`

describe('parseScQuery', () => {
  it('parses a running service with its pid', () => {
    expect(parseScQuery(running, 0)).toEqual({ installed: true, state: 'running', pid: 4321 })
  })

  it.each([
    [1, 'stopped'],
    [2, 'start-pending'],
    [3, 'stop-pending'],
    [7, 'paused'],
  ] as const)('maps state code %i to %s', (code, state) => {
    const out = `SERVICE_NAME: Theama\n        STATE              : ${code}  WHATEVER\n        PID                : 0\n`
    expect(parseScQuery(out, 0)).toMatchObject({ installed: true, state, pid: null })
  })

  it('detects a missing service by the 1060 error code regardless of language', () => {
    const en = '[SC] EnumQueryServicesStatus:OpenService FAILED 1060:\n\nThe specified service does not exist as an installed service.\n'
    const el = '[SC] OpenService ΑΠΟΤΥΧΙΑ 1060:\n\nΗ υπηρεσία που ορίστηκε δεν υπάρχει.\n'
    expect(parseScQuery(en, 1060)).toEqual({ installed: false, state: 'not-installed', pid: null })
    expect(parseScQuery(el, 1060).state).toBe('not-installed')
  })

  it('reports unknown rather than guessing when output is unexpected', () => {
    expect(parseScQuery('garbage', 0)).toEqual({ installed: true, state: 'unknown', pid: null })
    expect(parseScQuery('Access is denied', 5).installed).toBe(false)
  })
})

describe('parseScAccount', () => {
  it('reads the account name', () => {
    expect(parseScAccount('        SERVICE_START_NAME : LocalSystem\r\n')).toBe('LocalSystem')
    expect(parseScAccount('        SERVICE_START_NAME : .\\Tasos\n')).toBe('.\\Tasos')
  })
  it('returns null when absent', () => {
    expect(parseScAccount('nothing here')).toBeNull()
  })
})
