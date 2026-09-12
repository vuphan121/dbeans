// Radix's ContextMenu can let an item-selection click "fall through" to
// whatever element ends up underneath once the menu closes. On a React Flow
// canvas that's the very node the menu was opened on, which would otherwise
// immediately fire that node's click-to-navigate handler right after
// choosing an unrelated menu action (e.g. selecting "Run now" would also
// navigate away, because the underlying card's click handler fires a moment
// later). Call markContextMenuAction() from every ContextMenuItem's onClick,
// and check shouldSuppressNodeClick() from the canvas's onNodeClick.
let suppressUntil = 0;

export function markContextMenuAction() {
  suppressUntil = Date.now() + 300;
}

export function shouldSuppressNodeClick(): boolean {
  return Date.now() < suppressUntil;
}
