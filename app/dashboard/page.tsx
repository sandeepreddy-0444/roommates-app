"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import {
  onAuthStateChanged,
  sendPasswordResetEmail,
  signOut,
  deleteUser,
  reauthenticateWithCredential,
  EmailAuthProvider,
  updateProfile,
} from "firebase/auth";
import {
  collection,
  deleteDoc,
  deleteField,
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
import {
  APP_THEME_OPTIONS,
  applyAppTheme,
  getStoredAppThemeId,
  type AppThemeId,
} from "@/app/lib/appTheme";
import { MaterialIcon } from "@/components/MaterialIcon";

import ExpensesPanel from "@/components/ExpensesPanel";
import ChatPanel from "@/components/ChatPanel";
import GroceryPanel from "@/components/GroceryPanel";
import RoommatesPanel from "@/components/RoommatesPanel";
import RemindersPanel from "@/components/RemindersPanel";
import AIAssistantPanel from "@/components/AIAssistantPanel";
import ChoresPanel from "@/components/ChoresPanel";
import SettlementsPanel from "@/components/SettlementsPanel";
import PersonalPaymentsPanel from "@/components/PersonalPaymentsPanel";
import ThisMonthPanel from "@/components/ThisMonthPanel";
import VotingPollsPanel from "../../components/VotingPollsPanel";
import { RegisterPushNotifications } from "@/components/RegisterPushNotifications";

type Tab = "home" | "expenses" | "chat" | "profile";

type ToolPanel =
  | "grocery"
  | "roommates"
  | "reminders"
  | "ai"
  | "chores"
  | "settlements"
  | "personalPayments"
  | "thisMonth"
  | "polls";
type MonthKey = { year: number; month: number };
type Roommate = { uid: string; name: string };

type ChangePasswordResult =
  | { kind: "sent" }
  | { kind: "no_email" }
  | { kind: "error"; message: string };

type LeaveRoomResult =
  | { kind: "ok" }
  | { kind: "admin_must_transfer" }
  | { kind: "not_signed_in" }
  | { kind: "error"; message: string };

const DEFAULT_TAB_ORDER: Tab[] = ["home", "expenses", "chat", "profile"];

export default function DashboardPage() {
  const router = useRouter();

  const [tab, setTab] = useState<Tab>("home");
  const [tabOrder, setTabOrder] = useState<Tab[]>(DEFAULT_TAB_ORDER);
  const [draggingTab, setDraggingTab] = useState<Tab | null>(null);
  const [tabReorderMode, setTabReorderMode] = useState(false);
  const tabLongPressTimerRef = useRef<number | null>(null);
  const [toolPanel, setToolPanel] = useState<ToolPanel | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  const [uid, setUid] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [authDisplayName, setAuthDisplayName] = useState("");

  const [groupId, setGroupId] = useState<string | null>(null);
  const [createdBy, setCreatedBy] = useState<string | null>(null);
  const [roommates, setRoommates] = useState<Roommate[]>([]);
  const [pendingJoinRequestsCount, setPendingJoinRequestsCount] = useState(0);
  const baseNow = useMemo(() => new Date(), []);
  const [selectedMonth, setSelectedMonth] = useState<MonthKey>({
    year: baseNow.getFullYear(),
    month: baseNow.getMonth(),
  });

  const [monthTotal, setMonthTotal] = useState(0);
  const [monthCount, setMonthCount] = useState(0);
  const [youPaid, setYouPaid] = useState(0);
  const [youOwe, setYouOwe] = useState(0);
  const [net, setNet] = useState(0);

  const monthOptions = useMemo(() => {
    const out: MonthKey[] = [];
    const d0 = new Date();
    for (let i = 0; i < 12; i += 1) {
      const d = new Date(d0.getFullYear(), d0.getMonth() - i, 1);
      out.push({ year: d.getFullYear(), month: d.getMonth() });
    }
    return out;
  }, []);

  const myName = useMemo(() => {
    const fromRoommates = uid ? roommates.find((r) => r.uid === uid)?.name : undefined;
    return (fromRoommates || authDisplayName || "").trim();
  }, [uid, roommates, authDisplayName]);

  /** Room admin: `createdBy` on the group, or first member if legacy groups omit it. */
  const adminUid = useMemo(() => {
    if (createdBy) return createdBy;
    return roommates[0]?.uid ?? null;
  }, [createdBy, roommates]);

  const isRoomAdmin = useMemo(
    () => !!(uid && adminUid && uid === adminUid),
    [uid, adminUid]
  );

  /** Keep `createdBy` live (e.g. after admin transfer) so join-request badge stays accurate. */
  useEffect(() => {
    if (!groupId) return;

    const unsub = onSnapshot(doc(db, "groups", groupId), (snap) => {
      if (!snap.exists()) return;
      const data = snap.data() as Record<string, unknown>;
      setCreatedBy(typeof data.createdBy === "string" ? data.createdBy : null);
    });

    return () => unsub();
  }, [groupId]);

  useEffect(() => {
    const key = `home-tab-order:${uid || "guest"}`;
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) {
        setTabOrder(DEFAULT_TAB_ORDER);
        return;
      }
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return;
      const valid = parsed.filter((id): id is Tab => DEFAULT_TAB_ORDER.includes(id as Tab));
      const missing = DEFAULT_TAB_ORDER.filter((id) => !valid.includes(id));
      setTabOrder([...valid, ...missing]);
    } catch {
      setTabOrder(DEFAULT_TAB_ORDER);
    }
  }, [uid]);

  useEffect(() => {
    const key = `home-tab-order:${uid || "guest"}`;
    window.localStorage.setItem(key, JSON.stringify(tabOrder));
  }, [tabOrder, uid]);

  function moveTabToTarget(fromId: Tab, targetId: Tab) {
    setTabOrder((prev) => {
      const from = prev.indexOf(fromId);
      const to = prev.indexOf(targetId);
      if (from < 0 || to < 0 || from === to) return prev;
      const out = [...prev];
      const [moved] = out.splice(from, 1);
      out.splice(to, 0, moved);
      return out;
    });
  }

  function clearTabLongPressTimer() {
    if (tabLongPressTimerRef.current !== null) {
      window.clearTimeout(tabLongPressTimerRef.current);
      tabLongPressTimerRef.current = null;
    }
  }

  useEffect(() => () => clearTabLongPressTimer(), []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        setAuthChecked(true);
        router.replace("/login");
        return;
      }

      setUid(u.uid);
      setEmail(u.email || null);
      setAuthDisplayName(u.displayName || "");

      const userSnap = await getDoc(doc(db, "users", u.uid));
      const userData = userSnap.exists() ? userSnap.data() : undefined;
      const gid = typeof userData?.groupId === "string" ? userData.groupId : null;

      if (!gid) {
        setAuthChecked(true);
        router.replace("/room");
        return;
      }

      setGroupId(gid);

      const groupSnap = await getDoc(doc(db, "groups", gid));
      const groupData = groupSnap.exists() ? groupSnap.data() : undefined;
      setCreatedBy(typeof groupData?.createdBy === "string" ? groupData.createdBy : null);

      setAuthChecked(true);
    });

    return () => unsub();
  }, [router]);

  useEffect(() => {
    if (!groupId) return;

    const unsub = onSnapshot(collection(db, "groups", groupId, "members"), async (snap) => {
      const ids = snap.docs.map((d) => d.id);
      const userDocs = await Promise.all(ids.map((id) => getDoc(doc(db, "users", id))));

      const list: Roommate[] = userDocs.map((docSnap, i) => {
        const memberId = ids[i];
        const data = docSnap.exists() ? docSnap.data() : undefined;
        const fallback = memberId.slice(0, 6);
        return {
          uid: memberId,
          name: typeof data?.name === "string" && data.name.trim() ? data.name : fallback,
        };
      });

      list.sort((a, b) => {
        if (a.uid === uid) return -1;
        if (b.uid === uid) return 1;
        return a.name.localeCompare(b.name);
      });

      setRoommates(list);
    });

    return () => unsub();
  }, [groupId, uid]);

  useEffect(() => {
    if (!groupId || !isRoomAdmin) {
      setPendingJoinRequestsCount(0);
      return;
    }

    const unsub = onSnapshot(
      collection(db, "groups", groupId, "joinRequests"),
      (snap) => {
        setPendingJoinRequestsCount(snap.size);
      },
      (err) => {
        console.warn("joinRequests snapshot:", err);
        setPendingJoinRequestsCount(0);
      }
    );

    return () => unsub();
  }, [groupId, isRoomAdmin]);

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
          const data = d.data();
          const dt = getExpenseDate(data);
          if (!dt || dt < start || dt >= end) continue;

          const amt = Number(data.amount);
          if (!Number.isFinite(amt)) continue;

          total += amt;
          count += 1;

          const payerRaw =
            data.paidByUid ?? data.paidBy ?? data.createdByUid ?? data.createdBy ?? null;
          const payer = payerRaw ? String(payerRaw) : null;

          if (payer === uid) paid += amt;
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
    setToolPanel(null);
  }, [tab]);

  useEffect(() => {
    applyAppTheme(getStoredAppThemeId() ?? "light");
  }, []);

  const loading = !authChecked;

  /**
   * Leave the current room (no browser dialogs). Use from Profile in-app modals; Roommates
   * tool can wrap with `leaveRoom` which may use `confirm` when available.
   */
  async function performLeaveRoom(): Promise<LeaveRoomResult> {
    if (!groupId || !uid) return { kind: "not_signed_in" };

    const others = roommates.filter((r) => r.uid !== uid);
    if (adminUid && uid === adminUid && others.length > 0) {
      return { kind: "admin_must_transfer" };
    }

    try {
      await deleteDoc(doc(db, "groups", groupId, "members", uid));
      try {
        await deleteDoc(doc(db, "groups", groupId, "joinRequests", uid));
      } catch {
        /* no pending request */
      }
      await setDoc(
        doc(db, "users", uid),
        {
          groupId: null,
          pendingJoinGroupId: deleteField(),
          joinRequestNote: deleteField(),
        },
        { merge: true }
      );
      router.replace("/room");
      return { kind: "ok" };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not leave the room. Try again.";
      return { kind: "error", message: msg };
    }
  }

  /** Roommates tool leave action; Roommates panel now handles warning modal. */
  async function leaveRoom() {
    if (!groupId || !uid) return;

    const others = roommates.filter((r) => r.uid !== uid);
    if (adminUid && uid === adminUid && others.length > 0) {
      try {
        window.alert("Transfer admin before leaving.");
      } catch {
        /* alert blocked in some in-app WebViews */
      }
      return;
    }

    const r = await performLeaveRoom();
    if (r.kind === "error") {
      try {
        window.alert(r.message);
      } catch {
        /* ignore */
      }
    }
  }

  async function transferAdmin(newAdminUid: string) {
    if (!groupId || !uid) return;
    if (!adminUid || uid !== adminUid) {
      alert("Only admin can transfer admin.");
      return;
    }

    await updateDoc(doc(db, "groups", groupId), { createdBy: newAdminUid });
    setCreatedBy(newAdminUid);
  }

  async function removeMember(memberUid: string) {
    if (!groupId || !uid) return;
    if (!adminUid || uid !== adminUid) {
      alert("Only admin can remove members.");
      return;
    }

    await deleteDoc(doc(db, "groups", groupId, "members", memberUid));
    try {
      await deleteDoc(doc(db, "groups", groupId, "joinRequests", memberUid));
    } catch {
      /* no pending request */
    }
    await setDoc(
      doc(db, "users", memberUid),
      {
        groupId: null,
        pendingJoinGroupId: deleteField(),
        joinRequestNote: deleteField(),
      },
      { merge: true }
    );
  }

  async function logout() {
    await signOut(auth);
    router.replace("/login");
  }

  async function updateMyDisplayName(nextName: string) {
    if (!uid) throw new Error("Not signed in.");
    const u = auth.currentUser;
    const trimmed = nextName.trim();
    if (!trimmed) throw new Error("Name cannot be empty.");

    await updateDoc(doc(db, "users", uid), { name: trimmed });
    if (u) {
      await updateProfile(u, { displayName: trimmed });
    }
    setAuthDisplayName(trimmed);
  }

  async function changePassword(): Promise<ChangePasswordResult> {
    const addr = auth.currentUser?.email?.trim() || email?.trim() || null;
    if (!addr) {
      return { kind: "no_email" };
    }

    try {
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const continueUrl = origin ? `${origin}/reset-password` : "https://roommates-app.vercel.app/reset-password";

      await sendPasswordResetEmail(auth, addr, {
        url: continueUrl,
        handleCodeInApp: true,
      });
      return { kind: "sent" };
    } catch (e) {
      const err = e as { code?: string; message?: string };
      const code = err?.code;
      if (code === "auth/too-many-requests") {
        return {
          kind: "error",
          message:
            "Too many password reset emails were sent from this device or to this address. For security, email sending is paused. Wait about 15–30 minutes, then try again, or use the link in a reset email you already received.",
        };
      }
      if (code === "auth/network-request-failed") {
        return { kind: "error", message: "Network error. Check your connection and try again." };
      }
      const raw = err?.message ? String(err.message) : "Could not send the reset email.";
      const cleaned = raw
        .replace(/^Firebase:\s*Error\s*\(\s*auth\/[a-z-]+\s*\)\.?\s*/i, "")
        .replace(/^Firebase:\s*/i, "")
        .trim();
      return {
        kind: "error",
        message: cleaned || "Could not send the reset email. Please try again later.",
      };
    }
  }

  async function deleteAccountWithPassword(password: string) {
    const user = auth.currentUser;
    if (!user || !uid) {
      throw new Error("Not signed in.");
    }
    if (!user.email) {
      throw new Error(
        "This account is not an email + password sign-in. Delete is only supported for email sign-in, or use Firebase help."
      );
    }
    if (!password.trim()) {
      throw new Error("Password is required.");
    }

    try {
      const cred = EmailAuthProvider.credential(user.email, password);
      await reauthenticateWithCredential(user, cred);
    } catch {
      throw new Error("That password is incorrect, or the session is invalid. Try again.");
    }

    try {
      if (groupId) {
        await deleteDoc(doc(db, "groups", groupId, "members", uid));
      }
      await deleteDoc(doc(db, "users", uid));
    } catch (e) {
      const err = e as { code?: string; message?: string };
      if (err?.code && err.code !== "permission-denied") {
        throw new Error(err?.message || "Could not update your data.");
      }
    }

    try {
      await deleteUser(user);
    } catch (e) {
      const err = e as { code?: string; message?: string };
      if (err?.code === "auth/requires-recent-login") {
        throw new Error("Session expired. Sign out, sign in again, then try deleting your account.");
      }
      throw new Error(err?.message || "Could not delete your login.");
    }
    router.replace("/login");
  }

  if (loading) {
    return (
      <div style={pageShellStyle}>
        <div style={floatingCardStyle}>
          <h2 style={loadingTitleStyle}>Preparing your room</h2>
          <p style={subtleTextStyle}>Syncing your profile, expenses, and recent updates.</p>
        </div>
      </div>
    );
  }

  return (
    <div
      style={
        tab === "home" && !toolPanel
          ? { ...pageShellStyle, ...pageShellHomeStyle }
          : pageShellStyle
      }
    >
      <RegisterPushNotifications userId={uid} />
      <div style={phoneFrameStyle}>
        <header
          style={
            toolPanel
              ? headerToolStyle
              : {
                  ...headerStyle,
                  ...(tab === "home" ? homeHeaderMainStyle : {}),
                }
          }
        >
          {toolPanel ? (
            <>
              <button
                type="button"
                onClick={() => setToolPanel(null)}
                style={backButtonStyle}
                aria-label="Back"
              >
                <MaterialIcon name="arrow_back" size={24} />
              </button>
              <h1 style={headerTitleCenterStyle}>{toolTitle(toolPanel)}</h1>
              <div style={{ width: 44 }} aria-hidden />
            </>
          ) : (
            <div>
              {tab === "home" ? (
                <div style={homeHeaderPillRowStyle}>
                  <div style={homeHeaderBrandPillStyle}>
                    <MaterialIcon
                      name="group"
                      size={20}
                      style={{ color: "var(--app-text-secondary)", flexShrink: 0 }}
                    />
                    <span style={homeHeaderBrandPillTextStyle}>Roommates</span>
                  </div>
                </div>
              ) : (
                <>
                  <p style={eyebrowStyle}>Roommates</p>
                  {tab !== "profile" ? (
                    <h1 style={titleStyle}>{tabTitle(tab)}</h1>
                  ) : null}
                </>
              )}
            </div>
          )}
        </header>

        <main
          className="app-scroll"
          style={
            !toolPanel && tab === "home" ? homeMainAreaStyle : contentStyle
          }
        >
          {toolPanel ? (
            <section style={{ ...contentCardStyle, minWidth: 0 }}>
              {toolPanel === "grocery" ? <GroceryPanel /> : null}
              {toolPanel === "roommates" && groupId && uid ? (
                <RoommatesPanel
                  groupId={groupId}
                  roommates={roommates}
                  isCreator={!!uid && !!adminUid && uid === adminUid}
                  myUid={uid}
                  createdByUid={adminUid}
                  onRemove={removeMember}
                  onTransferAdmin={transferAdmin}
                  onLeave={leaveRoom}
                />
              ) : null}
              {toolPanel === "reminders" && groupId ? <RemindersPanel groupId={groupId} /> : null}
              {toolPanel === "ai" ? <AIAssistantPanel /> : null}
              {toolPanel === "chores" ? <ChoresPanel /> : null}
              {toolPanel === "settlements" ? <SettlementsPanel /> : null}
              {toolPanel === "personalPayments" ? <PersonalPaymentsPanel /> : null}
              {toolPanel === "thisMonth" ? (
                <ThisMonthPanel
                  monthOptions={monthOptions}
                  selectedMonth={selectedMonth}
                  onChangeMonth={setSelectedMonth}
                  monthTotal={monthTotal}
                  monthCount={monthCount}
                  youPaid={youPaid}
                  youOwe={youOwe}
                  net={net}
                />
              ) : null}
              {toolPanel === "polls" && groupId && uid ? (
                <VotingPollsPanel groupId={groupId} myUid={uid} myName={myName || "Roommate"} />
              ) : null}
            </section>
          ) : null}

          {!toolPanel && tab === "home" ? (
            <HomeTab
              onOpenTool={setToolPanel}
              name={myName}
              userKey={uid}
              isRoomAdmin={isRoomAdmin}
              pendingJoinRequestsCount={pendingJoinRequestsCount}
            />
          ) : null}

          {!toolPanel && tab === "expenses" ? (
            <section style={contentCardStyle}>
              <CardHeader
                title="Shared Expenses"
                subtitle="Track spending with transparent splits and clean summaries."
              />
              <ExpensesPanel />
            </section>
          ) : null}

          {!toolPanel && tab === "chat" ? (
            <section style={contentCardStyle}>
              <ChatPanel />
            </section>
          ) : null}

          {!toolPanel && tab === "profile" ? (
            <ProfileTab
              name={myName || "Not set"}
              email={email || "No email"}
              role={!!uid && !!adminUid && uid === adminUid ? "Admin" : "Member"}
              groupId={groupId || "Not available"}
              uid={uid}
              onUpdateDisplayName={updateMyDisplayName}
              onChangePassword={changePassword}
              onLeaveRoom={performLeaveRoom}
              onLogout={logout}
              onDeleteAccount={deleteAccountWithPassword}
            />
          ) : null}
        </main>

        <nav style={tabBarStyle}>
          {tabOrder.map((tabId) => (
            <TabButton
              key={tabId}
              id={tabId}
              active={tab === tabId}
              label={tabTitle(tabId)}
              onPress={setTab}
              isReordering={tabReorderMode}
              isDragging={draggingTab === tabId}
              onDragStartTab={(id) => tabReorderMode && setDraggingTab(id)}
              onDragEnterTab={(id) => tabReorderMode && draggingTab && moveTabToTarget(draggingTab, id)}
              onDragEndTab={() => tabReorderMode && setDraggingTab(null)}
              onTouchStartTab={(id) => {
                clearTabLongPressTimer();
                tabLongPressTimerRef.current = window.setTimeout(() => {
                  setTabReorderMode(true);
                  setDraggingTab(id);
                }, 340);
              }}
              onTouchMoveTab={(e, id) => {
                if (!tabReorderMode || !draggingTab) return;
                e.preventDefault();
                if (draggingTab !== id) moveTabToTarget(draggingTab, id);
              }}
              onTouchEndTab={() => {
                clearTabLongPressTimer();
                if (!tabReorderMode) return;
                setDraggingTab(null);
                setTabReorderMode(false);
              }}
            />
          ))}
        </nav>
      </div>
    </div>
  );
}

