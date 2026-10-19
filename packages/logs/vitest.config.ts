import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { name: 'logs', include: ['src/**/*.test.ts'], environment: 'node' },
})
