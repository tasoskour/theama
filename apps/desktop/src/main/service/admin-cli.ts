/**
 * Developer helper: install / repair / uninstall the Theama service from a
 * terminal, with the same elevated script the desktop app uses.
 *
 *   yarn service:install [--system]     (needs `yarn build` and `yarn nssm:fetch` first)
 *   yarn service:uninstall
 */
import { fileURLToPath } from 'node:url'
import { defaultDataDir } from '@theama/logs'
import { currentUser, runAdmin, type AdminAction } from './admin'
import { resolveAdminPaths } from './admin-paths'

const action = process.argv[2] as AdminAction | undefined
if (action !== 'install' && action !== 'repair' && action !== 'uninstall') {
  console.error('Usage: service <install|repair|uninstall> [--system]')
  process.exit(2)
}

const repoRoot = fileURLToPath(new URL('../../../../../', import.meta.url))
const paths = resolveAdminPaths({
  packaged: false,
  repoRoot,
  resourcesPath: '',
  dataDir: defaultDataDir(),
  nodeExe: process.execPath,
})
const account = action === 'uninstall' ? null : process.argv.includes('--system') ? ({ kind: 'local-system' } as const) : ({ kind: 'current-user' } as const)

console.log(`${action} Theama service (data: ${paths.dataDir}${account ? `, account: ${account.kind}` : ''})`)
console.log('Windows will ask for administrator permission' + (account?.kind === 'current-user' ? ' and then for your account password.' : '.'))
const result = await runAdmin(action, account, paths, await currentUser())
console.log(result.ok ? `OK: ${result.message}` : `FAILED: ${result.message}`)
process.exit(result.ok ? 0 : 1)
