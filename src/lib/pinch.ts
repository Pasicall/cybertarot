type Point = { x: number; y: number }
export type PinchTarget = { view: "ring" | "detail"; slot: number; revision: number }
export type PinchPhase = "waiting-open" | "ready" | "holding" | "locked"
export type PinchFeedback = { phase: PinchPhase; progress: number; target: PinchTarget | null }
export type PinchContext = { target: PinchTarget; settled: boolean }
export type PinchControls = {
  getContext: () => PinchContext
  onConfirm: (target: PinchTarget) => void
}

export const INITIAL_PINCH: PinchFeedback = { phase: "waiting-open", progress: 0, target: null }
const OPEN_RATIO = 0.45
/* 0.28：侧对摄像头时掌宽像素偏小、ratio 虚高，放宽闭合阈值保证侧身也能捏合 */
const CLOSED_RATIO = 0.28
const CONFIRM_MS = 250
export const PINCH_TRACKING_GRACE_MS = 150

export function samePinchTarget(a: PinchTarget | null, b: PinchTarget | null) {
  return a === b || (a !== null && b !== null
    && a.view === b.view && a.slot === b.slot && a.revision === b.revision)
}

/** Scale fingertip separation by palm width using camera pixels, not normalized distances. */
export function getPinchRatio(points: Point[] | undefined, width: number, height: number): number | null {
  if (!points || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  if ([4, 8, 5, 17].some((index) => !points[index]
    || !Number.isFinite(points[index].x) || !Number.isFinite(points[index].y))) return null
  const distance = (a: Point, b: Point) => Math.hypot((a.x - b.x) * width, (a.y - b.y) * height)
  const palmWidth = distance(points[5], points[17])
  if (palmWidth < 12) return null
  const ratio = distance(points[4], points[8]) / palmWidth
  return Number.isFinite(ratio) ? ratio : null
}

type Frame = {
  ratio: number | null
  palm: Point | null
  time: number
  target: PinchTarget
  canStart: boolean
}

export class PinchTracker {
  feedback: PinchFeedback = INITIAL_PINCH
  private lastTime: number | null = null
  private lastTarget: PinchTarget | null = null
  private hold: { time: number; palm: Point; target: PinchTarget } | null = null

  reset() {
    this.feedback = INITIAL_PINCH
    this.lastTime = null
    this.lastTarget = null
    this.hold = null
  }

  private publish(phase: PinchPhase, progress = 0, target: PinchTarget | null = null) {
    if (this.feedback.phase !== phase || this.feedback.progress !== progress
      || !samePinchTarget(this.feedback.target, target)) this.feedback = { phase, progress, target }
  }

  update({ ratio, palm, time, target, canStart }: Frame): PinchTarget | null {
    if (ratio === null || !Number.isFinite(ratio) || ratio < 0 || !palm
      || !Number.isFinite(palm.x) || !Number.isFinite(palm.y)) {
      this.reset()
      return null
    }
    if (this.lastTime !== null && time - this.lastTime > PINCH_TRACKING_GRACE_MS) this.reset()
    // Keep the release lock across the view change caused by this confirmation.
    if (this.feedback.phase !== "locked" && this.lastTarget && !samePinchTarget(this.lastTarget, target)) this.reset()
    this.lastTime = time
    this.lastTarget = { ...target }

    if (ratio >= OPEN_RATIO) {
      this.hold = null
      this.publish("ready")
      return null
    }
    if (this.feedback.phase === "waiting-open" || this.feedback.phase === "locked") return null

    if (this.hold) {
      if (!canStart || Math.abs(palm.x - this.hold.palm.x) > 0.05
        || Math.abs(palm.y - this.hold.palm.y) > 0.05) {
        this.reset()
        return null
      }
      const progress = Math.min(1, (time - this.hold.time) / CONFIRM_MS)
      if (progress >= 1) {
        const confirmed = this.hold.target
        this.hold = null
        this.publish("locked")
        return confirmed
      }
      this.publish("holding", progress, this.hold.target)
    } else if (canStart && ratio <= CLOSED_RATIO) {
      this.hold = { time, palm: { ...palm }, target: { ...target } }
      this.publish("holding", 0, this.hold.target)
    }
    return null
  }
}
