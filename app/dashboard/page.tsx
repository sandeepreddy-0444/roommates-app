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
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { auth, db } from "@/app/lib/firebase";

import ExpensesPanel from "../../components/ExpensesPanel";
import GroceryPanel from "../../components/GroceryPanel";
import RoommatesPanel from "../../components/RoommatesPanel";
import NotificationsPanel from "../../components/NotificationsPanel";
import RemindersPanel from "../../components/RemindersPanel"; // ✅ NEW

type Tab =
  | "profile"
  | "thisMonth"
  | "expenses"
  | "groceries"
  | "roommates"
  | "notifications"
  | "reminders"; // ✅ NEW

type Roommate = { uid: string; name: string };
type MonthKey = { year: number; month: number }; // month: 0-11

export default function DashboardPage() {
  const router = useRouter();

  const [tab, setTab] = useState<Tab>("profile");
  const [authChecked, setAuthChecked] = useState(false);

  const [uid, setUid] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [authDisplayName, setAuthDisplayName] = useState<string>("");

  const [groupId, setGroupId] = useState<string | null>(null);
  const [createdBy, setCreatedBy] = useState<string | null>(null);

  const [roommates, setRoommates] = useState<Roommate[]>([]);

  // Month selector
  const baseNow = useMemo(() => new Date(), []);
  const [selectedMonth, setSelectedMonth] = useState<MonthKey>({
    year: baseNow.getFullYear(),
    month: baseNow.getMonth(),
  });

  // Monthly stats
  const [monthTotal, setMonthTotal] = useState<number>(0);
  const [monthCount, setMonthCount] = useState<number>(0);
  const [youPaid, setYouPaid] = useState<number>(0);
  const [youOwe, setYouOwe] = useState<number>(0);
  const [net, setNet] = useState<number>(0);

  // Bell badge
  const [unreadNotifs, setUnreadNotifs] = useState<number>(0);

  const loading = useMemo(() => !authChecked, [authChecked]);

  const myName = useMemo(() => {
    const fromRoommates =
      uid ? roommates.find((r) => r.uid === uid)?.name : undefined;
    return (fromRoommates || authDisplayName || "").trim();
  }, [uid, roommates, authDisplayName]);

  const initials = useMemo(() => {
    const base = myName || email || "U";
    return getInitials(base);
  }, [myName, email]);

  const monthOptions = useMemo(() => {
    const out: MonthKey[] = [];
    const d0 = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(d0.getFullYear(), d0.getMonth() - i, 1);
      out.push({ year: d.getFullYear(), month: d.getMonth() });
    }
    return out;
  }, []);

  // Auth
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        setAuthChecked(true);
        router.push("/login");
        return;
      }

      setUid(u.uid);
      setEmail(u.email || null);
      setAuthDisplayName(u.displayName || "");

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

  // Roommates list
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
          return { uid: id, name: data?.name || id.slice(0, 6) };
        });

        list.sort((a, b) => (a.uid === uid ? -1 : b.uid === uid ? 1 : 0));
        setRoommates(list);
      }
    );

    return () => unsub();
  }, [groupId, uid]);

  // Monthly stats for selected month
  useEffect(() => {
    if (!groupId || !uid) return;

    const expensesCol = collection(db, "groups", groupId, "expenses");
    const q = query(expensesCol, orderBy("createdAt", "desc"), limit(500));

    const start = new Date(selectedMonth.year, selectedMonth.month, 1);
    const end = new Date(selectedMonth.year, selectedMonth.month + 1, 1);

    const unsub = onSnapshot(
      q,
      (snap) => {
        let total = 0;
        let count = 0;
        let paid = 0;
        let owe = 0;

        for (const d of snap.docs) {
          const data = d.data() as any;

          const ts = data?.createdAt;
          const dt: Date | null =
            ts?.toDate ? ts.toDate() : ts instanceof Date ? ts : null;
          if (!dt) continue;

          if (dt < start || dt >= end) continue;

          const amt = Number(data?.amount);
          if (!Number.isFinite(amt)) continue;

          total += amt;
          count += 1;

          const payer =
            data?.paidByUid ??
            data?.paidBy ??
            data?.createdByUid ??
            data?.createdBy ??
            null;

          if (payer && String(payer) === uid) paid += amt;

          owe += estimateOwedForUser(data, uid, amt);
        }

        setMonthTotal(total);
        setMonthCount(count);
        setYouPaid(paid);
        setYouOwe(owe);
        setNet(paid - owe);
      },
      () => {
        setMonthTotal(0);
        setMonthCount(0);
        setYouPaid(0);
        setYouOwe(0);
        setNet(0);
      }
    );

    return () => unsub();
  }, [groupId, uid, selectedMonth.year, selectedMonth.month]);

  // Bell unread
  useEffect(() => {
    if (!groupId || !uid) return;

    const notifsCol = collection(db, "groups", groupId, "notifications");
    const q = query(notifsCol, orderBy("createdAt", "desc"), limit(50));

    const unsub = onSnapshot(q, (snap) => {
      let unread = 0;
      for (const d of snap.docs) {
        const data = d.data() as any;
        const readBy = Array.isArray(data?.readBy) ? data.readBy : [];
        if (!readBy.includes(uid)) unread += 1;
      }
      setUnreadNotifs(unread);
    });

    return () => unsub();
  }, [groupId, uid]);

  // Remove member
  const removeMember = async (memberUid: string) => {
    if (!groupId || !uid) return;
    if (uid !== createdBy) return alert("Only admin can remove members.");

    const ok = confirm("Remove this roommate?");
    if (!ok) return;

    await deleteDoc(doc(db, "groups", groupId, "members", memberUid));
    await setDoc(doc(db, "users", memberUid), { groupId: null }, { merge: true });
    alert("Roommate removed ✅");
  };

  // Transfer admin
  const transferAdmin = async (newAdminUid: string) => {
    if (!groupId || !uid) return;
    if (uid !== createdBy) return alert("Only admin can transfer admin.");

    const ok = confirm("Transfer admin?");
    if (!ok) return;

    await updateDoc(doc(db, "groups", groupId), { createdBy: newAdminUid });
    setCreatedBy(newAdminUid);
    alert("Admin transferred ✅");
  };

  // Leave room
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
    if (!email) return alert("No email found for this account.");
    try {
      await sendPasswordResetEmail(auth, email, {
        url: "https://roommates-app.vercel.app/reset-password",
        handleCodeInApp: true,
      });
      alert("Password reset email sent ✅ (check spam too)");
    } catch (error: any) {
      alert("Error: " + (error?.message || "Failed to send reset email"));
    }
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

          <button onClick={() => setTab("profile")} style={{ marginBottom: 10, width: "100%" }}>
            Profile
          </button>

          <button onClick={() => setTab("thisMonth")} style={{ marginBottom: 10, width: "100%" }}>
            This Month
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

          {/* ✅ NEW: Reminders */}
          <button onClick={() => setTab("reminders")} style={{ marginBottom: 10, width: "100%" }}>
            Reminders
          </button>
        </div>

        {/* Main */}
        <div style={{ flex: 1, border: "1px solid #2b2b2b", borderRadius: 14, padding: 16 }}>
          {/* Top-right bell only */}
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
            <button
              onClick={() => setTab("notifications")}
              style={{
                position: "relative",
                border: "1px solid #2b2b2b",
                borderRadius: 12,
                padding: "10px 12px",
                background: "#111",
                color: "white",
                cursor: "pointer",
                fontWeight: 800,
              }}
              title="Notifications"
            >
              🔔
              {unreadNotifs > 0 ? (
                <span
                  style={{
                    position: "absolute",
                    top: -6,
                    right: -6,
                    background: "red",
                    color: "white",
                    borderRadius: 999,
                    padding: "2px 7px",
                    fontSize: 12,
                    fontWeight: 900,
                    border: "2px solid #0b0b0b",
                  }}
                >
                  {unreadNotifs > 99 ? "99+" : unreadNotifs}
                </span>
              ) : null}
            </button>
          </div>

          {tab === "profile" && (
            <div style={{ display: "grid", gap: 14 }}>
              <div style={{ border: "1px solid #333", borderRadius: 12, padding: 16, background: "#111" }}>
                <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                  <div
                    style={{
                      width: 54,
                      height: 54,
                      borderRadius: 999,
                      border: "1px solid #2b2b2b",
                      background: "#0b0b0b",
                      display: "grid",
                      placeItems: "center",
                      fontWeight: 900,
                      fontSize: 18,
                    }}
                  >
                    {initials}
                  </div>

                  <div style={{ display: "grid", gap: 2 }}>
                    <h2 style={{ margin: 0 }}>Profile</h2>
                    <div style={{ fontSize: 13, opacity: 0.8 }}>Account</div>
                  </div>
                </div>

                <div style={{ marginTop: 12 }}>
                  <p><strong>Name:</strong> {myName || "Not set"}</p>
                  <p><strong>Email:</strong> {email}</p>
                </div>

                <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button onClick={changePassword}>Change Password</button>
                  <button onClick={logout}>Logout</button>
                </div>
              </div>

              <div style={{ border: "1px solid #333", borderRadius: 12, padding: 16, background: "#111" }}>
                <h3 style={{ marginTop: 0 }}>Room</h3>
                <p><strong>Role:</strong> {uid === createdBy ? "Admin" : "Member"}</p>
                <p><strong>Room ID:</strong> {groupId}</p>
                <button onClick={leaveRoom} style={{ marginTop: 8 }}>Leave Room</button>
              </div>
            </div>
          )}

          {tab === "thisMonth" && (
            <div style={{ display: "grid", gap: 12 }}>
              <h2 style={{ margin: 0 }}>This Month</h2>

              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ fontSize: 12, opacity: 0.75 }}>Month</div>
                <select
                  value={`${selectedMonth.year}-${selectedMonth.month}`}
                  onChange={(e) => {
                    const [y, m] = e.target.value.split("-").map(Number);
                    setSelectedMonth({ year: y, month: m });
                  }}
                  style={{
                    background: "#111",
                    color: "white",
                    border: "1px solid #2b2b2b",
                    borderRadius: 10,
                    padding: "8px 10px",
                  }}
                >
                  {monthOptions.map((m) => (
                    <option key={`${m.year}-${m.month}`} value={`${m.year}-${m.month}`}>
                      {monthLabel(m.year, m.month)}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                <StatCard title="Total spent" value={`$${formatMoney(monthTotal)}`} />
                <StatCard title="You paid" value={`$${formatMoney(youPaid)}`} />
                <StatCard title="You owe" value={`$${formatMoney(youOwe)}`} />
                <StatCard title="Net" value={`${net >= 0 ? "+" : "-"}$${formatMoney(Math.abs(net))}`} />
                <StatCard title="Expenses count" value={`${monthCount}`} />
              </div>
            </div>
          )}

          {/* ✅ FIXED: ExpensesPanel called with NO props */}
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

          {/* ✅ NEW: Reminders panel */}
          {tab === "reminders" && <RemindersPanel groupId={groupId ?? ""} />}

          {tab === "notifications" && <NotificationsPanel />}
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value }: { title: string; value: string }) {
  return (
    <div style={{ border: "1px solid #2b2b2b", borderRadius: 12, padding: "10px 12px", background: "#111", minWidth: 160 }}>
      <div style={{ fontSize: 12, opacity: 0.75 }}>{title}</div>
      <div style={{ fontSize: 18, fontWeight: 900 }}>{value}</div>
    </div>
  );
}

function monthLabel(year: number, month: number) {
  const d = new Date(year, month, 1);
  return d.toLocaleString(undefined, { month: "long", year: "numeric" });
}

function getInitials(input: string) {
  const s = (input || "").trim();
  if (!s) return "U";
  if (s.includes("@")) return s[0]?.toUpperCase() || "U";

  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0][0]?.toUpperCase() || "U";

  const a = parts[0][0] || "";
  const b = parts[parts.length - 1][0] || "";
  return (a + b).toUpperCase() || "U";
}

function formatMoney(n: number) {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return v.toFixed(2);
}

function estimateOwedForUser(data: any, uid: string, amount: number): number {
  const map = data?.splits ?? data?.shares ?? data?.owedBy ?? data?.splitMap ?? null;
  if (map && typeof map === "object") {
    const v = map[uid];
    const num = Number(v);
    if (Number.isFinite(num)) return num;
  }

  const arr = data?.participants ?? data?.participantUids ?? data?.splitBetween ?? data?.sharedWith ?? null;
  if (Array.isArray(arr) && arr.length > 0) {
    const hasMe = arr.map(String).includes(String(uid));
    if (!hasMe) return 0;
    return amount / arr.length;
  }

  return 0;
}