"use client";

import type { CSSProperties } from "react";

export type ThisMonthKey = { year: number; month: number };

type Props = {
  monthOptions: ThisMonthKey[];
  selectedMonth: ThisMonthKey;
  onChangeMonth: (m: ThisMonthKey) => void;
  monthTotal: number;
  monthCount: number;
  youPaid: number;
  youOwe: number;
  net: number;
};

function formatMoney(n: number) {
  return (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
}

function monthLabel(year: number, month: number) {
  return new Date(year, month, 1).toLocaleString(undefined, {
    month: "long",
    year: "numeric",
  });
}

export default function ThisMonthPanel({
  monthOptions,
  selectedMonth,
  onChangeMonth,
  monthTotal,
  monthCount,
  youPaid,
  youOwe,
  net,
}: Props) {
  return (
    <div style={wrapStyle}>
      <p style={kickerStyle}>This month</p>
      <p style={sharedLineStyle}>Shared spending for your room</p>
      <select
        style={selectStyle}
        value={`${selectedMonth.year}-${selectedMonth.month}`}
        onChange={(e) => {
          const [y, m] = e.target.value.split("-").map(Number);
          onChangeMonth({ year: y, month: m });
        }}
        aria-label="Month for shared spending"
      >
        {monthOptions.map((m) => (
          <option key={`${m.year}-${m.month}`} value={`${m.year}-${m.month}`}>
            {monthLabel(m.year, m.month)}
          </option>
        ))}
      </select>
      <p style={bigMetricStyle}>${formatMoney(monthTotal)}</p>
      <p style={periodLabelStyle}>Total shared for the period</p>
      <div style={statsGridStyle}>
        <StatMini title="Entries" value={String(monthCount)} />
        <StatMini title="You paid" value={`$${formatMoney(youPaid)}`} />
        <StatMini title="You owe" value={`$${formatMoney(youOwe)}`} />
        <StatMini
          title="Your balance"
          value={net >= 0 ? `+$${formatMoney(net)}` : `-$${formatMoney(-net)}`}
          tone={net >= 0 ? "positive" : "negative"}
        />
      </div>
      <div style={netPillStyle(net)}>
        {net >= 0 ? "You are owed" : "You owe"} ${formatMoney(Math.abs(net))}
      </div>
    </div>
  );
}

function StatMini({
  title,
  value,
  tone = "default",
}: {
  title: string;
  value: string;
  tone?: "default" | "positive" | "negative";
}) {
  const c =
    tone === "positive" ? "#166534" : tone === "negative" ? "#9a3412" : "#0f172a";
  return (
    <div style={statCardStyle}>
      <div style={statLabelStyle}>{title}</div>
      <div style={{ ...statValueStyle, color: c }}>{value}</div>
    </div>
  );
}

const wrapStyle: CSSProperties = {
  display: "grid",
  gap: 8,
  minWidth: 0,
};

const kickerStyle: CSSProperties = {
  margin: 0,
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: 0.04,
  textTransform: "uppercase",
  color: "rgba(15, 23, 42, 0.45)",
};

const sharedLineStyle: CSSProperties = {
  margin: 0,
  fontSize: 15,
  lineHeight: 1.4,
  fontWeight: 600,
  color: "rgba(15, 23, 42, 0.85)",
};

const selectStyle: CSSProperties = {
  width: "100%",
  maxWidth: 280,
  minHeight: 44,
  borderRadius: 12,
  border: "1px solid var(--app-border-subtle, rgba(148, 163, 184, 0.32))",
  background: "var(--app-surface-card, #fff)",
  color: "#0f172a",
  fontWeight: 600,
  fontSize: 16,
  padding: "8px 12px",
  outline: "none",
  boxShadow: "var(--app-shadow-sheet, 0 4px 14px rgba(15, 23, 42, 0.06))",
};

const bigMetricStyle: CSSProperties = {
  margin: 0,
  fontSize: "clamp(28px, 8vw, 40px)",
  lineHeight: 1.05,
  letterSpacing: "-0.03em",
  fontWeight: 800,
  color: "#0f172a",
  fontVariantNumeric: "tabular-nums",
};

const periodLabelStyle: CSSProperties = {
  margin: 0,
  fontSize: 14,
  color: "rgba(15, 23, 42, 0.5)",
  fontWeight: 500,
};

const statsGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 10,
  marginTop: 4,
};

const statCardStyle: CSSProperties = {
  borderRadius: 16,
  border: "1px solid var(--app-border-subtle, rgba(148, 163, 184, 0.32))",
  background: "var(--app-surface-card, rgba(255, 255, 255, 0.94))",
  padding: "12px 14px",
  boxShadow: "var(--app-shadow-sheet, 0 4px 14px rgba(15, 23, 42, 0.06))",
};

const statLabelStyle: CSSProperties = {
  fontSize: 12,
  color: "rgba(15, 23, 42, 0.52)",
  marginBottom: 2,
  fontWeight: 600,
  letterSpacing: 0.02,
};

const statValueStyle: CSSProperties = {
  fontSize: 18,
  fontWeight: 800,
  fontVariantNumeric: "tabular-nums",
  letterSpacing: "-0.02em",
};

const netPillStyle = (net: number): CSSProperties => ({
  marginTop: 4,
  borderRadius: 14,
  padding: "10px 14px",
  fontSize: 14,
  fontWeight: 650,
  textAlign: "center",
  fontVariantNumeric: "tabular-nums",
  border:
    net >= 0
      ? "1px solid rgba(34, 197, 94, 0.35)"
      : "1px solid rgba(249, 115, 22, 0.4)",
  background: net >= 0 ? "rgba(22, 163, 74, 0.1)" : "rgba(254, 215, 170, 0.35)",
  color: net >= 0 ? "#166534" : "#9a3412",
});
