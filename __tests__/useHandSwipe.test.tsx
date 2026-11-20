import { act, renderHook } from "@testing-library/react"
import { useHandSwipe } from "@/hooks/useHandSwipe"
import type { SwipeDirection, SwipeMode } from "@/lib/handSwipe"
import type { PinchContext, PinchControls, PinchTarget } from "@/lib/pinch"

const createDetector = jest.fn()
const resolveFiles = jest.fn()
jest.mock("@mediapipe/tasks-vision", () => ({
  FilesetResolver: { forVisionTasks: (...args: unknown[]) => resolveFiles(...args) },
  HandLandmarker: { createFromOptions: (...args: unknown[]) => createDetector(...args) },
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function camera() {
  const track = Object.assign(new EventTarget(), { stop: jest.fn() })
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream
  return { track, stream }
}

const getUserMedia = jest.fn()
let detector: { close: jest.Mock; detectForVideo: jest.Mock }
let frames: Map<number, FrameRequestCallback>
let frameId: number

beforeEach(() => {
  jest.clearAllMocks()
  frames = new Map()
  frameId = 0
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } })
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true })
  Object.defineProperty(document, "hidden", { configurable: true, value: false })
  jest.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue()
  jest.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {})
  jest.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.set(++frameId, callback)
    return frameId
  })
  jest.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => { frames.delete(id) })
  detector = { close: jest.fn(), detectForVideo: jest.fn(() => ({ landmarks: [] })) }
  createDetector.mockResolvedValue(detector)
  resolveFiles.mockResolvedValue({})
})

afterEach(() => { jest.restoreAllMocks() })

function setup(onSwipe = jest.fn(), swipeMode: SwipeMode = "single", pinchControls?: PinchControls) {
  const hook = renderHook(({ mode }) => useHandSwipe(onSwipe, mode, pinchControls), { initialProps: { mode: swipeMode } })
  const video = document.createElement("video")
  Object.defineProperty(video, "readyState", { value: 2 })
  Object.defineProperty(video, "videoWidth", { value: 640 })
  Object.defineProperty(video, "videoHeight", { value: 480 })
  hook.result.current.videoRef.current = video
  return { ...hook, video, onSwipe }
}

function sampleFrame(video: HTMLVideoElement, time: number, mirrorX: number | null, fresh = true, ratio?: number) {
  if (fresh) video.currentTime = time / 1000
  const points = Array.from({ length: 21 }, () => ({ x: 1 - (mirrorX ?? 0.5), y: 0.5 }))
  if (ratio !== undefined) {
    const x = 1 - (mirrorX ?? 0.5)
    points[5] = { x: x - 0.08, y: 0.5 }
    points[17] = { x: x + 0.08, y: 0.5 }
    points[4] = { x: x - 0.02, y: 0.4 }
    points[8] = { x: x - 0.02 + 0.16 * ratio, y: 0.4 }
  }
  detector.detectForVideo.mockReturnValue({
    landmarks: mirrorX === null ? [] : [points],
  })
  const [id, callback] = frames.entries().next().value!
  frames.delete(id)
  act(() => callback(time))
}

async function startRepeat(direction: SwipeDirection = "left") {
  const { stream, track } = camera()
  getUserMedia.mockResolvedValue(stream)
  const hook = setup(jest.fn(), "repeat")
  await act(async () => { await hook.result.current.start() })
  const mirror = (x: number) => direction === "left" ? x : 1 - x
  for (const [time, x] of [[0, 0.5], [70, 0.5], [140, 0.5], [210, 0.4], [280, 0.25]]) {
    sampleFrame(hook.video, time, mirror(x))
  }
  expect(hook.onSwipe).toHaveBeenCalledTimes(1)
  expect(hook.result.current.guide).toBe(`holding-${direction}`)
  for (const time of [340, 410, 480, 550]) sampleFrame(hook.video, time, mirror(0.25))
  return { ...hook, stream, track }
}

test("只在主动开启后请求摄像头；关闭会取消循环并释放全部资源", async () => {
  const { stream, track } = camera()
  getUserMedia.mockResolvedValue(stream)
  const { result, video } = setup()
  expect(getUserMedia).not.toHaveBeenCalled()
  expect(createDetector).not.toHaveBeenCalled()
  await act(async () => { await result.current.start() })
  expect(result.current.status).toBe("running")
  expect(video.srcObject).toBe(stream)
  expect(frames.size).toBe(1)
  act(() => result.current.stop())
  expect(result.current.status).toBe("idle")
  expect(track.stop).toHaveBeenCalledTimes(1)
  expect(detector.close).toHaveBeenCalledTimes(1)
  expect(video.srcObject).toBeNull()
  expect(frames.size).toBe(0)
})

