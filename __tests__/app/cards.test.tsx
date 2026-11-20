import { act, fireEvent, render, screen } from "@testing-library/react"
import HomePage from "@/app/page"
import CardsPage from "@/app/cards/page"
import AboutPage from "@/app/about/page"
import { CARDS } from "@/data/cards"
import * as handSwipe from "@/hooks/useHandSwipe"
import type { SwipeDirection } from "@/lib/handSwipe"
import { INITIAL_PINCH } from "@/lib/pinch"
import type { PinchControls, PinchFeedback } from "@/lib/pinch"

jest.mock("@/hooks/useHandSwipe", () => ({
  ...jest.requireActual("@/hooks/useHandSwipe"),
  useHandSwipe: jest.fn(jest.requireActual("@/hooks/useHandSwipe").useHandSwipe),
}))

jest.mock("next/navigation", () => ({
  redirect: jest.fn(() => { throw new Error("NEXT_REDIRECT") }),
}))

import { redirect } from "next/navigation"

const reducedMotionQuery = "(prefers-reduced-motion: reduce)"
let reducedMotion: boolean

beforeEach(() => {
  jest.clearAllMocks()
  reducedMotion = true
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: jest.fn((query: string) => ({
      matches: query === reducedMotionQuery && reducedMotion,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    })),
  })
})

function setupGallery() {
  render(<HomePage />)
  // 开场屏在非 reduced-motion 下会先展示，进入画廊前先点「开始」。
  const start = screen.queryByRole("button", { name: "开始" })
  if (start) fireEvent.click(start)
  return {
    viewport: screen.getByRole("region", { name: "塔罗牌画廊" }),
    previous: screen.getByRole("button", { name: /上一张/ }),
    next: screen.getByRole("button", { name: /下一张/ }),
    confirm: screen.getByRole("button", { name: "翻开这张牌" }),
  }
}

