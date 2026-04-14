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
import PersonalPaymentsPanel from "../../components/PersonalPaymentsPanel";

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
  | "analytics"
  | "personalPayments";

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
  { id: "personalPayments", emoji: "💵", label: "Personal Payments" },
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
const MOBILE_BREAKPOINT = 900;

export default function DashboardPage() {
  const router = useRouter();

  const [tab, setTab] = useState<Tab>("profile");
  const [authChecked, setAuthChecked] = useState(false);

  const [uid, setUid] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [authDisplayName, setAuthDisplayName] = useState("");

  const [groupId, setGroupId] = useState<string | null>(null);
  const [createdBy, setCreatedBy] = useState<string | null>(null);

  const [roommates, setRoommates] = useState<Roommate[]>([]);

  const [sidebarItems, setSidebarItems] =
    useState<SidebarItem[]>(defaultSidebarItems);
  const [isReordering, setIsReordering] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [viewportWidth, setViewportWidth] = useState<number>(1200);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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
  const isMobile = viewportWidth <= MOBILE_BREAKPOINT;

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
    if (typeof window === "undefined") return;

    const handleResize = () => {
      setViewportWidth(window.innerWidth);
    };

    handleResize();
    window.addEventListener("resize", handleResize, { passive: true });

    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (!isMobile) {
      setMobileMenuOpen(false);
    }
  }, [isMobile]);

  useEffect(() => {
    if (typeof document === "undefined") return;

    const previousOverflow = document.body.style.overflow;
    if (isMobile && mobileMenuOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isMobile, mobileMenuOpen]);

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
    const q = query(expensesCol, orderBy("createdAt", "desc"), limit(300));

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
    const q = query(notifsCol, orderBy("createdAt", "desc"), limit(40));

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
    if (uid !== createdBy) {
      alert("Only admin can remove members.");
      return;
    }

    const ok = confirm("Remove this roommate?");
    if (!ok) return;

    await deleteDoc(doc(db, "groups", groupId, "members", memberUid));
    await setDoc(doc(db, "users", memberUid), { groupId: null }, { merge: true });

    alert("Roommate removed ✅");
  };

  const transferAdmin = async (newAdminUid: string) => {
    if (!groupId || !uid) return;
    if (uid !== createdBy) {
      alert("Only admin can transfer admin.");
      return;
    }

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
    if (!email) {
      alert("No email found for this account.");
      return;
    }

    try {
      await sendPasswordResetEmail(auth, email, {
        url: "https://roommates-app.vercel.app/reset-password",
        handleCodeInApp: true,
      });
      alert("Password reset email sent ✅");
    } catch (error: any) {
      alert("Error: " + (error?.message || "Failed to send reset email"));
    }
  };

  if (loading) {
    return (
      <div style={loadingPageStyle}>
        <div style={loadingCardStyle}>
          <div style={loadingTitleStyle}>Loading your data...</div>
          <div style={loadingSubtleStyle}>
            Getting your room, expenses, and dashboard ready.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      {isMobile ? (
        <div style={mobileTopBarStyle}>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            style={mobileMenuButtonStyle}
          >
            ☰ Menu
          </button>

          <button
            type="button"
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
      ) : null}

      {isMobile && mobileMenuOpen ? (
        <>
          <div
            onClick={() => setMobileMenuOpen(false)}
            style={mobileOverlayStyle}
          />

          <aside style={mobileSidebarStyle} className="scrollable">
            <div style={sidebarTopStyle}>
              <div>
                <div style={brandEyebrowStyle}>Roommates</div>
                <div style={brandTitleStyle}>Dashboard</div>
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  onClick={() => {
                    setIsReordering((prev) => !prev);
                    setDraggedIndex(null);
                  }}
                  style={iconActionStyle}
                  title={isReordering ? "Done reordering" : "Reorder sidebar"}
                >
                  {isReordering ? "✓" : "↕"}
                </button>

                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  style={iconActionStyle}
                  title="Close menu"
                >
                  ✕
                </button>
              </div>
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
                    setMobileMenuOpen(false);
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
        </>
      ) : null}

      <div
        style={{
          ...shellStyle,
          flexDirection: isMobile ? "column" : "row",
        }}
      >
        {!isMobile ? (
          <aside style={desktopSidebarStyle}>
            <div style={sidebarTopStyle}>
              <div>
                <div style={brandEyebrowStyle}>Roommates</div>
                <div style={brandTitleStyle}>Dashboard</div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setIsReordering((prev) => !prev);
                  setDraggedIndex(null);
                }}
                style={iconActionStyle}
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
        ) : null}

        <main style={mainPanelStyle} className="scrollable">
          <div
            style={{
              ...topBarStyle,
              flexDirection: isMobile ? "column" : "row",
            }}
          >
            <div>
              <div style={topBarEyebrowStyle}>Shared home management</div>
              <h1 style={topBarTitleStyle}>{getTabTitle(tab)}</h1>
            </div>

            {!isMobile ? (
              <button
                type="button"
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
            ) : null}
          </div>

          <div style={contentAreaStyle}>
            {tab === "profile" && (
              <div style={{ display: "grid", gap: 16 }}>
                <section style={sectionCardStyle}>
                  <div style={profileHeaderStyle}>
                    <div style={heroAvatarStyle}>{initials}</div>

                    <div style={{ minWidth: 0 }}>
                      <div style={profileTitleStyle}>Profile</div>
                      <div style={profileSubtitleStyle}>Account details</div>
                    </div>
                  </div>

                  <div
                    style={{
                      ...profileGridStyle,
                      gridTemplateColumns: isMobile
                        ? "1fr"
                        : "repeat(auto-fit, minmax(180px, 1fr))",
                    }}
                  >
                    <InfoPill label="Name" value={myName || "Not set"} />
                    <InfoPill label="Email" value={email || "No email"} />
                    <InfoPill
                      label="Role"
                      value={uid === createdBy ? "Admin" : "Member"}
                    />
                    <InfoPill label="Room ID" value={groupId || "Not available"} />
                  </div>

                  <div style={actionRowStyle}>
                    <button
                      type="button"
                      onClick={changePassword}
                      style={secondaryBtnStyle}
                    >
                      Change Password
                    </button>

                    <button
                      type="button"
                      onClick={logout}
                      style={dangerBtnStyle}
                    >
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
              <div style={{ display: "grid", gap: 16 }}>
                <section style={sectionCardStyle}>
                  <div
                    style={{
                      ...sectionHeaderRowStyle,
                      flexDirection: isMobile ? "column" : "row",
                      alignItems: isMobile ? "stretch" : "flex-end",
                    }}
                  >
                    <div>
                      <div style={sectionTitleStyle}>Monthly overview</div>
                      <div style={sectionSubtleStyle}>
                        Quick snapshot of your selected month.
                      </div>
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gap: 6,
                        width: isMobile ? "100%" : 220,
                      }}
                    >
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
                            style={{ background: "#0b1628", color: "#fff" }}
                          >
                            {monthLabel(m.year, m.month)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </section>

                <div
                  style={{
                    ...statsGridStyle,
                    gridTemplateColumns: isMobile
                      ? "1fr"
                      : "repeat(auto-fit, minmax(180px, 1fr))",
                  }}
                >
                  <StatCard
                    title="Total spent"
                    value={`$${formatMoney(monthTotal)}`}
                  />
                  <StatCard title="You paid" value={`$${formatMoney(youPaid)}`} />
                  <StatCard title="You owe" value={`$${formatMoney(youOwe)}`} />
                  <StatCard
                    title="Net"
                    value={`${net >= 0 ? "+" : "-"}$${formatMoney(
                      Math.abs(net)
                    )}`}
                  />
                  <StatCard title="Expenses count" value={`${monthCount}`} />
                </div>
              </div>
            )}

            {tab === "expenses" && <ExpensesPanel />}
            {tab === "personalPayments" && <PersonalPaymentsPanel />}
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
      type="button"
      onClick={onClick}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      style={{
        ...sidebarButtonStyle,
        ...(active ? sidebarButtonActiveStyle : {}),
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
    <div style={statCardSmallStyle}>
      <div style={statTitleStyle}>{title}</div>
      <div style={statValueLargeStyle}>{value}</div>
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

function getTabTitle(tab: Tab) {
  switch (tab) {
    case "profile":
      return "Profile";
    case "thisMonth":
      return "This Month";
    case "expenses":
      return "Expenses";
    case "personalPayments":
      return "Personal Payments";
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
  const map =
    data?.splits ?? data?.shares ?? data?.owedBy ?? data?.splitMap ?? null;

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

const loadingPageStyle: CSSProperties = {
  minHeight: "100vh",
  background: "#07111f",
  color: "white",
  padding: 16,
  display: "grid",
  placeItems: "center",
};

const loadingCardStyle: CSSProperties = {
  width: "100%",
  maxWidth: 520,
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 20,
  padding: 20,
  background: "rgba(255,255,255,0.03)",
};

const loadingTitleStyle: CSSProperties = {
  fontSize: 22,
  fontWeight: 800,
  marginBottom: 8,
};

const loadingSubtleStyle: CSSProperties = {
  color: "rgba(255,255,255,0.68)",
  lineHeight: 1.5,
};

const pageStyle: CSSProperties = {
  minHeight: "100vh",
  background: "#07111f",
  color: "white",
  padding: 12,
};

const shellStyle: CSSProperties = {
  display: "flex",
  gap: 12,
  alignItems: "flex-start",
};

const desktopSidebarStyle: CSSProperties = {
  width: 270,
  maxHeight: "calc(100vh - 24px)",
  overflowY: "auto",
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 20,
  padding: 14,
  background: "rgba(255,255,255,0.03)",
  position: "sticky",
  top: 12,
  WebkitOverflowScrolling: "touch",
};

const mobileSidebarStyle: CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  width: "84vw",
  maxWidth: 320,
  height: "100dvh",
  zIndex: 1001,
  padding: 14,
  background: "#0b1628",
  borderRight: "1px solid rgba(255,255,255,0.10)",
  overflowY: "auto",
  WebkitOverflowScrolling: "touch",
};

const mobileOverlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.45)",
  zIndex: 1000,
};

const mobileTopBarStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  marginBottom: 12,
};

