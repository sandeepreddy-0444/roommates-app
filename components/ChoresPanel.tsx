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
import { auth, db } from "@/app/lib/firebase";

type Chore = {
  id: string;
  title: string;
  assignedToUid: string;
  assignedToName: string;
  dueDate: string;
  status: "pending" | "done";
  createdAt?: any;
};

type Roommate = {
  uid: string;
  name: string;
};

export default function ChoresPanel() {
  const [uid, setUid] = useState<string | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [roommates, setRoommates] = useState<Roommate[]>([]);
  const [items, setItems] = useState<Chore[]>([]);
  const [title, setTitle] = useState("");
  const [assignedToUid, setAssignedToUid] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [loading, setLoading] = useState(true);

  const grouped = useMemo(() => {
    return {
      pending: items.filter((i) => i.status === "pending"),
      done: items.filter((i) => i.status === "done"),
    };
  }, [items]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        setLoading(false);
        return;
      }

      setUid(u.uid);

      const userSnap = await getDoc(doc(db, "users", u.uid));
      const userData = userSnap.exists() ? (userSnap.data() as any) : {};
      const gid = userData?.groupId || null;
      setGroupId(gid);
      setLoading(false);
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    if (!groupId) return;

    const unsub = onSnapshot(collection(db, "groups", groupId, "members"), async (snap) => {
      const rows = await Promise.all(
        snap.docs.map(async (memberDoc) => {
          const userSnap = await getDoc(doc(db, "users", memberDoc.id));
          const data = userSnap.exists() ? (userSnap.data() as any) : {};
          return {
            uid: memberDoc.id,
            name: data?.name || memberDoc.id.slice(0, 6),
          };
        })
      );

      setRoommates(rows);
      if (!assignedToUid && rows[0]) setAssignedToUid(rows[0].uid);
    });

    return () => unsub();
  }, [groupId, assignedToUid]);

  useEffect(() => {
    if (!groupId) return;

    const q = query(collection(db, "groups", groupId, "chores"), orderBy("createdAt", "desc"));

    const unsub = onSnapshot(q, (snap) => {
      const rows: Chore[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          title: data?.title || "",
          assignedToUid: data?.assignedToUid || "",
          assignedToName: data?.assignedToName || "Unknown",
          dueDate: data?.dueDate || "",
          status: data?.status || "pending",
          createdAt: data?.createdAt,
        };
      });
      setItems(rows);
    });

    return () => unsub();
  }, [groupId]);

  async function addChore() {
    if (!groupId || !uid) return;
    if (!title.trim()) return alert("Enter chore title");
    if (!assignedToUid) return alert("Choose roommate");
    if (!dueDate) return alert("Choose due date");

    const roommate = roommates.find((r) => r.uid === assignedToUid);

    await addDoc(collection(db, "groups", groupId, "chores"), {
      title: title.trim(),
      assignedToUid,
      assignedToName: roommate?.name || "Unknown",
      dueDate,
      status: "pending",
      createdAt: serverTimestamp(),
      createdBy: uid,
    });

    await addDoc(collection(db, "groups", groupId, "notifications"), {
      type: "chore",
      title: "New chore assigned",
      body: `${roommate?.name || "Someone"} was assigned "${title.trim()}" due on ${dueDate}`,
      createdAt: serverTimestamp(),
      createdBy: uid,
      readBy: [],
    });

    setTitle("");
    setDueDate("");
  }

  async function toggleDone(chore: Chore) {
    if (!groupId) return;
    await updateDoc(doc(db, "groups", groupId, "chores", chore.id), {
      status: chore.status === "done" ? "pending" : "done",
    });
  }

  async function deleteChore(choreId: string) {
    if (!groupId) return;
    const ok = confirm("Delete this chore?");
    if (!ok) return;
    await deleteDoc(doc(db, "groups", groupId, "chores", choreId));
  }

  if (loading) return <div>Loading chores...</div>;
  if (!groupId) return <div>You are not in a room yet.</div>;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <h2 style={{ margin: 0 }}>Chores</h2>

      <div style={cardStyle}>
        <div style={{ fontWeight: 900, marginBottom: 10 }}>Add chore</div>

        <div style={{ display: "grid", gap: 10 }}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Take out trash"
            style={inputStyle}
          />

          <select
            value={assignedToUid}
            onChange={(e) => setAssignedToUid(e.target.value)}
            style={inputStyle}
          >
            {roommates.map((r) => (
              <option key={r.uid} value={r.uid}>
                {r.name}
              </option>
            ))}
          </select>

          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            style={inputStyle}
          />

          <button onClick={addChore} style={buttonStyle}>
            Add chore
          </button>
        </div>
      </div>

      <div style={cardStyle}>
        <div style={{ fontWeight: 900, marginBottom: 10 }}>Pending</div>
        {grouped.pending.length === 0 ? (
          <div style={{ opacity: 0.75 }}>No pending chores.</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {grouped.pending.map((c) => (
              <div key={c.id} style={rowStyle}>
                <div>
                  <div style={{ fontWeight: 800 }}>{c.title}</div>
                  <div style={{ fontSize: 13, opacity: 0.75 }}>
                    Assigned to {c.assignedToName} • Due {c.dueDate}
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button onClick={() => toggleDone(c)} style={buttonStyle}>
                    Mark done
                  </button>
                  <button onClick={() => deleteChore(c.id)} style={dangerStyle}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={cardStyle}>
        <div style={{ fontWeight: 900, marginBottom: 10 }}>Completed</div>
        {grouped.done.length === 0 ? (
          <div style={{ opacity: 0.75 }}>No completed chores yet.</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {grouped.done.map((c) => (
              <div key={c.id} style={rowStyle}>
                <div>
                  <div style={{ fontWeight: 800 }}>{c.title}</div>
                  <div style={{ fontSize: 13, opacity: 0.75 }}>
                    Assigned to {c.assignedToName} • Due {c.dueDate}
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button onClick={() => toggleDone(c)} style={buttonStyle}>
                    Mark pending
                  </button>
                  <button onClick={() => deleteChore(c.id)} style={dangerStyle}>
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

const cardStyle: React.CSSProperties = {
  border: "1px solid #2b2b2b",
  borderRadius: 12,
  padding: 14,
  background: "#0b0b0b",
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  border: "1px solid #2b2b2b",
  borderRadius: 12,
  padding: 12,
  background: "#111",
  flexWrap: "wrap",
};

const inputStyle: React.CSSProperties = {
  background: "#111",
  color: "white",
  border: "1px solid #2b2b2b",
  borderRadius: 10,
  padding: "10px 12px",
};

const buttonStyle: React.CSSProperties = {
  border: "1px solid #2b2b2b",
  borderRadius: 10,
  padding: "8px 12px",
  background: "white",
  color: "black",
  fontWeight: 800,
  cursor: "pointer",
};

const dangerStyle: React.CSSProperties = {
  border: "1px solid #7f1d1d",
  borderRadius: 10,
  padding: "8px 12px",
  background: "#2a0f0f",
  color: "#fecaca",
  fontWeight: 800,
  cursor: "pointer",
};