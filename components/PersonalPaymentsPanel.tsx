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
  updateDoc,
} from "firebase/firestore";
import { auth, db } from "@/app/lib/firebase";
import { toLocalInputDate } from "@/app/lib/dateLocal";

type Roommate = {
  uid: string;
  name: string;
};

type PersonalPayment = {
  id: string;
  fromUid: string;
  toUid: string;
  amount: number;
  note?: string;
  date?: string;
  status?: "pending" | "repaid";
  visibleTo?: string[];
  createdAt?: any;
};

function formatMoney(n: number) {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return v.toFixed(2);
}

function uniqueIds(ids: string[]) {
  return Array.from(new Set(ids.filter(Boolean)));
}

export default function PersonalPaymentsPanel() {
  const [uid, setUid] = useState<string | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [roommates, setRoommates] = useState<Roommate[]>([]);
  const [payments, setPayments] = useState<PersonalPayment[]>([]);
  const [loading, setLoading] = useState(true);

  const [toUid, setToUid] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [paymentDate, setPaymentDate] = useState(
    toLocalInputDate()
  );
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
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
        setIsAdmin(groupData?.createdBy === u.uid);
      } else {
        setIsAdmin(false);
      }

      setLoading(false);
    });

    return () => unsub();
  }, []);

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

        setRoommates(list);
      }
    );

    return () => unsub();
  }, [groupId]);

  useEffect(() => {
    if (!groupId || !uid) {
      setPayments([]);
      return;
    }

    const q = query(
      collection(db, "groups", groupId, "personalPayments"),
      orderBy("createdAt", "desc"),
      limit(100)
    );

    const unsub = onSnapshot(q, (snap) => {
      const rows: PersonalPayment[] = snap.docs
        .map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            fromUid: data?.fromUid || "",
            toUid: data?.toUid || "",
            amount: Number(data?.amount || 0),
            note: data?.note || "",
            date: data?.date || "",
            status: data?.status || "pending",
            visibleTo: Array.isArray(data?.visibleTo) ? data.visibleTo : [],
            createdAt: data?.createdAt,
          };
        })
        .filter((p) => {
          const visibleTo =
            p.visibleTo && p.visibleTo.length > 0
              ? p.visibleTo
              : uniqueIds([p.fromUid, p.toUid]);
          return visibleTo.includes(uid);
        });

      setPayments(rows);
    });

    return () => unsub();
  }, [groupId, uid]);

  const summary = useMemo(() => {
    if (!uid) return { youLent: 0, youBorrowed: 0 };

    let youLent = 0;
    let youBorrowed = 0;

    for (const p of payments) {
      if (p.status === "repaid") continue;

      if (p.fromUid === uid) youLent += Number(p.amount || 0);
      if (p.toUid === uid) youBorrowed += Number(p.amount || 0);
    }

    return { youLent, youBorrowed };
  }, [payments, uid]);

  async function addPayment() {
    setErr(null);

    const a = Number(amount);

    if (!uid || !groupId) return setErr("Not ready yet.");
    if (!toUid) return setErr("Choose who borrowed from you.");
    if (toUid === uid) return setErr("You cannot create a personal payment to yourself.");
    if (!Number.isFinite(a) || a <= 0) return setErr("Amount must be greater than 0.");
    if (!paymentDate) return setErr("Date is required.");

    setAdding(true);
    try {
      await addDoc(collection(db, "groups", groupId, "personalPayments"), {
        fromUid: uid,
        toUid,
        amount: a,
        note: note.trim(),
        date: paymentDate,
        status: "pending",
        visibleTo: [uid, toUid],
        createdAt: serverTimestamp(),
        createdByUid: uid,
      });

      setToUid("");
      setAmount("");
      setNote("");
      setPaymentDate(toLocalInputDate());
    } catch (e: any) {
      setErr(e?.message ?? "Failed to add personal payment.");
    } finally {
      setAdding(false);
    }
  }

  async function markRepaid(payment: PersonalPayment) {
    if (!groupId || !uid) return;

    const canMark = payment.fromUid === uid || isAdmin;
    if (!canMark) return;

    const ok = confirm("Are you sure you want to mark this personal payment as repaid?");
    if (!ok) return;

    setSavingId(payment.id);
    try {
      await updateDoc(doc(db, "groups", groupId, "personalPayments", payment.id), {
        status: "repaid",
        repaidAt: serverTimestamp(),
      });
    } finally {
      setSavingId(null);
    }
  }

  function getName(id: string) {
    const found = roommates.find((r) => r.uid === id);
    return found?.name || (id === uid ? "You" : id.slice(0, 6));
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
    <div style={{ display: "grid", gap: 12 }}>
      <div style={introTextStyle}>
        Personal payments are private. Only you and the other person can see them.
      </div>

      <div style={panelStyle}>
        <div style={sectionHeadingStyle}>Add personal payment</div>

        <div style={formGridStyle}>
          <div style={{ display: "grid", gap: 8 }}>
            <div style={fieldLabelStyle}>Who borrowed from you?</div>
            <select
              value={toUid}
              onChange={(e) => setToUid(e.target.value)}
              style={inputStyle}
              disabled={adding}
            >
              <option value="">Select roommate</option>
              {roommates
                .filter((r) => r.uid !== uid)
                .map((mate) => (
                  <option key={mate.uid} value={mate.uid}>
                    {mate.name}
                  </option>
                ))}
            </select>
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            <div style={fieldLabelStyle}>Amount</div>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="100.00"
              inputMode="decimal"
              style={inputStyle}
              disabled={adding}
            />
          </div>
        </div>

        <div style={formGridStyle}>
          <div style={{ display: "grid", gap: 8 }}>
            <div style={fieldLabelStyle}>Date</div>
            <input
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
              style={inputStyle}
              disabled={adding}
            />
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            <div style={fieldLabelStyle}>Note</div>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Gas money, movie ticket, emergency cash..."
              style={inputStyle}
              disabled={adding}
            />
          </div>
        </div>

        {err && <div style={errorStyle}>{err}</div>}

        <button
          onClick={addPayment}
          disabled={adding}
          style={{ ...primaryBtnStyle, opacity: adding ? 0.7 : 1 }}
        >
          {adding ? "Adding..." : "Add Personal Payment"}
        </button>
      </div>

      <div style={summaryCardStyle}>
        <div style={sectionHeadingStyle}>💵 Summary</div>
        <div style={summaryGridStyle}>
          <div style={summaryItemStyle}>
            <div style={summaryLabelStyle}>You lent</div>
            <div style={summaryValueStyle}>${formatMoney(summary.youLent)}</div>
          </div>
          <div style={summaryItemStyle}>
            <div style={summaryLabelStyle}>You borrowed</div>
            <div style={summaryValueStyle}>${formatMoney(summary.youBorrowed)}</div>
          </div>
        </div>
      </div>

      <div style={panelStyle}>
        <div style={sectionHeadingStyle}>Recent personal payments</div>

        {payments.length === 0 ? (
          <div style={emptyStateStyle}>No personal payments yet.</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {payments.map((payment) => {
              const canMark = payment.fromUid === uid || isAdmin;
              const isRepaid = payment.status === "repaid";

              return (
                <div key={payment.id} style={expenseCardStyle}>
                  <div style={expenseTopStyle}>
                    <div style={{ display: "grid", gap: 2 }}>
                      <div style={expenseTitleStyle}>
                        {getName(payment.toUid)} borrowed from {getName(payment.fromUid)}
                      </div>

                      <div style={metaTextStyle}>
                        Date: {payment.date || "No date"}
                      </div>

                      {payment.note ? (
                        <div style={metaTextStyle}>Note: {payment.note}</div>
                      ) : null}
                    </div>

                    <div style={expenseTopRightStyle}>
                      <div style={amountPillStyle}>
                        ${formatMoney(payment.amount)}
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      ...statusNeutralStyle,
                      ...(isRepaid
                        ? {
                            background: "rgba(22,163,74,0.18)",
                            border: "1px solid rgba(74,222,128,0.24)",
                            color: "#bbf7d0",
                          }
                        : {}),
                    }}
                  >
                    {isRepaid ? "Repaid" : "Pending"}
                  </div>

                  {!isRepaid ? (
                    canMark ? (
                      <button
                        type="button"
                        onClick={() => markRepaid(payment)}
                        disabled={savingId === payment.id}
                        style={primaryBtnStyle}
                      >
                        {savingId === payment.id ? "Saving..." : "Mark Repaid"}
                      </button>
                    ) : (
                      <div style={helperTextStyle}>
                        Only the person who gave the money or admin can mark this as repaid.
                      </div>
                    )
                  ) : null}
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
  color: "var(--app-text-secondary)",
  fontSize: 14,
  lineHeight: 1.6,
};

const panelStyle: CSSProperties = {
  border: "1px solid var(--app-border-subtle, rgba(148, 163, 184, 0.32))",
  borderRadius: 22,
  padding: 18,
  background: "var(--app-surface-elevated, linear-gradient(180deg, #ffffff 0%, #f1f5f9 100%))",
  boxShadow: "var(--app-shadow-sheet, 0 8px 28px rgba(15, 23, 42, 0.07))",
  display: "grid",
  gap: 12,
};

const sectionHeadingStyle: CSSProperties = {
  fontWeight: 800,
  fontSize: 16,
  color: "var(--app-text-primary)",
};

const fieldLabelStyle: CSSProperties = {
  fontSize: 12,
  color: "var(--app-text-secondary)",
  textTransform: "uppercase",
  letterSpacing: 0.05,
};

const formGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 10,
};

const inputStyle: CSSProperties = {
  background: "var(--app-input-surface, rgba(255, 255, 255, 0.95))",
  color: "var(--app-text-primary)",
  border: "1px solid rgba(148, 163, 184, 0.4)",
  borderRadius: 14,
  padding: "12px 14px",
  outline: "none",
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
  fontSize: 15,
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
  border: "1px solid rgba(255, 255, 255, 0.75)",
  borderRadius: 24,
  padding: 18,
  background:
    "linear-gradient(135deg, rgba(255,255,255,0.9) 0%, rgba(241,245,249,0.75) 100%)",
  boxShadow: "0 16px 36px rgba(15, 23, 42, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.8)",
  display: "grid",
  gap: 10,
};

const summaryGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: 10,
};

const summaryItemStyle: CSSProperties = {
  border: "1px solid rgba(148, 163, 184, 0.4)",
  borderRadius: 18,
  padding: 14,
  background: "rgba(255, 255, 255, 0.5)",
};

const summaryLabelStyle: CSSProperties = {
  fontSize: 11,
  color: "var(--app-text-muted)",
  marginBottom: 4,
  textTransform: "uppercase",
  letterSpacing: 0.05,
};

const summaryValueStyle: CSSProperties = {
  fontSize: 20,
  fontWeight: 900,
  lineHeight: 1.12,
  fontVariantNumeric: "tabular-nums",
  color: "var(--app-text-primary)",
};

const emptyStateStyle: CSSProperties = {
  color: "var(--app-text-secondary)",
  padding: "10px 2px",
};

const expenseCardStyle: CSSProperties = {
  border: "1px solid rgba(148, 163, 184, 0.4)",
  borderRadius: 20,
  padding: 14,
  background: "rgba(255, 255, 255, 0.5)",
  display: "grid",
  gap: 10,
};

const expenseTopStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 10,
  flexWrap: "wrap",
};

const expenseTitleStyle: CSSProperties = {
  fontWeight: 900,
  fontSize: 16,
  lineHeight: 1.2,
  color: "var(--app-text-primary)",
};

const metaTextStyle: CSSProperties = {
  fontSize: 13,
  color: "var(--app-text-secondary)",
  lineHeight: 1.3,
};

const expenseTopRightStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
};

const amountPillStyle: CSSProperties = {
  padding: "8px 12px",
  borderRadius: 999,
  fontWeight: 900,
  fontSize: 15,
  color: "var(--app-text-primary)",
  background:
    "linear-gradient(135deg, rgba(99,102,241,0.26), rgba(59,130,246,0.22))",
  border: "1px solid rgba(129,140,248,0.26)",
  fontVariantNumeric: "tabular-nums",
};

const statusNeutralStyle: CSSProperties = {
  borderRadius: 14,
  padding: "10px 12px",
  background: "rgba(148,163,184,0.12)",
  border: "1px solid rgba(148,163,184,0.18)",
  color: "var(--app-text-primary)",
  fontWeight: 700,
  fontSize: 14,
};

const helperTextStyle: CSSProperties = {
  fontSize: 13,
  color: "var(--app-text-secondary)",
  lineHeight: 1.5,
};