import type { PointerEvent as ReactPointerEvent } from "react";

export function ResizeDivider({ onDrag }: { onDrag: (deltaY: number) => void }) {
  function handlePointerDown(e: ReactPointerEvent) {
    e.preventDefault();
    let lastY = e.clientY;

    function handleMove(ev: PointerEvent) {
      const delta = ev.clientY - lastY;
      lastY = ev.clientY;
      onDrag(delta);
    }
    function handleUp() {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    }
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }

  return (
    <div
      onPointerDown={handlePointerDown}
      className="group flex h-[7px] shrink-0 cursor-row-resize touch-none items-center justify-center border-y border-border-faint bg-bg-surface hover:bg-bg-hover"
    >
      <div className="h-[2px] w-9 rounded-full bg-border-control transition-colors group-hover:bg-border-focus" />
    </div>
  );
}
