"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from "firebase/firestore";
import { auth, db } from "@/app/lib/firebase";
import ExpenseActions from "@/components/ExpenseActions";

type Expense = {
  id: string;
  title: string;
  amount: number;
  createdAt?: any;
  date?: any;
  createdBy?: string;
  createdByUid?: string;
  paidByUid?: string;
  paidBy?: string;
  participants?: string[];
  visibleTo?: string[];
  splitMap?: Record<string, number>;
};

type Roommate = {
  uid: string;
  name: string;
};

function formatMoney(n: number) {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return v.toFixed(2);
}

function round2(n: number) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function toDisplayDate(value: any): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value?.toDate) return value.toDate().toLocaleDateString();
  if (value instanceof Date) return value.toLocaleDateString();
  return "";
}

function uniqueIds(ids: string[]) {
  return Array.from(new Set(ids.filter(Boolean)));
}

export default function ExpensesPanel() {
  const [uid, setUid] = useState<string | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const [roommates, setRoommates] = useState<Roommate[]>([]);
  const [allExpenses, setAllExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);

  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const [selectedParticipants, setSelectedParticipants] = useState<
    Record<string, boolean>
  >({});

  const selectedRoommates = useMemo(
    () => roommates.filter((r) => selectedParticipants[r.uid]),
    [roommates, selectedParticipants]
  );

  const selectedCount = selectedRoommates.length;
  const enteredAmount = Number(amount);

  const previewShare =
    selectedCount > 0 && Number.isFinite(enteredAmount) && enteredAmount > 0
      ? round2(enteredAmount / selectedCount)
      : 0;

  const previewYouReceive =
    uid &&
    selectedCount > 0 &&
    Number.isFinite(enteredAmount) &&
    enteredAmount > 0 &&
    selectedParticipants[uid]
      ? round2(enteredAmount - previewShare)
      : 0;

  function canViewExpense(exp: Expense) {
    if (!uid) return false;

    const payer = exp.paidByUid || exp.createdByUid || null;
    const visibleTo =
      Array.isArray(exp.visibleTo) && exp.visibleTo.length > 0
        ? exp.visibleTo
        : uniqueIds([
            ...(Array.isArray(exp.participants) ? exp.participants : []),
            payer || "",
          ]);

    return visibleTo.includes(uid);
  }

  const expenses = useMemo(
    () => allExpenses.filter(canViewExpense),
    [allExpenses, uid]
  );

  const summary = useMemo(() => {
    let youOweTotal = 0;
    let youReceiveTotal = 0;

    for (const exp of expenses) {
      const splitMap = exp.splitMap || {};
      const participantIds =
        exp.participants && exp.participants.length > 0
          ? exp.participants
          : Object.keys(splitMap);

      const payer = exp.paidByUid || exp.createdByUid || null;

      const youShare = uid ? Number(splitMap[uid] || 0) : 0;
      const youPaid = uid && payer === uid ? Number(exp.amount || 0) : 0;
      const youNet = round2(youPaid - youShare);

      if (participantIds.length === 0) continue;

      if (youNet > 0) youReceiveTotal += youNet;
      if (youNet < 0) youOweTotal += Math.abs(youNet);
    }

    return {
      owe: round2(youOweTotal),
      receive: round2(youReceiveTotal),
    };
  }, [expenses, uid]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        setUid(null);
        setGroupId(null);
        setIsAdmin(false);
        setAllExpenses([]);
        setRoommates([]);
        setLoading(false);
        return;
      }

      setUid(u.uid);

      const userSnap = await getDoc(doc(db, "users", u.uid));
      const userData = userSnap.exists() ? (userSnap.data() as any) : {};
      const gid = userData?.groupId || null;
      setGroupId(gid);

      if (gid) {
        const groupSnap = await getDoc(doc(db, "groups", gid));
        const groupData = groupSnap.exists() ? (groupSnap.data() as any) : {};
        const createdBy = groupData?.createdBy || null;
        setIsAdmin(createdBy === u.uid);
      } else {
        setIsAdmin(false);
      }

      setLoading(false);
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    if (!groupId) {
      setRoommates([]);
      return;
    }

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

        setRoommates(list);

        setSelectedParticipants((prev) => {
          const next: Record<string, boolean> = {};
          for (const mate of list) {
            next[mate.uid] = prev[mate.uid] ?? true;
          }
          return next;
        });
      }
    );

    return () => unsub();
  }, [groupId]);

  useEffect(() => {
    if (!groupId) {
      setAllExpenses([]);
      return;
    }

    const col = collection(db, "groups", groupId, "expenses");
    const q = query(col, orderBy("createdAt", "desc"), limit(100));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: Expense[] = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            title: data?.title ?? "Untitled",
            amount: Number(data?.amount ?? 0),
            createdAt: data?.createdAt,
            date: data?.date ?? data?.createdAt,
            createdBy: data?.createdBy ?? data?.createdByUid ?? null,
            createdByUid: data?.createdByUid ?? null,
            paidByUid: data?.paidByUid ?? null,
            paidBy: data?.paidBy ?? null,
            participants: Array.isArray(data?.participants)
              ? data.participants
              : [],
            visibleTo: Array.isArray(data?.visibleTo) ? data.visibleTo : [],
            splitMap: data?.splitMap ?? {},
          };
        });

        setAllExpenses(list);
      },
      () => setAllExpenses([])
    );

    return () => unsub();
  }, [groupId]);

  function toggleParticipant(id: string) {
    setSelectedParticipants((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  }

  function selectAllParticipants() {
    const next: Record<string, boolean> = {};
    for (const mate of roommates) next[mate.uid] = true;
    setSelectedParticipants(next);
  }

  function clearAllParticipants() {
    const next: Record<string, boolean> = {};
    for (const mate of roommates) next[mate.uid] = false;
    setSelectedParticipants(next);
  }

  async function addExpense() {
    setErr(null);

    const t = title.trim();
    const a = Number(amount);

    if (!t) return setErr("Title is required.");
    if (!Number.isFinite(a) || a <= 0) return setErr("Amount must be > 0.");
    if (!uid || !groupId) return setErr("Not ready (missing user or room).");
    if (!expenseDate) return setErr("Expense date is required.");

    const chosenParticipants = roommates
      .filter((r) => selectedParticipants[r.uid])
      .map((r) => r.uid);

    const participants = uniqueIds([uid, ...chosenParticipants]);

    if (participants.length === 0) {
      return setErr("Select at least one roommate to split the expense.");
    }

    const share = Math.round((a / participants.length) * 100) / 100;
    const splitMap: Record<string, number> = {};

    participants.forEach((id, index) => {
      if (index === participants.length - 1) {
        const assignedSoFar = Object.values(splitMap).reduce(
          (sum, v) => sum + v,
          0
        );
        splitMap[id] = Math.round((a - assignedSoFar) * 100) / 100;
      } else {
        splitMap[id] = share;
      }
    });

    const visibleTo = uniqueIds([uid, ...participants]);

    setAdding(true);
    try {
      const col = collection(db, "groups", groupId, "expenses");

      await addDoc(col, {
        title: t,
        amount: a,
        date: expenseDate,
        createdAt: serverTimestamp(),
        createdBy: uid,
        createdByUid: uid,
        paidByUid: uid,
        participants,
        visibleTo,
        splitMap,
      });

      setTitle("");
      setAmount("");
      setExpenseDate(new Date().toISOString().slice(0, 10));

      const resetSelection: Record<string, boolean> = {};
      for (const mate of roommates) resetSelection[mate.uid] = true;
      setSelectedParticipants(resetSelection);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to add expense.");
    } finally {
      setAdding(false);
    }
  }

  function getName(userId?: string | null) {
    if (!userId) return "Unknown";
    const found = roommates.find((r) => r.uid === userId);
    return found?.name || (userId === uid ? "You" : userId.slice(0, 6));
  }

  function getExpenseBreakdown(exp: Expense) {
    const splitMap = exp.splitMap || {};
    const participantIds =
      exp.participants && exp.participants.length > 0
        ? exp.participants
        : Object.keys(splitMap);

    const payer = exp.paidByUid || exp.createdByUid || null;

    const perPerson =
      participantIds.length > 0 ? round2(exp.amount / participantIds.length) : 0;

    const youShare = uid ? Number(splitMap[uid] || 0) : 0;
    const youPaid = uid && payer === uid ? Number(exp.amount || 0) : 0;
    const youNet = round2(youPaid - youShare);

    return {
      participantIds,
      payer,
      perPerson,
      youShare,
      youNet,
    };
  }

  if (loading) {
    return <div style={{ padding: 10, opacity: 0.7 }}>Loading your data...</div>;
  }

  if (!groupId) {
    return (
      <div style={{ padding: 10 }}>
        <p style={{ opacity: 0.78, margin: 0 }}>
          You are not in a room yet. Go to the Room page and join or create one.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={introTextStyle}>
        Shared expenses are visible only to the selected participants.
      </div>

      <div style={panelStyle}>
        <div style={sectionHeadingStyle}>Add expense</div>

        <div style={formGridStyle}>
          <div style={{ display: "grid", gap: 8 }}>
            <div style={fieldLabelStyle}>Title</div>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Dinner, movie, groceries..."
              style={inputStyle}
              disabled={adding}
            />
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            <div style={fieldLabelStyle}>Amount</div>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="25.00"
              inputMode="decimal"
              style={inputStyle}
              disabled={adding}
            />
          </div>
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          <div style={fieldLabelStyle}>Expense date</div>
          <input
            type="date"
            value={expenseDate}
            onChange={(e) => setExpenseDate(e.target.value)}
            style={inputStyle}
            disabled={adding}
          />
        </div>

        <div style={innerCardStyle}>
          <div style={splitHeaderStyle}>
            <div>
              <div style={sectionHeadingStyle}>Split with roommates</div>
              <div style={helperTextStyle}>
                Only selected roommates will see this expense.
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={selectAllParticipants}
                style={secondaryBtnStyle}
              >
                Select all
              </button>
              <button
                type="button"
                onClick={clearAllParticipants}
                style={secondaryBtnStyle}
              >
                Clear all
              </button>
            </div>
          </div>

          <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
            {roommates.map((mate) => (
              <label
                key={mate.uid}
                style={{
                  ...participantCardStyle,
                  border: selectedParticipants[mate.uid]
                    ? "1px solid rgba(96,165,250,0.55)"
                    : "1px solid rgba(255,255,255,0.08)",
                  background: selectedParticipants[mate.uid]
                    ? "linear-gradient(135deg, rgba(59,130,246,0.18), rgba(99,102,241,0.12))"
                    : "rgba(255,255,255,0.03)",
                }}
              >
                <input
                  type="checkbox"
                  checked={!!selectedParticipants[mate.uid]}
                  onChange={() => toggleParticipant(mate.uid)}
                />
                <span style={{ fontWeight: 700, fontSize: 14 }}>
                  {mate.name} {mate.uid === uid ? "(You)" : ""}
                </span>
              </label>
            ))}
          </div>

          <div style={{ marginTop: 12, ...helperTextStyle }}>
            {selectedCount > 0 && amount && Number(amount) > 0
              ? `Each selected member owes about $${formatMoney(
                  Number(amount) / uniqueIds([
                    uid || "",
                    ...selectedRoommates.map((r) => r.uid),
                  ]).length
                )}`
              : "Select who should share this expense."}
          </div>

          {selectedCount > 0 && Number.isFinite(enteredAmount) && enteredAmount > 0 && (
            <div style={previewCardStyle}>
              <div style={sectionHeadingStyle}>Preview</div>
              <div style={previewRowStyle}>
                <span>Total expense</span>
                <strong>${formatMoney(enteredAmount)}</strong>
              </div>
              <div style={previewRowStyle}>
                <span>Visible to</span>
                <strong>
                  {
                    uniqueIds([uid || "", ...selectedRoommates.map((r) => r.uid)])
                      .length
                  }{" "}
                  member(s)
                </strong>
              </div>
              <div style={previewRowStyle}>
                <span>Each share</span>
                <strong>${formatMoney(previewShare)}</strong>
              </div>

              {uid ? (
                <div style={{ ...previewRowStyle, marginTop: 4 }}>
                  <span>If you paid</span>
                  <strong style={{ color: "#93c5fd" }}>
                    Receive ${formatMoney(previewYouReceive)}
                  </strong>
                </div>
              ) : null}
            </div>
          )}
        </div>

        {err && <div style={errorStyle}>{err}</div>}

        <button
          onClick={addExpense}
          disabled={adding}
          style={{
            ...primaryBtnStyle,
            opacity: adding ? 0.7 : 1,
          }}
        >
          {adding ? "Adding..." : "Add Expense"}
        </button>
      </div>

      <div style={summaryCardStyle}>
        <div style={sectionHeadingStyle}>💰 Summary</div>
        <div style={summaryGridStyle}>
          <div style={summaryItemStyle}>
            <div style={summaryLabelStyle}>You owe</div>
            <div style={summaryValueStyle}>${formatMoney(summary.owe)}</div>
          </div>
          <div style={summaryItemStyle}>
            <div style={summaryLabelStyle}>You should receive</div>
            <div style={summaryValueStyle}>${formatMoney(summary.receive)}</div>
          </div>
        </div>
      </div>

      <div style={panelStyle}>
        <div style={sectionHeadingStyle}>Recent expenses</div>

        {expenses.length === 0 ? (
          <div style={emptyStateStyle}>No visible expenses yet.</div>
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            {expenses.map((exp) => {
              const breakdown = getExpenseBreakdown(exp);

              return (
                <div key={exp.id} style={expenseCardStyle}>
                  <div style={expenseTopStyle}>
                    <div style={{ display: "grid", gap: 6 }}>
                      <div style={expenseTitleStyle}>{exp.title}</div>

                      <div style={metaTextStyle}>
                        {toDisplayDate(exp.date || exp.createdAt)}
                      </div>

                      <div style={metaTextStyle}>
                        Paid by: {getName(breakdown.payer)}
                      </div>

                      {breakdown.participantIds.length > 0 ? (
                        <div style={metaTextStyle}>
                          Visible to {breakdown.participantIds.length} member(s)
                        </div>
                      ) : null}
                    </div>

                    <div style={expenseTopRightStyle}>
                      <div style={amountPillStyle}>
                        ${formatMoney(Number(exp.amount) || 0)}
                      </div>

                      {uid && (
                        <ExpenseActions
                          groupId={groupId}
                          expense={{
                            id: exp.id,
                            title: exp.title,
                            amount: Number(exp.amount) || 0,
                            date: exp.date || exp.createdAt,
                            createdBy:
                              exp.createdBy ||
                              exp.createdByUid ||
                              exp.paidByUid ||
                              exp.paidBy ||
                              "",
                          }}
                          myUid={uid}
                          isAdmin={isAdmin}
                          onDone={() => {}}
                        />
                      )}
                    </div>
                  </div>

                  <div style={breakdownCardStyle}>
                    <div style={sectionHeadingStyle}>Expense breakdown</div>

                    <div style={previewRowStyle}>
                      <span>Total</span>
                      <strong>${formatMoney(exp.amount)}</strong>
                    </div>

                    <div style={previewRowStyle}>
                      <span>Each share</span>
                      <strong>${formatMoney(breakdown.perPerson)}</strong>
                    </div>

                    {uid && (
                      <>
                        <div style={previewRowStyle}>
                          <span>Your share</span>
                          <strong>${formatMoney(breakdown.youShare)}</strong>
                        </div>

                        {breakdown.youNet > 0 ? (
                          <div style={statusGoodStyle}>
                            You should receive ${formatMoney(breakdown.youNet)}
                          </div>
                        ) : breakdown.youNet < 0 ? (
                          <div style={statusWarnStyle}>
                            You owe ${formatMoney(Math.abs(breakdown.youNet))}
                          </div>
                        ) : (
                          <div style={statusNeutralStyle}>
                            You are settled for this expense
                          </div>
                        )}
                      </>
                    )}

                    <div style={{ display: "grid", gap: 6, marginTop: 4 }}>
                      {Object.entries(exp.splitMap || {}).map(([personUid, owed]) => (
                        <div key={personUid} style={splitRowStyle}>
                          <span>{getName(personUid)} share</span>
                          <strong>${formatMoney(Number(owed || 0))}</strong>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

const introTextStyle: CSSProperties = {
  color: "rgba(255,255,255,0.68)",
  fontSize: 14,
  lineHeight: 1.6,
};

const panelStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 24,
  padding: 18,
  background:
    "linear-gradient(180deg, rgba(8,13,28,0.88) 0%, rgba(10,16,34,0.82) 100%)",
  boxShadow: "0 18px 38px rgba(0,0,0,0.20)",
  display: "grid",
  gap: 16,
};

const innerCardStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 20,
  padding: 16,
  background: "rgba(255,255,255,0.03)",
};

const sectionHeadingStyle: CSSProperties = {
  fontWeight: 800,
  fontSize: 16,
};

const helperTextStyle: CSSProperties = {
  fontSize: 13,
  color: "rgba(255,255,255,0.66)",
  lineHeight: 1.5,
};

const fieldLabelStyle: CSSProperties = {
  fontSize: 12,
  color: "rgba(255,255,255,0.68)",
  textTransform: "uppercase",
  letterSpacing: 0.6,
};

const formGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 14,
};

const splitHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 12,
  flexWrap: "wrap",
};

const inputStyle: CSSProperties = {
  background: "rgba(5,10,20,0.92)",
  color: "white",
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 14,
  padding: "12px 14px",
  outline: "none",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
  fontSize: 14,
};

const participantCardStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  borderRadius: 14,
  padding: "12px 14px",
  cursor: "pointer",
};

const previewCardStyle: CSSProperties = {
  marginTop: 14,
  border: "1px solid rgba(96,165,250,0.22)",
  borderRadius: 18,
  padding: 14,
  background:
    "linear-gradient(135deg, rgba(59,130,246,0.12), rgba(99,102,241,0.08))",
  display: "grid",
  gap: 10,
};

const previewRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  alignItems: "center",
  fontSize: 14,
};

const primaryBtnStyle: CSSProperties = {
  border: "1px solid rgba(96,165,250,0.75)",
  borderRadius: 14,
  padding: "12px 16px",
  background: "linear-gradient(135deg, #60a5fa, #2563eb)",
  color: "white",
  fontWeight: 800,
  cursor: "pointer",
  boxShadow: "0 14px 28px rgba(37,99,235,0.24)",
  transition: "all 0.2s ease",
  fontSize: 15,
};

const secondaryBtnStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 12,
  padding: "9px 12px",
  background: "rgba(255,255,255,0.04)",
  color: "white",
  cursor: "pointer",
  fontWeight: 700,
  transition: "all 0.2s ease",
  fontSize: 14,
};

const errorStyle: CSSProperties = {
  color: "#fda4af",
  fontSize: 13,
  background: "rgba(127,29,29,0.22)",
  border: "1px solid rgba(248,113,113,0.24)",
  borderRadius: 14,
  padding: "10px 12px",
};

const summaryCardStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 24,
  padding: 18,
  background:
    "linear-gradient(135deg, rgba(15,23,42,0.9), rgba(30,41,59,0.85))",
  boxShadow: "0 18px 38px rgba(0,0,0,0.18)",
  display: "grid",
  gap: 14,
};

const summaryGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: 14,
};

const summaryItemStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 18,
  padding: 16,
  background: "rgba(255,255,255,0.03)",
};

const summaryLabelStyle: CSSProperties = {
  fontSize: 11,
  color: "rgba(255,255,255,0.68)",
  marginBottom: 8,
  textTransform: "uppercase",
  letterSpacing: 0.6,
};

const summaryValueStyle: CSSProperties = {
  fontSize: 20,
  fontWeight: 900,
  lineHeight: 1.15,
};

const emptyStateStyle: CSSProperties = {
  color: "rgba(255,255,255,0.68)",
  padding: "10px 2px",
};

const expenseCardStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 20,
  padding: 16,
  background: "rgba(255,255,255,0.03)",
  display: "grid",
  gap: 14,
};

const expenseTopStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 14,
  flexWrap: "wrap",
};

const expenseTitleStyle: CSSProperties = {
  fontWeight: 900,
  fontSize: 16,
  lineHeight: 1.2,
};

const metaTextStyle: CSSProperties = {
  fontSize: 13,
  color: "rgba(255,255,255,0.66)",
  lineHeight: 1.5,
};

const expenseTopRightStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
};

const amountPillStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: 999,
  fontWeight: 900,
  fontSize: 15,
  background:
    "linear-gradient(135deg, rgba(99,102,241,0.26), rgba(59,130,246,0.22))",
  border: "1px solid rgba(129,140,248,0.26)",
};

const breakdownCardStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 18,
  padding: 14,
  background: "rgba(6,10,22,0.76)",
  display: "grid",
  gap: 10,
};

const statusGoodStyle: CSSProperties = {
  borderRadius: 14,
  padding: "10px 12px",
  background: "rgba(22,163,74,0.18)",
  border: "1px solid rgba(74,222,128,0.24)",
  color: "#bbf7d0",
  fontWeight: 700,
  fontSize: 14,
};

const statusWarnStyle: CSSProperties = {
  borderRadius: 14,
  padding: "10px 12px",
  background: "rgba(217,119,6,0.16)",
  border: "1px solid rgba(251,191,36,0.22)",
  color: "#fde68a",
  fontWeight: 700,
  fontSize: 14,
};

const statusNeutralStyle: CSSProperties = {
  borderRadius: 14,
  padding: "10px 12px",
  background: "rgba(148,163,184,0.12)",
  border: "1px solid rgba(148,163,184,0.18)",
  color: "#e2e8f0",
  fontWeight: 700,
  fontSize: 14,
};

const splitRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  fontSize: 14,
  lineHeight: 1.5,
};