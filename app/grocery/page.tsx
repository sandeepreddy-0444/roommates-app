"use client";

import GroceryPanel from "@/components/GroceryPanel";

export default function GroceryPage() {
  return (
    <main className="min-h-screen p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <h1 className="text-2xl font-semibold">Grocery List</h1>
        <GroceryPanel />
      </div>
    </main>
  );
}