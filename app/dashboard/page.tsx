"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
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
import RemindersPanel from "../../components/RemindersPanel";
import ChatPanel from "../../components/ChatPanel";
import AIAssistantPanel from "../../components/AIAssistantPanel";
import ChoresPanel from "../../components/ChoresPanel";
import SettlementsPanel from "../../components/SettlementsPanel";
import AnalyticsPanel from "../../components/AnalyticsPanel";

type Tab =
  | "profile"
  | "thisMonth"
  | "expenses"
  | "groceries"
  | "roommates"
  | "notifications"
  | "reminders"
  | "chat"
  | "ai"
  | "chores"
  | "settlements"
  | "analytics";

type Roommate = { uid: string; name: string };
type MonthKey = { year: number; month: number };

type SidebarItem = {
  id: Tab;
  emoji: string;
  label: string;
};

const defaultSidebarItems: SidebarItem[] = [
  { id: "profile", emoji: "👤", label: "Profile" },
  { id: "thisMonth", emoji: "📅", label: "This Month" },
  { id: "expenses", emoji: "💸", label: "Expenses" },
  { id: "settlements", emoji: "🤝", label: "Settlements" },
  { id: "analytics", emoji: "📊", label: "Analytics" },
  { id: "chores", emoji: "🧹", label: "Chores" },
  { id: "groceries", emoji: "🛒", label: "Grocery" },
  { id: "roommates", emoji: "🏠", label: "Roommates" },
  { id: "reminders", emoji: "⏰", label: "Reminders" },
  { id: "chat", emoji: "💬", label: "Chat" },
  { id: "ai", emoji: "🤖", label: "AI Assistant" },
];

