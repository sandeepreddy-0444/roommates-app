"use client";

type Props = {
  groupId: string; // Room ID
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
      {/* ✅ Room ID + Copy */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          padding: 12,
          border: "1px solid #333",
          borderRadius: 12,
          background: "#111",
          color: "white",
        }}
      >
        <div style={{ display: "grid", gap: 4 }}>
          <div style={{ fontWeight: 800 }}>Room ID</div>
          <div
            style={{
              fontFamily: "monospace",
              opacity: 0.9,
              wordBreak: "break-all",
            }}
          >
            {groupId ? groupId : "No Room ID (join or create a room first)"}
          </div>
        </div>

        <button
          onClick={() => {
            if (!groupId) {
              alert("No Room ID found. Join or create a room first.");
              return;
            }
            navigator.clipboard.writeText(groupId);
            alert("Room ID copied!");
          }}
          style={{
            padding: "10px 14px",
            borderRadius: 12,
            border: "1px solid #3b82f6",
            background: "transparent",
            color: "#3b82f6",
            cursor: "pointer",
            whiteSpace: "nowrap",
            opacity: groupId ? 1 : 0.6,
          }}
        >
          Copy
        </button>
      </div>

      {/* Leave Room */}
      <button
        onClick={onLeave}
        style={{
          padding: "10px 14px",
          borderRadius: 12,
          border: "1px solid red",
          background: "transparent",
          color: "red",
          cursor: "pointer",
          width: "150px",
        }}
      >
        Leave Room
      </button>

      {/* Roommates list */}
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
              padding: 12,
              border: "1px solid #333",
              borderRadius: 12,
              background: "#111",
              color: "white",
            }}
          >
            <div>
              {r.name} {isMe ? "(You)" : ""}{" "}
              {isAdmin && <span style={{ opacity: 0.7 }}>• Admin</span>}
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              {isCreator && !isMe && !isAdmin && (
                <button
                  onClick={() => onTransferAdmin(r.uid)}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 8,
                    border: "1px solid #3b82f6",
                    background: "transparent",
                    color: "#3b82f6",
                    cursor: "pointer",
                  }}
                >
                  Make Admin
                </button>
              )}

              {isCreator && !isMe && (
                <button
                  onClick={() => onRemove(r.uid)}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 8,
                    border: "1px solid red",
                    background: "transparent",
                    color: "red",
                    cursor: "pointer",
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
  );
}