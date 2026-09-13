import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react";
import { Clock } from "lucide-react";
import { EngineTag } from "@/components/ui/Badge";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/ContextMenu";
import { useJobsStore } from "@/state/jobs";
import { useConnectionsStore } from "@/state/connections";
import { snapToGrid } from "@/lib/canvasBounds";
import { markContextMenuAction } from "@/lib/contextMenuGuard";
import { cn } from "@/lib/utils";

export function JobCard({ data, selected }: NodeProps) {
  const navigate = useNavigate();
  const jobId = (data as { jobId: string }).jobId;
  const job = useJobsStore((s) => s.jobs.find((j) => j.id === jobId));
  const connection = useConnectionsStore((s) => s.connections.find((c) => c.id === job?.connectionId));
  const { removeJob, toggleEnabled, updateLayout } = useJobsStore();
  const [hovered, setHovered] = useState(false);

  if (!job) return null;

  return (
    <div className="h-full w-full" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      {/* Dependency arrows attach here — not user-draggable, since deps are edited via the "Depends on" picker */}
      <Handle type="target" position={Position.Left} isConnectable={false} className="!border-0 !bg-transparent" />
      <Handle type="source" position={Position.Right} isConnectable={false} className="!border-0 !bg-transparent" />
      <NodeResizer
        minWidth={240}
        minHeight={120}
        isVisible={hovered || selected}
        lineClassName="!border-border-focus"
        handleClassName="!h-2.5 !w-2.5 !rounded-[2px] !border !border-border-focus !bg-bg-app"
        onResizeEnd={(_, params) =>
          updateLayout(job!.id, {
            x: snapToGrid(params.x),
            y: snapToGrid(params.y),
            width: snapToGrid(params.width),
            height: snapToGrid(params.height),
          })
        }
      />
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className={cn(
              "relative flex h-full w-full cursor-pointer flex-col gap-2.5 rounded-[10px] border bg-bg-surface p-4 shadow-sm transition-colors",
              selected ? "border-border-focus" : "border-border-default hover:border-border-control",
              !job.enabled && "opacity-60",
            )}
          >
            <div className="flex items-start gap-2.5">
              {connection ? (
                <EngineTag engine={connection.engine} size={30} />
              ) : (
                <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[7px] border border-border-strong bg-bg-hover text-text-tertiary">
                  <Clock size={14} />
                </div>
              )}
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="truncate text-[13.5px] font-medium text-text-primary">{job.name}</div>
                <div className="truncate text-[11px] text-text-faint">{connection?.name ?? "connection removed"}</div>
              </div>
            </div>

            <div className="flex items-center gap-1.5 font-mono text-[11px] text-text-faint">
              <Clock size={10} className="shrink-0" />
              <span className="truncate">{job.cronExpr}</span>
            </div>

            <div className="mt-auto flex items-center gap-1.5 text-[11px] text-text-faint">
              <StatusDot status={job.lastStatus} />
              <span>{statusLabel(job)}</span>
              {!job.enabled && <span className="ml-auto rounded-[4px] bg-bg-hover px-1.5 py-0.5 text-[10px]">paused</span>}
            </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem
            onClick={() => {
              markContextMenuAction();
              navigate(`/jobs/${job.id}/edit`);
            }}
          >
            Edit
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => {
              markContextMenuAction();
              toggleEnabled(job.id);
            }}
          >
            {job.enabled ? "Pause" : "Resume"}
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => {
              markContextMenuAction();
              removeJob(job.id);
            }}
            className="text-error-dim data-[highlighted]:text-error-text"
          >
            Remove
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "h-1.5 w-1.5 shrink-0 rounded-full",
        status === "success" && "bg-success-dot",
        status === "failed" && "bg-error-dot",
        status === "blocked" && "bg-text-faint",
        status === "never_run" && "bg-border-control",
      )}
    />
  );
}

function statusLabel(job: { lastStatus: string; lastRunAt?: string }) {
  if (job.lastStatus === "never_run") return "Never run";
  const when = job.lastRunAt ? new Date(job.lastRunAt).toLocaleString() : "";
  const label = job.lastStatus === "success" ? "Succeeded" : job.lastStatus === "failed" ? "Failed" : "Blocked";
  return when ? `${label} · ${when}` : label;
}
