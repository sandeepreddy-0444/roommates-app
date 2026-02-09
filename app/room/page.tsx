"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { useRouter } from "next/navigation";
import { auth, db } from "@/app/lib/firebase";

export default function RoomPage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [roomCode, setRoomCode] = useState("");
  const [createdRoomId, setCreatedRoomId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) return router.push("/login");
      setUserId(u.uid);

      const userDoc = await getDoc(doc(db, "users", u.uid));
      const gid = userDoc.exists() ? userDoc.data().groupId : null;

      // If already in a room, show ID (do NOT redirect)
      if (gid) setCreatedRoomId(gid);
    });

    return () => unsub();
  }, [router]);

  async function createRoom() {
    if (!userId) return;
    setLoading(true);
    setMsg(null);
    try {
      const ref = await addDoc(collection(db, "groups"), {
        createdAt: serverTimestamp(),
        createdBy: userId,
      });

      await setDoc(doc(db, "groups", ref.id, "members", userId), {
        role: "member",
        joinedAt: serverTimestamp(),
      });

      await setDoc(doc(db, "users", userId), { groupId: ref.id }, { merge: true });

      setCreatedRoomId(ref.id);
      setMsg("Room created! Share this Room ID with your roommates.");

      // ✅ go to dashboard after room created
      router.push("/dashboard");
    } catch (e: any) {
      setMsg(e?.message ?? "Failed to create room");
    } finally {
      setLoading(false);
    }
  }

  async function joinRoom() {
    if (!userId) return;
    const gid = roomCode.trim();
    if (!gid) return setMsg("Enter a room ID");

    setLoading(true);
    setMsg(null);
    try {
      const g = await getDoc(doc(db, "groups", gid));
      if (!g.exists()) return setMsg("Room not found. Check the ID.");

      await setDoc(doc(db, "groups", gid, "members", userId), {
        role: "member",
        joinedAt: serverTimestamp(),
      });

      await setDoc(doc(db, "users", userId), { groupId: gid }, { merge: true });

      // ✅ go to dashboard after joining
      router.push("/dashboard");
    } catch (e: any) {
      setMsg(e?.message ?? "Failed to join room");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border p-6">
        <h1 className="text-2xl font-semibold">Room</h1>

        {createdRoomId ? (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-gray-600">
              ✅ You are in a room. Share this Room ID with your roommates:
            </p>

            <div className="rounded-xl border p-3 font-mono text-sm break-all">
              {createdRoomId}
            </div>

            <button
              onClick={() => navigator.clipboard.writeText(createdRoomId)}
              className="w-full rounded-xl border p-3"
            >
              Copy Room ID
            </button>

            <button
              onClick={() => router.push("/dashboard")}
              className="w-full rounded-xl bg-black text-white p-3"
            >
              Go to Dashboard
            </button>
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            <button
              disabled={loading}
              onClick={createRoom}
              className="w-full rounded-xl bg-black text-white p-3 disabled:opacity-60"
            >
              {loading ? "Working..." : "Create Room"}
            </button>

            <div className="border-t pt-4">
              <input
                className="w-full rounded-xl border p-3"
                placeholder="Enter Room ID to join"
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value)}
              />
              <button
                disabled={loading}
                onClick={joinRoom}
                className="w-full mt-3 rounded-xl border p-3 disabled:opacity-60"
              >
                Join Room
              </button>
            </div>
          </div>
        )}

        {msg && <p className="text-sm mt-4">{msg}</p>}
      </div>
    </main>
  );
}