const mobileMenuButtonStyle: CSSProperties = {
  minHeight: 44,
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 12,
  padding: "10px 14px",
  background: "rgba(255,255,255,0.06)",
  color: "white",
  fontWeight: 700,
  cursor: "pointer",
  WebkitTapHighlightColor: "transparent",
  touchAction: "manipulation",
};

const sidebarTopStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  marginBottom: 16,
};

const brandEyebrowStyle: CSSProperties = {
  fontSize: 11,
  letterSpacing: 1.2,
  textTransform: "uppercase",
  color: "rgba(255,255,255,0.65)",
  marginBottom: 4,
};

const brandTitleStyle: CSSProperties = {
  fontSize: 24,
  fontWeight: 800,
};

const iconActionStyle: CSSProperties = {
  minHeight: 40,
  minWidth: 40,
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 12,
  background: "rgba(255,255,255,0.06)",
  color: "white",
  fontWeight: 700,
  cursor: "pointer",
  WebkitTapHighlightColor: "transparent",
  touchAction: "manipulation",
};

const sidebarButtonStyle: CSSProperties = {
  width: "100%",
  textAlign: "left",
  minHeight: 48,
  padding: "12px 14px",
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(255,255,255,0.03)",
  color: "white",
  fontWeight: 600,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  gap: 12,
  WebkitTapHighlightColor: "transparent",
  touchAction: "manipulation",
};

