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
    return <div style={{ padding: 24, color: "white" }}>Loading your data...</div>;
  }

  return (
    <div style={pageStyle}>
      <div style={auroraOne} />
      <div style={auroraTwo} />

      <div style={shellStyle}>
        <aside style={sidebarStyle}>
          <div style={sidebarTopStyle}>
            <div>
              <div style={brandEyebrowStyle}>Roommates</div>
              <div style={brandTitleStyle}>Dashboard</div>
            </div>

            <button
              onClick={() => {
                setIsReordering((prev) => !prev);
                setDraggedIndex(null);
              }}
              style={{
                ...iconActionStyle,
                background: isReordering
                  ? "linear-gradient(135deg, rgba(34,197,94,0.9), rgba(16,185,129,0.9))"
                  : "rgba(15,23,42,0.88)",
              }}
              title={isReordering ? "Done reordering" : "Reorder sidebar"}
            >
              {isReordering ? "✓" : "↕"}
            </button>
          </div>

          <div style={{ display: "grid", gap: 10 }}>
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
          </div>

          <div style={sidebarFooterStyle}>
            <div style={miniProfileStyle}>
              <div style={miniAvatarStyle}>{initials}</div>
              <div style={{ minWidth: 0 }}>
                <div style={miniNameStyle}>{myName || "Not set"}</div>
                <div style={miniRoleStyle}>
                  {uid === createdBy ? "Admin" : "Member"}
                </div>
              </div>
            </div>
          </div>
        </aside>

        <main style={mainPanelStyle}>
          <div style={topBarStyle}>
            <div>
              <div style={topBarEyebrowStyle}>Shared home management</div>
              <h1 style={topBarTitleStyle}>{getTabTitle(tab)}</h1>
            </div>

            <button
              onClick={() => setTab("notifications")}
              style={{
                ...notificationBtnStyle,
                ...(tab === "notifications" ? notificationBtnActiveStyle : {}),
              }}
              title="Notifications"
            >
              <span style={{ fontSize: 18 }}>🔔</span>
              {unreadNotifs > 0 ? (
                <span style={notificationBadgeStyle}>
                  {unreadNotifs > 99 ? "99+" : unreadNotifs}
                </span>
              ) : null}
            </button>
          </div>

          <div style={contentAreaStyle}>
            {tab === "profile" && (
              <div style={{ display: "grid", gap: 18 }}>
                <section style={heroCardStyle}>
                  <div style={heroHeaderStyle}>
                    <div style={heroAvatarStyle}>{initials}</div>

                    <div style={{ display: "grid", gap: 4 }}>
                      <div style={heroTitleStyle}>Profile</div>
                      <div style={heroSubtitleStyle}>Account details</div>
                    </div>
                  </div>

                  <div style={profileGridStyle}>
                    <InfoPill label="Name" value={myName || "Not set"} />
                    <InfoPill label="Email" value={email || "No email"} />
                    <InfoPill
                      label="Role"
                      value={uid === createdBy ? "Admin" : "Member"}
                    />
                    <InfoPill label="Room ID" value={groupId || "Not available"} />
                  </div>

                  <div style={actionRowStyle}>
                    <button onClick={changePassword} style={primaryBtnStyle}>
                      Change Password
                    </button>
                    <button onClick={logout} style={dangerBtnStyle}>
                      Logout
                    </button>
                  </div>
                </section>

                <section style={sectionCardStyle}>
                  <div style={sectionTitleStyle}>Room access</div>
                  <div style={sectionSubtleStyle}>
                    You are currently connected to your shared room and can manage
                    expenses, reminders, chores, messages, and roommate settings.
                  </div>
                </section>
              </div>
            )}

            {tab === "thisMonth" && (
              <div style={{ display: "grid", gap: 18 }}>
                <section style={sectionCardStyle}>
                  <div style={sectionHeaderRowStyle}>
                    <div>
                      <div style={sectionTitleStyle}>Monthly overview</div>
                      <div style={sectionSubtleStyle}>
                        Quick snapshot of your selected month.
                      </div>
                    </div>

                    <div style={{ display: "grid", gap: 6 }}>
                      <div style={inputLabelStyle}>Month</div>
                      <select
                        value={`${selectedMonth.year}-${selectedMonth.month}`}
                        onChange={(e) => {
                          const [y, m] = e.target.value.split("-").map(Number);
                          setSelectedMonth({ year: y, month: m });
                        }}
                        style={modernSelectStyle}
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
                  </div>
                </section>

                <div style={statsGridStyle}>
                  <StatCard title="Total spent" value={`$${formatMoney(monthTotal)}`} />
                  <StatCard title="You paid" value={`$${formatMoney(youPaid)}`} />
                  <StatCard title="You owe" value={`$${formatMoney(youOwe)}`} />
                  <StatCard
                    title="Net"
                    value={`${net >= 0 ? "+" : "-"}$${formatMoney(Math.abs(net))}`}
                  />
                  <StatCard title="Expenses count" value={`${monthCount}`} />
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
        </main>
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
        width: "100%",
        textAlign: "left",
        padding: "13px 14px",
        borderRadius: 16,
        border: active
          ? "1px solid rgba(129,140,248,0.75)"
          : "1px solid rgba(255,255,255,0.08)",
        background: active
          ? "linear-gradient(135deg, rgba(99,102,241,0.95), rgba(59,130,246,0.95))"
          : "rgba(15,23,42,0.72)",
        color: "white",
        fontWeight: active ? 800 : 600,
        cursor: isReordering ? "grab" : "pointer",
        display: "flex",
        alignItems: "center",
        gap: 12,
        boxShadow: active
          ? "0 14px 32px rgba(59,130,246,0.30)"
          : "0 6px 16px rgba(0,0,0,0.14)",
        transition: "all 0.2s ease",
        transform: active ? "translateY(-1px)" : "translateY(0)",
      }}
      onMouseEnter={(e) => {
        if (!isReordering && !active) {
          e.currentTarget.style.transform = "translateY(-2px)";
          e.currentTarget.style.boxShadow = "0 12px 24px rgba(0,0,0,0.22)";
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.transform = "translateY(0)";
          e.currentTarget.style.boxShadow = "0 6px 16px rgba(0,0,0,0.14)";
        }
      }}
    >
      <span style={{ fontSize: 18 }}>{emoji}</span>
      <span style={{ flex: 1 }}>{label}</span>
      {isReordering ? <span style={{ opacity: 0.55 }}>↕</span> : null}
    </button>
  );
}

