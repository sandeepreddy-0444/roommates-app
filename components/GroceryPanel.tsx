"use client";

import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { useRouter } from "next/navigation";
import { auth, db } from "@/app/lib/firebase";
import { confirmDestructive } from "@/lib/confirmAction";

type GroceryItem = {
  id: string;
  name: string;
  category: string;
  qty?: string;
  createdAt?: any;
  bought: boolean;
  addedBy?: string;
};

const DEFAULT_CATEGORIES = [
  "Vegetables",
  "Fruits",
  "Dairy",
  "Grains/Lentils",
  "Spices",
  "Meat/Seafood",
  "Other",
];

const QUICK_ITEMS: { emoji: string; label: string; category: string }[] = [
  { emoji: "🍅", label: "Tomato", category: "Vegetables" },
  { emoji: "🧅", label: "Onion", category: "Vegetables" },
  { emoji: "🥔", label: "Potato", category: "Vegetables" },
  { emoji: "🍎", label: "Apples", category: "Fruits" },
  { emoji: "🍌", label: "Bananas", category: "Fruits" },
  { emoji: "🥛", label: "Milk", category: "Dairy" },
  { emoji: "🥚", label: "Eggs", category: "Dairy" },
  { emoji: "🍚", label: "Rice", category: "Grains/Lentils" },
  { emoji: "🥣", label: "Dal", category: "Grains/Lentils" },
  { emoji: "🌶️", label: "Mirchi", category: "Spices" },
  { emoji: "🍗", label: "Chicken", category: "Meat/Seafood" },
  { emoji: "🐟", label: "Fish", category: "Meat/Seafood" },
  { emoji: "🧻", label: "Toilet paper", category: "Other" },
  { emoji: "🧼", label: "Soap", category: "Other" },
];

const GROCERY_LIMIT = 80;

function inferCategoryFromText(text: string) {
  const t = text.toLowerCase();

  if (
    t.includes("🍗") ||
    t.includes("chicken") ||
    t.includes("🐟") ||
    t.includes("fish") ||
    t.includes("🦐") ||
    t.includes("shrimp") ||
    t.includes("🥩") ||
    t.includes("meat")
  ) {
    return "Meat/Seafood";
  }

  if (
    t.includes("🍅") ||
    t.includes("tomato") ||
    t.includes("🧅") ||
    t.includes("onion") ||
    t.includes("🥔") ||
    t.includes("potato") ||
    t.includes("🥦") ||
    t.includes("vegetable")
  ) {
    return "Vegetables";
  }

  if (
    t.includes("🍎") ||
    t.includes("apple") ||
    t.includes("🍌") ||
    t.includes("banana") ||
    t.includes("🍊") ||
    t.includes("orange")
  ) {
    return "Fruits";
  }

  if (
    t.includes("🥛") ||
    t.includes("milk") ||
    t.includes("🥚") ||
    t.includes("eggs") ||
    t.includes("🧀") ||
    t.includes("cheese") ||
    t.includes("🧈") ||
    t.includes("butter")
  ) {
    return "Dairy";
  }

  if (
    t.includes("🍚") ||
    t.includes("rice") ||
    t.includes("🥣") ||
    t.includes("dal") ||
    t.includes("lentil") ||
    t.includes("🌾") ||
    t.includes("flour") ||
    t.includes("bread") ||
    t.includes("🍞")
  ) {
    return "Grains/Lentils";
  }

  if (
    t.includes("🌶️") ||
    t.includes("mirchi") ||
    t.includes("chili") ||
    t.includes("🧂") ||
    t.includes("salt")
  ) {
    return "Spices";
  }

  return null;
}

const GroceryRow = memo(function GroceryRow({
  item,
  onToggle,
  onRemove,
}: {
  item: GroceryItem;
  onToggle: (item: GroceryItem) => void;
  onRemove: (item: GroceryItem) => void;
}) {
  return (
    <div className="border-b border-[var(--app-border-subtle)] py-2.5 last:border-b-0">
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={item.bought}
          onChange={() => onToggle(item)}
          className="h-5 w-5 shrink-0"
        />

        <div className="min-w-0 flex-1">
          <div
            className={`break-words text-sm sm:text-base leading-snug ${
              item.bought ? "line-through text-gray-500" : "text-slate-900"
            }`}
          >
            <span className={item.bought ? "" : "font-semibold"}>{item.name}</span>
            <span
              className={
                item.bought ? "text-gray-400 font-normal" : "text-slate-500 font-normal"
              }
            >
              {" "}
              ({item.category})
            </span>
            {item.qty ? (
              <span className={item.bought ? "text-gray-400" : "text-slate-400"}>
                {" "}
                · {item.qty}
              </span>
            ) : null}
          </div>
        </div>

        <button
          type="button"
          onClick={() => onRemove(item)}
          className="shrink-0 rounded-xl border border-[var(--app-border-subtle)] bg-white px-3 py-2 text-xs sm:text-sm text-slate-800"
        >
          Remove
        </button>
      </div>
    </div>
  );
});

