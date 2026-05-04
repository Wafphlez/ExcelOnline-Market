import { useEffect, useRef } from 'react'

const STAR_COUNT = 620
/** Глубина: большое z — звезда у «горизонта», мало — близко к «камере». */
const Z_FAR = 1400
const Z_NEAR = 14
/** Те же пределы, что при первом заполнении поля — иначе после респавна все оказываются только у «горизонта» и кажутся пропавшими. */
function randomStarDepthZ(): number
{
  return Math.random() * Z_FAR + Z_NEAR
}
/** Референсная ширина под старый фиксированный K=720 (проекция ~720/w по горизонтали). */
const FOCAL_REF_WIDTH = 1400
const FOCAL_REF_K = 720
const FOCAL_K_MIN = 280

/** Время плавного появления после рождения / респавна (мс). */
const STAR_FADE_IN_MS = 520

/** Мин./макс. коэффициента в формуле `speed = speedK * dt` (мс → шаг по z за кадр). */
export const WARP_SPEED_K_MIN = 0.0001
export const WARP_SPEED_K_MAX = 0.05
/** Значение по умолчанию для ползунка / при первом запуске. */
export const WARP_SPEED_K_DEFAULT = 0.0001

export function clampWarpSpeedK(value: number): number
{
  return Math.min(WARP_SPEED_K_MAX, Math.max(WARP_SPEED_K_MIN, value))
}

type Star = {
  x: number
  y: number
  z: number
  prevPx: number
  prevPy: number
  hasPrev: boolean
  /** RGB звезды как у реальных спектральных классов O…M (не зависит от UI-темы). */
  colorR: number
  colorG: number
  colorB: number
  /** performance.now() в момент рождения — для плавного fade-in. */
  spawnedAtMs: number
}

/**
 * Упрощённая шкала «цвет — температура» (O…M). Веса слегка выровнены:
 * холодные (K/M) по-прежнему чаще, но реже тяжёлое доминирование одного класса.
 */
const STELLAR_SWATCHES: { rgb: readonly [number, number, number]; weight: number }[] = [
  { rgb: [186, 208, 255], weight: 0.062 },
  { rgb: [202, 220, 255], weight: 0.078 },
  { rgb: [228, 236, 255], weight: 0.096 },
  { rgb: [255, 251, 242], weight: 0.129 },
  { rgb: [255, 240, 205], weight: 0.165 },
  { rgb: [255, 196, 150], weight: 0.189 },
  { rgb: [255, 164, 135], weight: 0.281 },
]

function clampByte(n: number): number
{
  return Math.max(0, Math.min(255, Math.round(n)))
}

function jitterRgb(base: readonly [number, number, number]): Pick<Star, 'colorR' | 'colorG' | 'colorB'>
{
  const d = (): number => (Math.random() - 0.5) * 16
  return {
    colorR: clampByte(base[0] + d()),
    colorG: clampByte(base[1] + d()),
    colorB: clampByte(base[2] + d()),
  }
}

function randomStellarColor(): Pick<Star, 'colorR' | 'colorG' | 'colorB'>
{
  const roll = Math.random()
  let acc = 0
  for (const sw of STELLAR_SWATCHES)
  {
    acc += sw.weight
    if (roll <= acc)
    {
      return jitterRgb(sw.rgb)
    }
  }
  const last = STELLAR_SWATCHES[STELLAR_SWATCHES.length - 1].rgb
  return jitterRgb(last)
}

/** Мягкое свечение вместо плоского кружка «шарика». */
function fillRadialStarGlow(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  sr: number,
  sg: number,
  sb: number,
  alpha: number,
  headR: number
): void
{
  const a = Math.min(1, alpha)
  /** Уже аура — меньше «гало». */
  const outerR = Math.max(1.35, headR * 1.52)

  const grd = ctx.createRadialGradient(px, py, 0, px, py, outerR)
  grd.addColorStop(0, `rgba(${sr}, ${sg}, ${sb}, ${a * 0.9})`)
  grd.addColorStop(0.07, `rgba(${sr}, ${sg}, ${sb}, ${a * 0.42})`)
  grd.addColorStop(0.2, `rgba(${sr}, ${sg}, ${sb}, ${a * 0.14})`)
  grd.addColorStop(0.45, `rgba(${sr}, ${sg}, ${sb}, ${a * 0.03})`)
  grd.addColorStop(1, `rgba(${sr}, ${sg}, ${sb}, 0)`)

  ctx.fillStyle = grd
  ctx.beginPath()
  ctx.arc(px, py, outerR, 0, Math.PI * 2)
  ctx.fill()
}

/** 0 → 1 без рывков (smoothstep). */
function starFadeInOpacity(ageMs: number): number
{
  if (ageMs <= 0) return 0
  if (ageMs >= STAR_FADE_IN_MS) return 1
  const x = ageMs / STAR_FADE_IN_MS
  return x * x * (3 - 2 * x)
}

