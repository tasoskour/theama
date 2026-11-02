import { expect, type Page } from '@playwright/test'

/** Existing suites start fresh profiles too; dismiss onboarding explicitly through the public UI. */
export async function dismissInitialSetup(page: Page): Promise<void> {
  await expect(page.locator('[data-test="setup-wizard"]')).toBeVisible({ timeout: 60_000 })
  await page.locator('[data-test="setup-later"]').click()
  await expect(page.locator('[data-test="setup-wizard"]')).toHaveCount(0)
}
