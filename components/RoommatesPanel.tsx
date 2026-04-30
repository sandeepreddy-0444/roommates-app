"use client";

import { useEffect, useState, type CSSProperties } from "react";
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/app/lib/firebase";

type JoinRequestRow = {
  uid: string;
  displayName: string;
  email: string | null;
};

type Props = {
  groupId: string;
  roommates: { uid: string; name: string }[];
  isCreator: boolean;
  myUid: string;
  createdByUid: string | null;
  onRemove: (uid: string) => void;
  onTransferAdmin: (uid: string) => void;
  onLeave: () => Promise<void> | void;
};

export default function RoommatesPanel({
  groupId,
  roommates,
  isCreator,
  myUid,
  createdByUid,
  onRemove,
  onTransferAdmin,
  onLeave,
}: Props) {
  const [joinRequests, setJoinRequests] = useState<JoinRequestRow[]>([]);
  const [joinBusy, setJoinBusy] = useState<string | null>(null);

  /** In-app modals (native `window.confirm` is unreliable on many mobile / in-app WebViews). */
  const [removeTarget, setRemoveTarget] = useState<{ uid: string; name: string } | null>(null);
  const [adminTarget, setAdminTarget] = useState<{ uid: string; name: string } | null>(null);
  const [rejectTarget, setRejectTarget] = useState<JoinRequestRow | null>(null);
  const [leaveTargetOpen, setLeaveTargetOpen] = useState(false);
  const [leaveBusy, setLeaveBusy] = useState(false);

  useEffect(() => {
    if (!removeTarget && !adminTarget && !rejectTarget && !leaveTargetOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (leaveBusy) return;
        setRemoveTarget(null);
        setAdminTarget(null);
        setRejectTarget(null);
        setLeaveTargetOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [removeTarget, adminTarget, rejectTarget, leaveTargetOpen, leaveBusy]);

  useEffect(() => {
    if (!groupId || !isCreator) {
      setJoinRequests([]);
      return;
    }

    const unsub = onSnapshot(collection(db, "groups", groupId, "joinRequests"), (snap) => {
      const rows: JoinRequestRow[] = snap.docs.map((d) => {
        const data = d.data() as Record<string, unknown>;
        return {
          uid: d.id,
          displayName: typeof data.displayName === "string" ? data.displayName : d.id.slice(0, 8),
          email: typeof data.email === "string" ? data.email : null,
        };
      });
      rows.sort((a, b) => a.displayName.localeCompare(b.displayName));
      setJoinRequests(rows);
    });

    return () => unsub();
  }, [groupId, isCreator]);

  async function acceptJoin(requesterUid: string) {
    if (!isCreator || !groupId) return;
    setJoinBusy(requesterUid);
    try {
      const batch = writeBatch(db);
      batch.set(doc(db, "groups", groupId, "members", requesterUid), {
        role: "member",
        joinedAt: serverTimestamp(),
      });
      batch.update(doc(db, "users", requesterUid), {
        groupId,
        pendingJoinGroupId: deleteField(),
        joinRequestNote: deleteField(),
      });
      batch.delete(doc(db, "groups", groupId, "joinRequests", requesterUid));
      await batch.commit();
    } catch (e) {
      console.error(e);
      alert("Could not accept this request. Check Firestore rules and try again.");
    } finally {
      setJoinBusy(null);
    }
  }

  async function runRejectJoin(requesterUid: string) {
    if (!isCreator || !groupId) return;
    setJoinBusy(requesterUid);
    try {
      await deleteDoc(doc(db, "groups", groupId, "joinRequests", requesterUid));
      await updateDoc(doc(db, "users", requesterUid), {
        pendingJoinGroupId: deleteField(),
        joinRequestNote:
          "Your request to join this room was declined. You can try another Room ID or ask the admin.",
      });
    } catch (e) {
      console.error(e);
      alert("Could not reject this request.");
    } finally {
      setJoinBusy(null);
    }
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div>
        <h2
          style={{
            margin: 0,
            fontSize: "clamp(18px, 4.2vw, 22px)",
            color: "#0f172a",
            letterSpacing: "-0.02em",
            fontWeight: 800,
            lineHeight: 1.15,
          }}
        >
          Roommates
        </h2>
        <div
          style={{
            marginTop: 4,
            color: "rgba(15, 23, 42, 0.72)",
            fontSize: "clamp(12px, 3.1vw, 13px)",
            lineHeight: 1.4,
          }}
        >
          Manage room members, admin access, and your room ID.
        </div>
      </div>

      <div style={panelStyle}>
        <div style={roomHeaderStyle}>
          <div style={{ display: "grid", gap: 6 }}>
            <div style={sectionHeadingStyle}>Room ID</div>
            <div style={roomIdStyle}>{groupId || "No Room ID"}</div>
            <div style={metaTextStyle}>
              Share this Room ID so people can request to join. New members only get access after you
              approve their request.
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              if (!groupId) {
                alert("No Room ID found. Join or create a room first.");
                return;
              }
              navigator.clipboard.writeText(groupId);
              alert("Room ID copied ✅");
            }}
            style={primaryGhostBtnStyle}
          >
            Copy
          </button>
        </div>
      </div>

      {isCreator && joinRequests.length > 0 ? (
        <div style={panelStyle}>
          <div style={sectionHeadingStyle}>Join requests ({joinRequests.length})</div>
          <div style={metaTextStyle}>
            Approve to add them to the room, or reject to notify them they were not added.
          </div>
          <div style={{ display: "grid", gap: 12 }}>
            {joinRequests.map((row) => (
              <div key={row.uid} style={memberCardStyle}>
                <div style={{ display: "grid", gap: 4 }}>
                  <div style={memberNameStyle}>{row.displayName}</div>
                  <div style={metaTextStyle}>{row.email ?? row.uid}</div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    disabled={joinBusy === row.uid}
                    onClick={() => acceptJoin(row.uid)}
                    style={primaryGhostBtnStyle}
                  >
                    {joinBusy === row.uid ? "…" : "Accept"}
                  </button>
                  <button
                    type="button"
                    disabled={joinBusy === row.uid}
                    onClick={() => setRejectTarget(row)}
                    style={dangerGhostBtnStyle}
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div style={panelStyle}>
        <div style={sectionHeadingStyle}>Roommates ({roommates.length})</div>

        <div style={{ display: "grid", gap: 12 }}>
          {roommates.map((r) => {
            const isMe = r.uid === myUid;
            const isAdmin = r.uid === createdByUid;

            return (
              <div key={r.uid} style={memberCardStyle}>
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <div style={memberNameStyle}>
                      {r.name} {isMe ? "(You)" : ""}
                    </div>

                    <span
                      style={{
                        ...roleBadgeStyle,
                        background: isAdmin
                          ? "rgba(219,234,254,0.95)"
                          : "rgba(241,245,249,0.95)",
                        color: isAdmin ? "#1e3a8a" : "#334155",
                        border: isAdmin
                          ? "1px solid rgba(59,130,246,0.35)"
                          : "1px solid rgba(148,163,184,0.45)",
                      }}
                    >
                      {isAdmin ? "Admin" : "Member"}
                    </span>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {isCreator && !isMe && !isAdmin && (
                    <button
                      type="button"
                      onClick={() => setAdminTarget({ uid: r.uid, name: r.name })}
                      style={primaryGhostBtnStyle}
                    >
                      Make Admin
                    </button>
                  )}

                  {isCreator && !isMe && (
                    <button
                      type="button"
                      onClick={() => setRemoveTarget({ uid: r.uid, name: r.name })}
                      style={dangerGhostBtnStyle}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={dangerPanelStyle}>
        <div style={sectionHeadingStyle}>Danger Zone</div>
        <div style={metaTextStyle}>
          Leaving the room will remove your access to this room’s shared features.
        </div>

        <div>
          <button type="button" onClick={() => setLeaveTargetOpen(true)} style={dangerBtnStyle}>
            Leave Room
          </button>
        </div>
      </div>

      {removeTarget ? (
        <div style={modalOverlayStyle} role="presentation" onClick={() => setRemoveTarget(null)}>
          <div
            style={modalCardStyle}
            role="dialog"
            aria-modal="true"
            aria-labelledby="remove-roommate-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="remove-roommate-title" style={modalTitleStyle}>
              Remove {removeTarget.name}?
            </h3>
            <p style={modalBodyStyle}>
              They will <strong>immediately</strong> lose access to shared expenses, chat, reminders,
              and this room’s data. This cannot be undone from their side without a new invite.
            </p>
            <div style={modalActionsStyle}>
              <button type="button" style={modalCancelBtnStyle} onClick={() => setRemoveTarget(null)}>
                Cancel
              </button>
              <button
                type="button"
                style={modalDangerBtnStyle}
                onClick={() => {
                  onRemove(removeTarget.uid);
                  setRemoveTarget(null);
                }}
              >
                Remove from room
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {adminTarget ? (
        <div style={modalOverlayStyle} role="presentation" onClick={() => setAdminTarget(null)}>
          <div
            style={modalCardStyle}
            role="dialog"
            aria-modal="true"
            aria-labelledby="make-admin-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="make-admin-title" style={modalTitleStyle}>
              Make {adminTarget.name} admin?
            </h3>
            <p style={modalBodyStyle}>
              You will become a regular member. <strong>{adminTarget.name}</strong> will manage join
              requests and can remove members.
            </p>
            <div style={modalActionsStyle}>
              <button type="button" style={modalCancelBtnStyle} onClick={() => setAdminTarget(null)}>
                Cancel
              </button>
              <button
                type="button"
                style={modalPrimaryBtnStyle}
                onClick={() => {
                  onTransferAdmin(adminTarget.uid);
                  setAdminTarget(null);
                }}
              >
                Make admin
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {rejectTarget ? (
        <div style={modalOverlayStyle} role="presentation" onClick={() => setRejectTarget(null)}>
          <div
            style={modalCardStyle}
            role="dialog"
            aria-modal="true"
            aria-labelledby="reject-join-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="reject-join-title" style={modalTitleStyle}>
              Reject {rejectTarget.displayName}?
            </h3>
            <p style={modalBodyStyle}>
              They will be told their request was declined. They can try again with a different room
              ID.
            </p>
            <div style={modalActionsStyle}>
              <button type="button" style={modalCancelBtnStyle} onClick={() => setRejectTarget(null)}>
                Cancel
              </button>
              <button
                type="button"
                style={modalDangerBtnStyle}
                onClick={() => {
                  const uid = rejectTarget.uid;
                  setRejectTarget(null);
                  void runRejectJoin(uid);
                }}
              >
                Reject request
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {leaveTargetOpen ? (
        <div
          style={modalOverlayStyle}
          role="presentation"
          onClick={() => {
            if (!leaveBusy) setLeaveTargetOpen(false);
          }}
        >
          <div
            style={modalCardStyle}
            role="dialog"
            aria-modal="true"
            aria-labelledby="leave-room-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="leave-room-title" style={modalTitleStyle}>
              Leave this room?
            </h3>
            <p style={modalBodyStyle}>
              You will lose access to shared expenses, chat, reminders, chores, and grocery for this
              room until you join again.
            </p>
            <div style={modalActionsStyle}>
              <button
                type="button"
                style={modalCancelBtnStyle}
                disabled={leaveBusy}
                onClick={() => setLeaveTargetOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                style={modalDangerBtnStyle}
                disabled={leaveBusy}
                onClick={async () => {
                  setLeaveBusy(true);
                  try {
                    await Promise.resolve(onLeave());
                    setLeaveTargetOpen(false);
                  } finally {
                    setLeaveBusy(false);
                  }
                }}
              >
                {leaveBusy ? "Leaving…" : "Leave room"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const modalOverlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 10050,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
  background: "rgba(15, 23, 42, 0.45)",
  backdropFilter: "blur(4px)",
  WebkitBackdropFilter: "blur(4px)",
};

const modalCardStyle: CSSProperties = {
  width: "100%",
  maxWidth: 400,
  borderRadius: 18,
  padding: 20,
  background: "var(--app-surface-elevated, #ffffff)",
  border: "1px solid var(--app-border-subtle, rgba(148, 163, 184, 0.35))",
  boxShadow: "0 20px 50px rgba(15, 23, 42, 0.15)",
  color: "#0f172a",
};

const modalTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: "clamp(17px, 4vw, 19px)",
  fontWeight: 800,
  letterSpacing: "-0.02em",
  lineHeight: 1.2,
};

const modalBodyStyle: CSSProperties = {
  margin: "12px 0 0",
  fontSize: 14,
  lineHeight: 1.45,
  color: "rgba(15, 23, 42, 0.78)",
};

const modalActionsStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 10,
  marginTop: 18,
  justifyContent: "flex-end",
};

const modalCancelBtnStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: 12,
  border: "1px solid rgba(148, 163, 184, 0.45)",
  background: "rgba(248, 250, 252, 0.95)",
  color: "#0f172a",
  fontWeight: 650,
  fontSize: 14,
  cursor: "pointer",
};

const modalPrimaryBtnStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: 12,
  border: "1px solid rgba(37, 99, 235, 0.45)",
  background: "linear-gradient(135deg, #60a5fa, #2563eb)",
  color: "#fff",
  fontWeight: 750,
  fontSize: 14,
  cursor: "pointer",
};

const modalDangerBtnStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: 12,
  border: "1px solid rgba(220, 38, 38, 0.45)",
  background: "linear-gradient(135deg, #f87171, #b91c1c)",
  color: "#fff",
  fontWeight: 750,
  fontSize: 14,
  cursor: "pointer",
};

const panelStyle: CSSProperties = {
  border: "1px solid var(--app-border-subtle, rgba(148, 163, 184, 0.32))",
  borderRadius: 18,
  padding: "14px 14px 16px",
  background: "var(--app-surface-elevated, linear-gradient(180deg, #ffffff 0%, #f1f5f9 100%))",
  boxShadow: "var(--app-shadow-sheet, 0 8px 28px rgba(15, 23, 42, 0.07))",
  display: "grid",
  gap: 12,
};

const dangerPanelStyle: CSSProperties = {
  border: "1px solid rgba(248,113,113,0.35)",
  borderRadius: 24,
  padding: 20,
  background: "linear-gradient(180deg, #fff1f2 0%, #ffe4e6 100%)",
  boxShadow: "0 12px 28px rgba(15, 23, 42, 0.06)",
  display: "grid",
  gap: 14,
};

const sectionHeadingStyle: CSSProperties = {
  fontWeight: 800,
  fontSize: "clamp(14px, 3.4vw, 16px)",
  color: "#0f172a",
  letterSpacing: "-0.02em",
};

const roomHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 14,
  flexWrap: "wrap",
};

const roomIdStyle: CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: "clamp(12px, 2.9vw, 14px)",
  color: "#0f172a",
  wordBreak: "break-all",
};

const metaTextStyle: CSSProperties = {
  fontSize: "clamp(11px, 2.8vw, 12px)",
  color: "rgba(15, 23, 42, 0.72)",
  lineHeight: 1.4,
};

const memberCardStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 10,
  padding: "12px 12px",
  border: "1px solid rgba(148, 163, 184, 0.4)",
  borderRadius: 14,
  background: "rgba(255, 255, 255, 0.5)",
  flexWrap: "wrap",
};

const memberNameStyle: CSSProperties = {
  fontWeight: 750,
  fontSize: "clamp(14px, 3.3vw, 15px)",
  color: "#0f172a",
  lineHeight: 1.25,
};

const roleBadgeStyle: CSSProperties = {
  padding: "3px 8px",
  borderRadius: 999,
  fontSize: "clamp(10px, 2.6vw, 11px)",
  fontWeight: 750,
};

const primaryGhostBtnStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: 12,
  border: "1px solid rgba(59,130,246,0.4)",
  background: "rgba(239,246,255,0.95)",
  color: "#1e40af",
  cursor: "pointer",
  fontWeight: 750,
  transition: "all 0.2s ease",
};

const dangerGhostBtnStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: 12,
  border: "1px solid rgba(248,113,113,0.45)",
  background: "rgba(254,226,226,0.9)",
  color: "#991b1b",
  cursor: "pointer",
  fontWeight: 750,
  transition: "all 0.2s ease",
};

const dangerBtnStyle: CSSProperties = {
  padding: "11px 15px",
  borderRadius: 14,
  border: "1px solid rgba(220,38,38,0.45)",
  background: "linear-gradient(135deg, #ef4444, #b91c1c)",
  color: "#ffffff",
  cursor: "pointer",
  fontWeight: 800,
  transition: "all 0.2s ease",
};
