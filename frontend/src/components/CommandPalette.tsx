import { useMemo } from "react";
import { Command } from "cmdk";
import * as Dialog from "@radix-ui/react-dialog";
import { useNavigate } from "react-router-dom";
import { Table2, FileCode2, Plus, SunMoon, ArrowLeftRight, Clock } from "lucide-react";
import { useSnippetsStore } from "@/state/snippets";
import { useWorkbenchStore } from "@/state/workbench";
import { useSettingsStore } from "@/state/settings";
import { useConnectionsStore } from "@/state/connections";
import { useSchemaStore } from "@/state/schema";
import { comboLabel, isMac } from "@/lib/platform";

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const navigate = useNavigate();
  const { snippets } = useSnippetsStore();
  const { addTab, openTable, openSnippet } = useWorkbenchStore();
  const { theme, setTheme } = useSettingsStore();
  const activeConnection = useConnectionsStore((s) => s.getActiveConnection());
  const schema = useSchemaStore((s) => (activeConnection ? s.byConnectionId[activeConnection.id]?.schema : undefined));

  const tables = useMemo(() => {
    const result: { qualifiedName: string; schema: string }[] = [];
    for (const group of schema?.schemas ?? []) {
      for (const table of group.tables) {
        result.push({ qualifiedName: `${group.name}.${table.name}`, schema: group.name });
      }
    }
    return result;
  }, [schema]);

  function run(fn: () => void) {
    fn();
    onOpenChange(false);
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-[120px] z-50 w-[620px] -translate-x-1/2 overflow-hidden rounded-xl border border-border-elevated bg-bg-raised shadow-2xl"
        >
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <Command loop shouldFilter>
            <div className="flex h-[50px] items-center gap-2.5 border-b border-border-strong px-4">
              <span className="text-[13px] text-text-faint">⌕</span>
              <Command.Input
                autoFocus
                placeholder="Search tables, queries, actions…"
                className="flex-1 bg-transparent text-[14px] text-text-primary placeholder:text-text-faint outline-none"
              />
              <span className="rounded-[4px] border border-border-control px-1.5 py-0.5 font-mono text-[10.5px] text-text-faint">
                esc
              </span>
            </div>
            <Command.List className="max-h-[420px] overflow-y-auto py-2">
              <Command.Empty className="px-4 py-6 text-center text-[12.5px] text-text-faint">
                No results
              </Command.Empty>

              <Command.Group heading="Tables" className="[&_[cmdk-group-heading]]:px-4 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-1.5 [&_[cmdk-group-heading]]:text-[10.5px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-text-quiet">
                {tables.map((t) => (
                  <Command.Item
                    key={t.qualifiedName}
                    onSelect={() => run(() => { navigate("/workbench"); openTable(t.qualifiedName); })}
                    className="flex h-[34px] cursor-pointer items-center gap-2.5 px-4 text-[12.5px] text-text-primary data-[selected=true]:bg-bg-selected"
                  >
                    <Table2 size={13} className="text-text-muted" />
                    <span className="font-mono">{t.qualifiedName}</span>
                  </Command.Item>
                ))}
              </Command.Group>

              <Command.Group heading="Queries" className="[&_[cmdk-group-heading]]:px-4 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-1.5 [&_[cmdk-group-heading]]:text-[10.5px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-text-quiet">
                {snippets.map((s) => (
                  <Command.Item
                    key={s.id}
                    onSelect={() => run(() => { navigate("/workbench"); openSnippet(s.id, s.name, s.sql); })}
                    className="flex h-[34px] cursor-pointer items-center gap-2.5 px-4 text-[12.5px] text-text-primary data-[selected=true]:bg-bg-selected"
                  >
                    <FileCode2 size={13} className="text-text-muted" />
                    <span>{s.name}</span>
                    <span className="ml-auto text-[10.5px] text-text-faint">{s.used}</span>
                  </Command.Item>
                ))}
              </Command.Group>

              <Command.Group heading="Actions" className="[&_[cmdk-group-heading]]:px-4 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-1.5 [&_[cmdk-group-heading]]:text-[10.5px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-text-quiet">
                <Command.Item
                  onSelect={() => run(() => { navigate("/workbench"); addTab(); })}
                  className="flex h-[34px] cursor-pointer items-center gap-2.5 px-4 text-[12.5px] text-text-primary data-[selected=true]:bg-bg-selected"
                >
                  <Plus size={13} className="text-text-muted" />
                  New query tab
                  <span className="ml-auto font-mono text-[10.5px] text-text-faint">T</span>
                </Command.Item>
                <Command.Item
                  onSelect={() => run(() => setTheme(theme === "dark" ? "light" : "dark"))}
                  className="flex h-[34px] cursor-pointer items-center gap-2.5 px-4 text-[12.5px] text-text-primary data-[selected=true]:bg-bg-selected"
                >
                  <SunMoon size={13} className="text-text-muted" />
                  Switch theme
                  <span className="ml-auto font-mono text-[10.5px] text-text-faint">
                    {isMac ? "⌘⇧L" : "Ctrl+Shift+L"}
                  </span>
                </Command.Item>
                <Command.Item
                  onSelect={() => run(() => navigate("/connections"))}
                  className="flex h-[34px] cursor-pointer items-center gap-2.5 px-4 text-[12.5px] text-text-primary data-[selected=true]:bg-bg-selected"
                >
                  <ArrowLeftRight size={13} className="text-text-muted" />
                  Switch connection…
                </Command.Item>
                <Command.Item
                  onSelect={() => run(() => navigate("/jobs"))}
                  className="flex h-[34px] cursor-pointer items-center gap-2.5 px-4 text-[12.5px] text-text-primary data-[selected=true]:bg-bg-selected"
                >
                  <Clock size={13} className="text-text-muted" />
                  Scheduled jobs…
                </Command.Item>
              </Command.Group>
            </Command.List>
            <div className="flex h-8 items-center gap-3.5 border-t border-border-strong bg-bg-app px-4 font-mono text-[10.5px] text-text-quiet">
              <span>↑↓ move</span>
              <span>⏎ open</span>
              <span>{comboLabel("⏎")} open in new tab</span>
            </div>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
