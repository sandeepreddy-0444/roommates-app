"use client";

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { useRouter } from "next/navigation";
import { auth, db } from "@/app/lib/firebase";

type Notif = {
  id: string;
  type: string;
  title: string;
  body: string;
  createdAt?: any;
  createdBy?: string;
  readBy?: string[];
};

export default function NotificationsPanel() {
  const router = useRouter();

  const [uid, setUid] = useState<string | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [rows, setRows] = useState<Notif[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const notifsCol = useMemo(() => {
    if (!groupId) return null;
    return collection(db, "groups", groupId, "notifications");
  }, [groupId]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        router.push("/login");
        return;
      }

      setUid(u.uid);

      const userDoc = await getDoc(doc(db, "users", u.uid));
      const gid = userDoc.exists() ? (userDoc.data() as any).groupId : null;

      if (!gid) {
        router.push("/room");
        return;
      }

      setGroupId(gid);
      setLoading(false);
    });

    return () => unsub();
  }, [router]);

  useEffect(() => {
    if (!notifsCol) return;

    const q = query(notifsCol, orderBy("createdAt", "desc"), limit(50));
    const unsub = onSnapshot(q, (snap) => {
      const items: Notif[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          type: data.type ?? "info",
          title: data.title ?? "Notification",
          body: data.body ?? "",
          createdAt: data.createdAt,
          createdBy: data.createdBy ?? "",
          readBy: Array.isArray(data.readBy) ? data.readBy : [],
        };
      });

      setRows(items);

      setSelected((prev) => {
        const next: Record<string, boolean> = {};
        const ids = new Set(items.map((x) => x.id));
        for (const [k, v] of Object.entries(prev)) {
          if (ids.has(k)) next[k] = v;
        }
        return next;
      });
    });

    return () => unsub();
  }, [notifsCol]);

  const unreadCount = useMemo(() => {
    if (!uid) return 0;
    return rows.filter((n) => !(n.readBy ?? []).includes(uid)).length;
  }, [rows, uid]);

  const selectedIds = useMemo(() => {
    return Object.keys(selected).filter((id) => selected[id]);
  }, [selected]);

  const readCount = rows.length - unreadCount;

  function toggleOne(id: string) {
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  async function markAllRead() {
    if (!uid || !groupId) return;

    const unread = rows.filter((n) => !(n.readBy ?? []).includes(uid));
    if (unread.length === 0) return;

    const batch = writeBatch(db);
    for (const n of unread) {
      batch.update(doc(db, "groups", groupId, "notifications", n.id), {
        readBy: arrayUnion(uid),
      });
    }
    await batch.commit();
  }

  async function markOneRead(id: string) {
    if (!uid || !groupId) return;
    await updateDoc(doc(db, "groups", groupId, "notifications", id), {
      readBy: arrayUnion(uid),
    });
  }

  async function deleteOne(id: string) {
    if (!groupId) return;
    const ok = confirm("Delete this notification?");
    if (!ok) return;

    await deleteDoc(doc(db, "groups", groupId, "notifications", id));
  }

  async function deleteSelected() {
    if (!groupId || selectedIds.length === 0) return;

    const ok = confirm(`Delete ${selectedIds.length} selected notification(s)?`);
    if (!ok) return;

    const batch = writeBatch(db);
    for (const id of selectedIds) {
      batch.delete(doc(db, "groups", groupId, "notifications", id));
    }
    await batch.commit();
    setSelected({});
  }

  async function deleteAll() {
    if (!groupId || rows.length === 0) return;

    const ok = confirm(`Delete ALL notifications (${rows.length})?`);
    if (!ok) return;

    const batch = writeBatch(db);
    for (const n of rows) {
      batch.delete(doc(db, "groups", groupId, "notifications", n.id));
    }
    await batch.commit();
    setSelected({});
  }

  if (loading) {
    return (
      <div style={shellStyle}>
        <div style={heroCardStyle}>
          <div style={heroGlowStyle} />
          <div style={{ position: "relative", zIndex: 1 }}>
            <div style={eyebrowStyle}>Notifications</div>
            <h2 style={titleStyle}>Loading notifications...</h2>
            <p style={subtitleStyle}>Bringing in your latest room activity.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={shellStyle}>
      <div style={heroCardStyle}>
        <div style={heroGlowStyle} />
        <div style={{ position: "relative", zIndex: 1 }}>
          <div style={eyebrowStyle}>Activity Center</div>
          <div style={heroHeaderStyle}>
            <div>
              <h2 style={titleStyle}>Notifications</h2>
              <p style={subtitleStyle}>
                Stay on top of reminders, settlements, room activity, and recent
                updates from your shared household.
              </p>
            </div>
          </div>

          <div style={statsGridStyle}>
            <div style={statCardStyle}>
              <div style={statLabelStyle}>Total</div>
              <div style={statValueStyle}>{rows.length}</div>
            </div>
            <div style={statCardStyle}>
              <div style={statLabelStyle}>Unread</div>
              <div style={statValueStyle}>{unreadCount}</div>
            </div>
            <div style={statCardStyle}>
              <div style={statLabelStyle}>Read</div>
              <div style={statValueStyle}>{readCount}</div>
            </div>
            <div style={statCardStyle}>
              <div style={statLabelStyle}>Selected</div>
              <div style={statValueStyle}>{selectedIds.length}</div>
            </div>
          </div>
        </div>
      </div>

      <div style={toolbarCardStyle}>
        <div style={toolbarHeaderStyle}>
          <div>
            <div style={sectionEyebrowStyle}>Manage</div>
            <h3 style={sectionTitleStyle}>Quick actions</h3>
            <p style={sectionTextStyle}>
              Review, mark, and clean up notifications from one place.
            </p>
          </div>
        </div>

        <div style={toolbarButtonsStyle}>
          <button onClick={markAllRead} style={primaryButtonStyle}>
            Mark all read
          </button>

          <button
            onClick={deleteSelected}
            disabled={selectedIds.length === 0}
            style={{
              ...secondaryButtonStyle,
              ...(selectedIds.length === 0 ? disabledButtonStyle : {}),
            }}
          >
            Delete selected
          </button>

          <button
            onClick={deleteAll}
            disabled={rows.length === 0}
            style={{
              ...dangerButtonStyle,
              ...(rows.length === 0 ? disabledButtonStyle : {}),
            }}
          >
            Delete all
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div style={emptyStateStyle}>
          <div style={emptyIconStyle}>🔔</div>
          <h3 style={emptyTitleStyle}>No notifications yet</h3>
          <p style={emptyTextStyle}>
            When your room has updates like reminders, settlements, or new shared
            activity, they will appear here.
          </p>
        </div>
      ) : (
        <div style={listStyle}>
          {rows.map((n) => {
            const isUnread = uid ? !(n.readBy ?? []).includes(uid) : false;
            const isChecked = !!selected[n.id];
            const typeMeta = getTypeMeta(n.type);

            return (
              <div
                key={n.id}
                style={{
                  ...notifCardStyle,
                  opacity: isUnread ? 1 : 0.72,
                  boxShadow: isUnread
                    ? "0 14px 32px rgba(59,130,246,0.08)"
                    : "0 10px 24px rgba(0,0,0,0.22)",
                }}
              >
                <div style={notifRowStyle}>
                  <div style={notifLeftStyle}>
                    <label style={checkboxWrapStyle}>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleOne(n.id)}
                        style={checkboxStyle}
                      />
                    </label>

                    <button
                      onClick={() => markOneRead(n.id)}
                      style={notifMainButtonStyle}
                    >
                      <div style={notifHeaderStyle}>
                        <div style={notifTitleBlockStyle}>
                          <div style={notifTitleRowStyle}>
                            <span style={typeBadgeStyle(typeMeta.bg, typeMeta.color)}>
                              {typeMeta.label}
                            </span>

                            {isUnread ? (
                              <span style={newBadgeStyle}>New</span>
                            ) : null}
                          </div>

                          <div style={notifTitleStyle}>{n.title}</div>
                        </div>
                      </div>

                      {n.body ? (
                        <div style={notifBodyStyle}>{formatBodyText(n.body)}</div>
                      ) : null}

                      <div style={notifFooterStyle}>
                        <span>{formatCreatedAt(n.createdAt)}</span>
                      </div>
                    </button>
                  </div>

                  <button onClick={() => deleteOne(n.id)} style={iconDeleteButtonStyle}>
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function formatBodyText(body: string) {
  const match = body.match(/\d{4}-\d{2}-\d{2}/);
  if (!match) return body;

  const [year, month, day] = match[0].split("-");
  return body.replace(match[0], `${month}/${day}/${year}`);
}

function formatCreatedAt(value: any) {
  if (!value) return "";
  try {
    if (value?.toDate) {
      return value.toDate().toLocaleString();
    }
    if (value instanceof Date) {
      return value.toLocaleString();
    }
    return "";
  } catch {
    return "";
  }
}

function getTypeMeta(type: string) {
  const normalized = String(type || "info").toLowerCase();

  if (normalized.includes("settlement")) {
    return {
      label: "Settlement",
      bg: "rgba(59,130,246,0.14)",
      color: "#93c5fd",
    };
  }

  if (normalized.includes("reminder")) {
    return {
      label: "Reminder",
      bg: "rgba(168,85,247,0.14)",
      color: "#d8b4fe",
    };
  }

  if (normalized.includes("expense")) {
    return {
      label: "Expense",
      bg: "rgba(34,197,94,0.14)",
      color: "#86efac",
    };
  }

  return {
    label: "Info",
    bg: "rgba(148,163,184,0.14)",
    color: "#cbd5e1",
  };
}

function typeBadgeStyle(bg: string, color: string): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    borderRadius: 999,
    padding: "6px 10px",
    fontSize: 11,
    fontWeight: 700,
    background: bg,
    color,
    border: "1px solid rgba(255,255,255,0.08)",
  };
}

const shellStyle: React.CSSProperties = {
  display: "grid",
  gap: 18,
  color: "#fff",
};

const heroCardStyle: React.CSSProperties = {
  position: "relative",
  overflow: "hidden",
  borderRadius: 28,
  padding: 24,
  border: "1px solid rgba(255,255,255,0.09)",
  background:
    "linear-gradient(135deg, rgba(59,130,246,0.16), rgba(139,92,246,0.16), rgba(15,23,42,0.95))",
  boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
  backdropFilter: "blur(18px)",
};

const heroGlowStyle: React.CSSProperties = {
  position: "absolute",
  inset: -80,
  background:
    "radial-gradient(circle at top left, rgba(96,165,250,0.22), transparent 32%), radial-gradient(circle at bottom right, rgba(168,85,247,0.18), transparent 30%)",
  pointerEvents: "none",
};

const eyebrowStyle: React.CSSProperties = {
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: "0.18em",
  color: "rgba(191,219,254,0.9)",
  fontWeight: 700,
  marginBottom: 10,
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: "clamp(1.6rem, 2vw, 2.2rem)",
  fontWeight: 800,
  color: "#f8fafc",
};

const subtitleStyle: React.CSSProperties = {
  margin: "8px 0 0",
  maxWidth: 760,
  lineHeight: 1.6,
  color: "rgba(226,232,240,0.8)",
  fontSize: 14,
};

const heroHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 16,
  flexWrap: "wrap",
};

const statsGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: 14,
  marginTop: 20,
};

const statCardStyle: React.CSSProperties = {
  borderRadius: 20,
  padding: 16,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(8,15,30,0.55)",
  backdropFilter: "blur(12px)",
};

const statLabelStyle: React.CSSProperties = {
  fontSize: 12,
  color: "rgba(191,219,254,0.78)",
  marginBottom: 8,
};

const statValueStyle: React.CSSProperties = {
  fontSize: 24,
  fontWeight: 800,
  color: "#ffffff",
};

const toolbarCardStyle: React.CSSProperties = {
  borderRadius: 24,
  padding: 20,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(10,14,24,0.82)",
  boxShadow: "0 18px 40px rgba(0,0,0,0.28)",
  backdropFilter: "blur(18px)",
};

const toolbarHeaderStyle: React.CSSProperties = {
  marginBottom: 16,
};

const sectionEyebrowStyle: React.CSSProperties = {
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.16em",
  color: "#93c5fd",
  fontWeight: 700,
  marginBottom: 8,
};

const sectionTitleStyle: React.CSSProperties = {
  margin: 0,
  color: "#f8fafc",
  fontSize: 20,
  fontWeight: 800,
};

const sectionTextStyle: React.CSSProperties = {
  margin: "8px 0 0",
  color: "rgba(203,213,225,0.72)",
  fontSize: 14,
  lineHeight: 1.6,
};

const toolbarButtonsStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 12,
};

const primaryButtonStyle: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 14,
  padding: "12px 16px",
  background:
    "linear-gradient(135deg, rgba(59,130,246,0.95), rgba(139,92,246,0.92))",
  color: "#ffffff",
  fontWeight: 800,
  cursor: "pointer",
  boxShadow: "0 12px 30px rgba(59,130,246,0.22)",
};