function StatCard({ title, value }: { title: string; value: string }) {
  return (
    <div style={statCardStyle}>
      <div style={statTitleStyle}>{title}</div>
      <div style={statValueStyle}>{value}</div>
    </div>
  );
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div style={infoPillStyle}>
      <div style={infoPillLabelStyle}>{label}</div>
      <div style={infoPillValueStyle}>{value}</div>
    </div>
  );
}

const pageStyle: CSSProperties = {
  minHeight: "100vh",
  padding: 20,
  background:
    "radial-gradient(circle at top left, rgba(79,70,229,0.22), transparent 24%), radial-gradient(circle at top right, rgba(14,165,233,0.18), transparent 20%), linear-gradient(180deg, #050816 0%, #091127 42%, #060913 100%)",
  color: "white",
  position: "relative",
  overflow: "hidden",
};

const auroraOne: CSSProperties = {
  position: "absolute",
  top: -120,
  left: -120,
  width: 300,
  height: 300,
  borderRadius: 999,
  background: "rgba(99,102,241,0.20)",
  filter: "blur(80px)",
  pointerEvents: "none",
};

const auroraTwo: CSSProperties = {
  position: "absolute",
  bottom: -120,
  right: -120,
  width: 320,
  height: 320,
  borderRadius: 999,
  background: "rgba(14,165,233,0.16)",
  filter: "blur(90px)",
  pointerEvents: "none",
};

const shellStyle: CSSProperties = {
  position: "relative",
  zIndex: 1,
  display: "flex",
  gap: 18,
  alignItems: "flex-start",
};

const sidebarStyle: CSSProperties = {
  width: 278,
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 24,
  padding: 16,
  background: "rgba(8,15,32,0.82)",
  backdropFilter: "blur(14px)",
  boxShadow: "0 20px 45px rgba(0,0,0,0.28)",
  position: "sticky",
  top: 20,
};

const sidebarTopStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  marginBottom: 18,
};

const brandEyebrowStyle: CSSProperties = {
  fontSize: 12,
  letterSpacing: 1.2,
  textTransform: "uppercase",
  color: "rgba(191,219,254,0.72)",
  marginBottom: 4,
};

const brandTitleStyle: CSSProperties = {
  fontSize: 28,
  fontWeight: 900,
  letterSpacing: -0.8,
  background: "linear-gradient(90deg, #c4b5fd 0%, #93c5fd 52%, #67e8f9 100%)",
  WebkitBackgroundClip: "text",
  WebkitTextFillColor: "transparent",
};

const iconActionStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 14,
  padding: "8px 10px",
  color: "white",
  cursor: "pointer",
  fontWeight: 800,
  boxShadow: "0 10px 24px rgba(0,0,0,0.20)",
  transition: "all 0.2s ease",
};

const sidebarFooterStyle: CSSProperties = {
  marginTop: 18,
  paddingTop: 16,
  borderTop: "1px solid rgba(255,255,255,0.08)",
};

const miniProfileStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: 12,
  borderRadius: 18,
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.06)",
};

const miniAvatarStyle: CSSProperties = {
  width: 42,
  height: 42,
  borderRadius: 999,
  display: "grid",
  placeItems: "center",
  fontWeight: 900,
  background: "linear-gradient(135deg, #6366f1, #0ea5e9)",
  boxShadow: "0 10px 22px rgba(59,130,246,0.28)",
};

const miniNameStyle: CSSProperties = {
  fontWeight: 700,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const miniRoleStyle: CSSProperties = {
  fontSize: 12,
  color: "rgba(255,255,255,0.64)",
  marginTop: 2,
};

const mainPanelStyle: CSSProperties = {
  flex: 1,
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 28,
  padding: 20,
  background:
    "linear-gradient(180deg, rgba(10,21,45,0.78) 0%, rgba(9,16,34,0.84) 100%)",
  backdropFilter: "blur(14px)",
  boxShadow: "0 24px 60px rgba(0,0,0,0.28)",
  minHeight: "88vh",
};

const topBarStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 14,
  marginBottom: 18,
};

const topBarEyebrowStyle: CSSProperties = {
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: 1.1,
  color: "rgba(191,219,254,0.68)",
  marginBottom: 6,
};

const topBarTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: 32,
  lineHeight: 1.1,
  letterSpacing: -1,
};

const notificationBtnStyle: CSSProperties = {
  position: "relative",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 16,
  padding: "12px 14px",
  background: "rgba(9,15,29,0.88)",
  color: "white",
  cursor: "pointer",
  boxShadow: "0 10px 24px rgba(0,0,0,0.20)",
  transition: "all 0.2s ease",
};

const notificationBtnActiveStyle: CSSProperties = {
  background: "linear-gradient(135deg, rgba(245,158,11,0.95), rgba(249,115,22,0.95))",
  border: "1px solid rgba(251,191,36,0.75)",
  boxShadow: "0 14px 30px rgba(245,158,11,0.28)",
};

const notificationBadgeStyle: CSSProperties = {
  position: "absolute",
  top: -7,
  right: -7,
  background: "linear-gradient(135deg, #ef4444, #dc2626)",
  color: "white",
  borderRadius: 999,
  padding: "3px 8px",
  fontSize: 11,
  fontWeight: 900,
  border: "2px solid #091127",
  boxShadow: "0 4px 10px rgba(239,68,68,0.4)",
};

const contentAreaStyle: CSSProperties = {
  display: "grid",
  gap: 16,
};

const heroCardStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 24,
  padding: 20,
  background:
    "linear-gradient(135deg, rgba(99,102,241,0.18), rgba(14,165,233,0.12) 55%, rgba(255,255,255,0.03))",
  boxShadow: "0 18px 44px rgba(0,0,0,0.22)",
};

const heroHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 14,
  marginBottom: 18,
};

