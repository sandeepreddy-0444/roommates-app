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
    <div style={{ display: "grid", gap: 14 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          padding: 14,
          border: "1px solid #333",
          borderRadius: 14,
          background: "#111",
          color: "white",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "grid", gap: 4 }}>
          <div style={{ fontWeight: 900, fontSize: 16 }}>Room ID</div>
          <div
            style={{
              fontFamily: "monospace",
              opacity: 0.9,
              wordBreak: "break-all",
            }}
          >
            {groupId || "No Room ID"}
          </div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>
            Share this Room ID with roommates so they can join.
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
          style={{
            padding: "10px 14px",
            borderRadius: 12,
            border: "1px solid #3b82f6",
            background: "transparent",
            color: "#60a5fa",
            cursor: "pointer",
            whiteSpace: "nowrap",
            fontWeight: 800,
          }}
        >
          Copy
        </button>
      </div>

      <div
        style={{
          border: "1px solid #333",
          borderRadius: 14,
          background: "#111",
          padding: 14,
          color: "white",
        }}
      >
        <div style={{ fontWeight: 900, marginBottom: 10 }}>
          Roommates ({roommates.length})
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          {roommates.map((r) => {
            const isMe = r.uid === myUid;
            const isAdmin = r.uid === createdByUid;

            return (
              <div
                key={r.uid}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  padding: 12,
                  border: "1px solid #333",
                  borderRadius: 12,
                  background: "#0b0b0b",
                  color: "white",
                  flexWrap: "wrap",
                }}
              >
                <div style={{ display: "grid", gap: 4 }}>
                  <div style={{ fontWeight: 800 }}>
                    {r.name} {isMe ? "(You)" : ""}
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.75 }}>
                    {isAdmin ? "Admin" : "Member"}
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {isCreator && !isMe && !isAdmin && (
                    <button
                      onClick={() => onTransferAdmin(r.uid)}
                      style={{
                        padding: "8px 10px",
                        borderRadius: 8,
                        border: "1px solid #3b82f6",
                        background: "transparent",
                        color: "#60a5fa",
                        cursor: "pointer",
                        fontWeight: 700,
                      }}
                    >
                      Make Admin
                    </button>
                  )}

                  {isCreator && !isMe && (
                    <button
                      onClick={() => onRemove(r.uid)}
                      style={{
                        padding: "8px 10px",
                        borderRadius: 8,
                        border: "1px solid red",
                        background: "transparent",
                        color: "#f87171",
                        cursor: "pointer",
                        fontWeight: 700,
                      }}
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

      <div
        style={{
          border: "1px solid #4b1c1c",
          borderRadius: 14,
          background: "#111",
          padding: 14,
        }}
      >
        <div style={{ fontWeight: 900, marginBottom: 10, color: "#fecaca" }}>
          Danger Zone
        </div>

        <button
          onClick={onLeave}
          style={{
            padding: "10px 14px",
            borderRadius: 12,
            border: "1px solid red",
            background: "transparent",
            color: "#f87171",
            cursor: "pointer",
            fontWeight: 800,
          }}
        >
          Leave Room
        </button>
      </div>
    </div>
  );
}