const sidebarButtonActiveStyle: CSSProperties = {
  background: "rgba(59,130,246,0.28)",
  border: "1px solid rgba(96,165,250,0.45)",
};

const sidebarFooterStyle: CSSProperties = {
  marginTop: 16,
  paddingTop: 14,
  borderTop: "1px solid rgba(255,255,255,0.10)",
};

const miniProfileStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: 12,
  borderRadius: 16,
  background: "rgba(255,255,255,0.04)",
};

const miniAvatarStyle: CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: 999,
  display: "grid",
  placeItems: "center",
  fontWeight: 800,
  background: "rgba(59,130,246,0.65)",
};

const miniNameStyle: CSSProperties = {
  fontWeight: 700,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const miniRoleStyle: CSSProperties = {
  fontSize: 12,
  color: "rgba(255,255,255,0.65)",
  marginTop: 2,
};

const mainPanelStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 20,
  padding: 14,
  background: "rgba(255,255,255,0.03)",
};

const topBarStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 12,
  marginBottom: 16,
};

const topBarEyebrowStyle: CSSProperties = {
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: 1.1,
  color: "rgba(255,255,255,0.65)",
  marginBottom: 6,
};

const topBarTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: 22,
  lineHeight: 1.15,
};

const notificationBtnStyle: CSSProperties = {
  position: "relative",
  minHeight: 44,
  minWidth: 44,
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 12,
  padding: "10px 12px",
  background: "rgba(255,255,255,0.06)",
  color: "white",
  cursor: "pointer",
  WebkitTapHighlightColor: "transparent",
  touchAction: "manipulation",
};

