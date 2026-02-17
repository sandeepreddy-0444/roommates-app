"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signOut } from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  setDoc,
} from "firebase/firestore";
import { auth, db } from "@/app/lib/firebase";

import ExpensesPanel from "../../components/ExpensesPanel";
import GroceryPanel from "../../components/GroceryPanel";
import RoommatesPanel from "../../components/RoommatesPanel";

type Tab = "expenses" | "groceries" | "roommates";
type Roommate = { uid: string; name: string };

export default function DashboardPage() {
  const router = useRouter();

  const [tab, setTab] = useState<Tab>("expenses");
  const [authChecked, setAuthChecked] = useState(false);

  const [uid, setUid] = useState<string | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);

  const [createdBy, setCreatedBy] = useState<string | null>(null);
  const [myName, setMyName] = useState<string>("");

  const [roommates, setRoommates] = useState<Roommate[]>([]);

  const loading = useMemo(() => !authChecked, [authChecked]);

  // ✅ Auth + load user info + group creator
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        setAuthChecked(true);
        router.push("/login");
        return;
      }

      setUid(u.uid);

      const userSnap = await getDoc(doc(db, "users", u.uid));
      const userData = userSnap.exists() ? (userSnap.data() as any) : {};

      const gid = userData?.groupId || null;
      setGroupId(gid);

      setMyName(userData?.name || "");

      // ✅ load group creator
      if (gid) {
        const groupSnap = await getDoc(doc(db, "groups", gid));
        const groupData = groupSnap.exists() ? (groupSnap.data() as any) : {};
        setCreatedBy(groupData?.createdBy || null);
      }

      setAuthChecked(true);

      if (!gid) router.push("/room");
    });

    return () => unsub();
  }, [router]);

  // ✅ Listen to members and fetch each member's name from users/{uid}
  useEffect(() => {
    if (!groupId) return;

    const unsub = onSnapshot(
      collection(db, "groups", groupId, "members"),
      async (snap) => {
        const memberUids = snap.docs.map((d) => d.id);

        const userDocs = await Promise.all(
          memberUids.map((id) => getDoc(doc(db, "users", id)))
        );

        const results: Roommate[] = userDocs.map((docSnap, index) => {
          const id = memberUids[index];
          const data = docSnap.exists() ? (docSnap.data() as any) : {};
          return {
            uid: id,
            name: data?.name || id.slice(0, 6),
          };
        });

        // Put you first
        results.sort((a, b) => (a.uid === uid ? -1 : b.uid === uid ? 1 : 0));
        setRoommates(results);
      }
    );

    return () => unsub();
  }, [groupId, uid]);

  // ✅ Everyone can leave
  const leaveRoom = async () => {
    if (!uid || !groupId) return;

    const ok = confirm("Are you sure you want to leave this room?");
    if (!ok) return;

    await deleteDoc(doc(db, "groups", groupId, "members", uid));
    await setDoc(doc(db, "users", uid), { groupId: null }, { merge: true });

    router.push("/room");
  };

  // ✅ Only creator can remove others
  const removeRoommate = async (memberUid: string) => {
    if (!uid || !groupId) return;
    if (uid !== createdBy) return;
    if (memberUid === uid) return;

    const ok = confirm("Remove this roommate from the room?");
    if (!ok) return;

    await deleteDoc(doc(db, "groups", groupId, "members", memberUid));
    await setDoc(doc(db, "users", memberUid), { groupId: null }, { merge: true });
  };

  const logout = async () => {
    await signOut(auth);
    router.push("/login");
  };

  const copyRoomId = async () => {
    if (!groupId) return;
    try {
      await navigator.clipboard.writeText(groupId);
      alert("Room ID copied!");
    } catch {
      alert("Could not copy. Please copy manually.");
    }
  };

  if (loading) return <div style={{ padding: 16 }}>Loading...</div>;

  const isCreator = uid !== null && uid === createdBy;

  return (
    <div
      style={{
        minHeight: "100vh",
        padding: 16,
        background: "#0b0b0b",
        color: "white",
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 16,
          flexWrap: "wrap",
          alignItems: "flex-start",
        }}
      >
        {/* LEFT SIDEBAR */}
        <div
          style={{
            width: 260,
            maxWidth: "100%",
            border: "1px solid #2b2b2b",
            borderRadius: 14,
            padding: 12,
            height: "fit-content",
          }}
        >
          <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 12 }}>
            Dashboard
          </div>

          <SidebarButton
            label="Expenses"
            active={tab === "expenses"}
            onClick={() => setTab("expenses")}
          />
          <SidebarButton
            label="Grocery List"
            active={tab === "groceries"}
            onClick={() => setTab("groceries")}
          />
          <SidebarButton
            label="Roommates"
            active={tab === "roommates"}
            onClick={() => setTab("roommates")}
          />

          <button
            onClick={logout}
            style={{
              marginTop: 12,
              width: "100%",
              padding: 10,
              borderRadius: 12,
              border: "1px solid #2b2b2b",
              background: "transparent",
              color: "white",
              cursor: "pointer",
            }}
          >
            Logout
          </button>
        </div>

        {/* MAIN CONTENT */}
        <div
          style={{
            flex: 1,
            minWidth: 280,
            border: "1px solid #2b2b2b",
            borderRadius: 14,
            padding: 16,
            background: "#0f0f0f",
          }}
        >
          {tab === "expenses" && <ExpensesPanel />}
          {tab === "groceries" && <GroceryPanel />}

          {tab === "roommates" && (
            <div>
              {/* Header */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 12,
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>
                  Roommates
                </h2>

                <button
                  onClick={leaveRoom}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 10,
                    border: "1px solid #555",
                    background: "transparent",
                    color: "white",
                    cursor: "pointer",
                  }}
                >
                  Leave Room
                </button>
              </div>

              {/* ✅ ROOM ID DISPLAY (ONLY HERE) */}
              <div
                style={{
                  border: "1px solid #2b2b2b",
                  borderRadius: 12,
                  padding: 12,
                  background: "#111",
                  marginBottom: 12,
                }}
              >
                <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>
                  Room ID
                </div>

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    flexWrap: "wrap",
                  }}
                >
                  <code
                    style={{
                      padding: "6px 10px",
                      borderRadius: 10,
                      border: "1px solid #2b2b2b",
                      background: "#0b0b0b",
                      fontSize: 12,
                      wordBreak: "break-all",
                    }}
                  >
                    {groupId ?? "No room joined"}
                  </code>

                  {groupId && (
                    <button
                      onClick={copyRoomId}
                      style={{
                        padding: "8px 12px",
                        borderRadius: 10,
                        border: "1px solid #2b2b2b",
                        background: "transparent",
                        color: "white",
                        cursor: "pointer",
                      }}
                    >
                      Copy
                    </button>
                  )}
                </div>

                {/* ✅ Friendly helper text */}
                <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>
                  Share this Room ID with your roommates so they can join.
                </div>
              </div>

              <RoommatesPanel
                roommates={roommates.map((r) => ({
                  uid: r.uid,
                  name: r.uid === uid ? (myName || r.name) : r.name,
                }))}
                myUid={uid ?? ""}
                isCreator={isCreator}
                onRemove={removeRoommate}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SidebarButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        width: "100%",
        textAlign: "left",
        padding: 12,
        borderRadius: 12,
        border: "1px solid #2b2b2b",
        marginBottom: 10,
        background: active ? "#111" : "transparent",
        color: "white",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}
