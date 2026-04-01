"use client";

import { useEffect, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
} from "firebase/firestore";
import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes,
} from "firebase/storage";
import { auth, db, storage } from "@/app/lib/firebase";

type Message = {
  id: string;
  text: string;
  senderId: string;
  senderName: string;
  imageUrl?: string;
  imagePath?: string;
  createdAt?: Timestamp;
  editedAt?: any;
};

export default function ChatPanel() {
  const [uid, setUid] = useState<string | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [senderName, setSenderName] = useState("");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setLoading(false);
        return;
      }

      setUid(user.uid);

      try {
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);

        if (userSnap.exists()) {
          const data = userSnap.data() as any;
          setGroupId(data.groupId || null);
          setSenderName(data.name || user.displayName || user.email || "User");
        }
      } catch (error) {
        console.error("Error loading user data:", error);
      } finally {
        setLoading(false);
      }
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    if (!groupId) return;

    const q = query(
      collection(db, "groups", groupId, "messages"),
      orderBy("createdAt", "asc")
    );

    const unsub = onSnapshot(q, (snapshot) => {
      const items = snapshot.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      })) as Message[];

      setMessages(items);
    });

    return () => unsub();
  }, [groupId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const closeMenu = () => setOpenMenuId(null);
    window.addEventListener("click", closeMenu);
    return () => window.removeEventListener("click", closeMenu);
  }, []);

  const formatTime = (timestamp?: Timestamp) => {
    if (!timestamp) return "";
    return timestamp.toDate().toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const sendMessage = async () => {
    if (!groupId || !uid || sending) return;
    if (!text.trim() && !file) return;

    setSending(true);

    try {
      let imageUrl = "";
      let imagePath = "";

      if (file) {
        const fileName = `${Date.now()}-${file.name}`;
        imagePath = `chatImages/${groupId}/${fileName}`;
        const storageRef = ref(storage, imagePath);

        await uploadBytes(storageRef, file);
        imageUrl = await getDownloadURL(storageRef);
      }

      await addDoc(collection(db, "groups", groupId, "messages"), {
        text: text.trim(),
        senderId: uid,
        senderName,
        imageUrl,
        imagePath,
        createdAt: serverTimestamp(),
      });

      setText("");
      setFile(null);

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (error) {
      console.error("Error sending message:", error);
      alert("Failed to send message.");
    } finally {
      setSending(false);
    }
  };

  const deleteMessage = async (msg: Message) => {
    if (!groupId || !uid) return;
    if (msg.senderId !== uid) {
      alert("You can only delete your own messages.");
      return;
    }

    const ok = confirm("Delete this message?");
    if (!ok) return;

    try {
      await deleteDoc(doc(db, "groups", groupId, "messages", msg.id));

      if (msg.imagePath) {
        try {
          await deleteObject(ref(storage, msg.imagePath));
        } catch (storageError) {
          console.error("Image delete failed:", storageError);
        }
      }
    } catch (error) {
      console.error("Error deleting message:", error);
      alert("Failed to delete message.");
    }
  };

  const startEdit = (msg: Message) => {
    setEditingId(msg.id);
    setEditText(msg.text || "");
    setOpenMenuId(null);
  };

  const saveEdit = async (msg: Message) => {
    if (!groupId || !uid) return;
    if (msg.senderId !== uid) {
      alert("You can only edit your own messages.");
      return;
    }

    try {
      await updateDoc(doc(db, "groups", groupId, "messages", msg.id), {
        text: editText.trim(),
        editedAt: serverTimestamp(),
      });

      setEditingId(null);
      setEditText("");
      setOpenMenuId(null);
    } catch (error) {
      console.error("Error editing message:", error);
      alert("Failed to edit message.");
    }
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditText("");
    setOpenMenuId(null);
  };

  if (loading) return <div style={{ padding: 10, opacity: 0.7 }}>Loading your data...</div>;
  if (!uid) return <div style={{ padding: 10 }}>Please log in first.</div>;
  if (!groupId) return <div style={{ padding: 10 }}>You are not in a room yet.</div>;

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 28 }}>Room Chat</h2>
        <div style={{ marginTop: 6, color: "rgba(255,255,255,0.68)" }}>
          Stay connected with your roommates in one shared space.
        </div>
      </div>

      <div style={chatShellStyle}>
        <div style={chatHeaderStyle}>
          <div>
            <div style={chatSectionTitleStyle}>Conversation</div>
            <div style={subtleTextStyle}>
              {messages.length === 0
                ? "No messages yet"
                : `${messages.length} message${messages.length === 1 ? "" : "s"}`}
            </div>
          </div>
        </div>

        <div style={messagesAreaStyle}>
          {messages.length === 0 ? (
            <div style={emptyChatStateStyle}>
              <div style={{ fontSize: 40 }}>💬</div>
              <p style={{ fontSize: 18, margin: 0, fontWeight: 700 }}>No messages yet</p>
              <p style={{ fontSize: 13, margin: 0, opacity: 0.72 }}>
                Start the conversation with your roommates!
              </p>
            </div>
          ) : (
            messages.map((msg) => {
              const isMe = msg.senderId === uid;

              return (
                <div
                  key={msg.id}
                  style={{
                    display: "flex",
                    justifyContent: isMe ? "flex-end" : "flex-start",
                    marginBottom: 14,
                  }}
                >
                  <div
                    style={{
                      ...bubbleStyle,
                      ...(isMe ? myBubbleStyle : theirBubbleStyle),
                      boxShadow: isMe
                        ? "0 4px 12px rgba(34,197,94,0.2)"
                        : "0 4px 12px rgba(0,0,0,0.3)",
                    }}
                  >
                    <div style={bubbleTopStyle}>
                      <div style={bubbleNameStyle}>
                        {isMe ? "You" : msg.senderName}
                      </div>

                      {isMe && (
                        <div
                          style={{ position: "relative" }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={() =>
                              setOpenMenuId(openMenuId === msg.id ? null : msg.id)
                            }
                            style={menuTriggerStyle}
                          >
                            ⋮
                          </button>

                          {openMenuId === msg.id && (
                            <div style={menuCardStyle}>
                              <button
                                onClick={() => startEdit(msg)}
                                style={menuBtnStyle}
                              >
                                Edit
                              </button>

                              <button
                                onClick={() => {
                                  deleteMessage(msg);
                                  setOpenMenuId(null);
                                }}
                                style={{
                                  ...menuBtnStyle,
                                  color: "#fca5a5",
                                }}
                              >
                                Delete
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {editingId === msg.id ? (
                      <div style={{ marginTop: 8 }}>
                        <textarea
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          rows={2}
                          style={editTextareaStyle}
                        />
                        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                          <button onClick={() => saveEdit(msg)} style={saveBtnStyle}>
                            Save
                          </button>

                          <button onClick={cancelEdit} style={cancelBtnStyle}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {msg.text && (
                          <p
                            style={{
                              margin: "6px 0 0 0",
                              lineHeight: "1.6",
                              whiteSpace: "pre-wrap",
                            }}
                          >
                            {msg.text}
                          </p>
                        )}
                      </>
                    )}

                    {msg.imageUrl && (
                      <a
                        href={msg.imageUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{ display: "block", marginTop: 10 }}
                      >
                        <img
                          src={msg.imageUrl}
                          alt="chat upload"
                          style={chatImageStyle}
                        />
                      </a>
                    )}

                    <div style={timestampStyle}>
                      {formatTime(msg.createdAt)} {msg.editedAt ? "• edited" : ""}
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>

        <div style={composerStyle}>
          <div style={{ display: "grid", gap: 8 }}>
            <div style={chatSectionTitleStyle}>New message</div>
            <div style={subtleTextStyle}>
              Press Enter to send. Use Shift + Enter for a new line.
            </div>
          </div>

          <textarea
            placeholder="Type a message"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            style={composerTextareaStyle}
          />

          <div style={fileRowStyle}>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  setFile(e.target.files[0]);
                }
              }}
              style={fileInputStyle}
            />

            {file && (
              <div style={fileChipStyle}>
                Selected: <strong>{file.name}</strong>
              </div>
            )}
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              onClick={sendMessage}
              disabled={sending || (!text.trim() && !file)}
              style={{
                ...sendBtnStyle,
                opacity: sending || (!text.trim() && !file) ? 0.55 : 1,
                cursor:
                  sending || (!text.trim() && !file) ? "not-allowed" : "pointer",
              }}
            >
              {sending ? "Sending..." : "Send Message"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const chatShellStyle: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 24,
  padding: 18,
  background:
    "linear-gradient(180deg, rgba(8,13,28,0.88) 0%, rgba(10,16,34,0.82) 100%)",
  boxShadow: "0 18px 38px rgba(0,0,0,0.20)",
  display: "grid",
  gap: 16,
};

const chatHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
};

const chatSectionTitleStyle: React.CSSProperties = {
  fontWeight: 800,
  fontSize: 18,
};

const subtleTextStyle: React.CSSProperties = {
  fontSize: 13,
  color: "rgba(255,255,255,0.66)",
};

const messagesAreaStyle: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 20,
  padding: 16,
  minHeight: 500,
  maxHeight: 500,
  overflowY: "auto",
  background:
    "linear-gradient(180deg, rgba(5,10,20,0.96) 0%, rgba(8,14,26,0.94) 100%)",
};

const emptyChatStateStyle: React.CSSProperties = {
  minHeight: 420,
  display: "grid",
  placeItems: "center",
  textAlign: "center",
  gap: 8,
  opacity: 0.9,
};

const bubbleStyle: React.CSSProperties = {
  position: "relative",
  maxWidth: "72%",
  borderRadius: 18,
  padding: "14px 14px 12px",
  border: "1px solid rgba(255,255,255,0.08)",
};

const myBubbleStyle: React.CSSProperties = {
  background: "linear-gradient(135deg, rgba(59,130,246,0.22), rgba(99,102,241,0.18))",
};

const theirBubbleStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.04)",
};

const bubbleTopStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 10,
};

const bubbleNameStyle: React.CSSProperties = {
  fontWeight: 800,
  fontSize: 14,
};

const menuTriggerStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "white",
  fontSize: 18,
  cursor: "pointer",
  lineHeight: 1,
  padding: 0,
};

const menuCardStyle: React.CSSProperties = {
  position: "absolute",
  top: 24,
  right: 0,
  background: "rgba(10,16,30,0.98)",
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 12,
  minWidth: 110,
  zIndex: 10,
  overflow: "hidden",
  boxShadow: "0 16px 30px rgba(0,0,0,0.24)",
};

const menuBtnStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "10px 12px",
  background: "transparent",
  border: "none",
  color: "white",
  textAlign: "left",
  cursor: "pointer",
  fontWeight: 600,
};

