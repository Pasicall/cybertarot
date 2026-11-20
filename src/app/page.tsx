"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import CardGallery from "@/components/CardGallery"
import IntroScreen from "@/components/IntroScreen"

type Phase = "intro" | "enter" | "gallery"

/** CardRing 每个 thumbnail 的屏幕坐标，用于散乱牌退场时的精确目标 */
export type SlotTarget = { x: number; y: number; w: number; h: number }

const INTRO_EXIT_MS = 1700

export default function HomePage() {
  const [phase, setPhase] = useState<Phase>("intro")
  const [targets, setTargets] = useState<SlotTarget[]>([])
  const [baseWidth, setBaseWidth] = useState(88)
  const timerRef = useRef<number | null>(null)
  const measuredRef = useRef(false)

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setPhase("gallery")
      /* eslint-enable react-hooks/set-state-in-effect */
    }
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    }
  }, [])

  /* enter 阶段：CardGallery DOM 就绪后 measure 17 个 thumbnail 的屏幕坐标
     同时读取散乱牌布局宽度（offsetWidth 不含 transform）作为 scale 基准 */
  useEffect(() => {
    if (phase !== "enter" || measuredRef.current) return
    const raf = requestAnimationFrame(() => {
      const thumbs = document.querySelectorAll(".card-ring-thumbnail")
      const rects: SlotTarget[] = []
      thumbs.forEach((el) => {
        const r = el.getBoundingClientRect()
        rects.push({ x: r.left, y: r.top, w: r.width, h: r.height })
      })
      const firstIntro = document.querySelector(".intro-card") as HTMLElement | null
      if (rects.length > 0) {
        measuredRef.current = true
        setTargets(rects)
        if (firstIntro && firstIntro.offsetWidth > 0) {
          setBaseWidth(firstIntro.offsetWidth)
        }
      }
    })
    return () => cancelAnimationFrame(raf)
  }, [phase])

  const start = useCallback(() => {
    measuredRef.current = false
    setPhase("enter")
    timerRef.current = window.setTimeout(() => setPhase("gallery"), INTRO_EXIT_MS)
  }, [])

  return (
    <>
      {phase !== "gallery" && (
        <IntroScreen
          exiting={phase === "enter"}
          targets={targets}
          baseWidth={baseWidth}
          onStart={start}
        />
      )}
      {phase !== "intro" && <CardGallery />}
    </>
  )
}