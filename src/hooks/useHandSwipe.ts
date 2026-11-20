"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { HandLandmarker } from "@mediapipe/tasks-vision"
import { getMirroredPalm, HandSwipeTracker } from "@/lib/handSwipe"
import type { SwipeDirection, SwipeGuide, SwipeMode } from "@/lib/handSwipe"
import { getPinchRatio, INITIAL_PINCH, PINCH_TRACKING_GRACE_MS, PinchTracker, samePinchTarget } from "@/lib/pinch"
import type { PinchControls, PinchFeedback } from "@/lib/pinch"

type Status = "idle" | "starting" | "running" | "error"
type Session = {
  video: HTMLVideoElement
  stream: MediaStream | null
  detector: HandLandmarker | null
  frame: number | null
  removeListeners: () => void
  tracker: HandSwipeTracker
  pinch: PinchTracker
}

function release(session: Session) {
  if (session.frame !== null) cancelAnimationFrame(session.frame)
  session.removeListeners()
  session.pinch.reset()
  session.stream?.getTracks().forEach((track) => track.stop())
  if (session.stream && session.video.srcObject === session.stream) {
    session.video.pause()
    session.video.srcObject = null
  }
  // Camera tracks have already been released, even if the runtime fails to close.
  try { session.detector?.close() } catch { /* Already disposed by the runtime. */ }
}

function cameraError(error: unknown) {
  const name = error instanceof Error ? error.name : ""
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "摄像头权限被拒绝，请在浏览器中允许访问后重试。"
    case "NotFoundError":
    case "OverconstrainedError":
      return "未找到可用的摄像头，请连接摄像头后重试。"
    case "NotReadableError":
    case "AbortError":
      return "摄像头无法启动，可能正被其他应用占用，请稍后重试。"
    default:
      return "摄像头无法启动，请检查设备和浏览器权限后重试。"
  }
}

