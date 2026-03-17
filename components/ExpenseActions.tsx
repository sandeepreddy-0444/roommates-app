"use client";

import { useMemo, useState } from "react";
import { deleteDoc, doc, updateDoc } from "firebase/firestore";
import { db } from "@/app/lib/firebase";

type Expense = {
  id: string;
  title: string;
  amount: number;
  date?: any;
  createdBy?: string;
};

function toInputDate(value: any): string {
  if (!value) return "";
  if (typeof value === "string") {
    return value.slice(0, 10);
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (value?.toDate) {
    return value.toDate().toISOString().slice(0, 10);
  }
  return "";
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
          className="px-3 py-1 rounded-lg border border-neutral-800 text-sm text-neutral-200 hover:bg-neutral-900"
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
          className="px-3 py-1 rounded-lg border border-neutral-800 text-sm text-red-300 hover:bg-neutral-900"
        >
          Delete
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/70"
            onClick={() => {
              if (!saving) {
                setOpen(false);
                setMode(null);
              }
            }}
          />
          <div className="relative w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-950 p-5">
            <div className="text-lg font-semibold">
              {mode === "edit" ? "Edit expense" : "Delete expense"}
            </div>
            <p className="text-sm text-neutral-400 mt-1">
              {mode === "edit"
                ? "Update the details and save."
                : "This will permanently delete the expense."}
            </p>

            {mode === "edit" && (
              <div className="mt-4 space-y-3">
                <input
                  className="w-full rounded-xl border border-neutral-800 bg-transparent p-3 text-white placeholder:text-neutral-500 outline-none focus:ring-2 focus:ring-neutral-700"
                  placeholder="Title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={saving}
                />
                <input
                  className="w-full rounded-xl border border-neutral-800 bg-transparent p-3 text-white placeholder:text-neutral-500 outline-none focus:ring-2 focus:ring-neutral-700"
                  placeholder="Amount"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  disabled={saving}
                />
                <input
                  className="w-full rounded-xl border border-neutral-800 bg-transparent p-3 text-white outline-none focus:ring-2 focus:ring-neutral-700"
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
                className="px-4 py-2 rounded-xl border border-neutral-800 text-sm text-neutral-200 hover:bg-neutral-900 disabled:opacity-60"
                disabled={saving}
              >
                Cancel
              </button>

              {mode === "edit" ? (
                <button
                  type="button"
                  onClick={doSave}
                  className="px-4 py-2 rounded-xl bg-white text-black text-sm font-semibold disabled:opacity-60"
                  disabled={saving}
                >
                  {saving ? "Saving..." : "Save"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={doDelete}
                  className="px-4 py-2 rounded-xl bg-red-500 text-black text-sm font-semibold disabled:opacity-60"
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