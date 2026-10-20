import { defineConfig } from '@playwright/test'

// Runs against the packaged app in build/installer/win-unpacked (see "yarn test:packaged").
export default defineConfig({
  testDir: 'e2e-packaged',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
})
