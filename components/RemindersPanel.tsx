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
    <div style={{ display: "grid", gap: 18 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 28 }}>Reminders</h2>
        <div style={{ marginTop: 6, color: "rgba(255,255,255,0.68)" }}>
          Keep track of recurring bills and important room-related dates.
        </div>
      </div>

      <div style={panelStyle}>
        <div style={sectionHeadingStyle}>Create reminder</div>

        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gap: 8 }}>
            <div style={fieldLabelStyle}>Title</div>
            <input
              placeholder="Rent, Wifi, Gas..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              style={inputStyle}
            />
          </div>

          <div style={formGridStyle}>
            <div style={{ display: "grid", gap: 8 }}>
              <div style={fieldLabelStyle}>Due date</div>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                style={inputStyle}
              />
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              <div style={fieldLabelStyle}>Repeat</div>
              <select
                value={repeat}
                onChange={(e) => setRepeat(e.target.value as "none" | "monthly")}
                style={inputStyle}
              >
                <option value="none">No repeat</option>
                <option value="monthly">Repeat monthly</option>
              </select>
            </div>
          </div>

          <button onClick={addReminder} style={primaryBtnStyle}>
            Add Reminder
          </button>
        </div>
      </div>

      <div style={panelStyle}>
        <div style={sectionHeadingStyle}>Upcoming reminders</div>

        {items.length === 0 ? (
          <div style={emptyStateStyle}>No reminders yet.</div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {items.map((r) => (
              <div
                key={r.id}
                style={{
                  ...reminderCardStyle,
                  opacity: r.isActive ? 1 : 0.58,
                }}
              >
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <div style={reminderTitleStyle}>{r.title}</div>
                    <span
                      style={{
                        ...statusBadgeStyle,
                        background: r.isActive
                          ? "rgba(34,197,94,0.14)"
                          : "rgba(148,163,184,0.12)",
                        color: r.isActive ? "#86efac" : "#cbd5e1",
                        border: r.isActive
                          ? "1px solid rgba(34,197,94,0.22)"
                          : "1px solid rgba(148,163,184,0.18)",
                      }}
                    >
                      {r.isActive ? "Active" : "Paused"}
                    </span>
                  </div>

                  <div style={metaTextStyle}>
                    Due: {formatMDY(r.dueDate)} • Repeat: {r.repeat}
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    onClick={() => toggleReminder(r)}
                    style={secondaryBtnStyle}
                  >
                    {r.isActive ? "Pause" : "Activate"}
                  </button>

                  <button
                    onClick={() => removeReminder(r.id)}
                    style={dangerGhostBtnStyle}
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

const panelStyle: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 24,
  padding: 20,
  background:
    "linear-gradient(180deg, rgba(8,13,28,0.88) 0%, rgba(10,16,34,0.82) 100%)",
  boxShadow: "0 18px 38px rgba(0,0,0,0.20)",
  display: "grid",
  gap: 16,
};

const sectionHeadingStyle: React.CSSProperties = {
  fontWeight: 800,
  fontSize: 18,
};

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 12,
  color: "rgba(255,255,255,0.68)",
  textTransform: "uppercase",
  letterSpacing: 0.6,
};

const formGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 14,
};

const inputStyle: React.CSSProperties = {
  background: "rgba(5,10,20,0.92)",
  color: "white",
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 14,
  padding: "12px 14px",
  outline: "none",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
};

const primaryBtnStyle: React.CSSProperties = {
  border: "1px solid rgba(96,165,250,0.75)",
  borderRadius: 14,
  padding: "12px 16px",
  background: "linear-gradient(135deg, #60a5fa, #2563eb)",
  color: "white",
  fontWeight: 800,
  cursor: "pointer",
  boxShadow: "0 14px 28px rgba(37,99,235,0.24)",
  transition: "all 0.2s ease",
};

const secondaryBtnStyle: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 12,
  padding: "9px 12px",
  background: "rgba(255,255,255,0.04)",
  color: "white",
  cursor: "pointer",
  fontWeight: 700,
  transition: "all 0.2s ease",
};

const dangerGhostBtnStyle: React.CSSProperties = {
  border: "1px solid rgba(248,113,113,0.28)",
  borderRadius: 12,
  padding: "9px 12px",
  background: "rgba(127,29,29,0.16)",
  color: "#fca5a5",
  cursor: "pointer",
  fontWeight: 700,
  transition: "all 0.2s ease",
};

const emptyStateStyle: React.CSSProperties = {
  color: "rgba(255,255,255,0.68)",
  padding: "10px 2px",
};

const reminderCardStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 14,
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 18,
  padding: 16,
  background: "rgba(255,255,255,0.03)",
  flexWrap: "wrap",
};

const reminderTitleStyle: React.CSSProperties = {
  fontWeight: 800,
  fontSize: 17,
};

const metaTextStyle: React.CSSProperties = {
  fontSize: 13,
  color: "rgba(255,255,255,0.66)",
};

const statusBadgeStyle: React.CSSProperties = {
  padding: "5px 10px",
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 800,
};

function formatMDY(ymd: string) {
  const [y, m, d] = (ymd || "").split("-");
  if (!y || !m || !d) return ymd;
  return `${m}/${d}/${y}`;
}