function prefersReducedMotion(): boolean
{
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Случайная точка экрана → мир: при проекции звезда попадает именно в (px, py) при её z. */
function worldFromScreen(
  px: number,
  py: number,
  z: number,
  cx: number,
  cy: number,
  focalK: number
): { x: number; y: number }
{
  return {
    x: ((px - cx) * z) / focalK,
    y: ((py - cy) * z) / focalK,
  }
}

function initStars(
  viewW: number,
  viewH: number,
  cx: number,
  cy: number,
  focalK: number,
  nowMs: number
): Star[]
{
  const stars: Star[] = []
  for (let i = 0; i < STAR_COUNT; i++)
  {
    const px = Math.random() * viewW
    const py = Math.random() * viewH
    const z = randomStarDepthZ()
    const { x, y } = worldFromScreen(px, py, z, cx, cy, focalK)
    /** Разброс фазы: первый кадр не «вспышкой», звёзды допроявляются постепенно. */
    const spawnedAtMs = nowMs - Math.random() * STAR_FADE_IN_MS * 0.92
    stars.push({
      x,
      y,
      z,
      prevPx: cx,
      prevPy: cy,
      hasPrev: false,
      spawnedAtMs,
      ...randomStellarColor(),
    })
  }
  return stars
}

function spawn(
  star: Star,
  viewW: number,
  viewH: number,
  cx: number,
  cy: number,
  focalK: number,
  nowMs: number
): void
{
  const px = Math.random() * viewW
  const py = Math.random() * viewH
  const z = randomStarDepthZ()
  const wld = worldFromScreen(px, py, z, cx, cy, focalK)
  star.x = wld.x
  star.y = wld.y
  star.z = z
  star.hasPrev = false
  star.spawnedAtMs = nowMs
  const col = randomStellarColor()
  star.colorR = col.colorR
  star.colorG = col.colorG
  star.colorB = col.colorB
}

export type StarfieldWarpProps = {
  speedK: number
}

/**
 * Полёт «вперёд»: рождение в случайных пикселях всего экрана, объём задаётся z, движение — к наблюдателю.
 */
export default function StarfieldWarp({ speedK }: StarfieldWarpProps): JSX.Element | null
{
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const speedKRef = useRef(clampWarpSpeedK(speedK))

  useEffect(() =>
  {
    speedKRef.current = clampWarpSpeedK(speedK)
  }, [speedK])

  useEffect(() =>
  {
    if (prefersReducedMotion()) return undefined

    const canvas = canvasRef.current
    if (!canvas) return undefined

    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) return undefined

    let stars: Star[] = []
    let cx = 0
    let cy = 0
    let rip = 0
    /** Проекция K: масштаб с шириной окна, чтобы край экрана не давал огромный мир × ширину. */
    let focalK = FOCAL_REF_K

    let raf = 0
    let last = performance.now()

    const resize = (): void =>
    {
      rip = window.devicePixelRatio || 1
      const { clientWidth: w, clientHeight: h } = document.documentElement
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      canvas.width = Math.max(1, Math.floor(w * rip))
      canvas.height = Math.max(1, Math.floor(h * rip))
      ctx.setTransform(rip, 0, 0, rip, 0, 0)
      cx = w * 0.5
      cy = h * 0.52
      focalK = Math.max(FOCAL_K_MIN, (w * FOCAL_REF_K) / FOCAL_REF_WIDTH)
      stars = initStars(Math.max(1, w), Math.max(1, h), cx, cy, focalK, performance.now())
    }

    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null
    ro?.observe(document.documentElement)
    window.addEventListener('resize', resize)
    resize()

    const frame = (now: number): void =>
    {
      const dt = Math.min(32, now - last)
      last = now
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      ctx.clearRect(0, 0, w, h)

      const speed = speedKRef.current * dt

      for (const star of stars)
      {
        star.z -= speed * (40 + (Z_FAR - star.z) * 0.02)
        if (star.z < Z_NEAR)
        {
          spawn(star, Math.max(1, w), Math.max(1, h), cx, cy, focalK, now)
          continue
        }

        const inv = focalK / star.z
        const px = cx + star.x * inv
        const py = cy + star.y * inv

        const t = 1 - star.z / Z_FAR
        const fade = starFadeInOpacity(now - star.spawnedAtMs)
        const alpha = (0.1 + Math.min(0.9, t * t * 1.2)) * fade
        const headR = Math.max(0.45, 1.05 + t * t * 4.8)
        const sr = star.colorR
        const sg = star.colorG
        const sb = star.colorB

        if (star.hasPrev && t > 0.06 && fade > 0.02)
        {
          const dx = px - star.prevPx
          const dy = py - star.prevPy
          if (dx * dx + dy * dy > 0.08)
          {
            const lg = ctx.createLinearGradient(star.prevPx, star.prevPy, px, py)
            const ta = (0.1 + Math.min(0.9, t * t * 1.2)) * fade * 0.5
            lg.addColorStop(0, `rgba(${sr}, ${sg}, ${sb}, 0)`)
            lg.addColorStop(0.42, `rgba(${sr}, ${sg}, ${sb}, ${ta * 0.2})`)
            lg.addColorStop(0.88, `rgba(${sr}, ${sg}, ${sb}, ${ta * 0.45})`)
            lg.addColorStop(1, `rgba(${sr}, ${sg}, ${sb}, ${ta * 0.28})`)

            ctx.beginPath()
            ctx.strokeStyle = lg
            ctx.lineWidth = Math.max(0.35, 1.15 * (1 - t * 0.62))
            ctx.lineCap = 'round'
            ctx.moveTo(star.prevPx, star.prevPy)
            ctx.lineTo(px, py)
            ctx.stroke()
          }
        }

        fillRadialStarGlow(ctx, px, py, sr, sg, sb, alpha, headR)

        star.prevPx = px
        star.prevPy = py
        star.hasPrev = true
      }

      raf = requestAnimationFrame(frame)
    }

    raf = requestAnimationFrame(frame)

    return () =>
    {
      cancelAnimationFrame(raf)
      ro?.disconnect()
      window.removeEventListener('resize', resize)
    }
  }, [])

  if (prefersReducedMotion()) return null

  return (
    <canvas
      ref={canvasRef}
      className="starfield-warp"
      aria-hidden
    />
  )
}
