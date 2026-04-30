import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Offline | Roommates",
  description: "You are offline. Check your connection and try again.",
};

export default function OfflinePage() {
  return (
    <main className="safe-area min-h-dvh flex flex-col items-center justify-center gap-4 px-6 py-[max(1.25rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))] text-center text-slate-800">
      <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        No connection
      </p>
      <h1 className="text-2xl font-bold tracking-tight">You are offline</h1>
      <p className="max-w-sm text-slate-600">
        Roommates needs the internet to sync your room, expenses, and chat. Reconnect, then
        try again.
      </p>
      <Link
        href="/"
        className="mt-2 rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white"
      >
        Back to app
      </Link>
    </main>
  );
}
