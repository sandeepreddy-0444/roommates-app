"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useState } from "react";
import { confirmPasswordReset } from "firebase/auth";
import { auth } from "@/app/lib/firebase";

export default function ResetPasswordPage() {
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
      setMsg("Password updated ✅ Redirecting...");
      setTimeout(() => router.push("/login"), 1200);
    } catch (e: any) {
      setMsg(e?.message || "Reset failed. Request a new email.");
    }
  };

  return (
    <div style={{ minHeight: "100vh", padding: 20, background: "#0b0b0b", color: "white" }}>
      <div style={{ maxWidth: 420, margin: "0 auto", border: "1px solid #333", borderRadius: 12, padding: 16, background: "#111" }}>
        <h2>Reset Password</h2>

        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
          <input
            type="password"
            placeholder="New password"
            value={p1}
            onChange={(e) => setP1(e.target.value)}
            style={{ padding: 10, borderRadius: 10 }}
          />
          <input
            type="password"
            placeholder="Confirm new password"
            value={p2}
            onChange={(e) => setP2(e.target.value)}
            style={{ padding: 10, borderRadius: 10 }}
          />
          <button onClick={submit} style={{ padding: 10, borderRadius: 10 }}>
            Update Password
          </button>

          {msg && <div style={{ opacity: 0.9 }}>{msg}</div>}
        </div>
      </div>
    </div>
  );
}