const secondaryButtonStyle: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 14,
  padding: "12px 16px",
  background: "rgba(255,255,255,0.05)",
  color: "#e2e8f0",
  fontWeight: 700,
  cursor: "pointer",
};

const dangerButtonStyle: React.CSSProperties = {
  border: "1px solid rgba(248,113,113,0.2)",
  borderRadius: 14,
  padding: "12px 16px",
  background: "rgba(239,68,68,0.14)",
  color: "#fecaca",
  fontWeight: 700,
  cursor: "pointer",
};

const disabledButtonStyle: React.CSSProperties = {
  opacity: 0.45,
  cursor: "not-allowed",
};

const listStyle: React.CSSProperties = {
  display: "grid",
  gap: 14,
};

const notifCardStyle: React.CSSProperties = {
  borderRadius: 22,
  padding: 16,
  border: "1px solid rgba(255,255,255,0.08)",
  background:
    "linear-gradient(180deg, rgba(15,23,42,0.84), rgba(2,6,23,0.96))",
};

const notifRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 16,
  alignItems: "flex-start",
};

const notifLeftStyle: React.CSSProperties = {
  display: "flex",
  gap: 14,
  flex: 1,
};

const checkboxWrapStyle: React.CSSProperties = {
  paddingTop: 6,
};

