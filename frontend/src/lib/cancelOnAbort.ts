// Stops server-side work when a request is aborted.
//
// Aborting a fetch alone isn't enough: on serverless hosts (Vercel) a client
// disconnect never reaches the Go handler, so the database query it started
// would run to completion regardless. Data-view page loads and counts therefore
// carry a requestId that tags their SQL server-side, and aborting one that is
// still in flight also asks the server to terminate the session running it.
//
// The Data view aborts its previous controller on every refresh, finished or
// not, so a request that already completed is left alone. That check happens
// inside the abort event on purpose: it fires synchronously, before the abort
// rejects the fetch, so "settled" still means "finished on its own".
//
// Best-effort: a cancel can reach the database before the tagged statement has
// started (a cold start, a slow connect), so while it keeps finding nothing to
// stop it is retried, once per delay in retryDelaysMs.

export const CANCEL_RETRY_DELAYS_MS = [1000, 3000];

export function cancelOnAbort(
  signal: AbortSignal | undefined,
  settled: Promise<unknown>,
  sendCancel: () => Promise<{ terminated: number }>,
  retryDelaysMs: number[] = CANCEL_RETRY_DELAYS_MS,
): void {
  if (!signal) return;
  let finishedOnItsOwn = false;
  const markFinished = () => {
    finishedOnItsOwn = true;
  };
  void settled.then(markFinished, markFinished);
  signal.addEventListener(
    "abort",
    () => {
      if (finishedOnItsOwn) return;
      const attempt = (retry: number) => {
        sendCancel()
          .then((res) => {
            if (res.terminated === 0 && retry < retryDelaysMs.length) setTimeout(() => attempt(retry + 1), retryDelaysMs[retry]);
          })
          .catch(() => {
            /* best-effort */
          });
      };
      attempt(0);
    },
    { once: true },
  );
}
