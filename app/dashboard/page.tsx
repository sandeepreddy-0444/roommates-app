"use client";

import { useState } from "react";
import GroceryPanel from "@/components/GroceryPanel";
import ExpensesPanel from "@/components/ExpensesPanel";

export default function DashboardPage() {
  const [tab, setTab] = useState<"expenses" | "grocery">("expenses");

  return (
    <main className="p-4">
      <h1 className="text-xl font-semibold mb-4">Dashboard</h1>

      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-6">
        {/* LEFT BUTTONS */}
        <aside className="border rounded p-3 h-fit">
          <div className="flex flex-col gap-2">
            <button
              onClick={() => setTab("expenses")}
              className={`border px-4 py-2 rounded text-left ${
                tab === "expenses" ? "bg-black text-white" : ""
              }`}
            >
              Expenses
            </button>

            <button
              onClick={() => setTab("grocery")}
              className={`border px-4 py-2 rounded text-left ${
                tab === "grocery" ? "bg-black text-white" : ""
              }`}
            >
              Grocery List
            </button>
          </div>
        </aside>

        {/* RIGHT CONTENT */}
        <section className="border rounded p-4">
          {tab === "expenses" ? <ExpensesPanel /> : <GroceryPanel />}
        </section>
      </div>
    </main>
  );
}