const editTextareaStyle: React.CSSProperties = {
  width: "100%",
  padding: 10,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(5,10,20,0.92)",
  color: "white",
  resize: "vertical",
  outline: "none",
};

const saveBtnStyle: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 12,
  border: "1px solid rgba(74,222,128,0.24)",
  background: "rgba(22,163,74,0.20)",
  color: "#dcfce7",
  cursor: "pointer",
  fontWeight: 700,
};

const cancelBtnStyle: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(255,255,255,0.08)",
  color: "white",
  cursor: "pointer",
  fontWeight: 700,
};

const chatImageStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: "260px",
  borderRadius: 14,
  display: "block",
  border: "1px solid rgba(255,255,255,0.08)",
};

const timestampStyle: React.CSSProperties = {
  marginTop: 10,
  fontSize: 12,
  color: "rgba(255,255,255,0.52)",
};

const composerStyle: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 20,
  padding: 16,
  background: "rgba(255,255,255,0.03)",
  display: "grid",
  gap: 14,
};

const composerTextareaStyle: React.CSSProperties = {
  width: "100%",
  padding: 14,
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.10)",
  resize: "vertical",
  background: "rgba(5,10,20,0.92)",
  color: "white",
  outline: "none",
};

const fileRowStyle: React.CSSProperties = {
  display: "flex",
  gap: 12,
  alignItems: "center",
  flexWrap: "wrap",
};

const fileInputStyle: React.CSSProperties = {
  color: "white",
};

const fileChipStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 999,
  background: "rgba(59,130,246,0.14)",
  border: "1px solid rgba(96,165,250,0.20)",
  fontSize: 13,
};

const sendBtnStyle: React.CSSProperties = {
  padding: "12px 18px",
  borderRadius: 14,
  border: "1px solid rgba(96,165,250,0.75)",
  background: "linear-gradient(135deg, #60a5fa, #2563eb)",
  color: "white",
  fontWeight: 800,
  boxShadow: "0 8px 20px rgba(37,99,235,0.3)",
  transition: "all 0.2s ease",
};