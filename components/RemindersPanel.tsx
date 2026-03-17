"use client";

import { useEffect, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/app/lib/firebase";

type Reminder = {
  id: string;
  title: string;
  dueDate: string;
  repeat: "none" | "monthly";
  isActive: boolean;
};

export default function RemindersPanel({ groupId }: { groupId: string }) {
  const [items, setItems] = useState<Reminder[]>([]);
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [repeat, setRepeat] = useState<"none" | "monthly">("monthly");

  useEffect(() => {
    if (!groupId) return;

    const q = query(
      collection(db, "groups", groupId, "reminders"),
      orderBy("dueDate", "asc")
    );

    const unsub = onSnapshot(q, (snap) => {
      const list: Reminder[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          title: data?.title ?? "",
          dueDate: data?.dueDate ?? "",
          repeat: (data?.repeat ?? "monthly") as "none" | "monthly",
          isActive: data?.isActive ?? true,
        };
      });

      setItems(list);
    });

    return () => unsub();
  }, [groupId]);

  async function addReminder() {
    if (!title.trim()) return alert("Enter a title (Rent/Wifi/Gas)");
    if (!dueDate) return alert("Pick a due date");

    await addDoc(collection(db, "groups", groupId, "reminders"), {
      title: title.trim(),
      dueDate,
      repeat,
      isActive: true,
      createdAt: serverTimestamp(),
    });

    setTitle("");
    setDueDate("");
    setRepeat("monthly");
  }

  async function removeReminder(id: string) {
    const ok = confirm("Delete this reminder?");
    if (!ok) return;
    await deleteDoc(doc(db, "groups", groupId, "reminders", id));
  }

  async function toggleReminder(reminder: Reminder) {
    await updateDoc(doc(db, "groups", groupId, "reminders", reminder.id), {
      isActive: !reminder.isActive,
    });
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div
        style={{
          border: "1px solid #2b2b2b",
          borderRadius: 14,
          padding: 14,
          background: "#111",
        }}
      >
        <h2 style={{ margin: 0, marginBottom: 10 }}>Reminders</h2>

        <div style={{ display: "grid", gap: 10 }}>
          <input
            placeholder="e.g. Rent, Wifi, Gas"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={inputStyle}
          />

          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            style={inputStyle}
          />

          <select
            value={repeat}
            onChange={(e) => setRepeat(e.target.value as "none" | "monthly")}
            style={inputStyle}
          >
            <option value="none">No repeat</option>
            <option value="monthly">Repeat monthly</option>
          </select>

          <button
            onClick={addReminder}
            style={{
              border: "1px solid #2b2b2b",
              borderRadius: 12,
              padding: "10px 12px",
              background: "white",
              color: "black",
              cursor: "pointer",
              fontWeight: 800,
            }}
          >
            Add reminder
          </button>
        </div>
      </div>

      <div
        style={{
          border: "1px solid #2b2b2b",
          borderRadius: 14,
          padding: 14,
          background: "#111",
        }}
      >
        <h3 style={{ marginTop: 0 }}>Upcoming</h3>

        {items.length === 0 ? (
          <div style={{ opacity: 0.75 }}>No reminders yet.</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {items.map((r) => (
              <div
                key={r.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  border: "1px solid #2b2b2b",
                  borderRadius: 12,
                  padding: 12,
                  background: "#0b0b0b",
                  opacity: r.isActive ? 1 : 0.55,
                  flexWrap: "wrap",
                }}
              >
                <div style={{ display: "grid", gap: 2 }}>
                  <div style={{ fontWeight: 900 }}>{r.title}</div>
                  <div style={{ fontSize: 13, opacity: 0.8 }}>
                    Due: {formatMDY(r.dueDate)} • Repeat: {r.repeat}
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>
                    Status: {r.isActive ? "Active" : "Paused"}
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    onClick={() => toggleReminder(r)}
                    style={{
                      border: "1px solid #2b2b2b",
                      borderRadius: 10,
                      padding: "8px 10px",
                      background: "#111",
                      color: "white",
                      cursor: "pointer",
                    }}
                  >
                    {r.isActive ? "Pause" : "Activate"}
                  </button>

                  <button
                    onClick={() => removeReminder(r.id)}
                    style={{
                      border: "1px solid #4b1c1c",
                      borderRadius: 10,
                      padding: "8px 10px",
                      background: "#111",
                      color: "#fca5a5",
                      cursor: "pointer",
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: "#0b0b0b",
  color: "white",
  border: "1px solid #2b2b2b",
  borderRadius: 10,
  padding: "10px 12px",
};

function formatMDY(ymd: string) {
  const [y, m, d] = (ymd || "").split("-");
  if (!y || !m || !d) return ymd;
  return `${m}/${d}/${y}`;
}