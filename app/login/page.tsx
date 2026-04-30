"use client";

import { useState } from "react";
import {
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
} from "firebase/auth";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { auth } from "@/app/lib/firebase";
import { MaterialIcon } from "@/components/MaterialIcon";

/** Pexels — kitchen & friends, warm “shared home” mood */
const LOGIN_BACKGROUND_IMAGE =
  "https://images.pexels.com/photos/4781415/pexels-photo-4781415.jpeg?auto=compress&cs=tinysrgb&w=1920";

function friendlyAuthError(code?: string) {
  switch (code) {
    case "auth/invalid-email":
      return "Please enter a valid email.";
    case "auth/user-not-found":
      return "No account found with that email.";
    case "auth/wrong-password":
      return "Incorrect password.";
    case "auth/invalid-credential":
      return "Incorrect email or password.";
    case "auth/too-many-requests":
      return "Too many attempts. Try again later.";
    case "auth/network-request-failed":
      return "Network error. Check your internet and try again.";
    default:
      return "Something went wrong. Please try again.";
  }
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);

  const [err, setErr] = useState<string | null>(null);
  const [resetMsg, setResetMsg] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setResetMsg(null);
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      router.push("/dashboard");
    } catch (error: any) {
      setErr(friendlyAuthError(error?.code));
    } finally {
      setLoading(false);
    }
  }

  async function onForgotPassword() {
    setErr(null);
    setResetMsg(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setErr("Type your email above, then click “Forgot password?”");
      return;
    }

    setResetLoading(true);
    try {
      await sendPasswordResetEmail(auth, trimmedEmail);
      setResetMsg("Password reset email sent. Check your inbox (and spam).");
    } catch (error: any) {
      setErr(friendlyAuthError(error?.code));
    } finally {
      setResetLoading(false);
    }
  }

  return (
    <main className="safe-area relative z-0 min-h-dvh flex items-center justify-center px-6 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] text-slate-900">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-20 bg-slate-200"
        style={{
          backgroundImage: `url(${LOGIN_BACKGROUND_IMAGE})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 bg-gradient-to-b from-white/70 via-white/50 to-white/75"
      />
      <div className="relative w-full max-w-md rounded-[var(--app-radius-sheet)] border border-[var(--app-border-subtle)] bg-[var(--app-surface-elevated)] backdrop-blur-2xl shadow-[var(--app-shadow-sheet)] p-6">
        {/* ✅ Brand header */}
        <div className="text-center">
          <div className="flex justify-center leading-none">
            <MaterialIcon name="groups" size={56} className="text-blue-600" />
          </div>
          <h1 className="text-3xl font-extrabold mt-3">Roommates</h1>
          <p className="text-sm text-slate-500 mt-1">
            Split bills • Track groceries • Stay organized
          </p>
        </div>

        {/* ✅ Form */}
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <input
            className="w-full rounded-xl border border-[var(--app-border-subtle)] bg-white p-3 text-slate-900 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-blue-500/30"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          {/* ✅ Password with Show/Hide */}
          <div className="relative">
            <input
              className="w-full rounded-xl border border-[var(--app-border-subtle)] bg-white p-3 pr-12 text-slate-900 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-blue-500/30"
              type={showPw ? "text" : "password"}
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-500 underline"
            >
              {showPw ? "Hide" : "Show"}
            </button>
          </div>

          {err && <p className="text-red-400 text-sm">{err}</p>}
          {resetMsg && <p className="text-green-400 text-sm">{resetMsg}</p>}

          <button
            disabled={loading}
            className="w-full rounded-xl bg-slate-900 text-white p-3 font-semibold disabled:opacity-60 shadow-sm"
          >
            {loading ? "Logging in..." : "Login"}
          </button>

          {/* ✅ Forgot password */}
          <div className="text-center">
            <button
              type="button"
              onClick={onForgotPassword}
              disabled={resetLoading || !email.trim()}
              className="text-sm text-slate-500 underline disabled:opacity-40"
            >
              {resetLoading ? "Sending reset email..." : "Forgot password?"}
            </button>
          </div>
        </form>

        <p className="text-sm mt-4 text-slate-600">
          Don’t have an account?{" "}
          <Link href="/signup" className="underline text-blue-600 font-medium">
            Sign up
          </Link>
        </p>
      </div>
    </main>
  );
}