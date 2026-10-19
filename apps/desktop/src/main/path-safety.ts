import { existsSync } from 'node:fs'
import { isAbsolute, normalize, win32 } from 'node:path'

export class UnsafePathError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsafePathError'
  }
}

/**
 * Validates a path received over IPC before it is handed to the OS shell.
 * It must be absolute, free of control characters and traversal segments, and
 * (unless `mustExist` is false) present on disk. Device paths and executables
 * are refused: opening a path is a viewing action, never a way to run code.
 */
export function assertSafeUserPath(raw: string, options: { mustExist?: boolean } = {}): string {
  if (raw.length === 0 || raw.length > 32_000) throw new UnsafePathError('Path has an invalid length')
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(raw)) throw new UnsafePathError('Path contains control characters')
  if (!isAbsolute(raw) && !win32.isAbsolute(raw)) throw new UnsafePathError('Path must be absolute')
  if (raw.split(/[\\/]+/).includes('..')) throw new UnsafePathError('Path must not contain ".." segments')
  if (/^\\\\[?.]\\/.test(raw)) throw new UnsafePathError('Device paths are not allowed')
  const normalized = normalize(raw)
  if (/\.(exe|com|bat|cmd|msi|ps1|vbs|js|jse|wsf|scr|lnk|reg)$/i.test(normalized)) {
    throw new UnsafePathError('Executable file types cannot be opened')
  }
  if (options.mustExist !== false && !existsSync(normalized)) throw new UnsafePathError('Path does not exist')
  return normalized
}
