"use client";

type Props = {
  groupId: string;
  roommates: { uid: string; name: string }[];
  isCreator: boolean;
  myUid: string;
  createdByUid: string | null;
  onRemove: (uid: string) => void;
  onTransferAdmin: (uid: string) => void;
  onLeave: () => void;
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
  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 28 }}>Roommates</h2>
        <div style={{ marginTop: 6, color: "rgba(255,255,255,0.68)" }}>
          Manage room members, admin access, and your room ID.
        </div>
      </div>

      <div style={panelStyle}>
        <div style={roomHeaderStyle}>
          <div style={{ display: "grid", gap: 6 }}>
            <div style={sectionHeadingStyle}>Room ID</div>
            <div style={roomIdStyle}>{groupId || "No Room ID"}</div>
            <div style={metaTextStyle}>
              Share this Room ID with your roommates so they can join.
            </div>
          </div>

          <button
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
                          ? "rgba(59,130,246,0.16)"
                          : "rgba(148,163,184,0.12)",
                        color: isAdmin ? "#93c5fd" : "#cbd5e1",
                        border: isAdmin
                          ? "1px solid rgba(59,130,246,0.24)"
                          : "1px solid rgba(148,163,184,0.18)",
                      }}
                    >
                      {isAdmin ? "Admin" : "Member"}
                    </span>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {isCreator && !isMe && !isAdmin && (
                    <button
                      onClick={() => onTransferAdmin(r.uid)}
                      style={primaryGhostBtnStyle}
                    >
                      Make Admin
                    </button>
                  )}

                  {isCreator && !isMe && (
                    <button
                      onClick={() => onRemove(r.uid)}
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
          <button onClick={onLeave} style={dangerBtnStyle}>
            Leave Room
          </button>
        </div>
      </div>
    </div>
  );
}

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

const dangerPanelStyle: React.CSSProperties = {
  border: "1px solid rgba(248,113,113,0.18)",
  borderRadius: 24,
  padding: 20,
  background: "linear-gradient(180deg, rgba(60,7,7,0.22) 0%, rgba(10,16,34,0.82) 100%)",
  boxShadow: "0 18px 38px rgba(0,0,0,0.20)",
  display: "grid",
  gap: 14,
};

const sectionHeadingStyle: React.CSSProperties = {
  fontWeight: 800,
  fontSize: 18,
};

const roomHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 14,
  flexWrap: "wrap",
};

const roomIdStyle: React.CSSProperties = {
  fontFamily: "monospace",
  fontSize: 15,
  opacity: 0.92,
  wordBreak: "break-all",
};

const metaTextStyle: React.CSSProperties = {
  fontSize: 13,
  color: "rgba(255,255,255,0.66)",
};

const memberCardStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 14,
  padding: 16,
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 18,
  background: "rgba(255,255,255,0.03)",
  flexWrap: "wrap",
};

const memberNameStyle: React.CSSProperties = {
  fontWeight: 800,
  fontSize: 17,
};

const roleBadgeStyle: React.CSSProperties = {
  padding: "5px 10px",
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 800,
};

const primaryGhostBtnStyle: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 12,
  border: "1px solid rgba(96,165,250,0.32)",
  background: "rgba(59,130,246,0.10)",
  color: "#93c5fd",
  cursor: "pointer",
  fontWeight: 800,
  transition: "all 0.2s ease",
};

const dangerGhostBtnStyle: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 12,
  border: "1px solid rgba(248,113,113,0.28)",
  background: "rgba(127,29,29,0.16)",
  color: "#fca5a5",
  cursor: "pointer",
  fontWeight: 800,
  transition: "all 0.2s ease",
};

const dangerBtnStyle: React.CSSProperties = {
  padding: "11px 15px",
  borderRadius: 14,
  border: "1px solid rgba(248,113,113,0.42)",
  background: "linear-gradient(135deg, rgba(239,68,68,0.24), rgba(185,28,28,0.28))",
  color: "#fecaca",
  cursor: "pointer",
  fontWeight: 800,
  transition: "all 0.2s ease",
};