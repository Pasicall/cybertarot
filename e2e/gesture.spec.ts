import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"

async function dismissIntro(page: Page) {
  const start = page.getByRole("button", { name: "开始" })
  // reduced-motion 下开场屏会自动跳过，「开始」可能短暂出现后消失。
  try {
    await start.click({ timeout: 2000 })
  } catch {
    // 开场屏已自动关闭，无需点击。
  }
  await expect(page.locator(".card-ring")).toBeVisible()
  // 等环入场缩放动画完成，避免触摸坐标漂移。
  await page.waitForTimeout(400)
}

async function openGallery(page: Page) {
  await page.goto("/")
  await dismissIntro(page)
}

test.use({
  launchOptions: {
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
})

test.describe("电脑端摄像头手势", () => {
  test.skip(({ isMobile }) => isMobile, "手势开关只在电脑端显示")

  test("主动开启后加载本地模型，关闭后释放摄像头，键盘继续翻页", async ({ page }) => {
    test.setTimeout(90_000)
    const assets: string[] = []
    const runtimeLogs: { type: string; text: string }[] = []
    const pageErrors: string[] = []
    page.on("console", (message) => runtimeLogs.push({ type: message.type(), text: message.text() }))
    page.on("pageerror", (error) => pageErrors.push(error.message))
    page.on("request", (request) => {
      if (request.url().includes("/mediapipe/")) assets.push(request.url())
    })
    await openGallery(page)
    await expect(page.getByRole("button", { name: "开启手势翻页" })).toBeVisible()
    await expect(page.getByRole("radiogroup", { name: "手势翻页方式" })).toBeVisible()
    await expect(page.getByRole("radio", { name: "单次翻页" })).toBeChecked()
    await page.getByRole("radio", { name: "单次翻页" }).focus()
    await page.keyboard.press("ArrowRight")
    await expect(page.getByRole("radio", { name: "停留连翻" })).toBeChecked()
    await expect(page.getByRole("status")).toContainText("1 / 78")
    expect(assets).toEqual([])
    expect(await page.locator("video").evaluate((video) => video.srcObject)).toBeNull()
    await page.getByRole("button", { name: "开启手势翻页" }).click()
    await expect(page.getByText("请举起一只手", { exact: false })).toBeVisible({ timeout: 60_000 })
    await expect(page.getByRole("button", { name: "关闭手势翻页" })).toHaveAttribute("aria-pressed", "true")
    expect(assets.some((url) => url.endsWith("hand_landmarker.task"))).toBe(true)
    expect(assets.some((url) => url.endsWith(".wasm"))).toBe(true)
    expect(assets.every((url) => new URL(url).origin === new URL(page.url()).origin)).toBe(true)
    // XNNPACK is initialized lazily on the first inference, after model creation.
    await expect.poll(() => runtimeLogs.some((message) => message.text.includes("Created TensorFlow Lite XNNPACK delegate for CPU"))).toBe(true)
    expect(runtimeLogs.filter((message) => message.type === "error" && message.text.includes("XNNPACK"))).toEqual([])
    expect(pageErrors).toEqual([])
    await expect(page.getByRole("button", { name: "关闭手势翻页" })).toBeVisible()
    await page.locator("video").evaluate((video) => {
      const stream = video.srcObject as MediaStream
      ;(window as unknown as { cameraTracks: MediaStreamTrack[] }).cameraTracks = stream.getTracks()
    })
    await page.getByRole("radio", { name: "单次翻页" }).check()
    await page.getByRole("radio", { name: "停留连翻" }).check()
    await expect(page.getByRole("button", { name: "关闭手势翻页" })).toBeVisible()
    expect(assets.filter((url) => url.endsWith("hand_landmarker.task"))).toHaveLength(1)
    await page.getByRole("button", { name: "翻开这张牌" }).click()
    await expect(page.getByRole("img", { name: "愚人 / The Fool" })).toBeVisible()
    await expect(page.getByRole("radio", { name: "停留连翻" })).toBeChecked()
    await page.getByRole("radio", { name: "停留连翻" }).focus()
    await page.keyboard.press("Escape")
    await expect(page.getByRole("button", { name: "翻开这张牌" })).toBeFocused()
    await expect(page.getByRole("radio", { name: "停留连翻" })).toBeChecked()
    expect(await page.locator("video").evaluate((video) => {
      const { cameraTracks } = window as unknown as { cameraTracks: MediaStreamTrack[] }
      return (video.srcObject as MediaStream).getTracks().every((track) => (
        cameraTracks.includes(track) && track.readyState === "live"
      ))
    })).toBe(true)
    await page.getByRole("button", { name: "关闭手势翻页" }).click()
    await expect(page.getByRole("button", { name: "开启手势翻页" })).toHaveAttribute("aria-pressed", "false")
    expect(await page.locator("video").evaluate((video) => video.srcObject)).toBeNull()
    expect(await page.evaluate(() => (
      window as unknown as { cameraTracks: MediaStreamTrack[] }
    ).cameraTracks.every((track) => track.readyState === "ended"))).toBe(true)
    await page.getByRole("region", { name: "塔罗牌画廊" }).focus()
    await page.keyboard.press("ArrowRight")
    await expect(page.getByRole("status")).toContainText("2 / 78")
  })

  test("拒绝授权后显示原因，按钮仍可正常翻页", async ({ page }) => {
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = async () => { throw new DOMException("denied", "NotAllowedError") }
    })
    await openGallery(page)
    await page.getByRole("button", { name: "开启手势翻页" }).click()
    await expect(page.getByRole("alert").filter({ hasText: "摄像头权限被拒绝" })).toBeVisible()
    await page.getByRole("button", { name: /下一张/ }).click()
    await expect(page.getByRole("status")).toContainText("2 / 78")
  })
})

test("手机端不显示手势开关", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "只检查手机布局")
  await openGallery(page)
  await expect(page.getByRole("button", { name: "开启手势翻页" })).toBeHidden()
  await expect(page.getByRole("radiogroup", { name: "手势翻页方式" })).toBeHidden()
})