export default function GroceryPanel() {
  const router = useRouter();
  const [uid, setUid] = useState<string | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);

  const [items, setItems] = useState<GroceryItem[]>([]);
  const [name, setName] = useState("");
  const [qty, setQty] = useState("");
  const [category, setCategory] = useState("Vegetables");
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const itemsCol = useMemo(() => {
    if (!groupId) return null;
    return collection(db, "groups", groupId, "grocery");
  }, [groupId]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        router.push("/login");
        return;
      }

      setUid(u.uid);

      const userDoc = await getDoc(doc(db, "users", u.uid));
      const gid = userDoc.exists() ? (userDoc.data() as any).groupId : null;

      if (!gid) {
        router.push("/room");
        return;
      }

      setGroupId(gid);
      setLoading(false);
    });

    return () => unsub();
  }, [router]);

  useEffect(() => {
    if (!itemsCol) return;

    const q = query(itemsCol, orderBy("createdAt", "desc"), limit(GROCERY_LIMIT));
    const unsub = onSnapshot(q, (snap) => {
      const rows: GroceryItem[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          name: data.name ?? "",
          qty: data.qty ?? "",
          category: data.category ?? "Other",
          bought: !!data.bought,
          createdAt: data.createdAt,
          addedBy: data.addedBy ?? "",
        };
      });
      setItems(rows);
    });

    return () => unsub();
  }, [itemsCol]);

  const addQuickItem = useCallback((emoji: string, label: string, cat: string) => {
    setName(`${emoji} ${label}`);
    setCategory(cat);
    setQty("");
    setMsg(null);
  }, []);

  const handleNameChange = useCallback((value: string) => {
    setName(value);
    const inferred = inferCategoryFromText(value);
    if (inferred) setCategory(inferred);
  }, []);

  const addItem = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setMsg(null);

      if (!itemsCol || !uid || saving) return;

      const clean = name.trim();
      if (!clean) {
        setMsg("Enter an item name");
        return;
      }

      setSaving(true);
      try {
        await addDoc(itemsCol, {
          name: clean,
          qty: qty.trim(),
          category,
          bought: false,
          addedBy: uid,
          createdAt: serverTimestamp(),
        });

        setName("");
        setQty("");
        setCategory("Vegetables");
      } finally {
        setSaving(false);
      }
    },
    [itemsCol, uid, saving, name, qty, category]
  );

  const toggleBought = useCallback(
    async (item: GroceryItem) => {
      if (!groupId) return;
      await updateDoc(doc(db, "groups", groupId, "grocery", item.id), {
        bought: !item.bought,
      });
    },
    [groupId]
  );

  const removeItem = useCallback(
    async (item: GroceryItem) => {
      if (!groupId) return;
      if (
        !confirmDestructive(
          `Remove “${item.name || "this item"}” from the grocery list?\n\nThis cannot be undone.`
        )
      ) {
        return;
      }
      await deleteDoc(doc(db, "groups", groupId, "grocery", item.id));
    },
    [groupId]
  );

  if (loading) {
    return (
      <div className="py-3 px-1 text-[rgba(15,23,42,0.65)] text-[15px]">
        Loading…
      </div>
    );
  }

  return (
    <div className="space-y-4 text-slate-900 min-w-0">
      <form
        onSubmit={addItem}
        className="rounded-[var(--app-radius-sheet)] border border-[var(--app-border-subtle)] p-3 sm:p-4 space-y-4 bg-[var(--app-surface-elevated)] shadow-[var(--app-shadow-sheet)] backdrop-blur-[20px]"
      >
        <div>
          <div className="mb-2 text-sm text-slate-600">Quick add</div>
          <div className="grid grid-cols-5 sm:grid-cols-7 gap-2">
            {QUICK_ITEMS.map((it) => (
              <button
                key={it.emoji + it.label}
                type="button"
                onClick={() => addQuickItem(it.emoji, it.label, it.category)}
                className="min-h-[46px] rounded-xl border border-[var(--app-border-subtle)] bg-[var(--app-surface-card)] px-2 py-2 text-lg shadow-sm"
                title={`${it.label} → ${it.category}`}
                aria-label={`Add ${it.label}`}
              >
                {it.emoji}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <input
            className="min-h-[46px] rounded-xl border border-[var(--app-border-subtle)] bg-white px-3 py-3 w-full text-slate-900 placeholder:text-slate-400 outline-none"
            placeholder="Item name"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            autoComplete="off"
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              className="min-h-[46px] rounded-xl border border-[var(--app-border-subtle)] bg-white px-3 py-3 w-full text-slate-900 placeholder:text-slate-400 outline-none"
              placeholder="Qty (optional)"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />

            <select
              className="min-h-[46px] rounded-xl border border-[var(--app-border-subtle)] bg-white px-3 py-3 w-full text-slate-900 outline-none"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {DEFAULT_CATEGORIES.map((c) => (
                <option key={c} value={c} className="text-black">
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>

        {msg ? <p className="text-sm text-red-600">{msg}</p> : null}

        <button
          type="submit"
          disabled={saving}
          className="w-full sm:w-auto min-h-[46px] rounded-xl bg-slate-900 text-white px-4 py-3 font-semibold shadow-md disabled:opacity-60"
        >
          {saving ? "Adding..." : "Add Item"}
        </button>
      </form>

      <div className="rounded-[var(--app-radius-sheet)] border border-[var(--app-border-subtle)] px-3 sm:px-4 bg-[var(--app-surface-card)] shadow-[var(--app-shadow-sheet)]">
        {items.length === 0 ? (
          <div className="py-4 text-sm text-slate-500">
            No items yet. Add your first one.
          </div>
        ) : (
          items.map((it) => (
            <GroceryRow
              key={it.id}
              item={it}
              onToggle={toggleBought}
              onRemove={removeItem}
            />
          ))
        )}
      </div>
    </div>
  );
}