import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useRedisStore } from "@/state/redis";
import type { RedisType, RedisValue } from "@/lib/types";

function emptyValue(type: RedisType): RedisValue {
  switch (type) {
    case "string":
      return { type: "string", value: "" };
    case "hash":
      return { type: "hash", fields: [{ field: "field", value: "" }] };
    case "list":
      return { type: "list", items: [""] };
    case "set":
      return { type: "set", members: [""] };
    case "zset":
      return { type: "zset", members: [{ member: "member", score: 0 }] };
  }
}

export function NewKeyDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const createKey = useRedisStore((s) => s.createKey);
  const [name, setName] = useState("");
  const [type, setType] = useState<RedisType>("string");

  async function handleCreate() {
    if (!name.trim()) return;
    try {
      await createKey({ key: name.trim(), ttl: null, value: emptyValue(type) });
      setName("");
      onOpenChange(false);
    } catch {
      // The workbench header displays the API error and keeps this dialog open.
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-[10px] border border-border-elevated bg-bg-raised p-5 shadow-2xl">
          <Dialog.Title className="mb-4 text-[14px] font-semibold text-text-primary">New key</Dialog.Title>
          <div className="flex flex-col gap-3.5">
            <div className="flex flex-col gap-1.5">
              <div className="text-[12px] font-medium text-text-tertiary">Key name</div>
              <Input mono value={name} onChange={(e) => setName(e.target.value)} placeholder="namespace:id" />
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="text-[12px] font-medium text-text-tertiary">Type</div>
              <SegmentedControl
                value={type}
                onChange={setType}
                options={[
                  { value: "string", label: "string" },
                  { value: "hash", label: "hash" },
                  { value: "list", label: "list" },
                  { value: "set", label: "set" },
                  { value: "zset", label: "zset" },
                ]}
              />
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" size="md" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="md" onClick={() => void handleCreate()}>
              Create key
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
