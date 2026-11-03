import { expect, type Page } from '@playwright/test'

/** Wait for startup, dismissing onboarding if automatic setup is re-enabled. */
export async function dismissInitialSetup(page: Page): Promise<void> {
  const wizard = page.locator('[data-test="setup-wizard"]')
  await expect(wizard.or(page.getByRole('heading', { name: 'Welcome to Theama' })).first()).toBeVisible({ timeout: 60_000 })
  if (await wizard.isVisible()) await page.locator('[data-test="setup-later"]').click()
  await expect(page.locator('[data-test="setup-wizard"]')).toHaveCount(0)
}
