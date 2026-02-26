"use client";

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  arrayUnion,
  collection,
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
    });

    return () => unsub();
  }, [notifsCol]);

  const unreadCount = useMemo(() => {
    if (!uid) return 0;
    return rows.filter((n) => !(n.readBy ?? []).includes(uid)).length;
  }, [rows, uid]);

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

  if (loading) return <div className="p-2 text-white">Loading...</div>;

  return (
    <div className="space-y-4 text-white">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Notifications</h2>
          <p className="text-sm text-gray-400">
            Unread: {unreadCount}
          </p>
        </div>

        <button
          onClick={markAllRead}
          className="text-sm border px-3 py-2 rounded bg-white text-black"
        >
          Mark all read
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="text-gray-400">No notifications yet.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((n) => {
            const isUnread = uid ? !(n.readBy ?? []).includes(uid) : false;
            return (
              <button
                key={n.id}
                onClick={() => markOneRead(n.id)}
                className="w-full text-left border rounded-2xl p-4 hover:opacity-90"
                style={{ opacity: isUnread ? 1 : 0.65 }}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="font-semibold">{n.title}</div>
                  {isUnread ? (
                    <span className="text-xs px-2 py-1 rounded border">
                      New
                    </span>
                  ) : null}
                </div>
                <div className="text-sm text-gray-300 mt-1">{n.body}</div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}