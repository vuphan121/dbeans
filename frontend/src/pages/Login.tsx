import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/Button";
import { AUTH_CONSTANTS, useAuthStore } from "@/state/auth";

export default function Login() {
  const navigate = useNavigate();
  const { attemptUnlock, isUnlocked, lockedUntil, error, clearError } = useAuthStore();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [remainingMs, setRemainingMs] = useState(0);
  const userRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    userRef.current?.focus();
  }, []);

  useEffect(() => {
    if (isUnlocked) navigate("/connections", { replace: true });
  }, [isUnlocked, navigate]);

  useEffect(() => {
    if (!lockedUntil) {
      setRemainingMs(0);
      return;
    }
    const tick = () => setRemainingMs(Math.max(0, lockedUntil - Date.now()));
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [lockedUntil]);

  const isLocked = !!lockedUntil && remainingMs > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isLocked || submitting) return;
    setSubmitting(true);
    await attemptUnlock(username, password);
    setSubmitting(false);
    setPassword("");
  }

  const seconds = Math.ceil(remainingMs / 1000);
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  const progressPct = isLocked
    ? Math.round(((AUTH_CONSTANTS.LOCKOUT_SECONDS - seconds) / AUTH_CONSTANTS.LOCKOUT_SECONDS) * 100)
    : 0;

  return (
    <div className="flex h-full items-center justify-center bg-bg-app">
      <form onSubmit={handleSubmit} className="flex w-[320px] flex-col items-center gap-7">
        <Logo size={24} />

        <div className="flex w-full flex-col gap-3.5">
          <div className="flex flex-col gap-2">
            <label className="text-[12px] font-medium text-text-tertiary" htmlFor="username">
              Username
            </label>
            <input
              ref={userRef}
              id="username"
              type="text"
              autoComplete="username"
              disabled={isLocked}
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                if (error) clearError();
              }}
              className="h-[38px] rounded-[7px] border border-border-input bg-bg-inset px-3 font-mono text-[13px] text-text-primary outline-none transition-shadow focus:ring-[3px] focus:ring-white/[0.04] disabled:opacity-50"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-[12px] font-medium text-text-tertiary" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              disabled={isLocked}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (error) clearError();
              }}
              className={`h-[38px] rounded-[7px] border bg-bg-inset px-3 font-mono text-[13px] tracking-[0.14em] text-text-primary outline-none transition-shadow focus:ring-[3px] focus:ring-white/[0.04] disabled:opacity-50 ${
                error && !isLocked ? "border-error-dot" : "border-border-input"
              }`}
            />
          </div>

          {error && !isLocked && (
            <div className="flex items-center gap-1.5">
              <span className="flex h-[13px] w-[13px] shrink-0 items-center justify-center rounded-full border border-error-dot text-[9px] font-bold text-error-dim">
                !
              </span>
              <span className="text-[12px] text-error-dim">{error}</span>
            </div>
          )}

          <Button type="submit" variant="primary" size="md" disabled={isLocked || submitting} className="mt-1">
            {submitting ? "Signing in…" : "Sign in"}
          </Button>
        </div>

        {isLocked && (
          <div className="flex w-full flex-col gap-1.5 rounded-[8px] border border-border-default bg-bg-inset px-3.5 py-3">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-medium text-text-primary">Too many attempts</span>
              <span className="font-mono text-[11px] font-medium text-text-tertiary">
                {mm}:{ss}
              </span>
            </div>
            <div className="text-[11px] leading-[1.45] text-text-faint">
              Sign-in is paused. Try again when the timer ends.
            </div>
            <div className="mt-0.5 h-[3px] overflow-hidden rounded-full bg-border-strong">
              <div
                className="h-full bg-text-quiet transition-all"
                style={{ width: `${Math.max(4, progressPct)}%` }}
              />
            </div>
          </div>
        )}
      </form>
    </div>
  );
}
