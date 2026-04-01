"use client";

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";
import { auth, db } from "@/app/lib/firebase";

type Expense = {
  id: string;
  title: string;
  amount: number;
  date?: string;
  createdAt?: any;
  paidByUid?: string;
  splitMap?: Record<string, number>;
};

type UserMap = Record<string, string>;

export default function AnalyticsPanel() {
  const [uid, setUid] = useState<string | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [users, setUsers] = useState<UserMap>({});
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        setLoading(false);
        return;
      }

      setUid(u.uid);

      const userSnap = await getDoc(doc(db, "users", u.uid));
      const userData = userSnap.exists() ? (userSnap.data() as any) : {};
      setGroupId(userData?.groupId || null);
      setLoading(false);
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    if (!groupId) return;

    const unsub = onSnapshot(collection(db, "groups", groupId, "members"), async (snap) => {
      const next: UserMap = {};
      await Promise.all(
        snap.docs.map(async (memberDoc) => {
          const userSnap = await getDoc(doc(db, "users", memberDoc.id));
          const data = userSnap.exists() ? (userSnap.data() as any) : {};
          next[memberDoc.id] = data?.name || memberDoc.id.slice(0, 6);
        })
      );
      setUsers(next);
    });

    return () => unsub();
  }, [groupId]);

  useEffect(() => {
    if (!groupId) return;

    const q = query(
      collection(db, "groups", groupId, "expenses"),
      orderBy("createdAt", "desc"),
      limit(500)
    );

    const unsub = onSnapshot(q, (snap) => {
      const rows: Expense[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          title: data?.title || "",
          amount: Number(data?.amount || 0),
          date: data?.date || "",
          createdAt: data?.createdAt,
          paidByUid: data?.paidByUid || data?.createdByUid || "",
          splitMap: data?.splitMap || {},
        };
      });
      setExpenses(rows);
    });

    return () => unsub();
  }, [groupId]);

  const stats = useMemo(() => {
    const total = expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);

    const spendByUser: Record<string, number> = {};
    const weekly: Record<string, number> = {};
    const categoryTotals: Record<string, number> = {};

    for (const e of expenses) {
      const payer = e.paidByUid || "unknown";
      spendByUser[payer] = (spendByUser[payer] || 0) + Number(e.amount || 0);

      const weekKey = getWeekLabel(e.date, e.createdAt);
      weekly[weekKey] = (weekly[weekKey] || 0) + Number(e.amount || 0);

      const category = inferCategory(e.title);
      categoryTotals[category] = (categoryTotals[category] || 0) + Number(e.amount || 0);
    }

    const highestSpender = Object.entries(spendByUser).sort((a, b) => b[1] - a[1])[0];
    const topCategory = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1])[0];

    return {
      total,
      spendByUser,
      weekly,
      categoryTotals,
      highestSpender,
      topCategory,
    };
  }, [expenses]);

  const insights = useMemo(() => {
    const lines: string[] = [];

    if (stats.highestSpender) {
      lines.push(
        `${users[stats.highestSpender[0]] || "Someone"} spent the most: $${stats.highestSpender[1].toFixed(2)}.`
      );
    }

    if (stats.topCategory) {
      lines.push(
        `Top spending category is ${stats.topCategory[0]} at $${stats.topCategory[1].toFixed(2)}.`
      );
    }

    if (uid && stats.spendByUser[uid] != null) {
      const mySpend = stats.spendByUser[uid] || 0;
      const avg =
        Object.values(stats.spendByUser).reduce((a, b) => a + b, 0) /
        Math.max(Object.keys(stats.spendByUser).length, 1);

      if (mySpend > avg) {
        lines.push(`You spent more than the room average this period.`);
      } else {
        lines.push(`You spent less than or equal to the room average this period.`);
      }
    }

    if (expenses.length === 0) {
      lines.push("No expense data yet.");
    }

    return lines;
  }, [stats, users, uid, expenses.length]);

  if (loading) return <div style={{ padding: 10, opacity: 0.7 }}>Loading analytics...</div>;
  if (!groupId) return <div style={{ padding: 10 }}>You are not in a room yet.</div>;

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 28 }}>Analytics & AI Insights</h2>
        <div style={{ marginTop: 6, color: "rgba(255,255,255,0.68)" }}>
          Understand spending patterns, weekly trends, and key room insights.
        </div>
      </div>

      <div style={statsGridStyle}>
        <StatCard title="Total Expenses" value={`$${stats.total.toFixed(2)}`} />
        <StatCard title="Expense Records" value={`${expenses.length}`} />
        <StatCard
          title="Top Category"
          value={stats.topCategory ? stats.topCategory[0] : "None"}
        />
      </div>

      <div style={panelStyle}>
        <div style={sectionHeadingStyle}>Spend by roommate</div>
        <div style={{ display: "grid", gap: 14 }}>
          {Object.entries(stats.spendByUser).length === 0 ? (
            <div style={emptyStateStyle}>No data yet.</div>
          ) : (
            Object.entries(stats.spendByUser)
              .sort((a, b) => b[1] - a[1])
              .map(([personUid, amount]) => (
                <BarRow
                  key={personUid}
                  label={`${users[personUid] || "Unknown"}${uid === personUid ? " (You)" : ""}`}
                  value={amount}
                  max={Math.max(...Object.values(stats.spendByUser), 1)}
                />
              ))
          )}
        </div>
      </div>

      <div style={panelStyle}>
        <div style={sectionHeadingStyle}>Weekly trend</div>
        <div style={{ display: "grid", gap: 14 }}>
          {Object.entries(stats.weekly).length === 0 ? (
            <div style={emptyStateStyle}>No weekly data.</div>
          ) : (
            Object.entries(stats.weekly)
              .sort((a, b) => a[0].localeCompare(b[0]))
              .map(([week, amount]) => (
                <BarRow
                  key={week}
                  label={week}
                  value={amount}
                  max={Math.max(...Object.values(stats.weekly), 1)}
                />
              ))
          )}
        </div>
      </div>

      <div style={panelStyle}>
        <div style={sectionHeadingStyle}>AI insights</div>
        <div style={{ display: "grid", gap: 10 }}>
          {insights.map((line, index) => (
            <div key={index} style={insightStyle}>
              {line}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function BarRow({
  label,
  value,
  max,
}: {
  label: string;
  value: number;
  max: number;
}) {
  const width = `${Math.max((value / Math.max(max, 1)) * 100, 6)}%`;

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
        <div style={{ fontWeight: 600 }}>{label}</div>
        <div style={{ fontWeight: 800 }}>${value.toFixed(2)}</div>
      </div>
      <div style={barTrackStyle}>
        <div
          style={{
            width,
            height: "100%",
            background: "linear-gradient(135deg, #60a5fa, #2563eb)",
            borderRadius: 999,
          }}
        />
      </div>
    </div>
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

function inferCategory(title: string) {
  const t = (title || "").toLowerCase();
  if (t.includes("rent")) return "Rent";
  if (t.includes("wifi") || t.includes("internet")) return "Internet";
  if (t.includes("grocery") || t.includes("food") || t.includes("dinner") || t.includes("lunch")) return "Food";
  if (t.includes("gas") || t.includes("electric") || t.includes("water") || t.includes("utility")) return "Utilities";
  return "Other";
}

function getWeekLabel(dateString?: string, createdAt?: any) {
  let d: Date | null = null;

  if (dateString) {
    const temp = new Date(`${dateString}T00:00:00`);
    if (!Number.isNaN(temp.getTime())) d = temp;
  }

  if (!d && createdAt?.toDate) d = createdAt.toDate();
  if (!d) d = new Date();

  const firstDay = new Date(d.getFullYear(), 0, 1);
  const diff = Math.floor((d.getTime() - firstDay.getTime()) / 86400000);
  const week = Math.ceil((diff + firstDay.getDay() + 1) / 7);

  return `${d.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

const statsGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: 14,
};

const statCardStyle: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 20,
  padding: "16px 18px",
  background:
    "linear-gradient(145deg, rgba(99,102,241,0.16), rgba(14,165,233,0.10), rgba(255,255,255,0.03))",
  minHeight: 104,
  boxShadow: "0 16px 32px rgba(0,0,0,0.18)",
};

const statTitleStyle: React.CSSProperties = {
  fontSize: 12,
  color: "rgba(255,255,255,0.74)",
  marginBottom: 12,
  textTransform: "uppercase",
  letterSpacing: 0.7,
};

const statValueStyle: React.CSSProperties = {
  fontSize: 26,
  fontWeight: 900,
  letterSpacing: -0.4,
};

const panelStyle: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 24,
  padding: 20,
  background:
    "linear-gradient(180deg, rgba(8,13,28,0.88) 0%, rgba(10,16,34,0.82) 100%)",
  boxShadow: "0 18px 38px rgba(0,0,0,0.20)",
  display: "grid",
  gap: 16,
};

const sectionHeadingStyle: React.CSSProperties = {
  fontWeight: 800,
  fontSize: 18,
};

const emptyStateStyle: React.CSSProperties = {
  color: "rgba(255,255,255,0.68)",
};

const barTrackStyle: React.CSSProperties = {
  width: "100%",
  height: 12,
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 999,
  overflow: "hidden",
};

const insightStyle: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 16,
  padding: "12px 14px",
  background: "rgba(255,255,255,0.03)",
  color: "rgba(255,255,255,0.86)",
};