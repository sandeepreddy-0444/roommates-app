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
  where,
  query,
  orderBy,
  updateDoc,
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

      const userSnap = await getDoc(doc(db, "users", u.uid));
      const userData = userSnap.exists() ? (userSnap.data() as any) : {};
      const gid = userData?.groupId || null;

      setGroupId(gid);

      if (!gid) {
        router.push("/room");
      } else {
        const groupSnap = await getDoc(doc(db, "groups", gid));
        const groupData = groupSnap.exists() ? (groupSnap.data() as any) : {};
        setCreatedBy(groupData?.createdBy || null);
      }

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

        setRoommates(list);
      }
    );

    return () => unsub();
  }, [groupId]);

  // 🧹 Remove Member
  const removeMember = async (memberUid: string) => {
    if (!groupId || !uid) return;
    if (uid !== createdBy) return alert("Only admin can remove members.");

    const ok = confirm("Remove this roommate?");
    if (!ok) return;

    await deleteDoc(doc(db, "groups", groupId, "members", memberUid));
    await setDoc(doc(db, "users", memberUid), { groupId: null }, { merge: true });

    alert("Roommate removed ✅");
  };

  // 🔁 Transfer Admin
  const transferAdmin = async (newAdminUid: string) => {
    if (!groupId || !uid) return;
    if (uid !== createdBy) return alert("Only admin can transfer admin.");

    const ok = confirm("Transfer admin to this roommate?");
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

  if (loading) return <div style={{ padding: 16 }}>Loading...</div>;

  return (
    <div style={{ minHeight: "100vh", padding: 16, background: "#0b0b0b", color: "white" }}>
      <div style={{ display: "flex", gap: 16 }}>
        {/* Sidebar */}
        <div style={{ width: 260, border: "1px solid #2b2b2b", borderRadius: 14, padding: 12 }}>
          <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 12 }}>
            Dashboard
          </div>

          <button onClick={() => setTab("expenses")} style={{ marginBottom: 10, width: "100%" }}>Expenses</button>
          <button onClick={() => setTab("groceries")} style={{ marginBottom: 10, width: "100%" }}>Grocery</button>
          <button onClick={() => setTab("roommates")} style={{ marginBottom: 10, width: "100%" }}>Roommates</button>

          <button onClick={logout} style={{ marginTop: 12, width: "100%" }}>
            Logout
          </button>
        </div>

        {/* Main */}
        <div style={{ flex: 1, border: "1px solid #2b2b2b", borderRadius: 14, padding: 16 }}>
          {tab === "expenses" && <ExpensesPanel />}
          {tab === "groceries" && <GroceryPanel />}
          {tab === "roommates" && (
            <RoommatesPanel
              roommates={roommates}
              myUid={uid ?? ""}
              isCreator={uid === createdBy}
              createdByUid={createdBy}
              onRemove={removeMember}
              onTransferAdmin={transferAdmin}
              onLeave={leaveRoom}
            />
          )}
        </div>
      </div>
    </div>
  );
}