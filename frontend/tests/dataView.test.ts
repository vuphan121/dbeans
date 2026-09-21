import assert from "node:assert/strict";
import { test } from "node:test";
import { describeView, EMPTY_VIEW, sanitizeViewConfig } from "../src/lib/dataView.ts";
import { relativeTime } from "../src/lib/time.ts";

const columns = [{ name: "id", type: "int" }, { name: "email", type: "text" }, { name: "plan", type: "text" }];

test("sanitizeViewConfig drops filters and sorts on columns that no longer exist", () => {
  const config = sanitizeViewConfig(
    {
      filters: [
        { column: "email", operator: "contains", value: "a" },
        { column: "gone", operator: "eq", value: "x" },
        { column: "id", operator: "bogus" as never, value: "1" },
      ],
      sorts: [{ column: "gone", direction: "asc" }, { column: "id", direction: "desc" }],
      pageSize: 250,
      columnOrder: ["plan", "gone", "id"],
      hiddenColumns: ["email", "nope"],
    },
    columns,
  );
  assert.deepEqual(config.filters, [{ column: "email", operator: "contains", value: "a" }]);
  assert.deepEqual(config.sorts, [{ column: "id", direction: "desc" }]);
  assert.equal(config.pageSize, 250);
  assert.deepEqual(config.columnOrder, ["plan", "id", "email"], "saved order kept, new columns appended");
  assert.deepEqual(config.hiddenColumns, ["email"]);
});

test("sanitizeViewConfig tolerates missing or malformed input", () => {
  for (const junk of [null, undefined, {}, { filters: "x", sorts: 5, pageSize: "big", columnOrder: null, hiddenColumns: {} } as never]) {
    assert.deepEqual(sanitizeViewConfig(junk, columns), EMPTY_VIEW);
  }
  assert.deepEqual(sanitizeViewConfig({ filters: [null as never, { column: "id", operator: "eq", value: null as never }] }, columns).filters, []);
});

test("sanitizeViewConfig enforces supported page sizes, unique columns, and never hides every column", () => {
  assert.equal(sanitizeViewConfig({ pageSize: 7 }, columns).pageSize, 100);
  assert.deepEqual(sanitizeViewConfig({ hiddenColumns: ["id", "email", "plan"] }, columns).hiddenColumns, []);
  assert.deepEqual(sanitizeViewConfig({ columnOrder: ["id", "id", "email"] }, columns).columnOrder, ["id", "email", "plan"]);
});

test("describeView summarises what a view changes", () => {
  assert.equal(describeView(EMPTY_VIEW), "no changes");
  assert.equal(
    describeView({ ...EMPTY_VIEW, filters: [{ column: "id", operator: "eq", value: "1" }], sorts: [{ column: "id", direction: "desc" }] }),
    "1 filter · sorted by id desc",
  );
});

test("relativeTime buckets ages and never goes negative under clock skew", () => {
  const now = Date.parse("2026-09-21T12:00:00Z");
  assert.equal(relativeTime("2026-09-21T11:59:40Z", now), "just now");
  assert.equal(relativeTime("2026-09-21T11:55:00Z", now), "5m ago");
  assert.equal(relativeTime("2026-09-21T09:00:00Z", now), "3h ago");
  assert.equal(relativeTime("2026-09-18T12:00:00Z", now), "3d ago");
  assert.equal(relativeTime("2026-09-21T12:05:00Z", now), "just now");
  assert.equal(relativeTime("garbage", now), "");
});
