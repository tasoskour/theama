import { join } from 'node:path'
import type { AdminPaths } from './admin'

/**
 * Where the pieces the elevated helper needs live.
 *  - development: straight from the repository (server must be built, NSSM fetched)
 *  - packaged: next to the app under resources/ (assembled by the installer build)
 */
export function resolveAdminPaths(options: {
  packaged: boolean
  repoRoot: string
  resourcesPath: string
  dataDir: string
  nodeExe: string
}): AdminPaths {
  if (options.packaged) {
    const r = options.resourcesPath
    return {
      nssmExe: join(r, 'nssm', 'nssm.exe'),
      nodeExe: join(r, 'node', 'node.exe'),
      serverEntry: join(r, 'server', 'server.cjs'),
      ffprobeExe: join(r, 'ffprobe', 'ffprobe.exe'),
      scriptPath: join(r, 'nssm', 'service-admin.ps1'),
      dataDir: options.dataDir,
    }
  }
  return {
    nssmExe: join(options.repoRoot, 'tools', 'nssm', 'bin', 'nssm.exe'),
    nodeExe: options.nodeExe,
    serverEntry: join(options.repoRoot, 'apps', 'server', 'dist', 'server.cjs'),
    ffprobeExe: join(options.repoRoot, 'tools', 'ffprobe', 'bin', 'ffprobe.exe'),
    scriptPath: join(options.repoRoot, 'tools', 'nssm', 'service-admin.ps1'),
    dataDir: options.dataDir,
  }
}
