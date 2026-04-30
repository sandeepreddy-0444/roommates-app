"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useState } from "react";
import { confirmPasswordReset } from "firebase/auth";
import { auth } from "@/app/lib/firebase";

export default function ResetPasswordClient() {
  const params = useSearchParams();
  const router = useRouter();

  const oobCode = params.get("oobCode");

  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [msg, setMsg] = useState("");

  const submit = async () => {
    setMsg("");

    if (!oobCode) return setMsg("Invalid reset link. Request a new one.");
    if (p1.length < 6) return setMsg("Password must be at least 6 characters.");
    if (p1 !== p2) return setMsg("Passwords do not match.");

    try {
      await confirmPasswordReset(auth, oobCode, p1);
      setMsg("Password updated ✅ Redirecting to login...");
      setTimeout(() => router.push("/login"), 1200);
    } catch (e: any) {
      setMsg(e?.message || "Reset failed. Request a new email.");
    }
  };

  return (
    <div className="safe-area min-h-dvh flex items-center justify-center px-5 py-[max(1.25rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))] text-slate-900">
      <div className="max-w-md w-full rounded-[var(--app-radius-sheet)] border border-[var(--app-border-subtle)] bg-[var(--app-surface-elevated)] backdrop-blur-xl p-5 shadow-[var(--app-shadow-sheet)]">
        <h2 className="text-xl font-bold tracking-tight text-[#0f172a]">Reset Password</h2>

        <div className="grid gap-2.5 mt-3">
          <input
            type="password"
            placeholder="New password"
            value={p1}
            onChange={(e) => setP1(e.target.value)}
            className="w-full rounded-xl border border-[var(--app-border-subtle)] bg-white p-2.5 text-slate-900"
          />
          <input
            type="password"
            placeholder="Confirm new password"
            value={p2}
            onChange={(e) => setP2(e.target.value)}
            className="w-full rounded-xl border border-[var(--app-border-subtle)] bg-white p-2.5 text-slate-900"
          />
          <button
            type="button"
            onClick={submit}
            className="w-full rounded-xl bg-slate-900 text-white py-2.5 font-semibold"
          >
            Update Password
          </button>

          {msg && <p className="text-sm text-slate-600">{msg}</p>}
        </div>
      </div>
    </div>
  );
}