describe("首页卡片画廊", () => {
  test("桌面初始只显示 17 张牌背和序号，首尾可循环", () => {
    const { viewport, previous, next } = setupGallery()
    const front = screen.getByRole("button", { name: "翻开第 1 张" })
    expect(front).toHaveAttribute("aria-current", "true")
    const thumbnails = viewport.querySelectorAll("img")
    expect(thumbnails).toHaveLength(17)
    for (const thumbnail of thumbnails) {
      expect(thumbnail).toHaveAttribute("src", expect.stringContaining("card_back.webp"))
    }
    expect(viewport).not.toHaveTextContent(/愚人|The Fool|阿卡纳/)
    expect(screen.getByRole("status")).toHaveTextContent(/^1 \/ 78$/)
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument()

    fireEvent.click(previous)
    expect(screen.getByRole("status")).toHaveTextContent("78 / 78")
    fireEvent.click(next)
    expect(screen.getByRole("status")).toHaveTextContent("1 / 78")
  })

  test("点击侧牌先选中，再点击前方牌查看大图", () => {
    const { viewport } = setupGallery()
    fireEvent.click(screen.getByRole("button", { name: "将第 2 张移到前方" }))
    expect(viewport).toHaveFocus()
    expect(screen.getByRole("status")).toHaveTextContent(/^2 \/ 78$/)
    expect(screen.queryByRole("img", { name: "魔术师 / The Magician" })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "翻开第 2 张" }))
    expect(viewport.querySelectorAll("img")).toHaveLength(1)
    expect(screen.getByRole("img", { name: "魔术师 / The Magician" })).toHaveAttribute(
      "src", expect.stringContaining("major_01.webp"),
    )
    expect(screen.getByRole("heading", { name: "魔术师" })).toBeVisible()
    expect(screen.getByRole("status")).toHaveTextContent("魔术师 / The Magician，2 / 78")
    expect(screen.getByRole("button", { name: "返回牌环" })).toHaveFocus()
  })

  test("使用键盘确认、切换和返回，牌环保留最后查看的牌", () => {
    const { viewport, confirm } = setupGallery()
    const lastCard = CARDS.at(-1)!
    fireEvent.keyDown(viewport, { key: "End" })
    expect(screen.getByRole("status")).toHaveTextContent("78 / 78")
    fireEvent.keyDown(viewport, { key: "Home" })
    fireEvent.keyDown(viewport, { key: "Enter" })
    expect(screen.getByRole("img", { name: "愚人 / The Fool" })).toBeVisible()

    const back = screen.getByRole("button", { name: "返回牌环" })
    fireEvent.keyDown(back, { key: "ArrowLeft" })
    expect(screen.getByRole("img", { name: `${lastCard.nameZh} / ${lastCard.nameEn}` })).toBeVisible()
    fireEvent.keyDown(back, { key: "Escape" })
    expect(screen.getByRole("status")).toHaveTextContent(/^78 \/ 78$/)
    const front = screen.getByRole("button", { name: "翻开第 78 张" })
    expect(front).toHaveAttribute("aria-current", "true")
    expect(front.querySelector("img")).toHaveAttribute("src", expect.stringContaining("card_back.webp"))
    expect(confirm).toHaveFocus()
  })

  test("动画中的按钮、键盘和挥手从最近的目标继续，大图中直接切换", () => {
    jest.useFakeTimers()
    reducedMotion = false
    let swipe!: (direction: SwipeDirection) => void
    const mock = jest.mocked(handSwipe.useHandSwipe).mockImplementation((callback) => {
      swipe = callback
      return {
        videoRef: { current: null }, status: "running", guide: "ready", error: null,
        pinch: INITIAL_PINCH,
        start: jest.fn(), stop: jest.fn(),
      }
    })
    try {
      const { viewport, next, confirm } = setupGallery()
      fireEvent.click(next)
      fireEvent.keyDown(viewport, { key: "ArrowRight" })
      act(() => swipe("left"))
      expect(screen.getByRole("status")).toHaveTextContent("1 / 78")
      act(() => jest.advanceTimersByTime(300))
      expect(screen.getByRole("status")).toHaveTextContent("4 / 78")
      fireEvent.click(confirm)
      act(() => swipe("right"))
      expect(screen.getByRole("status")).toHaveTextContent("3 / 78")
      expect(screen.getByRole("img", { name: "女祭司 / The High Priestess" })).toBeVisible()
    } finally {
      mock.mockImplementation(jest.requireActual("@/hooks/useHandSwipe").useHandSwipe)
      jest.useRealTimers()
    }
  })

  test("默认单次翻页，手势模式在牌环和大图之间保持独立选择", () => {
    const { confirm, viewport } = setupGallery()
    const modes = screen.getByRole("radiogroup", { name: "手势翻页方式" })
    expect(modes).toBeInTheDocument()
    const single = screen.getByRole("radio", { name: "单次翻页" })
    const repeat = screen.getByRole("radio", { name: "停留连翻" })
    expect(single).toBeChecked()
    expect(repeat).not.toBeChecked()
    fireEvent.click(repeat)
    expect(repeat).toBeChecked()
    expect(handSwipe.useHandSwipe).toHaveBeenLastCalledWith(expect.any(Function), "repeat", expect.any(Object))
    fireEvent.click(confirm)
    expect(repeat).toBeChecked()
    fireEvent.click(screen.getByRole("button", { name: "返回牌环" }))
    expect(repeat).toBeChecked()
    fireEvent.keyDown(repeat, { key: "ArrowLeft" })
    expect(screen.getByRole("status")).toHaveTextContent("1 / 78")
    fireEvent.click(single)
    expect(handSwipe.useHandSwipe).toHaveBeenLastCalledWith(expect.any(Function), "single", expect.any(Object))
    fireEvent.keyDown(viewport, { key: "ArrowRight" })
    expect(screen.getByRole("status")).toHaveTextContent("2 / 78")
  })

  test("连续的识别事件在牌环和大图中仍共用同一套选牌逻辑", () => {
    let swipe!: (direction: SwipeDirection) => void
    const mock = jest.mocked(handSwipe.useHandSwipe).mockImplementation((callback) => {
      swipe = callback
      return {
        videoRef: { current: null }, status: "running", guide: "repeating-left", error: null,
        pinch: INITIAL_PINCH,
        start: jest.fn(), stop: jest.fn(),
      }
    })
    try {
      const { confirm } = setupGallery()
      fireEvent.click(screen.getByRole("radio", { name: "停留连翻" }))
      expect(screen.getByText("正在连续看下一张，手移回中间即可停止")).toBeVisible()
      act(() => { swipe("left"); swipe("left") })
      expect(screen.getByRole("status")).toHaveTextContent(/^3 \/ 78$/)
      const front = screen.getByRole("button", { name: "翻开第 3 张" })
      expect(front.querySelector("img")).toHaveAttribute("src", expect.stringContaining("card_back.webp"))
      fireEvent.click(confirm)
      expect(screen.getByRole("img", { name: "女祭司 / The High Priestess" })).toBeVisible()
      act(() => swipe("left"))
      expect(screen.getByRole("status")).toHaveTextContent("4 / 78")
      act(() => swipe("right"))
      expect(screen.getByRole("status")).toHaveTextContent("3 / 78")
      expect(screen.getByRole("img", { name: "女祭司 / The High Priestess" })).toBeVisible()
    } finally {
      mock.mockImplementation(jest.requireActual("@/hooks/useHandSwipe").useHandSwipe)
    }
  })

  test("捏合只点亮前方牌背，确认后打开对应牌，返回按钮显示同样进度", () => {
    let controls!: PinchControls
    let feedback: PinchFeedback = INITIAL_PINCH
    const mock = jest.mocked(handSwipe.useHandSwipe).mockImplementation((_callback, _mode, options) => {
      controls = options!
      return {
        videoRef: { current: null }, status: "running", guide: "ready", error: null, pinch: feedback,
        start: jest.fn(), stop: jest.fn(),
      }
    })
    try {
      const rendered = render(<HomePage />)
      const original = controls.getContext().target
      feedback = { phase: "holding", progress: 0.5, target: original }
      rendered.rerender(<HomePage />)
      const active = document.querySelectorAll(".card-ring-thumbnail[data-pinch-active='true']")
      expect(active).toHaveLength(1)
      expect(active[0]).toHaveAttribute("aria-current", "true")
      expect(active[0].querySelector("rect")).toHaveAttribute("stroke-dashoffset", "0.5")
      expect(screen.getByText("保持轻捏，正在翻开这张牌")).toBeVisible()
      fireEvent.click(screen.getByRole("button", { name: /下一张/ }))
      act(() => controls.onConfirm(original))
      expect(screen.queryByRole("img", { name: "魔术师 / The Magician" })).not.toBeInTheDocument()
      act(() => controls.onConfirm(controls.getContext().target))
      expect(screen.getByRole("img", { name: "魔术师 / The Magician" })).toBeVisible()
      feedback = { phase: "holding", progress: 0.7, target: controls.getContext().target }
      rendered.rerender(<HomePage />)
      expect(screen.getByRole("button", { name: "返回牌环" })).toHaveAttribute("data-pinch-active", "true")
      act(() => controls.onConfirm(controls.getContext().target))
      expect(screen.getByRole("button", { name: "翻开第 2 张" })).toHaveAttribute("aria-current", "true")
    } finally {
      mock.mockImplementation(jest.requireActual("@/hooks/useHandSwipe").useHandSwipe)
    }
  })

  test("动画、滚轮和按住鼠标时禁止确认，输入后回到同一张也会拒绝旧确认", () => {
    jest.useFakeTimers()
    reducedMotion = false
    let controls!: PinchControls
    const mock = jest.mocked(handSwipe.useHandSwipe).mockImplementation((_callback, _mode, options) => {
      controls = options!
      return {
        videoRef: { current: null }, status: "running", guide: "ready", error: null, pinch: INITIAL_PINCH,
        start: jest.fn(), stop: jest.fn(),
      }
    })
    try {
      const { next, previous } = setupGallery()
      const original = controls.getContext().target
      fireEvent.click(next)
      expect(controls.getContext().settled).toBe(false)
      act(() => controls.onConfirm(original))
      expect(screen.getByRole("button", { name: "翻开这张牌" })).toBeVisible()
      fireEvent.click(previous)
      expect(controls.getContext().target.slot).toBe(original.slot)
      act(() => controls.onConfirm(original))
      expect(screen.getByRole("button", { name: "翻开这张牌" })).toBeVisible()
      const ring = document.querySelector(".card-ring")!
      const down = new Event("pointerdown", { bubbles: true })
      Object.assign(down, { isPrimary: true, button: 0, pointerId: 1, clientX: 100, clientY: 100 })
      fireEvent(ring, down)
      expect(controls.getContext().settled).toBe(false)
      const up = new Event("pointerup", { bubbles: true })
      Object.assign(up, { pointerId: 1 })
      fireEvent(ring, up)
      expect(controls.getContext().settled).toBe(true)
      fireEvent.wheel(ring, { deltaX: 45, deltaY: 0 })
      expect(controls.getContext().settled).toBe(false)
      act(() => jest.advanceTimersByTime(500))
      expect(controls.getContext().settled).toBe(true)
    } finally {
      mock.mockImplementation(jest.requireActual("@/hooks/useHandSwipe").useHandSwipe)
      jest.useRealTimers()
    }
  })
})

describe("旧入口跳转", () => {
  test.each([CardsPage, AboutPage])("统一重定向到首页", (Page) => {
    expect(() => Page()).toThrow("NEXT_REDIRECT")
    expect(redirect).toHaveBeenCalledWith("/")
  })
})
