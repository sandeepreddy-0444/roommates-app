"use client";

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
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

export default function GroceryPanel() {
  const router = useRouter();
  const [uid, setUid] = useState<string | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);

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
      if (!u) return router.push("/login");
      setUid(u.uid);
      setEmail(u.email ?? null);

      const userDoc = await getDoc(doc(db, "users", u.uid));
      const gid = userDoc.exists() ? userDoc.data().groupId : null;
      if (!gid) return router.push("/room");

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

  async function logout() {
    await signOut(auth);
    router.push("/login");
  }

  if (loading) return <div className="p-2">Loading...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Grocery List</h2>
          <p className="text-sm text-gray-600">Room: {groupId}</p>
          <p className="text-sm text-gray-600">Logged in as: {email}</p>
        </div>

        <button onClick={logout} className="border px-4 py-2 rounded">
          Logout
        </button>
      </div>

      <form onSubmit={addItem} className="border rounded-2xl p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <input
            className="rounded-xl border p-3"
            placeholder="Item (tomato, dal, mirchi...)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="rounded-xl border p-3"
            placeholder="Qty (optional)"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
          <select
            className="rounded-xl border p-3"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {DEFAULT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        {msg && <p className="text-sm text-red-600">{msg}</p>}

        <button className="rounded-xl bg-black text-white px-4 py-3">
          Add Item
        </button>
      </form>

      <div className="space-y-3">
        {items.length === 0 ? (
          <p className="text-gray-600">No items yet. Add your first one ☝️</p>
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
                    <span className="font-medium">{it.name}</span>
                    {it.qty && (
                      <span className="text-gray-600"> • {it.qty}</span>
                    )}
                  </div>
                  <div className="text-sm text-gray-600">{it.category}</div>
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