const SIDEBAR_ORDER_KEY = "dashboard.sidebarOrder.v1";

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

  const [sidebarItems, setSidebarItems] =
    useState<SidebarItem[]>(defaultSidebarItems);
  const [isReordering, setIsReordering] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  const baseNow = useMemo(() => new Date(), []);
  const [selectedMonth, setSelectedMonth] = useState<MonthKey>({
    year: baseNow.getFullYear(),
    month: baseNow.getMonth(),
  });

  const [monthTotal, setMonthTotal] = useState<number>(0);
  const [monthCount, setMonthCount] = useState<number>(0);
  const [youPaid, setYouPaid] = useState<number>(0);
  const [youOwe, setYouOwe] = useState<number>(0);
  const [net, setNet] = useState<number>(0);

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

  useEffect(() => {
    const saved =
      typeof window !== "undefined"
        ? window.localStorage.getItem(SIDEBAR_ORDER_KEY)
        : null;

    if (!saved) return;

    try {
      const savedIds = JSON.parse(saved) as Tab[];
      const ordered = savedIds
        .map((id) => defaultSidebarItems.find((item) => item.id === id))
        .filter(Boolean) as SidebarItem[];

      const missing = defaultSidebarItems.filter(
        (item) => !savedIds.includes(item.id)
      );

      if (ordered.length > 0) {
        setSidebarItems([...ordered, ...missing]);
      }
    } catch {
      setSidebarItems(defaultSidebarItems);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const ids = sidebarItems.map((item) => item.id);
    window.localStorage.setItem(SIDEBAR_ORDER_KEY, JSON.stringify(ids));
  }, [sidebarItems]);

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

          const dt = getExpenseDate(data);
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

  const handleDragStart = (index: number) => {
    if (!isReordering) return;
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent<HTMLButtonElement>) => {
    if (!isReordering) return;
    e.preventDefault();
  };

  const handleDrop = (dropIndex: number) => {
    if (!isReordering) return;
    if (draggedIndex === null || draggedIndex === dropIndex) {
      setDraggedIndex(null);
      return;
    }

    setSidebarItems((prev) => {
      const updated = [...prev];
      const [movedItem] = updated.splice(draggedIndex, 1);
      updated.splice(dropIndex, 0, movedItem);
      return updated;
    });

    setDraggedIndex(null);
  };

  const removeMember = async (memberUid: string) => {
    if (!groupId || !uid) return;
    if (uid !== createdBy) return alert("Only admin can remove members.");

    const ok = confirm("Remove this roommate?");
    if (!ok) return;

    await deleteDoc(doc(db, "groups", groupId, "members", memberUid));
    await setDoc(doc(db, "users", memberUid), { groupId: null }, { merge: true });
    alert("Roommate removed ✅");
  };

  const transferAdmin = async (newAdminUid: string) => {
    if (!groupId || !uid) return;
    if (uid !== createdBy) return alert("Only admin can transfer admin.");

    const ok = confirm("Transfer admin?");
    if (!ok) return;

    await updateDoc(doc(db, "groups", groupId), { createdBy: newAdminUid });
    setCreatedBy(newAdminUid);
    alert("Admin transferred ✅");
  };

  const leaveRoom = async () => {
    if (!groupId || !uid) return;

    const others = roommates.filter((r) => r.uid !== uid);
    if (uid === createdBy && others.length > 0) {
      alert("Transfer admin before leaving.");
      return;
    }

    const ok = confirm(
      "Are you sure you want to leave this room?\n\nYou will lose access to this room's chat, expenses, reminders, and roommate list."
    );
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

  if (loading) {
    return <div style={{ padding: 16, color: "white" }}>Loading...</div>;
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        padding: 16,
        background:
          "linear-gradient(180deg, #0b1020 0%, #111827 45%, #0b0b0b 100%)",
        color: "white",
      }}
    >
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        <div
          style={{
            width: 260,
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 18,
            padding: 14,
            background: "rgba(17, 24, 39, 0.88)",
            backdropFilter: "blur(10px)",
            boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
            position: "sticky",
            top: 16,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 14,
            }}
          >
            <div
              style={{
                fontSize: 24,
                fontWeight: 900,
                background:
                  "linear-gradient(90deg, #a78bfa, #60a5fa, #34d399)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              ✨ Dashboard
            </div>

            <button
              onClick={() => {
                setIsReordering((prev) => !prev);
                setDraggedIndex(null);
              }}
              style={{
                border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: 10,
                padding: "6px 8px",
                background: isReordering ? "#10b981" : "#0f172a",
                color: "white",
                cursor: "pointer",
                fontSize: 16,
                lineHeight: 1,
              }}
              title={isReordering ? "Done" : "Reorder"}
            >
              {isReordering ? "✓" : "↕️"}
            </button>
          </div>

          {sidebarItems.map((item, index) => (
            <SidebarButton
              key={item.id}
              emoji={item.emoji}
              label={item.label}
              active={tab === item.id}
              onClick={() => {
                if (isReordering) return;
                setTab(item.id);
              }}
              draggable={isReordering}
              onDragStart={() => handleDragStart(index)}
              onDragOver={handleDragOver}
              onDrop={() => handleDrop(index)}
              isReordering={isReordering}
            />
          ))}

          <div
            style={{
              marginTop: 16,
              borderTop: "1px solid rgba(255,255,255,0.08)",
              paddingTop: 14,
              fontSize: 13,
              opacity: 0.9,
            }}
          >
            <div>
              <strong>Name:</strong> {myName || "Not set"}
            </div>
            <div style={{ marginTop: 6 }}>
              <strong>Role:</strong> {uid === createdBy ? "Admin" : "Member"}
            </div>
          </div>
        </div>

        <div
          style={{
            flex: 1,
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 18,
            padding: 16,
            background: "rgba(17, 24, 39, 0.82)",
            backdropFilter: "blur(10px)",
            boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
            minHeight: "80vh",
          }}
        >
          <div
            style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}
          >
            <button
              onClick={() => setTab("notifications")}
              style={{
                position: "relative",
                border:
                  tab === "notifications"
                    ? "1px solid #f59e0b"
                    : "1px solid rgba(255,255,255,0.08)",
                borderRadius: 14,
                padding: "10px 12px",
                background:
                  tab === "notifications"
                    ? "linear-gradient(135deg, #f59e0b, #f97316)"
                    : "#0b1220",
                color: "white",
                cursor: "pointer",
                fontWeight: 800,
                boxShadow:
                  tab === "notifications"
                    ? "0 8px 24px rgba(245,158,11,0.3)"
                    : "none",
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
                    background: "#ef4444",
                    color: "white",
                    borderRadius: 999,
                    padding: "2px 7px",
                    fontSize: 12,
                    fontWeight: 900,
                    border: "2px solid #0b1020",
                  }}
                >
                  {unreadNotifs > 99 ? "99+" : unreadNotifs}
                </span>
              ) : null}
            </button>
          </div>

          {tab === "profile" && (
            <div style={{ display: "grid", gap: 14 }}>
              <div
                style={{
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 16,
                  padding: 16,
                  background:
                    "linear-gradient(135deg, rgba(124,58,237,0.18), rgba(37,99,235,0.14))",
                }}
              >
                <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                  <div
                    style={{
                      width: 58,
                      height: 58,
                      borderRadius: 999,
                      border: "1px solid rgba(255,255,255,0.08)",
                      background: "linear-gradient(135deg, #7c3aed, #2563eb)",
                      display: "grid",
                      placeItems: "center",
                      fontWeight: 900,
                      fontSize: 20,
                      boxShadow: "0 8px 20px rgba(124,58,237,0.3)",
                    }}
                  >
                    {initials}
                  </div>

                  <div style={{ display: "grid", gap: 2 }}>
                    <h2 style={{ margin: 0 }}>👤 Profile</h2>
                    <div style={{ fontSize: 13, opacity: 0.85 }}>
                      Account details
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: 12 }}>
                  <p>
                    <strong>Name:</strong> {myName || "Not set"}
                  </p>
                  <p>
                    <strong>Email:</strong> {email}
                  </p>
                </div>

                <div
                  style={{
                    marginTop: 12,
                    display: "flex",
                    gap: 10,
                    flexWrap: "wrap",
                  }}
                >
                  <button onClick={changePassword} style={actionBtnStyle}>
                    Change Password
                  </button>
                  <button onClick={logout} style={dangerBtnStyle}>
                    Logout
                  </button>
                </div>
              </div>

              <div
                style={{
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 16,
                  padding: 16,
                  background:
                    "linear-gradient(135deg, rgba(16,185,129,0.15), rgba(59,130,246,0.12))",
                }}
              >
                <h3 style={{ marginTop: 0 }}>🏠 Room</h3>
                <p>
                  <strong>Role:</strong> {uid === createdBy ? "Admin" : "Member"}
                </p>
                <p>
                  <strong>Room ID:</strong> {groupId}
                </p>
              </div>
            </div>
          )}

          {tab === "thisMonth" && (
            <div style={{ display: "grid", gap: 12 }}>
              <h2 style={{ margin: 0 }}>📅 This Month</h2>

              <div
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <div style={{ fontSize: 12, opacity: 0.75 }}>Month</div>
                <select
                  value={`${selectedMonth.year}-${selectedMonth.month}`}
                  onChange={(e) => {
                    const [y, m] = e.target.value.split("-").map(Number);
                    setSelectedMonth({ year: y, month: m });
                  }}
                  style={{
                    background: "#0b1220",
                    color: "white",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 10,
                    padding: "8px 10px",
                  }}
                >
                  {monthOptions.map((m) => (
                    <option
                      key={`${m.year}-${m.month}`}
                      value={`${m.year}-${m.month}`}
                    >
                      {monthLabel(m.year, m.month)}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                <StatCard title="💰 Total spent" value={`$${formatMoney(monthTotal)}`} />
                <StatCard title="🧾 You paid" value={`$${formatMoney(youPaid)}`} />
                <StatCard title="💸 You owe" value={`$${formatMoney(youOwe)}`} />
                <StatCard
                  title="📈 Net"
                  value={`${net >= 0 ? "+" : "-"}$${formatMoney(Math.abs(net))}`}
                />
                <StatCard title="📦 Expenses count" value={`${monthCount}`} />
              </div>
            </div>
          )}

          {tab === "expenses" && <ExpensesPanel />}
          {tab === "settlements" && <SettlementsPanel />}
          {tab === "analytics" && <AnalyticsPanel />}
          {tab === "chores" && <ChoresPanel />}
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

          {tab === "reminders" && <RemindersPanel groupId={groupId ?? ""} />}
          {tab === "chat" && <ChatPanel />}
          {tab === "ai" && <AIAssistantPanel />}
          {tab === "notifications" && <NotificationsPanel />}
        </div>
      </div>
    </div>
  );
}

function SidebarButton({
  emoji,
  label,
  active,
  onClick,
  draggable,
  onDragStart,
  onDragOver,
  onDrop,
  isReordering,
}: {
  emoji: string;
  label: string;
  active: boolean;
  onClick: () => void;
  draggable?: boolean;
  onDragStart?: () => void;
  onDragOver?: (e: React.DragEvent<HTMLButtonElement>) => void;
  onDrop?: () => void;
  isReordering?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      style={{
        marginBottom: 10,
        width: "100%",
        textAlign: "left",
        padding: "12px 14px",
        borderRadius: 14,
        border: active ? "1px solid #7c3aed" : "1px solid rgba(255,255,255,0.08)",
        background: active
          ? "linear-gradient(135deg, #7c3aed, #2563eb)"
          : "#0f172a",
        color: "white",
        fontWeight: active ? 900 : 700,
        cursor: isReordering ? "grab" : "pointer",
        display: "flex",
        alignItems: "center",
        gap: 10,
        boxShadow: active ? "0 8px 24px rgba(124,58,237,0.35)" : "none",
        opacity: isReordering ? 0.95 : 1,
      }}
    >
      <span style={{ fontSize: 18 }}>{emoji}</span>
      <span style={{ flex: 1 }}>{label}</span>
      {isReordering ? <span style={{ opacity: 0.7 }}>↕️</span> : null}
    </button>
  );
}

function StatCard({ title, value }: { title: string; value: string }) {
  return (
    <div
      style={{
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 16,
        padding: "14px 16px",
        background:
          "linear-gradient(135deg, rgba(124,58,237,0.18), rgba(37,99,235,0.14))",
        minWidth: 170,
        boxShadow: "0 8px 24px rgba(0,0,0,0.22)",
      }}
    >
      <div style={{ fontSize: 12, opacity: 0.8 }}>{title}</div>
      <div style={{ fontSize: 24, fontWeight: 900, marginTop: 4 }}>{value}</div>
    </div>
  );
}

const actionBtnStyle: CSSProperties = {
  border: "1px solid #2563eb",
  borderRadius: 12,
  padding: "10px 12px",
  background: "linear-gradient(135deg, #60a5fa, #2563eb)",
  color: "white",
  fontWeight: 800,
  cursor: "pointer",
  boxShadow: "0 8px 20px rgba(37,99,235,0.3)",
};

const dangerBtnStyle: CSSProperties = {
  border: "1px solid #dc2626",
  borderRadius: 12,
  padding: "10px 12px",
  background: "linear-gradient(135deg, #ef4444, #b91c1c)",
  color: "white",
  fontWeight: 800,
  cursor: "pointer",
  boxShadow: "0 8px 20px rgba(239,68,68,0.25)",
};

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

function getExpenseDate(data: any): Date | null {
  const dateValue = data?.date;
  if (typeof dateValue === "string") {
    const d = new Date(`${dateValue}T00:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const ts = data?.createdAt;
  if (ts?.toDate) return ts.toDate();
  if (ts instanceof Date) return ts;

  return null;
}

function estimateOwedForUser(data: any, uid: string, amount: number): number {
  const map = data?.splits ?? data?.shares ?? data?.owedBy ?? data?.splitMap ?? null;
  if (map && typeof map === "object") {
    const v = map[uid];
    const num = Number(v);
    if (Number.isFinite(num)) return num;
  }

  const arr =
    data?.participants ??
    data?.participantUids ??
    data?.splitBetween ??
    data?.sharedWith ??
    null;

  if (Array.isArray(arr) && arr.length > 0) {
    const hasMe = arr.map(String).includes(String(uid));
    if (!hasMe) return 0;
    return amount / arr.length;
  }

  return 0;
}