export function useHandSwipe(onSwipe: (direction: SwipeDirection, repeating?: boolean) => void, swipeMode: SwipeMode = "single", pinchControls?: PinchControls) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const sessionRef = useRef<Session | null>(null)
  const onSwipeRef = useRef(onSwipe)
  const swipeModeRef = useRef(swipeMode)
  const pinchControlsRef = useRef(pinchControls)
  const [status, setStatus] = useState<Status>("idle")
  const [guide, setGuide] = useState<SwipeGuide>("searching")
  const [error, setError] = useState<string | null>(null)
  const [pinch, setPinch] = useState<PinchFeedback>(INITIAL_PINCH)

  useEffect(() => { onSwipeRef.current = onSwipe }, [onSwipe])
  useEffect(() => { pinchControlsRef.current = pinchControls }, [pinchControls])
  useEffect(() => {
    swipeModeRef.current = swipeMode
    sessionRef.current?.tracker.setMode(swipeMode)
    sessionRef.current?.pinch.reset()
  }, [swipeMode])

  const cleanup = useCallback(() => {
    const session = sessionRef.current
    sessionRef.current = null
    if (session) release(session)
  }, [])

  const stop = useCallback(() => {
    cleanup()
    setStatus("idle")
    setError(null)
    setPinch(INITIAL_PINCH)
  }, [cleanup])

  useEffect(() => cleanup, [cleanup])

  const start = useCallback(async () => {
    if (sessionRef.current) return
    setError(null)
    if (window.isSecureContext === false || !navigator.mediaDevices?.getUserMedia) {
      setStatus("error")
      setError("当前环境不支持摄像头访问，请使用支持摄像头的浏览器，并通过 HTTPS 或 localhost 打开。")
      return
    }
    const video = videoRef.current
    if (!video) return
    const session: Session = {
      video, stream: null, detector: null, frame: null, removeListeners: () => {},
      tracker: new HandSwipeTracker(swipeModeRef.current),
      pinch: new PinchTracker(),
    }
    sessionRef.current = session
    setGuide("searching")
    setPinch(INITIAL_PINCH)
    setStatus("starting")
    const isCurrent = () => sessionRef.current === session
    const tracker = session.tracker
    const pinchTracker = session.pinch
    let publishedPinch = INITIAL_PINCH
    let publishedGuide: SwipeGuide = "searching"
    const publishGuide = () => {
      if (isCurrent() && publishedGuide !== tracker.guide) {
        publishedGuide = tracker.guide
        setGuide(tracker.guide)
      }
      if (isCurrent() && publishedPinch !== pinchTracker.feedback) {
        publishedPinch = pinchTracker.feedback
        setPinch(publishedPinch)
      }
    }
    const fail = (message: string) => {
      if (!isCurrent()) return
      cleanup()
      setError(message)
      setStatus("error")
      setPinch(INITIAL_PINCH)
    }
    const onPageHide = () => stop()
    const onVisibilityChange = () => {
      if (!document.hidden) return
      tracker.reset()
      pinchTracker.reset()
      publishGuide()
    }
    window.addEventListener("pagehide", onPageHide)
    document.addEventListener("visibilitychange", onVisibilityChange)
    session.removeListeners = () => {
      window.removeEventListener("pagehide", onPageHide)
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
    let stage: "camera" | "model" = "camera"

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      })
      // A permission prompt can outlive a cancelled start or an unmounted page.
      if (!isCurrent()) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      session.stream = stream
      const onEnded = () => fail("摄像头连接已中断，请检查设备后重新开启。")
      stream.getVideoTracks().forEach((track) => track.addEventListener("ended", onEnded))
      const removeSessionListeners = session.removeListeners
      session.removeListeners = () => {
        stream.getVideoTracks().forEach((track) => track.removeEventListener("ended", onEnded))
        removeSessionListeners()
      }
      video.srcObject = stream
      await video.play()
      if (!isCurrent()) return

      stage = "model"
      const { FilesetResolver, HandLandmarker } = await import("@mediapipe/tasks-vision")
      if (!isCurrent()) return
      const files = await FilesetResolver.forVisionTasks("/mediapipe/wasm")
      if (!isCurrent()) return
      const detector = await HandLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: "/mediapipe/hand_landmarker.task" },
        runningMode: "VIDEO",
        numHands: 1,
      })
      if (!isCurrent()) {
        detector.close()
        return
      }
      session.detector = detector
      setStatus("running")
      let lastSample = -Infinity
      let lastVideoTime = -1
      const detect = (now: number) => {
        if (!isCurrent()) return
        try {
          const controls = pinchControlsRef.current
          const context = controls?.getContext()
          // Clear stale feedback even if a stopped video produces no new frames.
          if (now - lastSample > PINCH_TRACKING_GRACE_MS || (pinchTracker.feedback.phase === "holding"
            && context && (!context.settled || !samePinchTarget(context.target, pinchTracker.feedback.target)))) {
            pinchTracker.reset()
          }
          if (document.hidden) {
            tracker.reset()
            pinchTracker.reset()
          }
          else if (now - lastSample >= 1000 / 20 && video.readyState >= 2
            && video.currentTime !== lastVideoTime) {
            lastSample = now
            lastVideoTime = video.currentTime
            const result = detector.detectForVideo(video, now)
            const points = result.landmarks[0]
            const palm = getMirroredPalm(points)
            const direction = tracker.update(
              palm, now, video.videoWidth, video.videoHeight,
            )
            if (direction) {
              pinchTracker.reset()
              // Repeat-driven frames keep the ring flowing at a steady pace.
              onSwipeRef.current(direction, tracker.guide === `repeating-${direction}`)
            } else {
              if (controls && context) {
                const confirmed = pinchTracker.update({
                  ratio: getPinchRatio(points, video.videoWidth, video.videoHeight), palm, time: now,
                  target: context.target,
                  canStart: tracker.guide === "ready" && !!palm && palm.x >= 0.2 && palm.x <= 0.8 && context.settled,
                })
                if (confirmed) {
                  const latest = controls.getContext()
                  if (latest.settled && samePinchTarget(latest.target, confirmed)) controls.onConfirm(confirmed)
                  else pinchTracker.reset()
                }
              }
            }
          }
          publishGuide()
          if (isCurrent()) session.frame = requestAnimationFrame(detect)
        } catch {
          fail("手势识别运行失败，请重新开启；仍可使用按钮或方向键翻页。")
        }
      }
      session.frame = requestAnimationFrame(detect)
    } catch (cause) {
      fail(stage === "camera" ? cameraError(cause) : "手势模型加载失败，请稍后重试；仍可使用按钮或方向键翻页。")
    }
  }, [cleanup, stop])

  return { videoRef, status, guide, error, pinch, start, stop }
}
