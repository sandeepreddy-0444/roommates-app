"use client";

import { useState } from "react";
import { createUserWithEmailAndPassword, updateProfile } from "firebase/auth";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { auth, db } from "@/app/lib/firebase";
import { MaterialIcon } from "@/components/MaterialIcon";

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);

    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName: name });

      await setDoc(doc(db, "users", cred.user.uid), {
        name: name,
        email: email,
        groupId: null,
        createdAt: serverTimestamp(),
      });

      router.push("/grocery");
    } catch (error: any) {
      setErr(error?.message ?? "Signup failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="safe-area min-h-dvh flex items-center justify-center px-6 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] text-slate-900">
      <div className="w-full max-w-md rounded-[var(--app-radius-sheet)] border border-[var(--app-border-subtle)] bg-[var(--app-surface-elevated)] backdrop-blur-xl p-6 shadow-[var(--app-shadow-sheet)]">
        <div className="flex justify-center">
          <MaterialIcon name="person_add" size={40} className="text-blue-600" />
        </div>
        <h1 className="text-2xl font-semibold text-center mt-2">Roommates</h1>
        <p className="text-sm text-gray-600 mt-1">Create your account</p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <input
            className="w-full rounded-xl border border-[var(--app-border-subtle)] bg-white p-3 text-slate-900"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <input
            className="w-full rounded-xl border border-[var(--app-border-subtle)] bg-white p-3 text-slate-900"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            className="w-full rounded-xl border border-[var(--app-border-subtle)] bg-white p-3 text-slate-900"
            type="password"
            placeholder="Password (min 6 chars)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          {err && <p className="text-red-600 text-sm">{err}</p>}

          <button
            disabled={loading}
            className="w-full rounded-xl bg-slate-900 text-white p-3 disabled:opacity-60"
          >
            {loading ? "Creating..." : "Sign up"}
          </button>
        </form>

        <p className="text-sm mt-4">
          Already have an account?{" "}
          <Link href="/login" className="underline text-blue-600 font-medium">
            Login
          </Link>
        </p>
      </div>
    </main>
  );
}
