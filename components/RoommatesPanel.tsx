"use client";

type Props = {
  roommates: { uid: string; name: string }[];
  isCreator: boolean;
  myUid: string;
  createdByUid: string | null;

  onRemove: (uid: string) => void;
  onTransferAdmin: (uid: string) => void;
  onLeave: () => void;
};

export default function RoommatesPanel({
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