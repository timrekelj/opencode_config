import type { GraphCommit } from "../types"

const LANE_W = 16
export const ROW_H = 30
const PAD_X = 9

const PALETTE = ["#3b82f6", "#22a06b", "#d9a400", "#e5484d", "#8957e5", "#e5679b", "#12a594", "#f76b15"]

export const laneColor = (lane: number) => PALETTE[lane % PALETTE.length]

export interface LaneRow {
  commit: GraphCommit
  lane: number
  index: number
}

export interface LaneEdge {
  fromLane: number
  fromRow: number
  toLane: number
  /** Row of the parent commit; `rows.length` means the parent is beyond the fetched limit (line runs off the bottom). */
  toRow: number
}

export interface LaneVertical {
  lane: number
  fromRow: number
  toRow: number
}

export interface GraphLayout {
  rows: LaneRow[]
  edges: LaneEdge[]
  verticals: LaneVertical[]
  lanes: number
  width: number
  height: number
  x: (lane: number) => number
  y: (row: number) => number
}

/**
 * Assigns each commit a lane and computes the edges between a commit and its parents, in the order `git log`
 * returns them (newest first). The first parent continues on the commit's own lane; every other parent gets a free
 * lane of its own, which is where a merge edge comes from.
 */
export function layoutGraph(commits: GraphCommit[]): GraphLayout {
  const index = new Map(commits.map((c, i) => [c.hash, i]))
  // lanes[k] is the hash occupying lane k below the row currently being processed.
  const lanes: (string | null)[] = []
  const rows: LaneRow[] = []
  const edges: LaneEdge[] = []
  const verticals: LaneVertical[] = []
  // rowLane: the lane each already-processed commit drew on, for parents that git log listed above their child (clock skew).
  const rowLane = new Map<string, number>()

  const laneOf = (hash: string) => lanes.findIndex((h) => h === hash)
  const freeLane = () => {
    const at = lanes.findIndex((h) => h === null)
    if (at !== -1) return at
    lanes.push(null)
    return lanes.length - 1
  }

  for (let i = 0; i < commits.length; i++) {
    const commit = commits[i]
    let lane = laneOf(commit.hash)
    if (lane === -1) lane = freeLane()
    lanes[lane] = null
    rows.push({ commit, lane, index: i })
    rowLane.set(commit.hash, lane)

    if (commit.parents.length > 0) lanes[lane] = commit.parents[0]
    for (const parent of commit.parents) {
      const parentRow = index.get(parent)
      if (parentRow !== undefined && parentRow < i && rowLane.has(parent)) {
        // Parent was already drawn above (commit-date skew): edge back up to its lane, no lane assignment.
        edges.push({ fromLane: lane, fromRow: i, toLane: rowLane.get(parent)!, toRow: parentRow })
        continue
      }
      const toLane = laneOf(parent) === -1 ? (lanes[freeLane()] = parent, laneOf(parent)) : laneOf(parent)
      if (toLane === lane) continue // the first parent continues straight down this lane
      edges.push({ fromLane: lane, fromRow: i, toLane, toRow: parentRow ?? commits.length })
    }
    for (let k = 0; k < lanes.length; k++) {
      if (lanes[k] !== null) verticals.push({ lane: k, fromRow: i, toRow: i + 1 })
    }
  }

  const x = (lane: number) => PAD_X + lane * LANE_W
  const y = (row: number) => row * ROW_H + ROW_H / 2
  return {
    rows,
    edges,
    verticals,
    lanes: lanes.length,
    width: lanes.length * LANE_W + PAD_X,
    height: commits.length * ROW_H,
    x,
    y,
  }
}

/** An elbow path from a commit down into its parent's lane. */
export function edgePath(g: GraphLayout, edge: LaneEdge): string {
  const x1 = g.x(edge.fromLane)
  const y1 = g.y(edge.fromRow)
  const x2 = g.x(edge.toLane)
  const y2 = g.y(Math.min(edge.toRow, g.rows.length - 1)) + (edge.toRow > g.rows.length - 1 ? ROW_H / 2 : 0)
  if (x1 === x2) return `M ${x1} ${y1} L ${x2} ${y2}`
  const mid = (y1 + y2) / 2
  return `M ${x1} ${y1} L ${x1} ${mid} Q ${x1} ${y2} ${x1 + (x2 > x1 ? 4 : -4)} ${y2} L ${x2} ${y2}`
}
