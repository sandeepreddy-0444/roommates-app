"use client";

import { useMemo, useState } from "react";
import { deleteDoc, doc, updateDoc } from "firebase/firestore";
import { db } from "@/app/lib/firebase";
import { coerceToLocalInputDate } from "@/app/lib/dateLocal";

type Expense = {
  id: string;
  title: string;
  amount: number;
  date?: any;
  createdBy?: string;
};

function toInputDate(value: any): string {
  return coerceToLocalInputDate(value);
}

export default function ExpenseActions({
  groupId,
  expense,
  myUid,
  isAdmin,
  onDone,
}: {
  groupId: string;
  expense: Expense;
  myUid: string;
  isAdmin: boolean;
  onDone?: () => void;
}) {
  const canManage = useMemo(() => {
    return isAdmin || (expense.createdBy && expense.createdBy === myUid);
  }, [isAdmin, expense.createdBy, myUid]);

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"edit" | "delete" | null>(null);

  const [title, setTitle] = useState(expense.title ?? "");
  const [amount, setAmount] = useState(
    Number.isFinite(expense.amount) ? String(expense.amount) : ""
  );
  const [dateStr, setDateStr] = useState(toInputDate(expense.date));

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!canManage) return null;

  const expenseRef = doc(db, "groups", groupId, "expenses", expense.id);

  async function doSave() {
    setErr(null);

    const nextTitle = title.trim();
    const nextAmount = Number(amount);

    if (!nextTitle) return setErr("Title is required.");
    if (!Number.isFinite(nextAmount) || nextAmount <= 0) {
      return setErr("Amount must be a number greater than 0.");
    }
    if (!dateStr) return setErr("Date is required.");

    setSaving(true);
    try {
      await updateDoc(expenseRef, {
        title: nextTitle,
        amount: nextAmount,
        date: dateStr,
        updatedAt: new Date(),
      });

      setOpen(false);
      setMode(null);
      onDone?.();
    } catch (e: any) {
      setErr(e?.message ?? "Failed to update expense.");
    } finally {
      setSaving(false);
    }
  }

  async function doDelete() {
    setErr(null);
    setSaving(true);
    try {
      await deleteDoc(expenseRef);
      setOpen(false);
      setMode(null);
      onDone?.();
    } catch (e: any) {
      setErr(e?.message ?? "Failed to delete expense.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            setMode("edit");
            setOpen(true);
            setErr(null);
          }}
          className="px-3 py-1 rounded-lg border border-slate-300/80 text-sm text-slate-700 hover:bg-white/60"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("delete");
            setOpen(true);
            setErr(null);
          }}
          className="px-3 py-1 rounded-lg border border-red-200/80 text-sm text-red-600 hover:bg-red-50/80"
        >
          Delete
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-slate-900/25 backdrop-blur-sm"
            onClick={() => {
              if (!saving) {
                setOpen(false);
                setMode(null);
              }
            }}
          />
          <div className="relative w-full max-w-md rounded-2xl border border-white/80 bg-white/70 backdrop-blur-xl p-5 shadow-[0_20px_50px_rgba(15,23,42,0.1)] text-slate-900">
            <div className="text-lg font-semibold">
              {mode === "edit" ? "Edit expense" : "Delete expense"}
            </div>
            <p className="text-sm text-slate-500 mt-1">
              {mode === "edit"
                ? "Update the details and save."
                : "Are you sure? This will permanently delete this expense for everyone in the room."}
            </p>

            {mode === "edit" && (
              <div className="mt-4 space-y-3">
                <input
                  className="w-full rounded-xl border border-slate-300/80 bg-white/90 p-3 text-slate-900 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-blue-500/30"
                  placeholder="Title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={saving}
                />
                <input
                  className="w-full rounded-xl border border-slate-300/80 bg-white/90 p-3 text-slate-900 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-blue-500/30"
                  placeholder="Amount"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  disabled={saving}
                />
                <input
                  className="w-full rounded-xl border border-slate-300/80 bg-white/90 p-3 text-slate-900 outline-none focus:ring-2 focus:ring-blue-500/30"
                  type="date"
                  value={dateStr}
                  onChange={(e) => setDateStr(e.target.value)}
                  disabled={saving}
                />
              </div>
            )}

            {err && <p className="text-red-400 text-sm mt-3">{err}</p>}

            <div className="mt-5 flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => {
                  if (!saving) {
                    setOpen(false);
                    setMode(null);
                  }
                }}
                className="px-4 py-2 rounded-xl border border-slate-300/80 text-sm text-slate-700 hover:bg-white/60 disabled:opacity-60"
                disabled={saving}
              >
                Cancel
              </button>

              {mode === "edit" ? (
                <button
                  type="button"
                  onClick={doSave}
                  className="px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-semibold disabled:opacity-60"
                  disabled={saving}
                >
                  {saving ? "Saving..." : "Save"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={doDelete}
                  className="px-4 py-2 rounded-xl bg-red-500 text-white text-sm font-semibold disabled:opacity-60"
                  disabled={saving}
                >
                  {saving ? "Deleting..." : "Delete"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}