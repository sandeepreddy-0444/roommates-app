"use client";

import GroceryPanel from "@/components/GroceryPanel";

export default function GroceryPage() {
  return (
    <main className="safe-area min-h-dvh px-5 py-[max(1.25rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))] text-slate-900">
      <div className="max-w-3xl mx-auto">
        <GroceryPanel />
      </div>
    </main>
  );
}