test("权限等待时取消并重新开启，迟到的授权只释放旧流", async () => {
  const pending = deferred<MediaStream>()
  const old = camera()
  const current = camera()
  getUserMedia.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(current.stream)
  const { result, video } = setup()
  let firstStart!: Promise<void>
  act(() => { firstStart = result.current.start() })
  expect(result.current.status).toBe("starting")
  act(() => result.current.stop())
  await act(async () => { await result.current.start() })
  await act(async () => { pending.resolve(old.stream); await firstStart })
  expect(old.track.stop).toHaveBeenCalledTimes(1)
  expect(current.track.stop).not.toHaveBeenCalled()
  expect(result.current.status).toBe("running")
  expect(video.srcObject).toBe(current.stream)
})

test("模型加载时卸载，迟到的识别器也会关闭", async () => {
  const pending = deferred<typeof detector>()
  const { stream, track } = camera()
  getUserMedia.mockResolvedValue(stream)
  createDetector.mockReturnValue(pending.promise)
  const { result, unmount, video } = setup()
  let start!: Promise<void>
  await act(async () => { start = result.current.start(); await Promise.resolve() })
  expect(createDetector).toHaveBeenCalled()
  unmount()
  expect(track.stop).toHaveBeenCalledTimes(1)
  expect(video.srcObject).toBeNull()
  await act(async () => { pending.resolve(detector); await start })
  expect(detector.close).toHaveBeenCalledTimes(1)
  expect(frames.size).toBe(0)
})

test.each([
  ["NotAllowedError", "权限被拒绝"],
  ["NotFoundError", "未找到可用的摄像头"],
  ["NotReadableError", "可能正被其他应用占用"],
])("摄像头错误 %s 提供可重试的原因", async (name, message) => {
  getUserMedia.mockRejectedValue(new DOMException("camera", name))
  const { result } = setup()
  await act(async () => { await result.current.start() })
  expect(result.current.status).toBe("error")
  expect(result.current.error).toContain(message)
  expect(createDetector).not.toHaveBeenCalled()
})

test("模型初始化失败会立即释放摄像头，重试可以成功", async () => {
  const { stream, track } = camera()
  getUserMedia.mockResolvedValue(stream)
  createDetector.mockRejectedValueOnce(new Error("missing model"))
  const { result, video } = setup()
  await act(async () => { await result.current.start() })
  expect(result.current.error).toContain("手势模型加载失败")
  expect(track.stop).toHaveBeenCalledTimes(1)
  expect(video.srcObject).toBeNull()
  await act(async () => { await result.current.start() })
  expect(result.current.status).toBe("running")
  expect(result.current.error).toBeNull()
})

test.each(["ended", "pagehide", "unmount", "inference failure"])("%s 释放已运行的摄像头和模型", async (reason) => {
  const { stream, track } = camera()
  getUserMedia.mockResolvedValue(stream)
  const { result, unmount, video } = setup()
  await act(async () => { await result.current.start() })
  act(() => {
    if (reason === "ended") track.dispatchEvent(new Event("ended"))
    else if (reason === "pagehide") window.dispatchEvent(new Event("pagehide"))
    else if (reason === "unmount") unmount()
    else {
      detector.detectForVideo.mockImplementation(() => { throw new Error("wasm") })
      frames.values().next().value!(100)
    }
  })
  expect(track.stop).toHaveBeenCalledTimes(1)
  expect(detector.close).toHaveBeenCalledTimes(1)
  expect(video.srcObject).toBeNull()
  expect(frames.size).toBe(0)
})

