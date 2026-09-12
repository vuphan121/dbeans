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

// React Flow centers each dot within its own gap-cell rather than placing
// one at flow-coordinate (0,0) — so the actual dot grid sits at
// GRID_OFFSET + k*GRID_UNIT, not at plain multiples of GRID_UNIT. Confirmed
// empirically: a card snapped to a bare multiple of 40 rendered exactly
// halfway between two dots in both axes.
const GRID_OFFSET = GRID_UNIT / 2;

export function snapToGrid(value: number): number {
  return Math.round((value - GRID_OFFSET) / GRID_UNIT) * GRID_UNIT + GRID_OFFSET;
}
