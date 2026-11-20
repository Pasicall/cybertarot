"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import CardGallery from "@/components/CardGallery"
import IntroScreen from "@/components/IntroScreen"
import type { SlotTarget } from "@/components/IntroScreen"

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)"
const INTRO_EXIT_MS = 1700

function subscribeToReducedMotion(callback: () => void) {
  const media = window.matchMedia(REDUCED_MOTION_QUERY)
  media.addEventListener("change", callback)
  return () => media.removeEventListener("change", callback)
}

function getReducedMotion() {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches
}

function getServerReducedMotion() {
  return null
}

export default function HomePage() {
  const reducedMotion = useSyncExternalStore<boolean | null>(subscribeToReducedMotion, getReducedMotion, getServerReducedMotion)
  const [phase, setPhase] = useState<"intro" | "enter" | "gallery">("intro")
  const [layout, setLayout] = useState<{ targets: SlotTarget[]; baseWidth: number } | null>(null)

  useEffect(() => {
    if (phase !== "enter") return

    let exitTimer: number | undefined
    const frame = window.requestAnimationFrame(() => {
      const targets = Array.from(document.querySelectorAll(".card-ring-thumbnail"), (thumbnail) => {
        const { left, top, width, height } = thumbnail.getBoundingClientRect()
        return { x: left, y: top, w: width, h: height }
      }).filter(({ w, h }) => w > 0 && h > 0)
      const baseWidth = document.querySelector<HTMLElement>(".intro-card")?.offsetWidth || 88
      setLayout({ targets, baseWidth })
      exitTimer = window.setTimeout(() => setPhase("gallery"), INTRO_EXIT_MS)
    })

    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(exitTimer)
    }
  }, [phase])

  return (
    <>
      {phase !== "gallery" && !reducedMotion && (
        <IntroScreen
          exiting={layout !== null}
          canStart={phase === "intro" && reducedMotion === false}
          targets={layout?.targets ?? []}
          baseWidth={layout?.baseWidth ?? 88}
          onStart={() => setPhase("enter")}
        />
      )}
      {(phase !== "intro" || reducedMotion) && <CardGallery />}
    </>
  )
}
