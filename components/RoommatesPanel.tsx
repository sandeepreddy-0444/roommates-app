"use client";

type Props = {
  roommates: { uid: string; name: string }[];
  isCreator: boolean;
  myUid: string;
  onRemove: (memberUid: string) => void;
};

export default function RoommatesPanel({ roommates, isCreator, myUid, onRemove }: Props) {
  return (
    <div>
      {roommates.length === 0 ? (
        <p style={{ opacity: 0.6 }}>No roommates found</p>
      ) : (
        <div style={{ display: "grid", gap: "10px" }}>
          {roommates.map((r) => (
            <div
              key={r.uid}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: 12,
                border: "1px solid #e5e7eb",
                borderRadius: 14,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 12,
                    border: "1px solid #e5e7eb",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 800,
                    background: "#f9fafb",
                    color: "#111",
                  }}
                >
                  {r.name?.[0]?.toUpperCase()}
                </div>

                <div style={{ fontWeight: 700 }}>
                  {r.name} {r.uid === myUid ? "(You)" : ""}
                </div>
              </div>

              {/* ✅ Remove only if creator, and not yourself */}
              {isCreator && r.uid !== myUid && (
                <button
                  onClick={() => onRemove(r.uid)}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 10,
                    border: "1px solid #ff4d4f",
                    background: "transparent",
                    color: "#ff4d4f",
                    cursor: "pointer",
                  }}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
