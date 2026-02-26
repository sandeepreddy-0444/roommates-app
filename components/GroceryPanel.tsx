"use client";

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { useRouter } from "next/navigation";
import { auth, db } from "@/app/lib/firebase";

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

// ✅ Autocomplete suggestions
const GROCERY_SUGGESTIONS = [
  "🥛 Milk",
  "🍞 Bread",
  "🥚 Eggs",
  "🧈 Butter",
  "🧀 Cheese",
  "🍚 Rice",
  "🌾 Flour",
  "🥣 Dal / Lentils",
  "🍅 Tomato",
  "🧅 Onion",
  "🥔 Potato",
  "🥦 Vegetables",
  "🍌 Bananas",
  "🍎 Apples",
  "🍊 Oranges",
  "🍗 Chicken",
  "🐟 Fish",
  "🧂 Salt",
  "🌶️ Mirchi / Chili",
  "🧻 Toilet paper",
  "🧼 Soap",
  "🧴 Shampoo",
  "🧃 Juice",
];

// ✅ Quick buttons with default category
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

    const q = query(itemsCol, orderBy("createdAt", "desc"));
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

  // ✅ When you click a quick item:
  // - set the name
  // - auto-set the category dropdown
  // - clear qty so it’s clean
  function addQuickItem(emoji: string, label: string, cat: string) {
    setName(`${emoji} ${label}`);
    setCategory(cat);
    setQty("");
    setMsg(null);
  }

  // ✅ NEW: infer category from what the user types/selects (like 🍗 Chicken)
  function inferCategoryFromText(text: string) {
    const t = text.toLowerCase();

    // meat/seafood
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

    // vegetables
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

    // fruits
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

    // dairy
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

    // grains/lentils
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

    // spices
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

  async function addItem(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!itemsCol || !uid) return;

    const clean = name.trim();
    if (!clean) return setMsg("Enter an item name");

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
  }

  async function toggleBought(item: GroceryItem) {
    if (!groupId) return;
    await updateDoc(doc(db, "groups", groupId, "grocery", item.id), {
      bought: !item.bought,
    });
  }

  async function removeItem(item: GroceryItem) {
    if (!groupId) return;
    await deleteDoc(doc(db, "groups", groupId, "grocery", item.id));
  }

  if (loading) return <div className="p-2 text-white">Loading...</div>;

  return (
    <div className="space-y-4 text-white">
      <div>
        <h2 className="text-lg font-semibold">Grocery List</h2>
      </div>

      <form onSubmit={addItem} className="border rounded-2xl p-4 space-y-3">
        {/* ✅ Quick emoji + name buttons (auto category) */}
        <div className="flex flex-wrap gap-2">
          {QUICK_ITEMS.map((it) => (
            <button
              key={it.emoji + it.label}
              type="button"
              onClick={() => addQuickItem(it.emoji, it.label, it.category)}
              className="border rounded-xl px-3 py-2"
              title={`${it.label} → ${it.category}`}
              aria-label={`Add ${it.label} in ${it.category}`}
            >
              {it.emoji}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="md:col-span-1">
            <input
              className="rounded-xl border p-3 w-full bg-transparent text-white placeholder:text-gray-400"
              placeholder="Item (🍅 tomato, 🥣 dal, 🌶️ mirchi...)"
              value={name}
              onChange={(e) => {
                const v = e.target.value;
                setName(v);

                const inferred = inferCategoryFromText(v);
                if (inferred) setCategory(inferred);
              }}
              list="grocery-suggestions"
              autoComplete="off"
            />
            <datalist id="grocery-suggestions">
              {GROCERY_SUGGESTIONS.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>

          <input
            className="rounded-xl border p-3 bg-transparent text-white placeholder:text-gray-400"
            placeholder="Qty (optional)"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />

          <select
            className="rounded-xl border p-3 bg-transparent text-white"
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

        {msg && <p className="text-sm text-red-400">{msg}</p>}

        <button className="rounded-xl bg-white text-black px-4 py-3">
          Add Item
        </button>
      </form>

      <div className="space-y-3">
        {items.length === 0 ? (
          <p className="text-gray-400">No items yet. Add your first one ☝️</p>
        ) : (
          items.map((it) => (
            <div
              key={it.id}
              className="border rounded-2xl p-4 flex justify-between"
            >
              <div className="flex gap-3">
                <input
                  type="checkbox"
                  checked={it.bought}
                  onChange={() => toggleBought(it)}
                />
                <div>
                  <div className={it.bought ? "line-through text-gray-500" : ""}>
                    <span
                      className={`font-medium ${
                        it.bought ? "text-gray-500" : "text-white"
                      }`}
                    >
                      {it.name}
                    </span>
                    {it.qty && <span className="text-gray-400"> • {it.qty}</span>}
                  </div>
                  <div className="text-sm text-gray-400">{it.category}</div>
                </div>
              </div>

              <button
                onClick={() => removeItem(it)}
                className="text-sm border px-3 py-2 rounded"
              >
                Remove
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}