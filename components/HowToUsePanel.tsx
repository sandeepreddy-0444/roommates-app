"use client";

import { useState, type CSSProperties } from "react";
import { MaterialIcon } from "@/components/MaterialIcon";

type HelpContentId =
  | "start"
  | "homeNav"
  | "grocery"
  | "roommates"
  | "reminders"
  | "ai"
  | "chores"
  | "settlements"
  | "personalPayments"
  | "thisMonth"
  | "polls"
  | "expenses"
  | "chat"
  | "profile"
  | "rules";

/** Tiny background emoji pairs — decorative only (aria-hidden). */
const MENU: { id: HelpContentId; label: string; icon: string; bgEmoji: [string, string] }[] = [
  { id: "start", label: "Getting started", icon: "flag", bgEmoji: ["✨", "🚀"] },
  { id: "homeNav", label: "Home & bottom tabs", icon: "home", bgEmoji: ["🏠", "📱"] },
  { id: "grocery", label: "Grocery", icon: "shopping_cart", bgEmoji: ["🛒", "🥬"] },
  { id: "roommates", label: "Roommates", icon: "group", bgEmoji: ["👥", "🚪"] },
  { id: "reminders", label: "Reminders", icon: "schedule", bgEmoji: ["⏰", "📝"] },
  { id: "ai", label: "AI assistant", icon: "smart_toy", bgEmoji: ["🤖", "💡"] },
  { id: "chores", label: "Chores", icon: "cleaning_services", bgEmoji: ["🧹", "✅"] },
  { id: "settlements", label: "Settlements", icon: "compare_arrows", bgEmoji: ["💸", "⚖️"] },
  { id: "personalPayments", label: "Personal pay", icon: "account_balance_wallet", bgEmoji: ["💳", "📒"] },
  { id: "thisMonth", label: "This month", icon: "calendar_month", bgEmoji: ["📅", "📊"] },
  { id: "polls", label: "Voting / Polls", icon: "how_to_vote", bgEmoji: ["🗳️", "✅"] },
  { id: "expenses", label: "Expenses tab", icon: "payments", bgEmoji: ["💰", "📋"] },
  { id: "chat", label: "Chat tab", icon: "chat", bgEmoji: ["💬", "📣"] },
  { id: "profile", label: "Profile", icon: "person", bgEmoji: ["👤", "⚙️"] },
  { id: "rules", label: "Ground rules", icon: "gavel", bgEmoji: ["📜", "🤝"] },
];

const BULLETS: Record<HelpContentId, string[]> = {
  start: [
    "Sign in with your email. New users can sign up from the login screen.",
    "Create a room or enter a room code to join the same household as your roommates.",
    "Your Room ID is on Profile — use copy to share it so others can join.",
    "Everyone in the room shares the same expenses, chat, lists, and polls.",
  ],
  homeNav: [
    "Bottom bar: Home, Expenses, Chat, Profile. Long-press a tab, then drag to reorder the bar.",
    "On Home, use Reorder to drag feature tiles, or scroll the grid — the last row sits above the bottom bar.",
    "Open any tile, then use the top back arrow to return to Home.",
  ],
  grocery: [
    "Shared shopping lists for the whole room — add items everyone can see.",
    "Use it for recurring buys so nothing gets forgotten between roommates.",
  ],
  roommates: [
    "See who is in the room and their display names.",
    "Admins can approve or decline join requests and remove members when needed.",
    "If you are admin and want to leave, transfer admin to someone else first (see Profile / dialog).",
    "A red badge on the Roommates tile means pending join requests need an admin’s attention.",
  ],
  reminders: [
    "Household reminders visible to everyone in the room.",
    "Use for bills, trash night, guests, or anything the group should remember.",
  ],
  ai: [
    "Ask quick questions; answers may use your room’s shared context.",
    "Availability depends on your setup — if you hit limits, try again later or shorten requests.",
  ],
  chores: [
    "Shared chore schedule and tasks so cleaning and rotations stay fair.",
    "Update assignments when your household agrees on changes.",
  ],
  settlements: [
    "Shows balances between roommates based on recorded expenses.",
    "Use it to decide who should pay whom next — settle outside the app (bank, cash, apps) as you prefer.",
  ],
  personalPayments: [
    "Track payments that are yours personally, separate from the shared expense split.",
    "Helpful if you want notes without affecting the group totals.",
  ],
  thisMonth: [
    "Pick a calendar month to see spending totals and summaries for that period.",
    "Compare your paid amount, share owed, and net for shared expenses in that month.",
  ],
  polls: [
    "Create a poll with a short question and at least two answer options (you can add more lines).",
    "Tap an option to add your vote; tap again on the same option to remove it.",
    "You can vote for more than one option if you want — each option toggles independently.",
    "Counts show how many roommates chose each line. Closed polls no longer accept votes.",
    "Who created the poll can Edit or Delete it from the poll card.",
  ],
  expenses: [
    "Open the Expenses tab (bottom bar) for shared spending: add purchases, who paid, and how costs are split.",
    "Keeping entries consistent makes Settlements and This month accurate.",
  ],
  chat: [
    "Room-wide chat for quick coordination — everyone in the room can read and send.",
    "Sensitive topics are still best handled with respect and clarity outside the app too.",
  ],
  profile: [
    "Edit display name, copy Room ID, change password (email users), leave room, log out, or delete account.",
    "Appearance themes apply on this device only.",
    "Leaving removes you from the member list until you rejoin with the room code.",
  ],
  rules: [
    "Enter honest amounts and splits — the app helps coordinate; trust stays with your household.",
    "Room data is for your roommates only; don’t share codes or screenshots where they shouldn’t go.",
    "Admins should transfer admin before leaving if other members remain.",
  ],
};

