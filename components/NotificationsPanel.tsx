"use client";

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { useRouter } from "next/navigation";
import { auth, db } from "@/app/lib/firebase";

type Notif = {
  id: string;
  type: string;
  title: string;
  body: string;
  createdAt?: any;
  createdBy?: string;
  readBy?: string[];
};

export default function NotificationsPanel() {
  const router = useRouter();

  const [uid, setUid] = useState<string | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [rows, setRows] = useState<Notif[]>([]);
  const [loading, setLoading] = useState(true);

  // ✅ selection state
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const notifsCol = useMemo(() => {
    if (!groupId) return null;
    return collection(db, "groups", groupId, "notifications");
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
    if (!notifsCol) return;

    const q = query(notifsCol, orderBy("createdAt", "desc"), limit(50));
    const unsub = onSnapshot(q, (snap) => {
      const items: Notif[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          type: data.type ?? "info",
          title: data.title ?? "Notification",
          body: data.body ?? "",
          createdAt: data.createdAt,
          createdBy: data.createdBy ?? "",
          readBy: Array.isArray(data.readBy) ? data.readBy : [],
        };
      });

      setRows(items);

      // ✅ Clean up selected map (remove ids that no longer exist)
      setSelected((prev) => {
        const next: Record<string, boolean> = {};
        const ids = new Set(items.map((x) => x.id));
        for (const [k, v] of Object.entries(prev)) {
          if (ids.has(k)) next[k] = v;
        }
        return next;
      });
    });

    return () => unsub();
  }, [notifsCol]);

  const unreadCount = useMemo(() => {
    if (!uid) return 0;
    return rows.filter((n) => !(n.readBy ?? []).includes(uid)).length;
  }, [rows, uid]);

  const selectedIds = useMemo(() => {
    return Object.keys(selected).filter((id) => selected[id]);
  }, [selected]);

  const allSelected = useMemo(() => {
    if (rows.length === 0) return false;
    return rows.every((n) => selected[n.id]);
  }, [rows, selected]);

  function toggleOne(id: string) {
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function toggleSelectAll() {
    if (rows.length === 0) return;
    if (allSelected) {
      setSelected({});
      return;
    }
    const map: Record<string, boolean> = {};
    for (const n of rows) map[n.id] = true;
    setSelected(map);
  }

  async function markAllRead() {
    if (!uid || !groupId) return;

    const unread = rows.filter((n) => !(n.readBy ?? []).includes(uid));
    if (unread.length === 0) return;

    const batch = writeBatch(db);
    for (const n of unread) {
      batch.update(doc(db, "groups", groupId, "notifications", n.id), {
        readBy: arrayUnion(uid),
      });
    }
    await batch.commit();
  }

  async function markOneRead(id: string) {
    if (!uid || !groupId) return;
    await updateDoc(doc(db, "groups", groupId, "notifications", id), {
      readBy: arrayUnion(uid),
    });
  }

  async function deleteOne(id: string) {
    if (!groupId) return;
    const ok = confirm("Delete this notification?");
    if (!ok) return;

    await deleteDoc(doc(db, "groups", groupId, "notifications", id));
  }

  async function deleteSelected() {
    if (!groupId) return;
    if (selectedIds.length === 0) return;

    const ok = confirm(`Delete ${selectedIds.length} selected notification(s)?`);
    if (!ok) return;

    const batch = writeBatch(db);
    for (const id of selectedIds) {
      batch.delete(doc(db, "groups", groupId, "notifications", id));
    }
    await batch.commit();
    setSelected({});
  }

  async function deleteAll() {
    if (!groupId) return;
    if (rows.length === 0) return;

    const ok = confirm(`Delete ALL notifications (${rows.length})?`);
    if (!ok) return;

    const batch = writeBatch(db);
    for (const n of rows) {
      batch.delete(doc(db, "groups", groupId, "notifications", n.id));
    }
    await batch.commit();
    setSelected({});
  }

  if (loading) return <div className="p-2 text-white">Loading...</div>;

  return (
    <div className="space-y-4 text-white">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Notifications</h2>
          <p className="text-sm text-gray-400">Unread: {unreadCount}</p>
          {rows.length > 0 ? (
            <p className="text-xs text-gray-500 mt-1">
              Tip: use checkboxes to delete selected.
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2 justify-end">
          <button
            onClick={markAllRead}
            className="text-sm border px-3 py-2 rounded bg-white text-black"
          >
            Mark all read
          </button>

          <button
            onClick={toggleSelectAll}
            disabled={rows.length === 0}
            className="text-sm border px-3 py-2 rounded"
            style={{ opacity: rows.length === 0 ? 0.5 : 1 }}
          >
            {allSelected ? "Clear selection" : "Select all"}
          </button>

          <button
            onClick={deleteSelected}
            disabled={selectedIds.length === 0}
            className="text-sm border px-3 py-2 rounded"
            style={{ opacity: selectedIds.length === 0 ? 0.5 : 1 }}
          >
            Delete selected
          </button>

          <button
            onClick={deleteAll}
            disabled={rows.length === 0}
            className="text-sm border px-3 py-2 rounded"
            style={{ opacity: rows.length === 0 ? 0.5 : 1 }}
          >
            Delete all
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-gray-400">No notifications yet.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((n) => {
            const isUnread = uid ? !(n.readBy ?? []).includes(uid) : false;
            const isChecked = !!selected[n.id];

            return (
              <div
                key={n.id}
                className="w-full border rounded-2xl p-4"
                style={{ opacity: isUnread ? 1 : 0.65 }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleOne(n.id)}
                      className="mt-1"
                    />

                    <button
                      onClick={() => markOneRead(n.id)}
                      className="text-left"
                      style={{ width: "100%" }}
                    >
                      <div className="flex items-center gap-2">
                        <div className="font-semibold">{n.title}</div>
                        {isUnread ? (
                          <span className="text-xs px-2 py-1 rounded border">
                            New
                          </span>
                        ) : null}
                      </div>
                      <div className="text-sm text-gray-300 mt-1">
                        {n.body}
                      </div>
                    </button>
                  </div>

                  <button
                    onClick={() => deleteOne(n.id)}
                    className="text-xs border px-2 py-1 rounded"
                    title="Delete"
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}