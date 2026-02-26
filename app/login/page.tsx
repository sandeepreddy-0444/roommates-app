"use client";

import { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { auth } from "@/app/lib/firebase";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      router.push("/dashboard");
    } catch (error: any) {
      setErr(error?.message ?? "Login failed");
    } finally {
      setLoading(false);
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
          <input
            className="w-full rounded-xl border border-neutral-800 bg-transparent p-3 text-white placeholder:text-neutral-500 outline-none focus:ring-2 focus:ring-neutral-700"
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          {err && <p className="text-red-400 text-sm">{err}</p>}

          <button
            disabled={loading}
            className="w-full rounded-xl bg-white text-black p-3 font-semibold disabled:opacity-60"
          >
            {loading ? "Logging in..." : "Login"}
          </button>
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