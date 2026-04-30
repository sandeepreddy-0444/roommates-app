"use client";

import { useEffect, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { useRouter } from "next/navigation";
import { auth, db } from "@/app/lib/firebase";
import { confirmDestructive } from "@/lib/confirmAction";

export default function RoomPage() {
  const router = useRouter();

  const [authChecked, setAuthChecked] = useState(false);

  const [uid, setUid] = useState<string | null>(null);
  const [roomId, setRoomId] = useState("");
  const [createdRoomId, setCreatedRoomId] = useState<string | null>(null);
  const [members, setMembers] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [pendingJoinGroupId, setPendingJoinGroupId] = useState<string | null>(null);
  const [joinRequestNote, setJoinRequestNote] = useState<string | null>(null);
  const prevUserStateRef = useRef<{ gid: string | null; pending: string | null } | null>(null);

  // Auth check + load groupId / pending join
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        setAuthChecked(true);
        router.push("/login");
        return;
      }

      setUid(u.uid);

      const userDoc = await getDoc(doc(db, "users", u.uid));
      const data = userDoc.exists() ? (userDoc.data() as Record<string, unknown>) : {};
      const gid = typeof data.groupId === "string" ? data.groupId : null;
      const pending =
        typeof data.pendingJoinGroupId === "string" ? data.pendingJoinGroupId : null;
      const note = typeof data.joinRequestNote === "string" ? data.joinRequestNote : null;

      if (gid) {
        setCreatedRoomId(gid);
        setPendingJoinGroupId(null);
      } else {
        setCreatedRoomId(null);
        setPendingJoinGroupId(pending);
      }
      setJoinRequestNote(note);

      setAuthChecked(true);
    });

    return () => unsub();
  }, [router]);

  // Live user doc: approval, rejection note, or group assignment
  useEffect(() => {
    if (!uid) return;

    const unsub = onSnapshot(doc(db, "users", uid), (snap) => {
      if (!snap.exists()) return;
      const data = snap.data() as Record<string, unknown>;
      const gid = typeof data.groupId === "string" ? data.groupId : null;
      const pending =
        typeof data.pendingJoinGroupId === "string" ? data.pendingJoinGroupId : null;
      const note = typeof data.joinRequestNote === "string" ? data.joinRequestNote : null;

      setJoinRequestNote(note);

      if (gid) {
        setCreatedRoomId(gid);
        setPendingJoinGroupId(null);
        const prev = prevUserStateRef.current;
        prevUserStateRef.current = { gid, pending };
        // Only auto-send to the app when a pending join was just approved (not room create / refresh).
        if (prev?.pending && !prev.gid) {
          router.replace("/dashboard");
        }
        return;
      }

      setCreatedRoomId(null);
      setPendingJoinGroupId(pending);
      prevUserStateRef.current = { gid, pending };
    });

    return () => unsub();
  }, [uid, router]);

  // Load members list if in a room
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

      await setDoc(
        doc(db, "users", uid),
        {
          groupId: ref.id,
          pendingJoinGroupId: deleteField(),
          joinRequestNote: deleteField(),
        },
        { merge: true }
      );

      setCreatedRoomId(ref.id);
      setPendingJoinGroupId(null);
      setMsg("Room created ✅ Share this Room ID with your roommates.");
    } catch (e: unknown) {
      const err = e as { message?: string };
      setMsg(err?.message ?? "Failed to create room");
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

      const userSnap = await getDoc(doc(db, "users", uid));
      const udata = userSnap.exists() ? (userSnap.data() as Record<string, unknown>) : {};
      const existingGid = typeof udata.groupId === "string" ? udata.groupId : null;
      const existingPending =
        typeof udata.pendingJoinGroupId === "string" ? udata.pendingJoinGroupId : null;

      if (existingGid && existingGid === gid) {
        const memSnap = await getDoc(doc(db, "groups", gid, "members", uid));
        if (memSnap.exists()) {
          setCreatedRoomId(gid);
          setMsg("You are already in this room ✅");
          return;
        }
      }

      if (existingGid && existingGid !== gid) {
        return setMsg("Leave your current room before joining another.");
      }

      if (existingPending && existingPending !== gid) {
        return setMsg("You already have a pending request for another room. Cancel it first.");
      }

      if (existingPending === gid) {
        return setMsg("You already requested to join this room. Wait for the admin to approve.");
      }

      const memSnap = await getDoc(doc(db, "groups", gid, "members", uid));
      if (memSnap.exists()) {
        await setDoc(
          doc(db, "users", uid),
          {
            groupId: gid,
            pendingJoinGroupId: deleteField(),
            joinRequestNote: deleteField(),
          },
          { merge: true }
        );
        setCreatedRoomId(gid);
        setMsg("You are already a member — syncing your account ✅");
        return;
      }

      const user = auth.currentUser;
      const displayName =
        (typeof udata.name === "string" && udata.name.trim()) ||
        user?.displayName ||
        user?.email?.split("@")[0] ||
        "Someone";

      await setDoc(doc(db, "groups", gid, "joinRequests", uid), {
        displayName,
        email: user?.email ?? null,
        requestedAt: serverTimestamp(),
      });

      await setDoc(
        doc(db, "users", uid),
        {
          pendingJoinGroupId: gid,
          joinRequestNote: deleteField(),
        },
        { merge: true }
      );

      setPendingJoinGroupId(gid);
      setRoomId("");
      setMsg("Request sent ✅ Waiting for admin approval. You cannot access this room until approved.");
    } catch (e: unknown) {
      const err = e as { message?: string };
      setMsg(err?.message ?? "Failed to request join");
    } finally {
      setLoading(false);
    }
  }

  async function cancelPendingJoin() {
    if (!uid || !pendingJoinGroupId) return;
    if (
      !confirmDestructive(
        "Cancel your pending join request?\n\nYou can send a new request later with the room ID."
      )
    ) {
      return;
    }
    setLoading(true);
    setMsg(null);
    try {
      await deleteDoc(doc(db, "groups", pendingJoinGroupId, "joinRequests", uid));
      await setDoc(
        doc(db, "users", uid),
        {
          pendingJoinGroupId: deleteField(),
          joinRequestNote: deleteField(),
        },
        { merge: true }
      );
      setPendingJoinGroupId(null);
      setMsg("Join request cancelled.");
    } catch (e: unknown) {
      const err = e as { message?: string };
      setMsg(err?.message ?? "Could not cancel request");
    } finally {
      setLoading(false);
    }
  }

  async function dismissJoinNote() {
    if (!uid) return;
    try {
      await updateDoc(doc(db, "users", uid), {
        joinRequestNote: deleteField(),
      });
      setJoinRequestNote(null);
    } catch {
      setJoinRequestNote(null);
    }
  }

  async function removeRoommate(memberUid: string) {
    if (!createdRoomId || !uid) return;
    if (memberUid === uid) return;

    if (
      !confirmDestructive(
        `Are you sure you want to remove this member (${memberUid.slice(0, 8)}…)?\n\nThey will immediately lose access to the room.`
      )
    ) {
      return;
    }

    try {
      await deleteDoc(doc(db, "groups", createdRoomId, "members", memberUid));
      alert("Roommate removed ✅");
    } catch {
      alert("Failed to remove roommate");
    }
  }

  async function leaveRoom() {
    if (!createdRoomId || !uid) return;

    if (
      !confirmDestructive(
        "Are you sure you want to leave this room?\n\nYou will lose access to shared data for this group until you join again."
      )
    ) {
      return;
    }

    try {
      await deleteDoc(doc(db, "groups", createdRoomId, "members", uid));
      await setDoc(
        doc(db, "users", uid),
        {
          groupId: null,
          pendingJoinGroupId: deleteField(),
          joinRequestNote: deleteField(),
        },
        { merge: true }
      );

      setCreatedRoomId(null);
      setMembers([]);
      setRoomId("");
      setMsg("You left the room ✅");
    } catch {
      alert("Failed to leave room");
    }
  }

  if (!authChecked) {
    return (
      <div className="safe-area min-h-dvh flex items-center justify-center px-6 text-slate-600">
        Loading…
      </div>
    );
  }

  return (
    <main className="safe-area min-h-dvh flex items-center justify-center px-6 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] text-slate-900">
      <div className="w-full max-w-md rounded-[var(--app-radius-sheet)] border border-[var(--app-border-subtle)] bg-[var(--app-surface-elevated)] backdrop-blur-xl p-6 space-y-4 shadow-[var(--app-shadow-sheet)]">
        <h1 className="text-2xl font-semibold">Room</h1>

        {joinRequestNote ? (
          <div className="rounded-xl border border-amber-200/80 bg-amber-50/90 p-3 text-sm text-amber-950 space-y-2">
            <p>{joinRequestNote}</p>
            <button
              type="button"
              onClick={dismissJoinNote}
              className="text-sm font-semibold text-amber-900 underline"
            >
              Dismiss
            </button>
          </div>
        ) : null}

        {!createdRoomId && pendingJoinGroupId ? (
          <div className="rounded-xl border border-blue-200/80 bg-blue-50/90 p-4 space-y-3 text-sm text-slate-800">
            <div className="inline-flex items-center rounded-full border border-blue-300/80 bg-white/80 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-blue-700">
              Pending approval
            </div>
            <p className="font-semibold">Request sent. Waiting for admin approval.</p>
            <p>
              Your request to join room{" "}
              <span className="font-mono break-all">{pendingJoinGroupId}</span> is pending. The room
              admin can accept or reject it from the app (Roommates). You will get access only after
              approval.
            </p>
            <button
              type="button"
              disabled={loading}
              onClick={cancelPendingJoin}
              className="w-full rounded-xl border border-slate-300/80 bg-white/80 p-3 text-slate-900 disabled:opacity-60"
            >
              {loading ? "Working…" : "Cancel request"}
            </button>
          </div>
        ) : null}

        {!createdRoomId && !pendingJoinGroupId ? (
          <>
            <button
              disabled={loading}
              onClick={createRoom}
              className="w-full rounded-xl bg-slate-900 text-white p-3 disabled:opacity-60"
            >
              {loading ? "Working..." : "Create Room"}
            </button>

            <div className="border-t pt-4 space-y-3">
              <p className="text-xs text-slate-500">
                Joining with a Room ID sends a request to the room admin. You will only get access
                after they approve.
              </p>
              <input
                className="w-full rounded-xl border border-slate-300/80 bg-white/80 p-3 text-slate-900"
                placeholder="Room ID"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
              />
              <button
                disabled={loading}
                onClick={joinRoom}
                className="w-full rounded-xl border border-slate-300/80 bg-white/60 p-3 text-slate-900 disabled:opacity-60"
              >
                Request to join room
              </button>
            </div>
          </>
        ) : null}

        {createdRoomId ? (
          <>
            <p className="text-sm text-gray-600">Room ID:</p>
            <div className="border border-slate-300/60 bg-slate-50/80 p-3 rounded font-mono text-sm break-all">
              {createdRoomId}
            </div>

            <button
              onClick={() => navigator.clipboard.writeText(createdRoomId)}
              className="w-full rounded-xl border border-slate-300/80 bg-white/70 p-3 text-slate-900"
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
              className="w-full mt-4 rounded-xl bg-slate-900 text-white p-3"
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
        ) : null}

        {msg && <p className="text-sm text-slate-700">{msg}</p>}
      </div>
    </main>
  );
}