test("识别视频帧被限制在约 20fps，并把镜像左挥传给画廊", async () => {
  const { stream } = camera()
  getUserMedia.mockResolvedValue(stream)
  const { result, video, onSwipe } = setup()
  await act(async () => { await result.current.start() })
  const sample = (time: number, rawX: number, changeFrame = true) => {
    if (changeFrame) video.currentTime = time / 1000
    detector.detectForVideo.mockReturnValue({
      landmarks: [Array.from({ length: 21 }, () => ({ x: rawX, y: 0.5 }))],
    })
    const [id, callback] = frames.entries().next().value!
    frames.delete(id)
    act(() => callback(time))
  }
  expect(result.current.guide).toBe("searching")
  sample(0, 0.5)
  expect(result.current.guide).toBe("settling")
  sample(10, 0.9)
  sample(70, 0.5)
  sample(140, 0.5)
  expect(result.current.guide).toBe("ready")
  sample(210, 0.5)
  sample(280, 0.6)
  sample(350, 0.75)
  expect(result.current.guide).toBe("returning")
  sample(420, 0.1, false)
  expect(detector.detectForVideo).toHaveBeenCalledTimes(6)
  expect(onSwipe).toHaveBeenCalledTimes(1)
  expect(onSwipe).toHaveBeenCalledWith("left", false)
})

test.each(["left", "right"] as const)("%s 连翻由新视频帧推进，侧边回摆时保持一致", async (direction) => {
  const { video, result, onSwipe } = await startRepeat(direction)
  const mirror = (x: number) => direction === "left" ? x : 1 - x
  sampleFrame(video, 620, mirror(0.27))
  expect(onSwipe).toHaveBeenCalledTimes(2)
  expect(result.current.guide).toBe(`repeating-${direction}`)
  for (const time of [690, 760, 830, 900, 970]) sampleFrame(video, time, mirror(0.27))
  expect(onSwipe).toHaveBeenCalledTimes(2)
  sampleFrame(video, 1050, mirror(0.27))
  expect(onSwipe).toHaveBeenCalledTimes(3)
  expect(onSwipe.mock.calls).toEqual([[direction, false], [direction, true], [direction, true]])
  for (const time of [1120, 1190, 1260, 1330]) sampleFrame(video, time, 0.5)
  expect(result.current.guide).toBe("ready")
  sampleFrame(video, 1400, mirror(0.4))
  sampleFrame(video, 1470, mirror(0.24))
  expect(onSwipe).toHaveBeenCalledTimes(4)
  for (const time of [1540, 1610, 1680, 1750]) sampleFrame(video, time, mirror(0.27))
  expect(onSwipe).toHaveBeenCalledTimes(5)
})

test.each(["收手", "丢手", "视频停帧"])("%s 会取消连翻，恢复后不会补翻或反向误触", async (reason) => {
  const { video, onSwipe } = await startRepeat()
  if (reason === "视频停帧") {
    sampleFrame(video, 620, 0.25, false)
    sampleFrame(video, 690, 0.25, false)
    expect(onSwipe).toHaveBeenCalledTimes(1)
    // 恢复帧距上次有效识别 300ms，超过 250ms 容错，须重置
    sampleFrame(video, 850, 0.25)
  } else {
    sampleFrame(video, 620, reason === "丢手" ? null : 0.5)
    sampleFrame(video, 690, 0.25)
    sampleFrame(video, 760, 0.8)
  }
  for (const time of [830, 900, 970, 1040, 1110, 1180, 1250, 1320]) sampleFrame(video, time, 0.25)
  expect(onSwipe).toHaveBeenCalledTimes(1)
})

test("页面隐藏即清除连翻，不依赖后台动画帧；恢复后重新居中", async () => {
  const { video, result, onSwipe, track } = await startRepeat()
  Object.defineProperty(document, "hidden", { value: true })
  act(() => document.dispatchEvent(new Event("visibilitychange")))
  expect(result.current.guide).toBe("searching")
  Object.defineProperty(document, "hidden", { value: false })
  act(() => document.dispatchEvent(new Event("visibilitychange")))
  for (const time of [5000, 5070, 5140, 5210, 5280]) sampleFrame(video, time, 0.2)
  expect(onSwipe).toHaveBeenCalledTimes(1)
  expect(track.stop).not.toHaveBeenCalled()
  for (const time of [5350, 5420, 5490]) sampleFrame(video, time, 0.5)
  expect(result.current.guide).toBe("ready")
  sampleFrame(video, 5560, 0.4)
  sampleFrame(video, 5630, 0.25)
  expect(onSwipe).toHaveBeenCalledTimes(2)
})

