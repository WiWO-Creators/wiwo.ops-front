import { expect, type Locator, type Page, test } from '@playwright/test'

import { PlatformSetting, PlatformURI, PlatformWs } from './utils'

test.use({ storageState: PlatformSetting })

/** Comprueba que ningún layout compartido ensanche el documento fuera del viewport. */
async function expectNoDocumentOverflow (page: Page): Promise<void> {
  await expect
    .poll(async () =>
      await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth <= 1)
    )
    .toBe(true)
}

/** Comprueba que un control visible conserva un objetivo táctil mínimo de 44px. */
async function expectTouchTarget (locator: Locator): Promise<void> {
  const box = await locator.boundingBox()
  expect(box).not.toBeNull()
  expect(box?.width).toBeGreaterThanOrEqual(44)
  expect(box?.height).toBeGreaterThanOrEqual(44)
}

/** Evita que el tutorial obligatorio del fixture bloquee la navegación que prueba este spec. */
async function isolateResponsiveFlow (page: Page): Promise<void> {
  await page.addStyleTag({ content: '.popup:has(.guided-tour-card) { display: none !important; }' })
}

test.describe('responsive shell and tracker', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${PlatformURI}/workbench/${PlatformWs}`)
    await expect(page.locator('.workbench-container').first()).toBeVisible()
    await isolateResponsiveFlow(page)
  })

  test('shell keeps drawers accessible across orientation', async ({ page }, testInfo) => {
    const appBar = page.locator('.antiPanel-application.horizontal').first()
    await expect(appBar).toBeVisible()
    await expectTouchTarget(page.locator('.topmenu-container').first())
    await expectNoDocumentOverflow(page)

    await page.locator('.topmenu-container').first().click()
    await expect(page.locator('.antiPanel-navigator.fly:not(.second)').first()).toBeVisible()
    await expect(page.locator('.cover.shown')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.locator('.cover.shown')).toHaveCount(0)

    const currentUrl = page.url()
    const portrait = page.viewportSize()
    if (portrait === null) throw new Error('Responsive project requires a viewport')
    await page.setViewportSize({ width: portrait.height, height: portrait.width })
    await expect(page).toHaveURL(currentUrl)
    await expectNoDocumentOverflow(page)

    if (testInfo.project.name === 'Responsive Android') {
      await page.setViewportSize({ width: 320, height: 568 })
      await expect(page.locator('.antiPanel-application.horizontal').first()).toBeVisible()
      await expectNoDocumentOverflow(page)
    }
  })

  test('tracker preserves list, board and detail access', async ({ page }) => {
    await page.goto(`${PlatformURI}/workbench/${PlatformWs}/tracker/tracker%3Aproject%3ADefaultProject/issues`)
    await expect(page.locator('.hulyComponent').first()).toBeVisible()
    await isolateResponsiveFlow(page)
    await expectNoDocumentOverflow(page)

    const listView = page.locator('label[data-view*="List"]')
    if (await listView.isVisible()) await listView.click()

    const firstIssue = page.locator('.antiList__row').first()
    await expect(firstIssue).toBeVisible()
    await firstIssue.click()
    await expect(page.locator('.panel-instance')).toBeVisible()
    await expectNoDocumentOverflow(page)
    await page.keyboard.press('Escape')

    await page.locator('label[data-view*="Board"]').click()
    const firstColumn = page.locator('.kanban-container .panel-container').first()
    await expect(firstColumn).toBeVisible()
    const columnBox = await firstColumn.boundingBox()
    const viewport = page.viewportSize()
    expect(columnBox).not.toBeNull()
    expect(viewport).not.toBeNull()
    expect(columnBox?.width).toBeLessThanOrEqual(viewport?.width ?? Number.POSITIVE_INFINITY)
    await expectNoDocumentOverflow(page)
  })
})