const notificationBtnActiveStyle: CSSProperties = {
  background: "rgba(245,158,11,0.28)",
  border: "1px solid rgba(251,191,36,0.45)",
};

const notificationBadgeStyle: CSSProperties = {
  position: "absolute",
  top: -6,
  right: -6,
  background: "#ef4444",
  color: "white",
  borderRadius: 999,
  padding: "2px 7px",
  fontSize: 11,
  fontWeight: 800,
};

const contentAreaStyle: CSSProperties = {
  display: "grid",
  gap: 14,
  minWidth: 0,
};

const sectionCardStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 18,
  padding: 16,
  background: "rgba(255,255,255,0.03)",
};

const profileHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 14,
  marginBottom: 16,
};

const heroAvatarStyle: CSSProperties = {
  width: 60,
  height: 60,
  borderRadius: 999,
  display: "grid",
  placeItems: "center",
  fontWeight: 800,
  fontSize: 20,
  background: "rgba(59,130,246,0.65)",
};

const profileTitleStyle: CSSProperties = {
  fontSize: 24,
  fontWeight: 800,
};

const profileSubtitleStyle: CSSProperties = {
  fontSize: 14,
  color: "rgba(255,255,255,0.70)",
};

const profileGridStyle: CSSProperties = {
  display: "grid",
  gap: 12,
};

const infoPillStyle: CSSProperties = {
  padding: 14,
  borderRadius: 14,
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.08)",
};

const infoPillLabelStyle: CSSProperties = {
  fontSize: 12,
  color: "rgba(255,255,255,0.60)",
  marginBottom: 6,
};

const infoPillValueStyle: CSSProperties = {
  fontWeight: 700,
  wordBreak: "break-word",
};

const actionRowStyle: CSSProperties = {
  marginTop: 16,
  display: "flex",
  gap: 10,
  flexWrap: "wrap",
};

const secondaryBtnStyle: CSSProperties = {
  minHeight: 44,
  border: "1px solid rgba(255,255,255,0.16)",
  borderRadius: 12,
  padding: "10px 14px",
  background: "rgba(255,255,255,0.06)",
  color: "white",
  fontWeight: 700,
  cursor: "pointer",
  WebkitTapHighlightColor: "transparent",
  touchAction: "manipulation",
};

const dangerBtnStyle: CSSProperties = {
  minHeight: 44,
  border: "1px solid rgba(248,113,113,0.55)",
  borderRadius: 12,
  padding: "10px 14px",
  background: "rgba(239,68,68,0.85)",
  color: "white",
  fontWeight: 700,
  cursor: "pointer",
  WebkitTapHighlightColor: "transparent",
  touchAction: "manipulation",
};

const sectionHeaderRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
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
  minHeight: 44,
  width: "100%",
  background: "rgba(255,255,255,0.04)",
  color: "white",
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 12,
  padding: "10px 12px",
  outline: "none",
};

const statsGridStyle: CSSProperties = {
  display: "grid",
  gap: 12,
};

const statCardSmallStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 16,
  padding: 14,
  background: "rgba(255,255,255,0.03)",
  minHeight: 88,
};

const statTitleStyle: CSSProperties = {
  fontSize: 11,
  color: "rgba(255,255,255,0.72)",
  marginBottom: 8,
  textTransform: "uppercase",
  letterSpacing: 0.6,
};

const statValueLargeStyle: CSSProperties = {
  fontSize: 20,
  fontWeight: 800,
  letterSpacing: -0.3,
  lineHeight: 1.15,
};