const HOME_TOOLS: Array<{ id: ToolPanel; icon: string; label: string }> = [
  { id: "grocery", icon: "shopping_cart", label: "Grocery" },
  { id: "roommates", icon: "group", label: "Roommates" },
  { id: "reminders", icon: "schedule", label: "Reminders" },
  { id: "ai", icon: "smart_toy", label: "AI assistant" },
  { id: "chores", icon: "cleaning_services", label: "Chores" },
  { id: "settlements", icon: "compare_arrows", label: "Settlements" },
  { id: "personalPayments", icon: "account_balance_wallet", label: "Personal pay" },
  { id: "thisMonth", icon: "calendar_month", label: "This month" },
  { id: "polls", icon: "how_to_vote", label: "Voting / Polls" },
];

function HomeTab({
  onOpenTool,
  name,
  userKey,
  isRoomAdmin,
  pendingJoinRequestsCount,
}: {
  onOpenTool: (id: ToolPanel) => void;
  name: string;
  userKey: string | null;
  isRoomAdmin: boolean;
  pendingJoinRequestsCount: number;
}) {
  const [reorderMode, setReorderMode] = useState(false);
  const [toolOrder, setToolOrder] = useState<ToolPanel[]>(HOME_TOOLS.map((t) => t.id));
  const [draggingToolId, setDraggingToolId] = useState<ToolPanel | null>(null);

  useEffect(() => {
    const key = `home-tool-order:${userKey || "guest"}`;
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) {
        setToolOrder(HOME_TOOLS.map((t) => t.id));
        return;
      }
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return;
      const valid = parsed.filter((id): id is ToolPanel =>
        HOME_TOOLS.some((t) => t.id === id)
      );
      const missing = HOME_TOOLS.map((t) => t.id).filter((id) => !valid.includes(id));
      setToolOrder([...valid, ...missing]);
    } catch {
      setToolOrder(HOME_TOOLS.map((t) => t.id));
    }
  }, [userKey]);

  useEffect(() => {
    const key = `home-tool-order:${userKey || "guest"}`;
    window.localStorage.setItem(key, JSON.stringify(toolOrder));
  }, [toolOrder, userKey]);

  function moveToolToTarget(fromId: ToolPanel, targetId: ToolPanel) {
    setToolOrder((prev) => {
      const from = prev.indexOf(fromId);
      const to = prev.indexOf(targetId);
      if (from < 0 || to < 0 || from === to) return prev;
      const out = [...prev];
      const [moved] = out.splice(from, 1);
      out.splice(to, 0, moved);
      return out;
    });
  }

  function handleTouchMove(e: React.TouchEvent<HTMLDivElement>, overId: ToolPanel) {
    if (!reorderMode || !draggingToolId) return;
    e.preventDefault();
    if (draggingToolId !== overId) moveToolToTarget(draggingToolId, overId);
  }

  const orderedTools = toolOrder
    .map((id) => HOME_TOOLS.find((t) => t.id === id))
    .filter((t): t is { id: ToolPanel; icon: string; label: string } => !!t);

  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = (name || "").trim().split(/\s+/)[0] || "Roommate";

  return (
    <div style={homeHomeRootStyle}>
      <div style={homeHeroZoneStyle}>
        <div style={homeWowTopRowStyle}>
          <div style={{ minWidth: 0 }}>
            <div style={homeHeroGreetingStyle}>
              {greeting}, {firstName}
            </div>
            <div style={homeWowSubStyle}>Let&apos;s keep your shared life smooth today.</div>
          </div>
          <div style={homeHeroActionsStyle}>
            <button
              type="button"
              style={{ ...homeReorderBtnStyle, ...(reorderMode ? homeReorderBtnActiveStyle : {}) }}
              onClick={() => {
                setReorderMode((v) => !v);
                setDraggingToolId(null);
              }}
            >
              {reorderMode ? "Done" : "Reorder"}
            </button>
            <div style={homeWowSparkStyle} aria-hidden>
              ✦
            </div>
          </div>
        </div>
      </div>

      <div style={homeSheetStyle}>
        <div style={homeToolGridStyle}>
        {orderedTools.map((tool) => (
          <HomeToolTile
            key={tool.id}
            toolId={tool.id}
            icon={tool.icon}
            label={tool.label}
            badgeCount={
              tool.id === "roommates" && isRoomAdmin ? pendingJoinRequestsCount : undefined
            }
            onClick={() => onOpenTool(tool.id)}
            isReordering={reorderMode}
            isDragging={draggingToolId === tool.id}
            onDragStartTool={(id) => setDraggingToolId(id)}
            onDragEnterTool={(id) => draggingToolId && moveToolToTarget(draggingToolId, id)}
            onDragEndTool={() => setDraggingToolId(null)}
            onTouchStartTool={(id) => setDraggingToolId(id)}
            onTouchMoveTool={handleTouchMove}
            onTouchEndTool={() => setDraggingToolId(null)}
          />
        ))}
        </div>
      </div>
    </div>
  );
}

