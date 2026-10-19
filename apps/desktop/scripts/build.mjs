import { build } from 'esbuild'

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: true,
  external: ['electron'],
  logLevel: 'info',
}

// Main process: no runtime dependencies besides Electron itself.
await build({ ...common, entryPoints: ['src/main/index.ts'], outfile: 'out/main.cjs' })

// Preload runs sandboxed: it must be a single self-contained CommonJS file.
await build({ ...common, entryPoints: ['src/preload/index.ts'], outfile: 'out/preload.cjs' })
