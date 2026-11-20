"use client"

import Image from "next/image"
import { useMemo } from "react"
import type { CSSProperties } from "react"
import { CARDS } from "@/data/cards"


type IntroCard = {
  id: string
  src: string
  tx: string
  ty: string
  rot: number
  scale: number
  slotX: number
  slotY: number
  slotScale: number
  flyDelay: string
}

const CARD_BACK = "/assets/cards/card_back.webp"
const RING_SLOTS = 17

function seeded(index: number, salt: number) {
  const x = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453
  return x - Math.floor(x)
}

function ringSlot(index: number) {
  const half = (RING_SLOTS - 1) / 2
  const theta = ((index - half) * 2 * Math.PI) / RING_SLOTS
  const cosine = Math.cos(theta)
  return {
    slotX: Math.sin(theta),
    slotY: cosine,
    slotScale: 0.55 + ((cosine + 1) / 2) * 0.45,
  }
}

function generateCards(): IntroCard[] {
  return CARDS.map((card, index) => {
    const front = seeded(index, 1) < 0.55
    const slot = ringSlot(index % RING_SLOTS)
    return {
      id: card.id,
      src: front ? card.imagePath : CARD_BACK,
      tx: `${(seeded(index, 2) * 88 - 44).toFixed(1)}vw`,
      ty: `${(seeded(index, 3) * 84 - 42).toFixed(1)}vh`,
      rot: seeded(index, 4) * 300 - 150,
      scale: 0.85 + seeded(index, 5) * 0.3,
      slotX: slot.slotX,
      slotY: slot.slotY,
      slotScale: slot.slotScale,
      flyDelay: `${index * 7}ms`,
    }
  })
}

export type SlotTarget = { x: number; y: number; w: number; h: number }

type IntroScreenProps = {
  onStart: () => void
  exiting: boolean
  canStart: boolean
  targets: SlotTarget[]
  baseWidth: number
}

function computeExit(
  index: number,
  targets: SlotTarget[],
  baseWidth: number,
): { tx: string; ty: string; sc: string } {
  const slot = targets[index % targets.length]
  const vw = window.innerWidth
  const vh = window.innerHeight
  const cx = slot.x + slot.w / 2
  const cy = slot.y + slot.h / 2
  const sc = baseWidth > 0 ? slot.w / baseWidth : 1
  return {
    tx: `${((cx - vw / 2) / vw * 100).toFixed(1)}vw`,
    ty: `${((cy - vh / 2) / vh * 100).toFixed(1)}vh`,
    sc: sc.toFixed(3),
  }
}

export default function IntroScreen({ onStart, exiting, canStart, targets, baseWidth }: IntroScreenProps) {
  const cards = useMemo(() => generateCards(), [])
  const hasTargets = targets.length > 0

  return (
    <div
      className={`intro${exiting ? " intro--exiting" : ""}`}
      inert={exiting}
    >
      <div className="intro-ring-track" aria-hidden="true" />

      <div className="intro-cards" aria-hidden="true">
        {cards.map((card, index) => {
          const exit = exiting && hasTargets ? computeExit(index, targets, baseWidth) : null
          return (
            <div
              key={card.id}
              className="intro-card"
              style={{
                "--tx": card.tx,
                "--ty": card.ty,
                "--rot": `${card.rot.toFixed(2)}deg`,
                "--sc": card.scale.toFixed(4),
                "--fly-delay": card.flyDelay,
                ...(exit ? {
                  "--exit-tx": exit.tx,
                  "--exit-ty": exit.ty,
                  "--exit-sc": exit.sc,
                } : {
                  "--slot-x": card.slotX.toFixed(4),
                  "--slot-y": card.slotY.toFixed(4),
                  "--slot-sc": card.slotScale.toFixed(4),
                }),
              } as unknown as CSSProperties}
            >
              <Image
                src={exiting ? CARD_BACK : card.src}
                alt=""
                fill
                sizes="(max-width: 640px) 12vw, 88px"
                className="intro-card-image"
                draggable={false}
              />
            </div>
          )
        })}
      </div>

      <div className="intro-foreground">
        <p className="intro-brand">CYBER TAROT 2077</p>
        <h1 className="intro-title">赛博占卜师</h1>
        <p className="intro-sub">78 张塔罗 · 一场漫游</p>
        <button type="button" className="intro-start" disabled={!canStart} onClick={onStart}>
          开始
        </button>
      </div>
    </div>
  )
}