function HomeToolTile({
  toolId,
  icon,
  label,
  onClick,
  badgeCount,
  isReordering,
  isDragging,
  onDragStartTool,
  onDragEnterTool,
  onDragEndTool,
  onTouchStartTool,
  onTouchMoveTool,
  onTouchEndTool,
}: {
  toolId: ToolPanel;
  icon: string;
  label: string;
  onClick: () => void;
  badgeCount?: number;
  isReordering?: boolean;
  isDragging?: boolean;
  onDragStartTool?: (id: ToolPanel) => void;
  onDragEnterTool?: (id: ToolPanel) => void;
  onDragEndTool?: () => void;
  onTouchStartTool?: (id: ToolPanel) => void;
  onTouchMoveTool?: (e: React.TouchEvent<HTMLDivElement>, id: ToolPanel) => void;
  onTouchEndTool?: () => void;
}) {
  return (
    <div
      style={{ ...homeToolTileWrapStyle, ...(isDragging ? homeToolTileWrapDraggingStyle : {}) }}
      draggable={!!isReordering}
      onDragStart={() => onDragStartTool?.(toolId)}
      onDragEnter={() => onDragEnterTool?.(toolId)}
      onDragOver={(e) => {
        if (isReordering) e.preventDefault();
      }}
      onDragEnd={onDragEndTool}
      onTouchStart={() => onTouchStartTool?.(toolId)}
      onTouchMove={(e) => onTouchMoveTool?.(e, toolId)}
      onTouchEnd={onTouchEndTool}
      onTouchCancel={onTouchEndTool}
    >
      <button
        type="button"
        onClick={isReordering ? undefined : onClick}
        aria-label={
          toolId === "roommates" && typeof badgeCount === "number" && badgeCount > 0
            ? `Roommates, ${badgeCount} pending join ${badgeCount === 1 ? "request" : "requests"}`
            : undefined
        }
        style={{
          ...homeToolTileStyle,
          ...(isReordering ? homeToolTileReorderingStyle : {}),
          ...(toolId === "roommates" ? homeToolTileRoommatesStyle : {}),
        }}
      >
        {typeof badgeCount === "number" && badgeCount > 0 ? (
          <span style={toolTileBadgeStyle} aria-hidden>
            {badgeCount > 99 ? "99+" : badgeCount}
          </span>
        ) : null}
        <div style={toolTileIconWrapStyle}>
          <MaterialIcon
            name={icon}
            size={24}
            style={{
              fontSize: "clamp(22px, 5.6vw, 26px)",
              color: "var(--app-tile-icon)",
            }}
          />
        </div>
        <span style={toolTileLabelStyle}>{label}</span>
      </button>
      {isReordering ? <div style={homeDragHintStyle}>Drag</div> : null}
    </div>
  );
}

