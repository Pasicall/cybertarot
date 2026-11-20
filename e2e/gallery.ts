import { expect } from "@playwright/test"
import type { Page } from "@playwright/test"

export async function openGallery(page: Page, route = "/") {
  await page.goto(route)
  if (!await page.evaluate(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches)) {
    await page.getByRole("button", { name: "开始", exact: true }).click()
  }
  await expect(page.locator(".intro")).toHaveCount(0)
  await expect(page.getByRole("region", { name: "塔罗牌画廊" })).toBeVisible()
}
