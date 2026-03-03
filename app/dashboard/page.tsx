"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  onAuthStateChanged,
  signOut,
  sendPasswordResetEmail,
} from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { auth, db } from "@/app/lib/firebase";

import ExpensesPanel from "../../components/ExpensesPanel";
import GroceryPanel from "../../components/GroceryPanel";
import RoommatesPanel from "../../components/RoommatesPanel";
import NotificationsPanel from "../../components/NotificationsPanel";

type Tab =
  | "profile"
  | "expenses"
  | "groceries"
  | "roommates"
  | "notifications";

type Roommate = { uid: string; name: string };

export default function DashboardPage() {
  const router = useRouter();

  const [tab, setTab] = useState<Tab>("profile");
  const [authChecked, setAuthChecked] = useState(false);

  const [uid, setUid] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string>("");

  const [groupId, setGroupId] = useState<string | null>(null);
  const [createdBy, setCreatedBy] = useState<string | null>(null);

  const [roommates, setRoommates] = useState<Roommate[]>([]);

  const loading = useMemo(() => !authChecked, [authChecked]);

  // 🔐 Auth
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        setAuthChecked(true);
        router.push("/login");
        return;
      }

      setUid(u.uid);
      setEmail(u.email || null);
      setDisplayName(u.displayName || "");

      const userSnap = await getDoc(doc(db, "users", u.uid));
      const userData = userSnap.exists() ? (userSnap.data() as any) : {};
      const gid = userData?.groupId || null;

      setGroupId(gid);

      if (!gid) {
        setAuthChecked(true);
        router.push("/room");
        return;
      }

      const groupSnap = await getDoc(doc(db, "groups", gid));
      const groupData = groupSnap.exists() ? (groupSnap.data() as any) : {};
      setCreatedBy(groupData?.createdBy || null);

      setAuthChecked(true);
    });

    return () => unsub();
  }, [router]);

  // 👥 Load roommates
  useEffect(() => {
    if (!groupId) return;

    const unsub = onSnapshot(
      collection(db, "groups", groupId, "members"),
      async (snap) => {
        const ids = snap.docs.map((d) => d.id);

        const userDocs = await Promise.all(
          ids.map((id) => getDoc(doc(db, "users", id)))
        );

        const list: Roommate[] = userDocs.map((docSnap, i) => {
          const id = ids[i];
          const data = docSnap.exists() ? (docSnap.data() as any) : {};
          return {
            uid: id,
            name: data?.name || id.slice(0, 6),
          };
        });

        list.sort((a, b) =>
          a.uid === uid ? -1 : b.uid === uid ? 1 : 0
        );

        setRoommates(list);
      }
    );

    return () => unsub();
  }, [groupId, uid]);

  // 🧹 Remove Member
  const removeMember = async (memberUid: string) => {
    if (!groupId || !uid) return;
    if (uid !== createdBy) return alert("Only admin can remove members.");

    const ok = confirm("Remove this roommate?");
    if (!ok) return;

    await deleteDoc(doc(db, "groups", groupId, "members", memberUid));
    await setDoc(
      doc(db, "users", memberUid),
      { groupId: null },
      { merge: true }
    );

    alert("Roommate removed ✅");
  };

  // 🔁 Transfer Admin
  const transferAdmin = async (newAdminUid: string) => {
    if (!groupId || !uid) return;
    if (uid !== createdBy) return alert("Only admin can transfer admin.");

    const ok = confirm("Transfer admin?");
    if (!ok) return;

    await updateDoc(doc(db, "groups", groupId), {
      createdBy: newAdminUid,
    });
    setCreatedBy(newAdminUid);

    alert("Admin transferred ✅");
  };

  // 🚪 Leave Room
  const leaveRoom = async () => {
    if (!groupId || !uid) return;

    const others = roommates.filter((r) => r.uid !== uid);

    if (uid === createdBy && others.length > 0) {
      alert("Transfer admin before leaving.");
      return;
    }

    const ok = confirm("Leave this room?");
    if (!ok) return;

    await deleteDoc(doc(db, "groups", groupId, "members", uid));
    await setDoc(doc(db, "users", uid), { groupId: null }, { merge: true });

    router.push("/room");
  };

  const logout = async () => {
    await signOut(auth);
    router.push("/login");
  };

  const changePassword = async () => {
    if (!email) return;
    await sendPasswordResetEmail(auth, email);
    alert("Password reset email sent ✅");
  };

  if (loading) return <div style={{ padding: 16 }}>Loading...</div>;

  return (
    <div
      style={{
        minHeight: "100vh",
        padding: 16,
        background: "#0b0b0b",
        color: "white",
      }}
    >
      <div style={{ display: "flex", gap: 16 }}>
        {/* Sidebar */}
        <div
          style={{
            width: 260,
            border: "1px solid #2b2b2b",
            borderRadius: 14,
            padding: 12,
          }}
        >
          <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 12 }}>
            Dashboard
          </div>

          <button onClick={() => setTab("profile")} style={{ marginBottom: 10, width: "100%" }}>
            Profile
          </button>

          <button onClick={() => setTab("expenses")} style={{ marginBottom: 10, width: "100%" }}>
            Expenses
          </button>

          <button onClick={() => setTab("groceries")} style={{ marginBottom: 10, width: "100%" }}>
            Grocery
          </button>

          <button onClick={() => setTab("roommates")} style={{ marginBottom: 10, width: "100%" }}>
            Roommates
          </button>

          <button onClick={() => setTab("notifications")} style={{ marginBottom: 10, width: "100%" }}>
            Notifications
          </button>
        </div>

        {/* Main */}
        <div
          style={{
            flex: 1,
            border: "1px solid #2b2b2b",
            borderRadius: 14,
            padding: 16,
          }}
        >
          {tab === "profile" && (
            <div style={{ display: "grid", gap: 20 }}>
              {/* Profile Info */}
              <div
                style={{
                  border: "1px solid #333",
                  borderRadius: 12,
                  padding: 16,
                  background: "#111",
                }}
              >
                <h2 style={{ marginBottom: 10 }}>Profile</h2>
                <p><strong>Name:</strong> {displayName || "Not set"}</p>
                <p><strong>Email:</strong> {email}</p>

                <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
                  <button onClick={changePassword}>
                    Change Password
                  </button>
                  <button onClick={logout}>
                    Logout
                  </button>
                </div>
              </div>

              {/* Roommates + Room Info */}
              <RoommatesPanel
                groupId={groupId ?? ""}
                roommates={roommates}
                myUid={uid ?? ""}
                isCreator={uid === createdBy}
                createdByUid={createdBy}
                onRemove={removeMember}
                onTransferAdmin={transferAdmin}
                onLeave={leaveRoom}
              />
            </div>
          )}

          {tab === "expenses" && <ExpensesPanel />}
          {tab === "groceries" && <GroceryPanel />}
          {tab === "roommates" && (
            <RoommatesPanel
              groupId={groupId ?? ""}
              roommates={roommates}
              myUid={uid ?? ""}
              isCreator={uid === createdBy}
              createdByUid={createdBy}
              onRemove={removeMember}
              onTransferAdmin={transferAdmin}
              onLeave={leaveRoom}
            />
          )}
          {tab === "notifications" && <NotificationsPanel />}
        </div>
      </div>
    </div>
  );
}