function ProfileTab({
  name,
  email,
  role,
  groupId,
  uid,
  onUpdateDisplayName,
  onChangePassword,
  onLeaveRoom,
  onLogout,
  onDeleteAccount,
}: {
  name: string;
  email: string;
  role: string;
  groupId: string;
  uid: string | null;
  onUpdateDisplayName: (name: string) => Promise<void>;
  onChangePassword: () => Promise<ChangePasswordResult>;
  onLeaveRoom: () => Promise<LeaveRoomResult>;
  onLogout: () => void;
  onDeleteAccount: (password: string) => Promise<void>;
}) {
  const [deleteStep, setDeleteStep] = useState<0 | 1 | 2>(0);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  /** 0 closed, 1 first confirm, 2 second confirm, 3 admin must transfer */
  const [leaveDialogStep, setLeaveDialogStep] = useState<0 | 1 | 2 | 3>(0);
  const [leaveWorking, setLeaveWorking] = useState(false);
  const [leaveErr, setLeaveErr] = useState<string | null>(null);
  const [passwordSending, setPasswordSending] = useState(false);
  const [passwordResult, setPasswordResult] = useState<ChangePasswordResult | null>(null);

  const [editingProfile, setEditingProfile] = useState(false);
  const [nameDraft, setNameDraft] = useState(name);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileErr, setProfileErr] = useState<string | null>(null);
  const [roomIdCopied, setRoomIdCopied] = useState(false);
  const [appTheme, setAppTheme] = useState<AppThemeId>("light");

  useEffect(() => {
    if (!editingProfile) setNameDraft(name);
  }, [name, editingProfile]);

  useEffect(() => {
    setAppTheme(getStoredAppThemeId() ?? "light");
  }, []);

  function openDeleteFlow() {
    setDeleteError(null);
    setDeletePassword("");
    setDeleteStep(1);
  }

  function closeDeleteFlow() {
    setDeleteStep(0);
    setDeletePassword("");
    setDeleteError(null);
  }

  async function submitDelete() {
    setDeleteError(null);
    if (!deletePassword.trim()) {
      setDeleteError("Enter your password to confirm.");
      return;
    }
    setDeleteLoading(true);
    try {
      await onDeleteAccount(deletePassword);
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Could not delete account");
    } finally {
      setDeleteLoading(false);
    }
  }

  async function saveDisplayName() {
    setProfileErr(null);
    setProfileSaving(true);
    try {
      await onUpdateDisplayName(nameDraft);
      setEditingProfile(false);
    } catch (e) {
      setProfileErr(e instanceof Error ? e.message : "Could not save name.");
    } finally {
      setProfileSaving(false);
    }
  }

  function openNameEdit() {
    setProfileErr(null);
    setNameDraft(name);
    setEditingProfile(true);
  }

  async function copyRoomIdToClipboard() {
    if (!groupId || groupId === "Not available") return;
    try {
      await navigator.clipboard.writeText(groupId);
      setRoomIdCopied(true);
      window.setTimeout(() => setRoomIdCopied(false), 2000);
    } catch {
      // clipboard may be denied in some contexts
    }
  }

  function closeLeaveDialog() {
    if (leaveWorking) return;
    setLeaveDialogStep(0);
    setLeaveErr(null);
  }

  async function runChangePassword() {
    setPasswordResult(null);
    setPasswordSending(true);
    try {
      const r = await onChangePassword();
      setPasswordResult(r);
    } finally {
      setPasswordSending(false);
    }
  }

  async function runLeaveRoomFinal() {
    setLeaveErr(null);
    setLeaveWorking(true);
    try {
      const r = await onLeaveRoom();
      if (r.kind === "ok") {
        setLeaveDialogStep(0);
      } else if (r.kind === "admin_must_transfer") {
        setLeaveDialogStep(3);
      } else if (r.kind === "not_signed_in") {
        setLeaveErr("You are not signed in.");
      } else {
        setLeaveErr(r.message);
      }
    } finally {
      setLeaveWorking(false);
    }
  }

  return (
    <div style={profileTabStackStyle}>
      <section style={profileContentCardStyle}>
        <CardHeader title="Profile" subtitle="Account and room access settings." tight />

        {editingProfile ? (
          <div style={{ ...stackStyle, marginTop: 0, gap: 10 }}>
            <label style={fieldLabelStyle} htmlFor="profile-name-input">
              Display name
            </label>
            <input
              id="profile-name-input"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              style={{ ...selectStyle, width: "100%" }}
              autoComplete="name"
              disabled={profileSaving}
            />
            {profileErr ? <p style={{ color: "#b91c1c", fontSize: 14, margin: 0 }}>{profileErr}</p> : null}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                type="button"
                style={primaryActionStyle}
                onClick={saveDisplayName}
                disabled={profileSaving}
              >
                {profileSaving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                style={secondaryActionStyle}
                onClick={() => {
                  setEditingProfile(false);
                  setNameDraft(name);
                  setProfileErr(null);
                }}
                disabled={profileSaving}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div style={infoRowDenseStyle}>
            <span style={infoLabelDenseStyle}>Name</span>
            <div style={profileNameValueRowStyle}>
              <span style={infoValueStyle}>{name}</span>
              <button
                type="button"
                onClick={openNameEdit}
                style={profileIconButtonStyle}
                aria-label="Edit name"
                title="Edit name"
              >
                <MaterialIcon name="edit" size={20} style={{ color: "var(--app-icon-muted)" }} />
              </button>
            </div>
          </div>
        )}

        <InfoRow label="Email" value={email} dense />
        <InfoRow label="Role" value={role} dense />
        <div style={{ ...infoRowDenseStyle, borderBottom: "none", paddingBottom: 0 }}>
          <span style={infoLabelDenseStyle}>Room ID</span>
          <div style={profileRoomIdValueRowStyle}>
            <span
              style={{
                ...infoValueStyle,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, monospace",
                wordBreak: "break-all" as const,
                flex: 1,
                minWidth: 0,
              }}
            >
              {groupId}
            </span>
            {groupId !== "Not available" ? (
              <button
                type="button"
                onClick={() => void copyRoomIdToClipboard()}
                style={profileIconButtonStyle}
                aria-label={roomIdCopied ? "Copied" : "Copy room ID"}
                title={roomIdCopied ? "Copied" : "Copy room ID"}
              >
                <MaterialIcon
                  name={roomIdCopied ? "check" : "content_copy"}
                  size={20}
                  style={{ color: roomIdCopied ? "#166534" : "var(--app-icon-muted)" }}
                />
              </button>
            ) : null}
          </div>
        </div>

        <div style={profileActionRowStyle}>
          <button
            type="button"
            style={{
              ...secondaryActionStyle,
              ...profileActionBtnCompactStyle,
              opacity: passwordSending ? 0.7 : 1,
            }}
            disabled={passwordSending}
            onClick={() => {
              void runChangePassword();
            }}
          >
            {passwordSending ? "…" : "Change Password"}
          </button>
          <button
            type="button"
            style={{ ...dangerActionStyle, ...profileActionBtnCompactStyle, fontWeight: 700 }}
            onClick={() => {
              setLeaveErr(null);
              setLeaveDialogStep(1);
            }}
          >
            Leave Room
          </button>
          <button
            type="button"
            style={{ ...ghostActionStyle, ...profileActionBtnCompactStyle }}
            onClick={onLogout}
          >
            Logout
          </button>
          <button
            type="button"
            style={{ ...deleteAccountOutlineStyle, ...profileActionBtnCompactStyle, fontWeight: 700 }}
            onClick={openDeleteFlow}
          >
            Delete account
          </button>
        </div>
        {passwordResult ? (
          <p
            style={
              passwordResult.kind === "sent"
                ? profilePasswordOkStyle
                : profilePasswordErrStyle
            }
            role="status"
          >
            {passwordResult.kind === "sent"
              ? "Reset link sent — check your email and spam."
              : passwordResult.kind === "no_email"
                ? "No email on this sign-in. Use email & password, or add an email in your account."
                : passwordResult.message}
          </p>
        ) : null}
      </section>

      <section style={profileContentCardStyle}>
        <CardHeader title="Appearance" subtitle="Tap a look — saved on this device." tight />
        <div style={themePickerGridStyle} role="radiogroup" aria-label="App color theme">
          {APP_THEME_OPTIONS.map((opt) => {
            const selected = appTheme === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                className="app-theme-tile"
                role="radio"
                aria-checked={selected}
                title={`${opt.label}: ${opt.hint}`}
                onClick={() => {
                  applyAppTheme(opt.id);
                  setAppTheme(opt.id);
                }}
                style={{
                  ...themeOptionButtonStyle,
                  ...(selected ? themeOptionButtonSelectedStyle : {}),
                }}
              >
                <span
                  aria-hidden
                  style={{
                    ...themePreviewStripStyle,
                    background: `linear-gradient(90deg, ${opt.swatchBg} 0%, ${opt.swatchBg} 50%, ${opt.swatchAccent} 50%, ${opt.swatchAccent} 100%)`,
                  }}
                />
                <span style={themeOptionLabelStyle}>{opt.label}</span>
              </button>
            );
          })}
        </div>
      </section>

      {leaveDialogStep > 0 ? (
        <div
          style={leaveModalOverlayStyle}
          onClick={leaveWorking ? undefined : closeLeaveDialog}
          onKeyDown={(e) => e.key === "Escape" && !leaveWorking && closeLeaveDialog()}
          role="presentation"
        >
          <div
            style={deleteModalCardStyle}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="leave-dialog-title"
          >
            {leaveDialogStep === 1 ? (
              <>
                <h3 id="leave-dialog-title" style={cardTitleStyle}>
                  Leave this room?
                </h3>
                <p style={subtleTextStyle}>
                  You can rejoin with the room code if you have it, but you will be removed from the
                  member list and lose quick access to this group&apos;s shared data until you
                  rejoin.
                </p>
                <div style={{ display: "flex", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
                  <button type="button" style={secondaryActionStyle} onClick={closeLeaveDialog}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    style={dangerActionStyle}
                    onClick={() => {
                      setLeaveErr(null);
                      setLeaveDialogStep(2);
                    }}
                  >
                    Continue
                  </button>
                </div>
              </>
            ) : null}
            {leaveDialogStep === 2 ? (
              <>
                <h3 id="leave-dialog-title" style={cardTitleStyle}>
                  Leave room
                </h3>
                <p style={subtleTextStyle}>
                  This will remove you from the room. This action is not easily undone. Are you sure
                  you want to leave?
                </p>
                {leaveErr ? (
                  <p style={{ color: "#b91c1c", fontSize: 14, margin: 0 }} role="alert">
                    {leaveErr}
                  </p>
                ) : null}
                <div style={{ display: "flex", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    style={secondaryActionStyle}
                    onClick={() => {
                      setLeaveErr(null);
                      setLeaveDialogStep(1);
                    }}
                    disabled={leaveWorking}
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    style={dangerActionStyle}
                    onClick={() => {
                      void runLeaveRoomFinal();
                    }}
                    disabled={leaveWorking}
                  >
                    {leaveWorking ? "Leaving…" : "Leave room"}
                  </button>
                </div>
              </>
            ) : null}
            {leaveDialogStep === 3 ? (
              <>
                <h3 id="leave-dialog-title" style={cardTitleStyle}>
                  Transfer admin first
                </h3>
                <p style={subtleTextStyle}>
                  As the only admin, you need to <strong>make another member the admin</strong> in
                  the Roommates list below before you can leave. After someone else is admin, you
                  can leave the room.
                </p>
                <div style={{ display: "flex", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    style={primaryActionStyle}
                    onClick={closeLeaveDialog}
                  >
                    OK
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {deleteStep > 0 ? (
        <div
          style={deleteModalOverlayStyle}
          onClick={deleteLoading ? undefined : closeDeleteFlow}
          onKeyDown={(e) => e.key === "Escape" && !deleteLoading && closeDeleteFlow()}
          role="presentation"
        >
          <div
            style={deleteModalCardStyle}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-dialog-title"
          >
            {deleteStep === 1 ? (
              <>
                <h3 id="delete-dialog-title" style={cardTitleStyle}>
                  Delete your account?
                </h3>
                <p style={subtleTextStyle}>
                  This will remove your login and your saved profile. If you are in a room, you will
                  be removed from the members list. This cannot be easily undone. Are you sure you
                  want to continue?
                </p>
                <div style={{ display: "flex", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
                  <button type="button" style={secondaryActionStyle} onClick={closeDeleteFlow}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    style={dangerActionStyle}
                    onClick={() => {
                      setDeleteError(null);
                      setDeleteStep(2);
                    }}
                  >
                    Yes, continue
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 id="delete-dialog-title-2" style={cardTitleStyle}>
                  Final step
                </h3>
                <p style={subtleTextStyle}>
                  Just to be sure: you are about to <strong>permanently</strong> delete this account
                  and sign out. Enter your <strong>password</strong> to confirm.
                </p>
                <input
                  type="password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  placeholder="Current password"
                  style={{ ...selectStyle, marginTop: 6, width: "100%" }}
                  autoComplete="current-password"
                  disabled={deleteLoading}
                />
                {deleteError ? <p style={{ color: "#b91c1c", fontSize: 14, margin: 0 }}>{deleteError}</p> : null}
                <div style={{ display: "flex", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    style={secondaryActionStyle}
                    onClick={closeDeleteFlow}
                    disabled={deleteLoading}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    style={dangerActionStyle}
                    onClick={submitDelete}
                    disabled={deleteLoading}
                  >
                    {deleteLoading ? "Deleting…" : "Delete my account"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CardHeader({
  title,
  subtitle,
  tight,
}: {
  title: string;
  subtitle: string;
  /** Tighter title ↔ subtitle and less space before the next row (Profile, etc.) */
  tight?: boolean;
}) {
  return (
    <div style={tight ? cardHeaderTightStyle : cardHeaderStyle}>
      <h2 style={cardTitleStyle}>{title}</h2>
      <p style={tight ? subtleTextTightStyle : subtleTextStyle}>{subtitle}</p>
    </div>
  );
}

function InfoRow({
  label,
  value,
  mono = false,
  dense = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  /** Less vertical padding between label and value, and to the next row */
  dense?: boolean;
}) {
  return (
    <div style={dense ? infoRowDenseStyle : infoRowStyle}>
      <span style={dense ? infoLabelDenseStyle : infoLabelStyle}>{label}</span>
      <span style={{ ...infoValueStyle, fontFamily: mono ? "ui-monospace, SFMono-Regular, Menlo, monospace" : undefined }}>
        {value}
      </span>
    </div>
  );
}

const TAB_MATERIAL_ICONS: Record<Tab, string> = {
  home: "home",
  expenses: "payments",
  chat: "chat",
  profile: "person",
};

function TabButton({
  id,
  label,
  active,
  onPress,
  isReordering,
  isDragging,
  onDragStartTab,
  onDragEnterTab,
  onDragEndTab,
  onTouchStartTab,
  onTouchMoveTab,
  onTouchEndTab,
}: {
  id: Tab;
  label: string;
  active: boolean;
  onPress: (tab: Tab) => void;
  isReordering?: boolean;
  isDragging?: boolean;
  onDragStartTab?: (tab: Tab) => void;
  onDragEnterTab?: (tab: Tab) => void;
  onDragEndTab?: () => void;
  onTouchStartTab?: (tab: Tab) => void;
  onTouchMoveTab?: (e: React.TouchEvent<HTMLButtonElement>, tab: Tab) => void;
  onTouchEndTab?: () => void;
}) {
  const iconColor = active ? "var(--app-accent-pressed)" : "var(--app-nav-icon-muted)";

  return (
    <button
      type="button"
      onClick={isReordering ? undefined : () => onPress(id)}
      style={{
        ...tabButtonStyle,
        ...(active ? tabButtonActiveStyle : {}),
        ...(isReordering ? tabButtonReorderingStyle : {}),
        ...(isDragging ? tabButtonDraggingStyle : {}),
      }}
      aria-label={`${label} tab`}
      aria-current={active ? "page" : undefined}
      draggable={!!isReordering}
      onDragStart={() => onDragStartTab?.(id)}
      onDragEnter={() => onDragEnterTab?.(id)}
      onDragOver={(e) => e.preventDefault()}
      onDragEnd={onDragEndTab}
      onTouchStart={() => onTouchStartTab?.(id)}
      onTouchMove={(e) => onTouchMoveTab?.(e, id)}
      onTouchEnd={onTouchEndTab}
      onTouchCancel={onTouchEndTab}
    >
      <MaterialIcon
        name={TAB_MATERIAL_ICONS[id]}
        size={24}
        style={{
          fontSize: "clamp(22px, 5.5vw, 24px)",
          color: iconColor,
          display: "block",
        }}
      />
      {label}
      {isReordering ? <MaterialIcon name="drag_indicator" size={14} style={tabDragHintStyle} /> : null}
    </button>
  );
}

function toolTitle(id: ToolPanel): string {
  const labels: Record<ToolPanel, string> = {
    grocery: "Grocery",
    roommates: "Roommates",
    reminders: "Reminders",
    ai: "AI Assistant",
    chores: "Chores",
    settlements: "Settlements",
    personalPayments: "Personal payments",
    thisMonth: "This month",
    polls: "Voting / Polls",
  };
  return labels[id];
}

function tabTitle(tab: Tab) {
  if (tab === "home") return "Home";
  if (tab === "expenses") return "Expenses";
  if (tab === "chat") return "Chat";
  return "Profile";
}

function monthLabel(year: number, month: number) {
  return new Date(year, month, 1).toLocaleString(undefined, {
    month: "long",
    year: "numeric",
  });
}

function formatMoney(n: number) {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return v.toFixed(2);
}

function getExpenseDate(data: Record<string, unknown>): Date | null {
  const dateValue = data.date;

  if (typeof dateValue === "string") {
    const d = new Date(`${dateValue}T00:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  if (
    typeof dateValue === "object" &&
    dateValue !== null &&
    "toDate" in dateValue &&
    typeof (dateValue as { toDate: () => Date }).toDate === "function"
  ) {
    return (dateValue as { toDate: () => Date }).toDate();
  }

  const createdAt = data.createdAt;
  if (
    typeof createdAt === "object" &&
    createdAt !== null &&
    "toDate" in createdAt &&
    typeof (createdAt as { toDate: () => Date }).toDate === "function"
  ) {
    return (createdAt as { toDate: () => Date }).toDate();
  }

  return null;
}

function estimateOwedForUser(data: Record<string, unknown>, uid: string, amount: number): number {
  const mapSource =
    data.splits ?? data.shares ?? data.owedBy ?? data.splitMap ?? null;

  if (typeof mapSource === "object" && mapSource !== null && !Array.isArray(mapSource)) {
    const value = (mapSource as Record<string, unknown>)[uid];
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }

  const arrSource =
    data.participants ?? data.participantUids ?? data.splitBetween ?? data.sharedWith ?? null;

  if (Array.isArray(arrSource) && arrSource.length > 0) {
    const hasMe = arrSource.map(String).includes(String(uid));
    if (!hasMe) return 0;
    return amount / arrSource.length;
  }

  return 0;
}

const pageShellStyle: CSSProperties = {
  minHeight: "100dvh",
  paddingTop: "max(12px, env(safe-area-inset-top, 0px))",
  paddingLeft: "max(12px, env(safe-area-inset-left, 0px))",
  paddingRight: "max(12px, env(safe-area-inset-right, 0px))",
  paddingBottom: 0,
  color: "var(--app-text-primary)",
  backgroundColor: "var(--app-page-bg)",
  WebkitTextSizeAdjust: "100%",
  textSizeAdjust: "100%",
};

const pageShellHomeStyle: CSSProperties = {
  background: "var(--app-home-gradient)",
  backgroundColor: "transparent",
};

/** Home tab: thin rule under the pill; keep bottom padding tight so the grid sits close under the line. */
const homeHeaderMainStyle: CSSProperties = {
  padding: "2px 2px 4px",
  borderBottom: "1px solid color-mix(in srgb, var(--app-border-subtle) 85%, transparent)",
};

const homeHeaderPillRowStyle: CSSProperties = {
  width: "100%",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
};

const homeHeaderBrandPillStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 14px",
  borderRadius: 999,
  background: "rgba(255, 255, 255, 0.42)",
  backdropFilter: "blur(14px)",
  WebkitBackdropFilter: "blur(14px)",
  border: "1px solid rgba(255, 255, 255, 0.55)",
  boxShadow: "0 4px 18px rgba(45, 20, 75, 0.1)",
};

const homeHeaderBrandPillTextStyle: CSSProperties = {
  fontSize: "clamp(14px, 3.6vw, 15px)",
  fontWeight: 650,
  letterSpacing: "-0.02em",
  color: "var(--app-text-primary)",
};

/** Home <main>: block layout (not grid) so the tile block doesn’t pick up extra vertical space. */
const homeMainAreaStyle: CSSProperties = {
  display: "block",
  width: "100%",
  minWidth: 0,
  margin: 0,
  padding: 0,
};

const homeHomeRootStyle: CSSProperties = {
  display: "block",
  width: "100%",
  minWidth: 0,
  margin: 0,
  padding: 0,
};

/** Greeting sits on the sunset gradient (transparent main area). */
const homeHeroZoneStyle: CSSProperties = {
  padding: "14px 16px 22px",
};

/** Cream sheet overlapping the gradient — matches reference “card over sunset”. */
const homeSheetStyle: CSSProperties = {
  borderRadius: "28px 28px 0 0",
  background: "var(--app-home-sheet-bg)",
  boxShadow: "var(--app-home-sheet-shadow)",
  padding: "20px 12px 4px",
  marginTop: -2,
  minWidth: 0,
  overflow: "visible",
};

const homeWowTopRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
};

const homeWowGreetingStyle: CSSProperties = {
  margin: 0,
  fontWeight: 850,
  letterSpacing: "-0.02em",
  fontSize: "clamp(16px, 4.1vw, 20px)",
  color: "var(--app-text-primary)",
  lineHeight: 1.15,
};

const homeHeroGreetingStyle: CSSProperties = {
  ...homeWowGreetingStyle,
  fontFamily: "var(--app-home-hero-font)",
  textShadow: "var(--app-home-hero-text-shadow)",
};

const homeWowSubStyle: CSSProperties = {
  marginTop: 2,
  fontSize: "clamp(11px, 2.8vw, 12px)",
  color: "var(--app-text-secondary)",
  lineHeight: 1.35,
  textShadow: "var(--app-home-hero-text-shadow)",
};

const homeWowSparkStyle: CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: 999,
  display: "grid",
  placeItems: "center",
  fontSize: 17,
  color: "var(--app-accent-pressed)",
  background: "rgba(255, 255, 255, 0.38)",
  border: "1px solid rgba(255, 255, 255, 0.55)",
  backdropFilter: "blur(14px)",
  WebkitBackdropFilter: "blur(14px)",
  flexShrink: 0,
  boxShadow: "0 4px 16px rgba(45, 20, 75, 0.12)",
};

const homeHeroActionsStyle: CSSProperties = {
  display: "grid",
  gap: 6,
  justifyItems: "end",
  flexShrink: 0,
};

const homeReorderBtnStyle: CSSProperties = {
  borderRadius: 999,
  border: "1px solid rgba(255, 255, 255, 0.55)",
  background: "rgba(255,255,255,0.38)",
  backdropFilter: "blur(12px)",
  WebkitBackdropFilter: "blur(12px)",
  color: "var(--app-accent-pressed)",
  fontSize: 12,
  fontWeight: 700,
  padding: "4px 10px",
  cursor: "pointer",
  WebkitTapHighlightColor: "transparent",
};

const homeReorderBtnActiveStyle: CSSProperties = {
  background: "color-mix(in srgb, var(--app-accent) 20%, white)",
  border: "1px solid color-mix(in srgb, var(--app-accent) 42%, white)",
};

const homeToolGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 12,
  width: "100%",
  marginTop: 12,
  overflow: "visible",
};

const homeToolTileStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 10,
  minHeight: 100,
  padding: "14px 10px",
  borderRadius: 16,
  border: "1px solid color-mix(in srgb, var(--app-border-subtle) 70%, white)",
  background: "color-mix(in srgb, var(--app-secondary-surface) 94%, white)",
  boxShadow: "0 1px 3px rgba(15, 23, 42, 0.06)",
  cursor: "pointer",
  textAlign: "center",
  WebkitTapHighlightColor: "transparent",
  touchAction: "manipulation",
  position: "relative",
  overflow: "visible",
};

/** Roommates tile: anchor for join-request count badge (must not clip). */
const homeToolTileRoommatesStyle: CSSProperties = {
  overflow: "visible",
};

const homeToolTileWrapStyle: CSSProperties = {
  display: "grid",
  gap: 6,
  overflow: "visible",
};

const homeToolTileWrapDraggingStyle: CSSProperties = {
  opacity: 0.72,
  transform: "scale(0.98)",
};

const homeToolTileReorderingStyle: CSSProperties = {
  cursor: "grab",
};

const homeDragHintStyle: CSSProperties = {
  textAlign: "center",
  color: "var(--app-text-muted)",
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: "0.02em",
};

const phoneFrameStyle: CSSProperties = {
  width: "100%",
  maxWidth: 430,
  margin: "0 auto",
  minHeight: "100dvh",
  // Keep only safe-area reserve; avoid visible blank strip above tabs.
  paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 2px)",
  overflow: "visible",
};

const headerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "10px 2px 16px",
};

const headerToolStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "44px 1fr 44px",
  alignItems: "center",
  padding: "10px 2px 16px",
};

const backButtonStyle: CSSProperties = {
  width: 44,
  height: 44,
  borderRadius: 12,
  border: "1px solid var(--app-border-subtle)",
  background: "var(--app-secondary-surface)",
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
  color: "var(--app-text-primary)",
  WebkitTapHighlightColor: "transparent",
};

const headerTitleCenterStyle: CSSProperties = {
  margin: 0,
  fontSize: "clamp(16px, 4.2vw, 18px)",
  fontWeight: 700,
  lineHeight: 1.2,
  textAlign: "center",
  letterSpacing: "-0.02em",
  color: "var(--app-text-primary)",
};

const toolTileIconWrapStyle: CSSProperties = {
  position: "relative",
  display: "grid",
  placeItems: "center",
  width: 40,
  height: 40,
};

const toolTileLabelStyle: CSSProperties = {
  fontSize: "clamp(12px, 3.35vw, 14px)",
  fontWeight: 650,
  color: "var(--app-tool-tile-label)",
  lineHeight: 1.25,
};

const toolTileBadgeStyle: CSSProperties = {
  position: "absolute",
  top: 6,
  right: 6,
  zIndex: 4,
  minWidth: 20,
  height: 20,
  borderRadius: 10,
  padding: "0 6px",
  fontSize: 11,
  fontWeight: 800,
  lineHeight: "20px",
  background: "#ef4444",
  color: "white",
  textAlign: "center",
  boxShadow: "0 2px 8px rgba(15, 23, 42, 0.35)",
  border: "2px solid color-mix(in srgb, var(--app-home-sheet-bg) 92%, white)",
};

const deleteModalOverlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 2000,
  background: "rgba(15, 23, 42, 0.45)",
  display: "grid",
  placeItems: "center",
  padding: 16,
  WebkitTapHighlightColor: "transparent",
};

const deleteModalCardStyle: CSSProperties = {
  width: "100%",
  maxWidth: 400,
  borderRadius: 20,
  padding: 20,
  background: "rgba(255, 255, 255, 0.98)",
  border: "1px solid rgba(148, 163, 184, 0.35)",
  boxShadow: "0 24px 60px rgba(15, 23, 42, 0.2)",
  display: "grid",
  gap: 12,
};

const leaveModalOverlayStyle: CSSProperties = {
  ...deleteModalOverlayStyle,
  zIndex: 2001,
};

const profilePasswordOkStyle: CSSProperties = {
  margin: "8px 0 0",
  fontSize: 14,
  color: "var(--app-text-secondary)",
  lineHeight: 1.35,
};

const profilePasswordErrStyle: CSSProperties = {
  margin: "8px 0 0",
  fontSize: 14,
  color: "#b91c1c",
  lineHeight: 1.35,
};

const deleteAccountOutlineStyle: CSSProperties = {
  minHeight: 44,
  borderRadius: 12,
  border: "1px solid rgba(220, 38, 38, 0.55)",
  background: "rgba(255, 255, 255, 0.9)",
  color: "#b91c1c",
  fontWeight: 700,
  fontSize: 15,
  cursor: "pointer",
  WebkitTapHighlightColor: "transparent",
};

const eyebrowStyle: CSSProperties = {
  margin: 0,
  fontSize: "clamp(11px, 2.9vw, 12px)",
  fontWeight: 600,
  color: "var(--app-text-secondary)",
  letterSpacing: 0.2,
};

const titleStyle: CSSProperties = {
  margin: "2px 0 0",
  fontSize: "clamp(24px, 6.5vw, 30px)",
  lineHeight: 1.1,
  letterSpacing: "-0.03em",
  fontWeight: 700,
  color: "var(--app-text-primary)",
};

const contentStyle: CSSProperties = {
  display: "grid",
  gap: 14,
};

const stackStyle: CSSProperties = {
  display: "grid",
  gap: 14,
};

/** Profile card: four actions in one compact row */
const profileActionRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
  gap: 6,
  marginTop: 4,
  minWidth: 0,
};

const profileActionBtnCompactStyle: CSSProperties = {
  minHeight: 40,
  padding: "8px 4px",
  fontSize: "clamp(10px, 2.45vw, 11.5px)",
  fontWeight: 650,
  lineHeight: 1.2,
  textAlign: "center",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  whiteSpace: "normal",
  wordBreak: "break-word" as const,
  borderRadius: 10,
  WebkitTapHighlightColor: "transparent",
  touchAction: "manipulation",
};

/** Tighter than global stack between Profile sections */
const profileTabStackStyle: CSSProperties = {
  display: "grid",
  gap: 10,
};

const themePickerGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
  gap: 7,
  minWidth: 0,
  paddingTop: 2,
};

const themeOptionButtonStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  padding: "8px 4px 7px",
  borderRadius: 12,
  border: "1px solid color-mix(in srgb, var(--app-border-subtle) 85%, transparent)",
  background: "color-mix(in srgb, var(--app-secondary-surface) 92%, white)",
  cursor: "pointer",
  textAlign: "center",
  WebkitTapHighlightColor: "transparent",
  touchAction: "manipulation",
  minWidth: 0,
  width: "100%",
  boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
};

const themeOptionButtonSelectedStyle: CSSProperties = {
  border: "1px solid color-mix(in srgb, var(--app-accent) 42%, white)",
  boxShadow:
    "0 0 0 2px color-mix(in srgb, var(--app-accent) 20%, transparent), 0 4px 14px color-mix(in srgb, var(--app-accent) 14%, transparent)",
  background: "color-mix(in srgb, var(--app-accent) 11%, var(--app-secondary-surface))",
};

const themePreviewStripStyle: CSSProperties = {
  width: "100%",
  maxWidth: 44,
  height: 16,
  borderRadius: 8,
  border: "1px solid color-mix(in srgb, var(--app-text-primary) 10%, transparent)",
  boxSizing: "border-box",
  flexShrink: 0,
  boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.35)",
};

const themeOptionLabelStyle: CSSProperties = {
  fontSize: 10,
  fontWeight: 650,
  color: "var(--app-text-primary)",
  letterSpacing: "0.01em",
  lineHeight: 1.15,
  maxWidth: "100%",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const floatingCardStyle: CSSProperties = {
  borderRadius: 22,
  padding: 18,
  border: "1px solid var(--app-border-subtle, rgba(148, 163, 184, 0.32))",
  background: "var(--app-floating-card-bg)",
  backdropFilter: "blur(24px) saturate(180%)",
  WebkitBackdropFilter: "blur(24px) saturate(180%)",
  boxShadow: "var(--app-shadow-sheet, 0 8px 28px rgba(15, 23, 42, 0.07))",
};

const contentCardStyle: CSSProperties = {
  ...floatingCardStyle,
  display: "grid",
  gap: 12,
};

/** Profile blocks: less space between header, fields, and actions */
const profileContentCardStyle: CSSProperties = {
  ...floatingCardStyle,
  display: "grid",
  gap: 3,
  padding: 16,
};

const cardHeaderStyle: CSSProperties = {
  display: "grid",
  gap: 4,
};

const cardHeaderTightStyle: CSSProperties = {
  display: "grid",
  gap: 2,
};

const cardTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: "clamp(17px, 4.4vw, 20px)",
  lineHeight: 1.2,
  letterSpacing: "-0.03em",
  color: "var(--app-text-primary)",
};

const loadingTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: 22,
  lineHeight: 1.2,
  letterSpacing: -0.3,
  color: "var(--app-text-primary)",
};

const subtleTextStyle: CSSProperties = {
  margin: 0,
  fontSize: "clamp(13px, 3.5vw, 15px)",
  lineHeight: 1.55,
  color: "var(--app-text-subtle)",
};

const subtleTextTightStyle: CSSProperties = {
  ...subtleTextStyle,
  lineHeight: 1.32,
  fontSize: "clamp(12px, 3.2vw, 14px)",
};

const fieldLabelStyle: CSSProperties = {
  marginTop: 2,
  fontSize: 12,
  fontWeight: 600,
  color: "var(--app-text-secondary)",
};

const selectStyle: CSSProperties = {
  minHeight: 42,
  borderRadius: 12,
  border: "1px solid var(--app-border-subtle)",
  background: "var(--app-input-surface)",
  color: "var(--app-text-primary)",
  padding: "10px 12px",
  outline: "none",
};

const primaryActionStyle: CSSProperties = {
  minHeight: 44,
  borderRadius: 12,
  border: "1px solid color-mix(in srgb, var(--app-accent) 45%, white)",
  background: "linear-gradient(135deg, var(--app-accent-bright), var(--app-accent))",
  color: "white",
  fontWeight: 700,
  fontSize: 15,
  cursor: "pointer",
  boxShadow: "var(--app-primary-btn-shadow)",
};

const secondaryActionStyle: CSSProperties = {
  minHeight: 44,
  borderRadius: 12,
  border: "1px solid var(--app-border-subtle)",
  background: "var(--app-secondary-surface)",
  color: "var(--app-text-primary)",
  fontWeight: 650,
  fontSize: 15,
  cursor: "pointer",
};

const ghostActionStyle: CSSProperties = {
  ...secondaryActionStyle,
  background: "var(--app-ghost-surface)",
};

const dangerActionStyle: CSSProperties = {
  minHeight: 44,
  borderRadius: 12,
  border: "1px solid rgba(248, 113, 113, 0.5)",
  background: "rgba(239, 68, 68, 0.92)",
  color: "white",
  fontWeight: 700,
  fontSize: 15,
  cursor: "pointer",
};

const infoRowStyle: CSSProperties = {
  display: "grid",
  gap: 2,
  padding: "9px 0",
  borderBottom: "1px solid rgba(148, 163, 184, 0.22)",
};

const infoRowDenseStyle: CSSProperties = {
  display: "grid",
  gap: 0,
  padding: "3px 0",
  borderBottom: "1px solid rgba(148, 163, 184, 0.22)",
};

const infoLabelStyle: CSSProperties = {
  fontSize: 12,
  color: "var(--app-text-secondary)",
};

const infoLabelDenseStyle: CSSProperties = {
  ...infoLabelStyle,
  lineHeight: 1.2,
  display: "block",
};

const infoValueStyle: CSSProperties = {
  fontSize: 15,
  color: "var(--app-text-primary)",
  fontWeight: 550,
};

const profileNameValueRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  minWidth: 0,
};

const profileRoomIdValueRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 10,
  minWidth: 0,
};

const profileIconButtonStyle: CSSProperties = {
  flexShrink: 0,
  width: 40,
  height: 40,
  borderRadius: 10,
  border: "1px solid var(--app-border-subtle)",
  background: "var(--app-icon-button-bg)",
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
  WebkitTapHighlightColor: "transparent",
};

const metaRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 10,
  color: "rgba(15, 23, 42, 0.58)",
  fontSize: 13,
};

const tabBarStyle: CSSProperties = {
  position: "fixed",
  left: "50%",
  transform: "translateX(-50%)",
  bottom: 0,
  width: "min(100%, 430px)",
  padding: "4px 10px calc(4px + env(safe-area-inset-bottom, 0px))",
  borderRadius: "20px 20px 0 0",
  border: "1px solid var(--app-tab-bar-border)",
  background: "var(--app-tab-bar-bg)",
  backdropFilter: "blur(24px) saturate(180%)",
  WebkitBackdropFilter: "blur(24px) saturate(180%)",
  boxShadow: "0 12px 40px rgba(15, 23, 42, 0.14), 0 1px 0 rgba(255,255,255,0.9) inset",
  display: "grid",
  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
  gap: 6,
  zIndex: 50,
  overflow: "visible",
};

const tabButtonStyle: CSSProperties = {
  minHeight: 42,
  borderRadius: 14,
  border: "1px solid transparent",
  background: "transparent",
  color: "var(--app-text-subtle)",
  fontSize: "clamp(11px, 2.95vw, 13px)",
  fontWeight: 650,
  display: "grid",
  placeItems: "center",
  gap: 4,
  cursor: "pointer",
  paddingTop: 2,
};

const tabButtonReorderingStyle: CSSProperties = {
  cursor: "grab",
};

const tabButtonActiveStyle: CSSProperties = {
  background: "var(--app-nav-active-bg)",
  color: "var(--app-accent-pressed)",
  border: "1px solid var(--app-nav-active-border)",
};

const tabButtonDraggingStyle: CSSProperties = {
  opacity: 0.75,
  transform: "scale(0.96)",
};

const tabDragHintStyle: CSSProperties = {
  opacity: 0.58,
  marginTop: -1,
};

