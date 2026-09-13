import type { CoordinateExtent } from "@xyflow/react";

// Shared between the connections store (where new cards get placed) and the
// Connections page (where the initial viewport gets centered) — both need
// to agree on where "the middle of the field" actually is.
export const CANVAS_BOUNDS: CoordinateExtent = [
  [-400, -400],
  [3200, 2600],
];

export const FIELD_CENTER = {
  x: (CANVAS_BOUNDS[0][0] + CANVAS_BOUNDS[1][0]) / 2,
  y: (CANVAS_BOUNDS[0][1] + CANVAS_BOUNDS[1][1]) / 2,
};

// The dot background is drawn on this spacing, and every card's position
// and size snap to the same unit — so a card's edges always land on a dot,
// whether it just got placed, got dragged, or got resized.
export const GRID_UNIT = 40;

// Must match the `size` prop passed to every <Background variant="dots">
// using this grid (Connections.tsx, Jobs.tsx) — it's baked into where the
// dot actually sits within its own tile, not just the tile spacing.
const DOT_SIZE = 2;

// Traced through @xyflow/react's own Background source rather than eyeballed:
// for a "dots" background, each 40×40 tile gets a <circle cx={r} cy={r}
// r={r}> (r = DOT_SIZE/2) as its content, and the whole tiled pattern is
// shifted by `translate(-GRID_UNIT/2, -GRID_UNIT/2)` so a dot doesn't sit
// right at flow-origin (0,0). Composing those two shifts places actual dots
// at flow coordinates GRID_UNIT/2 + DOT_SIZE/2 + k·GRID_UNIT — one dot
// *radius* further than GRID_UNIT/2 alone, since the circle's own center is
// drawn `r` units in from its tile's corner, not exactly on it. The previous
// GRID_OFFSET (bare GRID_UNIT/2) was off by that one radius — a 1px-per-axis
// error, easy to miss at a normal zoom level but visible up close.
const GRID_OFFSET = GRID_UNIT / 2 + DOT_SIZE / 2;

export function snapToGrid(value: number): number {
  return Math.round((value - GRID_OFFSET) / GRID_UNIT) * GRID_UNIT + GRID_OFFSET;
}