test("运行中切换手势模式清空轨迹和计时，复用当前摄像头", async () => {
  const { video, result, onSwipe, rerender, stream, track } = await startRepeat()
  act(() => rerender({ mode: "single" }))
  sampleFrame(video, 620, 0.2)
  expect(result.current.guide).toBe("centering")
  act(() => rerender({ mode: "repeat" }))
  for (const time of [690, 760, 830, 900, 970, 1040, 1110, 1180, 1250]) sampleFrame(video, time, 0.2)
  expect(onSwipe).toHaveBeenCalledTimes(1)
  for (const time of [1320, 1390, 1460]) sampleFrame(video, time, 0.5)
  expect(result.current.guide).toBe("ready")
  sampleFrame(video, 1530, 0.4)
  sampleFrame(video, 1600, 0.25)
  expect(onSwipe).toHaveBeenCalledTimes(2)
  expect(video.srcObject).toBe(stream)
  expect(getUserMedia).toHaveBeenCalledTimes(1)
  expect(createDetector).toHaveBeenCalledTimes(1)
  expect(track.stop).not.toHaveBeenCalled()
})

test.each(["stop", "ended", "unmount"])("连翻待触发时 %s 会取消帧循环并释放资源", async (reason) => {
  const { result, unmount, video, onSwipe, track } = await startRepeat()
  act(() => {
    if (reason === "unmount") unmount()
    else if (reason === "ended") track.dispatchEvent(new Event("ended"))
    else result.current.stop()
  })
  expect(frames.size).toBe(0)
  expect(onSwipe).toHaveBeenCalledTimes(1)
  expect(track.stop).toHaveBeenCalledTimes(1)
  expect(detector.close).toHaveBeenCalledTimes(1)
  expect(video.srcObject).toBeNull()
})

async function startPinch(mode: SwipeMode = "single") {
  const context: PinchContext = { target: { view: "ring", slot: 0, revision: 0 }, settled: true }
  const onConfirm = jest.fn((target: PinchTarget) => {
    context.target = { ...target, view: target.view === "ring" ? "detail" : "ring", revision: target.revision + 1 }
  })
  const onSwipe = jest.fn((direction: SwipeDirection) => {
    context.target = { ...context.target, slot: context.target.slot + (direction === "left" ? 1 : -1), revision: context.target.revision + 1 }
  })
  const controls = { getContext: jest.fn(() => context), onConfirm }
  const { stream, track } = camera()
  getUserMedia.mockResolvedValue(stream)
  const hook = setup(onSwipe, mode, controls)
  await act(async () => { await hook.result.current.start() })
  for (const time of [0, 70, 140]) sampleFrame(hook.video, time, 0.5, true, 0.6)
  expect(hook.result.current.guide).toBe("ready")
  return { ...hook, controls, context, onConfirm, track }
}

test.each(["single", "repeat"] as const)("%s 模式中长捏只打开一次，松开再捏才返回", async (mode) => {
  const { video, result, onConfirm, track } = await startPinch(mode)
  sampleFrame(video, 210, 0.5, true, 0.2)
  expect(result.current.pinch.phase).toBe("holding")
  for (const time of [280, 350, 420]) sampleFrame(video, time, 0.5, true, 0.3)
  expect(onConfirm).not.toHaveBeenCalled()
  expect(result.current.pinch.progress).toBeGreaterThan(0.8)
  sampleFrame(video, 490, 0.5, true, 0.3)
  expect(onConfirm).toHaveBeenCalledTimes(1)
  expect(onConfirm).toHaveBeenLastCalledWith({ view: "ring", slot: 0, revision: 0 })
  for (const time of [560, 630, 700]) sampleFrame(video, time, 0.5, true, 0.2)
  expect(result.current.pinch.phase).toBe("locked")
  expect(onConfirm).toHaveBeenCalledTimes(1)
  sampleFrame(video, 770, 0.5, true, 0.6)
  for (const time of [840, 910, 980, 1050, 1120]) sampleFrame(video, time, 0.5, true, 0.2)
  expect(onConfirm).toHaveBeenCalledTimes(2)
  expect(onConfirm).toHaveBeenLastCalledWith({ view: "detail", slot: 0, revision: 1 })
  expect(getUserMedia).toHaveBeenCalledTimes(1)
  expect(createDetector).toHaveBeenCalledTimes(1)
  expect(track.stop).not.toHaveBeenCalled()
})