export default function HowToUsePanel({ isRoomAdmin }: { isRoomAdmin: boolean }) {
  const [topic, setTopic] = useState<HelpContentId | null>(null);

  const rulesExtra = isRoomAdmin
    ? ["As admin: review join requests under Roommates and transfer admin before you leave if others stay."]
    : [];

  if (!topic) {
    return (
      <div style={root}>
        <p style={intro}>Tap a feature to see how it works.</p>
        <div style={menuGrid}>
          {MENU.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTopic(item.id)}
              style={menuBtn}
            >
              <span style={menuEmojiLayer} aria-hidden>
                <span style={{ ...menuEmojiDot, right: 36, bottom: 11, fontSize: "clamp(14px, 3.6vw, 17px)" }}>
                  {item.bgEmoji[0]}
                </span>
                <span style={{ ...menuEmojiDot, right: 10, bottom: 7, fontSize: "clamp(12px, 3.2vw, 15px)" }}>
                  {item.bgEmoji[1]}
                </span>
              </span>
              <span style={menuBtnRow}>
                <MaterialIcon
                  name={item.icon}
                  size={22}
                  style={{ color: "var(--app-tile-icon)", flexShrink: 0 }}
                />
                <span style={menuLabel}>{item.label}</span>
                <MaterialIcon
                  name="chevron_right"
                  size={20}
                  style={{ color: "var(--app-icon-muted)", opacity: 0.7 }}
                />
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const item = MENU.find((m) => m.id === topic)!;
  const bullets = BULLETS[topic];
  const extra = topic === "rules" ? rulesExtra : [];

  return (
    <div style={root}>
      <button type="button" onClick={() => setTopic(null)} style={backRow}>
        <MaterialIcon name="arrow_back" size={22} style={{ color: "var(--app-accent-pressed)" }} />
        <span style={backText}>All topics</span>
      </button>
      <h2 style={detailTitleRow}>
        <span style={detailTitle}>{item.label}</span>
        <span style={detailTitleEmojis} aria-hidden>
          {item.bgEmoji[0]}
          {item.bgEmoji[1]}
        </span>
      </h2>
      <ul style={ul}>
        {bullets.map((line, i) => (
          <li key={i} style={li}>
            {line}
          </li>
        ))}
        {extra.map((line, i) => (
          <li key={`x-${i}`} style={li}>
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}

const root: CSSProperties = {
  display: "grid",
  gap: 14,
  minWidth: 0,
};

const intro: CSSProperties = {
  margin: 0,
  fontSize: "clamp(13px, 3.5vw, 15px)",
  lineHeight: 1.45,
  color: "var(--app-text-subtle)",
};

const menuGrid: CSSProperties = {
  display: "grid",
  gap: 10,
};

const menuBtn: CSSProperties = {
  position: "relative",
  overflow: "hidden",
  display: "block",
  width: "100%",
  textAlign: "left",
  padding: "12px 14px",
  borderRadius: 14,
  border: "1px solid color-mix(in srgb, var(--app-border-subtle) 75%, white)",
  background: "color-mix(in srgb, var(--app-secondary-surface) 94%, white)",
  cursor: "pointer",
  WebkitTapHighlightColor: "transparent",
  color: "var(--app-text-primary)",
  fontSize: "clamp(13px, 3.4vw, 15px)",
  fontWeight: 650,
};

/** Full-width row so emoji overlay can sit behind the whole button (not only grid col 1). */
const menuBtnRow: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "auto 1fr auto",
  alignItems: "center",
  gap: 12,
  position: "relative",
  zIndex: 1,
  minWidth: 0,
};

const menuEmojiLayer: CSSProperties = {
  position: "absolute",
  inset: 0,
  pointerEvents: "none",
  zIndex: 0,
};

const menuEmojiDot: CSSProperties = {
  position: "absolute",
  lineHeight: 1,
  opacity: 0.28,
  userSelect: "none",
};

const menuLabel: CSSProperties = {
  minWidth: 0,
};

const backRow: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: 0,
  border: "none",
  background: "transparent",
  cursor: "pointer",
  font: "inherit",
  WebkitTapHighlightColor: "transparent",
};

const backText: CSSProperties = {
  fontSize: 15,
  fontWeight: 650,
  color: "var(--app-accent-pressed)",
};

const detailTitleRow: CSSProperties = {
  margin: 0,
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 10,
};

const detailTitle: CSSProperties = {
  fontSize: "clamp(18px, 4.5vw, 22px)",
  fontWeight: 700,
  letterSpacing: "-0.02em",
  color: "var(--app-text-primary)",
};

const detailTitleEmojis: CSSProperties = {
  fontSize: "clamp(14px, 3.5vw, 17px)",
  opacity: 0.35,
  letterSpacing: 4,
  userSelect: "none",
};

const ul: CSSProperties = {
  margin: 0,
  paddingLeft: 20,
  display: "grid",
  gap: 10,
  color: "var(--app-text-primary)",
  fontSize: "clamp(13px, 3.5vw, 15px)",
  lineHeight: 1.5,
};

const li: CSSProperties = {
  paddingLeft: 4,
};
