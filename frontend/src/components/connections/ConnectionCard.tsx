import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import { MoreHorizontal, Loader2 } from "lucide-react";
import { EngineTag } from "@/components/ui/Badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import { useConnectionsStore } from "@/state/connections";
import { useUiStore } from "@/state/ui";
import { requestOpenConnection } from "@/lib/openConnection";
import { snapToGrid } from "@/lib/canvasBounds";
import { ENGINES } from "@/lib/types";
import { cn } from "@/lib/utils";

export function ConnectionCard({ data, selected }: NodeProps) {
  const navigate = useNavigate();
  const connectionId = (data as { connectionId: string }).connectionId;
  const connection = useConnectionsStore((s) => s.connections.find((c) => c.id === connectionId));
  const setActiveConnection = useConnectionsStore((s) => s.setActiveConnection);
  const removeConnection = useConnectionsStore((s) => s.removeConnection);
  const updateLayout = useConnectionsStore((s) => s.updateLayout);
  const isOpening = useUiStore((s) => s.openingConnectionId === connectionId);
  const [hovered, setHovered] = useState(false);

  if (!connection) return null;

  function open() {
    requestOpenConnection(connection!.id, navigate, setActiveConnection);
  }

  return (
    <div
      className="h-full w-full"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <NodeResizer
        minWidth={240}
        minHeight={120}
        isVisible={hovered || selected}
        lineClassName="!border-border-focus"
        handleClassName="!h-2.5 !w-2.5 !rounded-[2px] !border !border-border-focus !bg-bg-app"
        onResizeEnd={(_, params) =>
          updateLayout(connection!.id, {
            x: snapToGrid(params.x),
            y: snapToGrid(params.y),
            width: snapToGrid(params.width),
            height: snapToGrid(params.height),
          })
        }
      />
      <div
        className={cn(
          "relative flex h-full w-full cursor-pointer flex-col gap-3 rounded-[10px] border bg-bg-surface p-4 shadow-sm transition-colors",
          selected ? "border-border-focus" : "border-border-default hover:border-border-control",
        )}
      >
        <div className="flex items-start gap-2.5">
          <EngineTag engine={connection.engine} size={30} />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="truncate text-[13.5px] font-medium text-text-primary">{connection.name}</div>
            <div className="truncate text-[11px] text-text-faint">{ENGINES[connection.engine].label}</div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              className="flex w-5 shrink-0 items-center justify-center text-text-ghost outline-none hover:text-text-secondary"
            >
              <MoreHorizontal size={15} />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={open}>Open</DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => removeConnection(connection!.id)}
                className="text-error-dim data-[highlighted]:text-error-text"
              >
                Remove
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="mt-auto text-[11px] text-text-faint">{connection.lastUsed}</div>

        <span
          title={
            connection.status === "online"
              ? "Reachable"
              : connection.status === "offline"
                ? "Unreachable"
                : "Reachability unknown"
          }
          className={cn(
            "absolute bottom-3 right-3 h-2 w-2 rounded-full",
            connection.status === "online" && "bg-success-dot",
            connection.status === "offline" && "bg-error-dot",
            (!connection.status || connection.status === "unknown") && "bg-border-control",
          )}
        />

        {isOpening && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 rounded-[10px] bg-bg-surface/90 backdrop-blur-[1px]">
            <Loader2 size={14} className="animate-spin text-text-tertiary" />
            <span className="text-[12px] text-text-secondary">Opening…</span>
          </div>
        )}
      </div>
    </div>
  );
}
