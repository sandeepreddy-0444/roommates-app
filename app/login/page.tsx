"use client";

import { useState } from "react";
import {
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
} from "firebase/auth";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { auth } from "@/app/lib/firebase";

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
    <main className="min-h-screen flex items-center justify-center p-6 bg-black text-white">
      <div className="w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-950 p-6">
        {/* ✅ Brand header */}
        <div className="text-center">
          <div className="text-6xl leading-none">🏘️</div>
          <h1 className="text-3xl font-extrabold mt-3">Roommates</h1>
          <p className="text-sm text-neutral-400 mt-1">
            Split bills • Track groceries • Stay organized
          </p>
        </div>

        {/* ✅ Form */}
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <input
            className="w-full rounded-xl border border-neutral-800 bg-transparent p-3 text-white placeholder:text-neutral-500 outline-none focus:ring-2 focus:ring-neutral-700"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          {/* ✅ Password with Show/Hide */}
          <div className="relative">
            <input
              className="w-full rounded-xl border border-neutral-800 bg-transparent p-3 pr-12 text-white placeholder:text-neutral-500 outline-none focus:ring-2 focus:ring-neutral-700"
              type={showPw ? "text" : "password"}
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-neutral-300 underline"
            >
              {showPw ? "Hide" : "Show"}
            </button>
          </div>

          {err && <p className="text-red-400 text-sm">{err}</p>}
          {resetMsg && <p className="text-green-400 text-sm">{resetMsg}</p>}

          <button
            disabled={loading}
            className="w-full rounded-xl bg-white text-black p-3 font-semibold disabled:opacity-60"
          >
            {loading ? "Logging in..." : "Login"}
          </button>

          {/* ✅ Forgot password */}
          <div className="text-center">
            <button
              type="button"
              onClick={onForgotPassword}
              disabled={resetLoading || !email.trim()}
              className="text-sm text-neutral-300 underline disabled:opacity-40"
            >
              {resetLoading ? "Sending reset email..." : "Forgot password?"}
            </button>
          </div>
        </form>

        <p className="text-sm mt-4 text-neutral-300">
          Don’t have an account?{" "}
          <Link href="/signup" className="underline text-white">
            Sign up
          </Link>
        </p>
      </div>
    </main>
  );
}