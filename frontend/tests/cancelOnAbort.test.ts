import assert from "node:assert/strict";
import { test } from "node:test";
import { cancelOnAbort } from "../src/lib/cancelOnAbort.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// A request that never settles on its own until abort() rejects it, like a real fetch.
function inFlight(controller: AbortController) {
  return new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(new Error("aborted"))));
}

test("aborting a request that is still in flight sends a cancel", async () => {
  const controller = new AbortController();
  const settled = inFlight(controller);
  settled.catch(() => {});
  let sent = 0;
  cancelOnAbort(controller.signal, settled, async () => (sent++, { terminated: 1 }), [5, 5]);
  controller.abort();
  await sleep(40);
  assert.equal(sent, 1, "one cancel, and no retries once it terminated something");
});

test("aborting a request that already finished sends nothing", async () => {
  const controller = new AbortController();
  const settled = Promise.resolve("done");
  let sent = 0;
  cancelOnAbort(controller.signal, settled, async () => (sent++, { terminated: 0 }), [5, 5]);
  await sleep(10); // let the request settle on its own first
  controller.abort();
  await sleep(40);
  assert.equal(sent, 0);
});

test("a request that failed on its own is also left alone", async () => {
  const controller = new AbortController();
  const settled = Promise.reject(new Error("502"));
  settled.catch(() => {});
  let sent = 0;
  cancelOnAbort(controller.signal, settled, async () => (sent++, { terminated: 0 }), [5, 5]);
  await sleep(10);
  controller.abort();
  await sleep(40);
  assert.equal(sent, 0);
});

test("retries while the cancel finds nothing to stop, then gives up", async () => {
  const controller = new AbortController();
  const settled = inFlight(controller);
  settled.catch(() => {});
  let sent = 0;
  cancelOnAbort(controller.signal, settled, async () => (sent++, { terminated: 0 }), [5, 5]);
  controller.abort();
  await sleep(80);
  assert.equal(sent, 3, "the first attempt plus one retry per delay, then stop");
});

test("stops retrying as soon as a retry terminates something", async () => {
  const controller = new AbortController();
  const settled = inFlight(controller);
  settled.catch(() => {});
  const results = [0, 1];
  let sent = 0;
  cancelOnAbort(controller.signal, settled, async () => ({ terminated: results[sent++] ?? 0 }), [5, 5]);
  controller.abort();
  await sleep(80);
  assert.equal(sent, 2, "the second attempt found the query, so the third never happens");
});

test("a failing cancel is swallowed and does not retry forever", async () => {
  const controller = new AbortController();
  const settled = inFlight(controller);
  settled.catch(() => {});
  let sent = 0;
  cancelOnAbort(controller.signal, settled, async () => {
    sent++;
    throw new Error("network down");
  }, [5, 5]);
  controller.abort();
  await sleep(40);
  assert.equal(sent, 1, "best-effort: a failure ends the attempts without an unhandled rejection");
});

test("no signal means nothing to watch", () => {
  let sent = 0;
  cancelOnAbort(undefined, Promise.resolve(), async () => (sent++, { terminated: 0 }));
  assert.equal(sent, 0);
});

test("the abort listener fires once even if abort is called repeatedly", async () => {
  const controller = new AbortController();
  const settled = inFlight(controller);
  settled.catch(() => {});
  let sent = 0;
  cancelOnAbort(controller.signal, settled, async () => (sent++, { terminated: 1 }), [5]);
  controller.abort();
  controller.abort();
  await sleep(30);
  assert.equal(sent, 1);
});
