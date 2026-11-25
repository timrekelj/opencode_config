import { createMemo, For, Show } from "solid-js"

const W = 200
const H = 40

interface Line {
  values: (number | null | undefined)[]
  class: string
}

/** Inline SVG sparkline over a fixed time window. Several lines share one scale. */
export function Spark(props: {
  times: number[]
  lines: Line[]
  /** Fixed top of the scale (e.g. 100 for percent); defaults to the largest value. */
  max?: number
  label: string
}) {
  const shape = createMemo(() => {
    const times = props.times
    if (times.length < 2) return []
    const t0 = times[0]!
    const span = Math.max(1, times[times.length - 1]! - t0)
    const max = props.max ?? Math.max(1, ...props.lines.flatMap((l) => l.values.map((v) => v ?? 0)))
    return props.lines.map((line) => {
      const points: string[] = []
      line.values.forEach((v, i) => {
        if (v === null || v === undefined) return
        const x = ((times[i]! - t0) / span) * W
        const y = H - 1 - Math.min(1, Math.max(0, v / max)) * (H - 2)
        points.push(`${x.toFixed(1)},${y.toFixed(1)}`)
      })
      const path = points.length > 1 ? `M${points.join("L")}` : ""
      const first = points[0]?.split(",")[0]
      const last = points.at(-1)?.split(",")[0]
      const area = path && first && last ? `${path}L${last},${H}L${first},${H}Z` : ""
      return { class: line.class, path, area }
    })
  })

  return (
    <svg class="tm-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={props.label}>
      <line class="tm-spark-base" x1="0" y1={H - 0.5} x2={W} y2={H - 0.5} />
      <For each={shape()}>
        {(line) => (
          <Show when={line.path}>
            <path class={`tm-spark-area ${line.class}`} d={line.area} />
            <path class={`tm-spark-line ${line.class}`} d={line.path} vector-effect="non-scaling-stroke" />
          </Show>
        )}
      </For>
    </svg>
  )
}