test("同帧捏合到期与挥手冲突时只派发翻页", async () => {
  const { video, result, onSwipe, onConfirm } = await startPinch()
  for (const time of [210, 280, 350, 420]) sampleFrame(video, time, 0.5, true, 0.2)
  sampleFrame(video, 490, 0.34, true, 0.2)
  expect(onSwipe).toHaveBeenCalledWith("left", false)
  expect(onConfirm).not.toHaveBeenCalled()
  expect(result.current.pinch.progress).toBe(0)
})

test.each(["横移", "缺手", "停帧", "换牌", "切换模式", "后台", "画廊移动"])("捏合中途%s会撤销确认，闭合恢复不再自动确认", async (reason) => {
  const { video, result, context, rerender, onConfirm } = await startPinch()
  sampleFrame(video, 210, 0.5, true, 0.2)
  if (reason === "后台") {
    Object.defineProperty(document, "hidden", { value: true })
    act(() => document.dispatchEvent(new Event("visibilitychange")))
    expect(result.current.pinch.progress).toBe(0)
    Object.defineProperty(document, "hidden", { value: false })
    act(() => document.dispatchEvent(new Event("visibilitychange")))
  } else if (reason === "换牌") context.target = { ...context.target, slot: 1, revision: 1 }
  else if (reason === "切换模式") act(() => rerender({ mode: "repeat" }))
  else if (reason === "画廊移动") context.settled = false
  sampleFrame(video, 280, reason === "缺手" ? null : reason === "横移" ? 0.56 : 0.5, reason !== "停帧", 0.2)
  context.settled = true
  if (reason === "停帧") {
    sampleFrame(video, 350, 0.5, false, 0.2)
    sampleFrame(video, 420, 0.5, false, 0.2)
    expect(result.current.pinch).toMatchObject({ phase: "waiting-open", progress: 0 })
  } else for (const time of [350, 420]) sampleFrame(video, time, 0.5, true, 0.2)
  for (const time of [490, 560, 630, 700, 770]) sampleFrame(video, time, 0.5, true, 0.2)
  expect(onConfirm).not.toHaveBeenCalled()
  expect(result.current.pinch).toMatchObject({ phase: "waiting-open", progress: 0 })
})

test("画廊输入即使没有新视频帧也会撤销捏合描边", async () => {
  const { video, result, context, onConfirm } = await startPinch()
  sampleFrame(video, 210, 0.5, true, 0.2)
  expect(result.current.pinch.phase).toBe("holding")
  const calls = detector.detectForVideo.mock.calls.length
  context.settled = false
  sampleFrame(video, 280, 0.5, false, 0.2)
  expect(detector.detectForVideo).toHaveBeenCalledTimes(calls)
  expect(result.current.pinch).toMatchObject({ phase: "waiting-open", progress: 0 })
  expect(onConfirm).not.toHaveBeenCalled()
})

test("侧边捏住不妨碍原有连翻，回中停稳并松开再捏可打开当前牌", async () => {
  const { video, onSwipe, onConfirm } = await startPinch("repeat")
  sampleFrame(video, 210, 0.4, true, 0.2)
  sampleFrame(video, 280, 0.25, true, 0.2)
  for (const time of [350, 420, 490, 560, 630, 700, 770]) sampleFrame(video, time, 0.25, true, 0.2)
  expect(onSwipe).toHaveBeenCalledTimes(2)
  expect(onConfirm).not.toHaveBeenCalled()
  for (const time of [840, 910, 980, 1050]) sampleFrame(video, time, 0.5, true, 0.2)
  expect(onConfirm).not.toHaveBeenCalled()
  sampleFrame(video, 1120, 0.5, true, 0.6)
  for (const time of [1190, 1260, 1330, 1400, 1470]) sampleFrame(video, time, 0.5, true, 0.2)
  expect(onConfirm).toHaveBeenCalledTimes(1)
  expect(onConfirm).toHaveBeenCalledWith({ view: "ring", slot: 2, revision: 2 })
})

test("确认前再次复核目标，目标变动时取消回调", async () => {
  const { video, controls, context, onConfirm, result } = await startPinch()
  for (const time of [210, 280, 350, 420]) sampleFrame(video, time, 0.5, true, 0.2)
  controls.getContext.mockImplementationOnce(() => context).mockImplementationOnce(() => ({
    ...context, target: { ...context.target, slot: 1 },
  }))
  sampleFrame(video, 490, 0.5, true, 0.2)
  expect(onConfirm).not.toHaveBeenCalled()
  expect(result.current.pinch.phase).toBe("waiting-open")
})
