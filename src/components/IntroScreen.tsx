"use client"

import Image from "next/image"
import { useMemo } from "react"
import type { CSSProperties } from "react"
import { CARDS } from "@/data/cards"

/* ===== 散乱牌 → 牌环 FLIP 过渡 =====
   每张开场牌对应环上一个槽位。点击「开始」后所有牌从散乱位置
   丝滑飞行到环上各自的目标位置，同时旋转归零、切换为牌背。
   CardGallery 的牌环随后以缩放动画覆盖入场。 */

type IntroCard = {
  id: string
  src: string
  /* 散乱位置 */
  tx: string
  ty: string
  rot: number
  scale: number
  /* 环上目标槽位（与 CardRing 桌面 17 张一致） */
  slotX: number
  slotY: number
  slotScale: number
  /* 逐张飞行的延迟 — 牌从不同方向先后抵达环上 */
  flyDelay: string
}

const CARD_BACK = "/assets/cards/card_back.webp"
const RING_SLOTS = 17 // 桌面宽屏牌背槽位数，与 CardRing DESKTOP_CARD_COUNT 一致

/** 确定性伪随机 [0, 1) — 保证 SSR 与 hydration 一致 */
function seeded(index: number, salt: number) {
  const x = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453
  return x - Math.floor(x)
}

/** 环上第 i 个槽位的 sin/cos/scale — 与 CardRing CSS 公式同构 */
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

import type { SlotTarget } from "@/app/page"

type IntroScreenProps = {
  onStart: () => void
  exiting: boolean
  targets: SlotTarget[]
  /** 散乱牌布局宽度（px，不含 transform）— scale 对齐基准 */
  baseWidth: number
}

/** 用 JS 测量的 thumbnail 屏幕坐标计算精确退出偏移（vw/vh + 目标 scale） */
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
  /* 目标 scale = thumbnail 视觉宽度 / 散乱牌布局宽度 → 最终视觉尺寸精确一致 */
  const sc = baseWidth > 0 ? slot.w / baseWidth : 1
  return {
    tx: `${((cx - vw / 2) / vw * 100).toFixed(1)}vw`,
    ty: `${((cy - vh / 2) / vh * 100).toFixed(1)}vh`,
    sc: sc.toFixed(3),
  }
}

export default function IntroScreen({ onStart, exiting, targets, baseWidth }: IntroScreenProps) {
  const cards = useMemo(() => generateCards(), [])
  const hasTargets = targets.length > 0

  return (
    <div
      className={`intro${exiting ? " intro--exiting" : ""}`}
      aria-hidden={exiting || undefined}
    >
      <div className="intro-ring-track" aria-hidden="true" />

      <div className="intro-cards" aria-hidden="true">
        {cards.map((card, i) => {
          const exit = exiting && hasTargets ? computeExit(i, targets, baseWidth) : null
          return (
            <div
              key={card.id}
              className="intro-card"
              style={{
                "--tx": card.tx,
                "--ty": card.ty,
                "--rot": `${card.rot}deg`,
                "--sc": card.scale,
                "--fly-delay": card.flyDelay,
                /* 精确目标（有 targets 时使用，覆盖 CSS 中的 slot-* 近似值） */
                ...(exit ? {
                  "--exit-tx": exit.tx,
                  "--exit-ty": exit.ty,
                  "--exit-sc": exit.sc,
                } : {
                  "--slot-x": String(card.slotX),
                  "--slot-y": String(card.slotY),
                  "--slot-sc": String(card.slotScale),
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
        <button type="button" className="intro-start" onClick={onStart}>
          开始
        </button>
      </div>
    </div>
  )
}