const checkboxStyle: React.CSSProperties = {
  width: 16,
  height: 16,
  cursor: "pointer",
};

const notifMainButtonStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  padding: 0,
  textAlign: "left",
  color: "inherit",
  cursor: "pointer",
  width: "100%",
};

const notifHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  alignItems: "flex-start",
};

const notifTitleBlockStyle: React.CSSProperties = {
  display: "grid",
  gap: 10,
};

const notifTitleRowStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
  alignItems: "center",
};

const newBadgeStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  borderRadius: 999,
  padding: "6px 10px",
  fontSize: 11,
  fontWeight: 700,
  background: "rgba(34,197,94,0.14)",
  color: "#86efac",
  border: "1px solid rgba(255,255,255,0.08)",
};

const notifTitleStyle: React.CSSProperties = {
  fontSize: 17,
  fontWeight: 800,
  color: "#f8fafc",
  lineHeight: 1.4,
};

const notifBodyStyle: React.CSSProperties = {
  marginTop: 10,
  color: "rgba(226,232,240,0.82)",
  fontSize: 14,
  lineHeight: 1.7,
};

const notifFooterStyle: React.CSSProperties = {
  marginTop: 14,
  color: "rgba(148,163,184,0.8)",
  fontSize: 12,
};

const iconDeleteButtonStyle: React.CSSProperties = {
  border: "1px solid rgba(248,113,113,0.18)",
  borderRadius: 12,
  padding: "10px 12px",
  background: "rgba(239,68,68,0.1)",
  color: "#fecaca",
  fontWeight: 700,
  cursor: "pointer",
  flexShrink: 0,
};

const emptyStateStyle: React.CSSProperties = {
  borderRadius: 28,
  padding: 28,
  border: "1px solid rgba(255,255,255,0.08)",
  background:
    "linear-gradient(180deg, rgba(15,23,42,0.82), rgba(2,6,23,0.96))",
  textAlign: "center",
};

const emptyIconStyle: React.CSSProperties = {
  fontSize: 34,
  marginBottom: 12,
};

const emptyTitleStyle: React.CSSProperties = {
  margin: 0,
  color: "#f8fafc",
  fontSize: 22,
  fontWeight: 800,
};

const emptyTextStyle: React.CSSProperties = {
  margin: "10px auto 0",
  maxWidth: 520,
  color: "rgba(203,213,225,0.72)",
  lineHeight: 1.6,
};