const heroAvatarStyle: CSSProperties = {
  width: 68,
  height: 68,
  borderRadius: 999,
  display: "grid",
  placeItems: "center",
  fontWeight: 900,
  fontSize: 22,
  background: "linear-gradient(135deg, #6366f1, #3b82f6)",
  boxShadow: "0 16px 30px rgba(59,130,246,0.26)",
};

const heroTitleStyle: CSSProperties = {
  fontSize: 26,
  fontWeight: 900,
  lineHeight: 1.1,
};

const heroSubtitleStyle: CSSProperties = {
  fontSize: 14,
  color: "rgba(255,255,255,0.72)",
};

const profileGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: 12,
};

const infoPillStyle: CSSProperties = {
  padding: 14,
  borderRadius: 18,
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.07)",
};

const infoPillLabelStyle: CSSProperties = {
  fontSize: 12,
  color: "rgba(255,255,255,0.62)",
  marginBottom: 6,
};

const infoPillValueStyle: CSSProperties = {
  fontWeight: 700,
  wordBreak: "break-word",
};

const actionRowStyle: CSSProperties = {
  marginTop: 18,
  display: "flex",
  gap: 10,
  flexWrap: "wrap",
};

const sectionCardStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 22,
  padding: 18,
  background: "rgba(255,255,255,0.03)",
  boxShadow: "0 14px 32px rgba(0,0,0,0.16)",
};

const sectionHeaderRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-end",
  gap: 14,
  flexWrap: "wrap",
};

const sectionTitleStyle: CSSProperties = {
  fontSize: 20,
  fontWeight: 800,
  marginBottom: 6,
};

const sectionSubtleStyle: CSSProperties = {
  color: "rgba(255,255,255,0.68)",
  lineHeight: 1.5,
};

const inputLabelStyle: CSSProperties = {
  fontSize: 12,
  color: "rgba(255,255,255,0.66)",
};

const modernSelectStyle: CSSProperties = {
  background: "rgba(7,12,25,0.92)",
  color: "white",
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 14,
  padding: "11px 14px",
  outline: "none",
  minWidth: 220,
};

const statsGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: 14,
};

const statCardStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 20,
  padding: "16px 18px",
  background:
    "linear-gradient(145deg, rgba(99,102,241,0.16), rgba(14,165,233,0.10), rgba(255,255,255,0.03))",
  minHeight: 104,
  boxShadow: "0 16px 32px rgba(0,0,0,0.18)",
};

const statTitleStyle: CSSProperties = {
  fontSize: 12,
  color: "rgba(255,255,255,0.74)",
  marginBottom: 12,
  textTransform: "uppercase",
  letterSpacing: 0.7,
};

const statValueStyle: CSSProperties = {
  fontSize: 28,
  fontWeight: 900,
  letterSpacing: -0.6,
};

const primaryBtnStyle: CSSProperties = {
  border: "1px solid rgba(96,165,250,0.7)",
  borderRadius: 14,
  padding: "11px 15px",
  background: "linear-gradient(135deg, #60a5fa, #2563eb)",
  color: "white",
  fontWeight: 800,
  cursor: "pointer",
  boxShadow: "0 14px 28px rgba(37,99,235,0.28)",
  transition: "all 0.2s ease",
};

const dangerBtnStyle: CSSProperties = {
  border: "1px solid rgba(248,113,113,0.75)",
  borderRadius: 14,
  padding: "11px 15px",
  background: "linear-gradient(135deg, #ef4444, #b91c1c)",
  color: "white",
  fontWeight: 800,
  cursor: "pointer",
  boxShadow: "0 14px 28px rgba(239,68,68,0.22)",
  transition: "all 0.2s ease",
};

function getTabTitle(tab: Tab) {
  switch (tab) {
    case "profile":
      return "Profile";
    case "thisMonth":
      return "This Month";
    case "expenses":
      return "Expenses";
    case "settlements":
      return "Settlements";
    case "analytics":
      return "Analytics";
    case "chores":
      return "Chores";
    case "groceries":
      return "Grocery";
    case "roommates":
      return "Roommates";
    case "reminders":
      return "Reminders";
    case "chat":
      return "Chat";
    case "ai":
      return "AI Assistant";
    case "notifications":
      return "Notifications";
    default:
      return "Dashboard";
  }
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