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
  deleteDoc,
  onSnapshot,
} from "firebase/firestore";
import { useRouter } from "next/navigation";
import { auth, db } from "@/app/lib/firebase";

export default function RoomPage() {
  const router = useRouter();

  const [authChecked, setAuthChecked] = useState(false);

  const [uid, setUid] = useState<string | null>(null);
  const [roomId, setRoomId] = useState("");
  const [createdRoomId, setCreatedRoomId] = useState<string | null>(null);
  const [members, setMembers] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // ✅ Auth check + load existing groupId
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        setAuthChecked(true);
        router.push("/login");
        return;
      }

      setUid(u.uid);

      const userDoc = await getDoc(doc(db, "users", u.uid));
      const gid = userDoc.exists() ? (userDoc.data() as any).groupId : null;

      if (gid) setCreatedRoomId(gid);

      setAuthChecked(true);
    });

    return () => unsub();
  }, [router]);

  // ✅ Load members list if in a room
  useEffect(() => {
    if (!createdRoomId) return;

    const unsub = onSnapshot(
      collection(db, "groups", createdRoomId, "members"),
      (snap) => {
        setMembers(snap.docs.map((d) => d.id));
      }
    );

    return () => unsub();
  }, [createdRoomId]);

  async function createRoom() {
    if (!uid) return;
    setLoading(true);
    setMsg(null);

    try {
      const ref = await addDoc(collection(db, "groups"), {
        createdAt: serverTimestamp(),
        createdBy: uid,
      });

      await setDoc(doc(db, "groups", ref.id, "members", uid), {
        role: "member",
        joinedAt: serverTimestamp(),
      });

      await setDoc(doc(db, "users", uid), { groupId: ref.id }, { merge: true });

      setCreatedRoomId(ref.id);
      setMsg("Room created ✅ Share this Room ID with your roommates.");
    } catch (e: any) {
      setMsg(e?.message ?? "Failed to create room");
    } finally {
      setLoading(false);
    }
  }

  async function joinRoom() {
    if (!uid) return;
    const gid = roomId.trim();
    if (!gid) return setMsg("Enter Room ID");

    setLoading(true);
    setMsg(null);

    try {
      const g = await getDoc(doc(db, "groups", gid));
      if (!g.exists()) return setMsg("Room not found. Check the ID.");

      await setDoc(doc(db, "groups", gid, "members", uid), {
        role: "member",
        joinedAt: serverTimestamp(),
      });

      await setDoc(doc(db, "users", uid), { groupId: gid }, { merge: true });

      setCreatedRoomId(gid);
      setMsg("Joined room ✅");
    } catch (e: any) {
      setMsg(e?.message ?? "Failed to join room");
    } finally {
      setLoading(false);
    }
  }

  // ✅ REMOVE ROOMMATE (simple). Prevent removing yourself.
  async function removeRoommate(memberUid: string) {
    if (!createdRoomId || !uid) return;
    if (memberUid === uid) return;

    const ok = confirm("Remove this roommate from the room?");
    if (!ok) return;

    try {
      await deleteDoc(doc(db, "groups", createdRoomId, "members", memberUid));
      alert("Roommate removed ✅");
    } catch {
      alert("Failed to remove roommate");
    }
  }

  // ✅ LEAVE ROOM (removes you + clears your groupId)
  async function leaveRoom() {
    if (!createdRoomId || !uid) return;

    const ok = confirm("Are you sure you want to leave this room?");
    if (!ok) return;

    try {
      await deleteDoc(doc(db, "groups", createdRoomId, "members", uid));
      await setDoc(doc(db, "users", uid), { groupId: null }, { merge: true });

      setCreatedRoomId(null);
      setMembers([]);
      setRoomId("");
      setMsg("You left the room ✅");

      // Optional: send them to login or dashboard after leaving
      // router.push("/login");
    } catch {
      alert("Failed to leave room");
    }
  }

  // ✅ IMPORTANT: don’t render room page until auth check finishes
  if (!authChecked) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border p-6 space-y-4">
        <h1 className="text-2xl font-semibold">Room</h1>

        {!createdRoomId ? (
          <>
            <button
              disabled={loading}
              onClick={createRoom}
              className="w-full rounded-xl bg-black text-white p-3 disabled:opacity-60"
            >
              {loading ? "Working..." : "Create Room"}
            </button>

            <div className="border-t pt-4 space-y-3">
              <input
                className="w-full rounded-xl border p-3"
                placeholder="Room ID"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
              />
              <button
                disabled={loading}
                onClick={joinRoom}
                className="w-full rounded-xl border p-3 disabled:opacity-60"
              >
                Join Room
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-gray-600">Room ID:</p>
            <div className="border p-3 rounded font-mono text-sm break-all">
              {createdRoomId}
            </div>

            <button
              onClick={() => navigator.clipboard.writeText(createdRoomId)}
              className="w-full rounded-xl border p-3"
            >
              Copy Room ID
            </button>

            <h2 className="font-semibold mt-2">Roommates</h2>

            {members.length === 0 ? (
              <p className="text-sm text-gray-600">No roommates found.</p>
            ) : (
              members.map((m) => (
                <div
                  key={m}
                  className="flex justify-between items-center border rounded p-2"
                >
                  <span className="text-sm font-mono break-all">
                    {m === uid ? `${m} (You)` : m}
                  </span>

                  {m !== uid && (
                    <button
                      onClick={() => removeRoommate(m)}
                      className="text-red-600 text-sm"
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))
            )}

            <button
              onClick={() => router.push("/dashboard")}
              className="w-full mt-4 rounded-xl bg-black text-white p-3"
            >
              Go to Dashboard
            </button>

            <button
              onClick={leaveRoom}
              className="w-full rounded-xl border border-red-500 text-red-600 p-3"
            >
              Leave Room
            </button>
          </>
        )}

        {msg && <p className="text-sm text-red-600">{msg}</p>}
      </div>
    </main>
  );
}
