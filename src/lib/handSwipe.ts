export type SwipeDirection = "left" | "right"
export type SwipeMode = "single" | "repeat"
export type SwipeGuide = "searching" | "centering" | "settling" | "ready" | "returning"
  | "repeat-pending-left" | "repeat-pending-right"
  | "holding-left" | "holding-right" | "repeating-left" | "repeating-right"
type Point = { x: number; y: number }
type Sample = Point & { time: number }

const PALM_INDICES = [0, 5, 9, 13, 17]
const CENTER_SETTLE_MS = 80
const RETURN_SETTLE_MS = 150
const RETURN_CENTER_RADIUS = 0.08
const TRACKING_GRACE_MS = 250
const REPEAT_HOLD_MS = 280
const REPEAT_INTERVAL_MS = 400
const SIDE_ENTER_DISTANCE = 0.25
const SIDE_EXIT_DISTANCE = 0.22
const POSITION_EPSILON = 1e-6

/** One outward axis for both hands: positive always means moving in the swipe direction. */
function outwardDistance(x: number, origin: number, direction: SwipeDirection) {
  return (x - origin) * (direction === "right" ? 1 : -1)
}

function inSide(x: number, direction: SwipeDirection, holding = false) {
  const threshold = holding ? SIDE_EXIT_DISTANCE : SIDE_ENTER_DISTANCE
  return outwardDistance(x, 0.5, direction) + POSITION_EPSILON >= threshold
}

/** Raw camera frames are unmirrored; convert once to the user's mirror view. */
export function getMirroredPalm(landmarks: Point[] | undefined): Point | null {
  if (!landmarks || PALM_INDICES.some((index) => !landmarks[index])) return null
  const palm = PALM_INDICES.reduce((sum, index) => ({
    x: sum.x + landmarks[index].x / PALM_INDICES.length,
    y: sum.y + landmarks[index].y / PALM_INDICES.length,
  }), { x: 0, y: 0 })
  return { x: 1 - palm.x, y: palm.y }
}

/** Mutable tracking state, kept outside React's render loop. */
export class HandSwipeTracker {
  private samples: Sample[] = []
  private centerSamples: Sample[] = []
  private returnCenterX: number | null = null
  private repeatDirection: SwipeDirection | null = null
  private repeatDueAt: number | null = null
  guide: SwipeGuide = "searching"
  private lastTime: number | null = null

  constructor(private mode: SwipeMode = "single") {}

  setMode(mode: SwipeMode) {
    if (mode === this.mode) return
    this.mode = mode
    this.reset()
  }

  private cancelRepeat() {
    if (this.repeatDirection === null) return
    this.repeatDirection = null
    this.repeatDueAt = null
    this.guide = "returning"
  }

  reset() {
    this.samples = []
    this.centerSamples = []
    this.returnCenterX = null
    this.repeatDirection = null
    this.repeatDueAt = null
    this.guide = "searching"
    this.lastTime = null
  }

  update(palm: Point | null, time: number, width: number, height: number): SwipeDirection | null {
    if (width <= 0 || height <= 0) {
      this.reset()
      return null
    }
    // Measure the gap from the last valid hand, including paused/stalled frames.
    if (this.lastTime !== null && time - this.lastTime > TRACKING_GRACE_MS) {
      // Losing the hand cannot turn a swipe endpoint into a new neutral position.
      const returnCenterX = this.returnCenterX
      this.reset()
      this.returnCenterX = returnCenterX
      if (returnCenterX !== null) this.guide = "returning"
    }
    if (!palm) {
      this.cancelRepeat()
      // Allow a brief dropout without re-arming an already locked gesture.
      // Never join motion or center-settling samples across a tracking gap.
      this.samples = []
      this.centerSamples = []
      return null
    }
    this.lastTime = time
    const sample = { ...palm, time }

    if (this.repeatDirection !== null) {
      const direction = this.repeatDirection
      // Once entered, allow a 3% inward wobble instead of cancelling at the same edge.
      if (inSide(palm.x, direction, this.repeatDueAt !== null)) {
        this.centerSamples = []
        if (this.repeatDueAt === null) {
          this.repeatDueAt = time + REPEAT_HOLD_MS
          this.guide = `holding-${direction}`
        } else if (time >= this.repeatDueAt) {
          // Emit once per fresh frame; never catch up missed repeat intervals.
          this.repeatDueAt = time + REPEAT_INTERVAL_MS
          this.guide = `repeating-${direction}`
          return direction
        }
        return null
      }

      // A fast return can cross the entire neutral zone between sampled frames.
      const returnedToStart = this.returnCenterX !== null
        && outwardDistance(palm.x, this.returnCenterX, direction) <= RETURN_CENTER_RADIUS + POSITION_EPSILON
      if (this.repeatDueAt !== null || returnedToStart) this.cancelRepeat()
      else {
        // A short swipe may need more outward motion to reach the side zone.
        this.guide = `repeat-pending-${direction}`
        return null
      }
    }

    if (this.guide !== "ready") {
      const returning = this.returnCenterX !== null
      const inCenter = this.returnCenterX !== null
        ? Math.abs(palm.x - this.returnCenterX) <= RETURN_CENTER_RADIUS + POSITION_EPSILON
        : Math.abs(palm.x - 0.5) <= 0.25 + POSITION_EPSILON
      if (!inCenter) {
        this.guide = returning ? "returning" : "centering"
        this.centerSamples = []
        return null
      }
      this.guide = "settling"
      this.centerSamples.push(sample)
      const settleMs = returning ? RETURN_SETTLE_MS : CENTER_SETTLE_MS
      // Retain the earliest sample spanning the settling period at a 15fps cadence.
      while (this.centerSamples.length > 1 && time - this.centerSamples[1].time >= settleMs) {
        this.centerSamples.shift()
      }
      const xs = this.centerSamples.map((point) => point.x)
      if (Math.max(...xs) - Math.min(...xs) >= (returning ? 0.015 : 0.04)) {
        this.centerSamples = [sample]
        return null
      }
      if (time - this.centerSamples[0].time >= settleMs) {
        this.guide = "ready"
        this.returnCenterX = null
        this.centerSamples = []
        this.samples = [sample]
      }
      return null
    }

    this.samples = this.samples.filter((point) => time - point.time <= 500)
    this.samples.push(sample)
    if (this.samples.length < 3) return null
    const dx = palm.x - this.samples[0].x
    const dy = palm.y - this.samples[0].y
    if (Math.abs(dx) > 0.11 + POSITION_EPSILON
      && Math.abs(dx) * width + POSITION_EPSILON >= 1.25 * Math.abs(dy) * height) {
      const returnCenterX = this.samples[0].x
      this.reset()
      this.returnCenterX = returnCenterX
      this.guide = "returning"
      this.lastTime = time
      const direction = dx < 0 ? "left" : "right"
      if (this.mode === "repeat") {
        this.repeatDirection = direction
        if (inSide(palm.x, direction)) {
          this.repeatDueAt = time + REPEAT_HOLD_MS
          this.guide = `holding-${direction}`
        } else {
          this.guide = `repeat-pending-${direction}`
        }
      }
      return direction
    }
    return null
  }
}
