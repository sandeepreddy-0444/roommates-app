"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import EmojiPicker, { EmojiStyle, Theme } from "emoji-picker-react";
import { onAuthStateChanged } from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  limit,
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
import { MaterialIcon } from "@/components/MaterialIcon";

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

const MOBILE_BREAKPOINT = 900;
const MESSAGE_LIMIT = 80;

/** Resize large photos before upload (mobile-friendly, fewer failures on slow networks). */
async function compressImageForChat(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || typeof createImageBitmap !== "function") {
    return file;
  }
  try {
    const bitmap = await createImageBitmap(file);
    const maxEdge = 1600;
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close?.();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", 0.82);
    });
    if (!blob || blob.size >= file.size * 0.95) return file;
    const base = file.name.replace(/\.[^.]+$/, "") || "photo";
    return new File([blob], `${base}.jpg`, {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  } catch {
    return file;
  }
}

export default function ChatPanel() {
  const [uid, setUid] = useState<string | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [senderName, setSenderName] = useState("");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingComposerCursorRef = useRef<number | null>(null);
  const messagesAreaRef = useRef<HTMLDivElement | null>(null);
  const prevMessageCountRef = useRef(0);

  const isMobile =
    typeof window !== "undefined" ? window.innerWidth <= MOBILE_BREAKPOINT : false;

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
      orderBy("createdAt", "desc"),
      limit(MESSAGE_LIMIT)
    );

    const unsub = onSnapshot(q, (snapshot) => {
      const items = snapshot.docs
        .map((d) => ({
          id: d.id,
          ...d.data(),
        }))
        .reverse() as Message[];

      setMessages(items);
    });

    return () => unsub();
  }, [groupId]);

  useEffect(() => {
    if (!messagesAreaRef.current) return;

    const hasNewMessage = messages.length > prevMessageCountRef.current;
    prevMessageCountRef.current = messages.length;

    if (!hasNewMessage) return;

    bottomRef.current?.scrollIntoView({
      behavior: isMobile ? "auto" : "smooth",
      block: "end",
    });
  }, [messages, isMobile]);

  const formatTime = (timestamp?: Timestamp) => {
    if (!timestamp) return "";
    return timestamp.toDate().toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const resetComposer = () => {
    setText("");
    setFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  function clearAttachment() {
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function insertEmojiAtCursor(emoji: string) {
    const ta = composerTextareaRef.current;
    if (!ta) {
      setText((prev) => prev + emoji);
      return;
    }
    const start = ta.selectionStart ?? ta.value.length;
    const end = ta.selectionEnd ?? ta.value.length;
    const v = ta.value;
    const next = v.slice(0, start) + emoji + v.slice(end);
    pendingComposerCursorRef.current = start + [...emoji].length;
    setText(next);
  }

  useLayoutEffect(() => {
    const ta = composerTextareaRef.current;
    const pos = pendingComposerCursorRef.current;
    if (ta == null || pos == null) return;
    pendingComposerCursorRef.current = null;
    ta.focus();
    ta.setSelectionRange(pos, pos);
  }, [text]);

  useEffect(() => {
    if (!emojiPickerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setEmojiPickerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [emojiPickerOpen]);

  const sendMessage = async () => {
    if (!groupId || !uid || sending) return;
    if (!text.trim() && !file) return;

    setSending(true);

    try {
      let imageUrl = "";
      let imagePath = "";

      if (file) {
        const uploadFile = await compressImageForChat(file);
        const safeName = `${Date.now()}-${uploadFile.name}`;
        imagePath = `chatImages/${groupId}/${safeName}`;
        const storageRef = ref(storage, imagePath);

        await uploadBytes(storageRef, uploadFile);
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

      resetComposer();
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

  if (loading) {
    return <div style={{ padding: 10, opacity: 0.7 }}>Loading your data...</div>;
  }

  if (!uid) {
    return <div style={{ padding: 10 }}>Please log in first.</div>;
  }

  if (!groupId) {
    return <div style={{ padding: 10 }}>You are not in a room yet.</div>;
  }

  return (
    <div style={{ display: "grid", gap: 0, minWidth: 0 }}>
      <div style={chatShellStyle}>
        <div style={chatHeaderStyle}>
          <div>
            <div style={chatSectionTitleStyle}>Messages</div>
            <div style={subtleTextStyle}>
              {messages.length === 0
                ? "Your room’s thread. Say hi or share a photo below."
                : `${messages.length} recent message${
                    messages.length === 1 ? "" : "s"
                  }`}
            </div>
          </div>
        </div>

        <div
          ref={messagesAreaRef}
          style={messagesAreaStyle}
          onClick={() => setOpenMenuId(null)}
        >
          {messages.length === 0 ? (
            <div style={emptyChatStateStyle}>
              <div style={emptyStateIconWrapStyle} aria-hidden>
                <MaterialIcon name="chat_bubble" size={36} style={{ color: "rgba(37, 99, 235, 0.55)" }} />
              </div>
              <p style={emptyStateTitleStyle}>Nothing here yet</p>
              <p style={emptyStateSubStyle}>
                Send a message or add a photo—everyone in the room will see it.
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
                    }}
                  >
                    <div style={bubbleTopStyle}>
                      <div style={bubbleNameStyle}>
                        {isMe ? "You" : msg.senderName}
                      </div>

                      {isMe && (
                        <div
                          style={{ position: "relative", flexShrink: 0 }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
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
                                type="button"
                                onClick={() => startEdit(msg)}
                                style={menuBtnStyle}
                              >
                                Edit
                              </button>

                              <button
                                type="button"
                                onClick={() => {
                                  deleteMessage(msg);
                                  setOpenMenuId(null);
                                }}
                                style={{ ...menuBtnStyle, color: "#fca5a5" }}
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
                        <div style={editActionRowStyle}>
                          <button
                            type="button"
                            onClick={() => saveEdit(msg)}
                            style={saveBtnStyle}
                          >
                            Save
                          </button>

                          <button
                            type="button"
                            onClick={cancelEdit}
                            style={cancelBtnStyle}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {msg.text && (
                          <p style={messageTextStyle}>{msg.text}</p>
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
                          loading="lazy"
                          decoding="async"
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
            ref={composerTextareaRef}
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

          <div style={composerToolsRowStyle}>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              aria-label="Choose image to attach"
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  setFile(e.target.files[0]);
                }
              }}
              style={fileInputHiddenStyle}
              tabIndex={-1}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              style={composerAttachCompactStyle}
              aria-label="Attach image (JPG, PNG, GIF, WebP)"
              title="Attach image"
            >
              <MaterialIcon name="add_photo_alternate" size={22} style={{ color: "#1d4ed8" }} />
            </button>

            <button
              type="button"
              onClick={() => setEmojiPickerOpen(true)}
              style={composerAttachCompactStyle}
              aria-label="Open emoji picker"
              title="Emoji"
            >
              <MaterialIcon name="emoji_emotions" size={24} style={{ color: "#1d4ed8" }} />
            </button>
          </div>

          {emojiPickerOpen
            ? createPortal(
                <div
                  style={emojiPickerOverlayStyle}
                  onClick={() => setEmojiPickerOpen(false)}
                  role="presentation"
                >
                  <div
                    role="dialog"
                    aria-label="Emoji picker"
                    style={emojiPickerDialogStyle}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <div style={emojiPickerHeaderStyle}>
                      <span style={emojiPickerTitleStyle}>Emoji</span>
                      <button
                        type="button"
                        onClick={() => setEmojiPickerOpen(false)}
                        style={emojiPickerCloseBtnStyle}
                        aria-label="Close emoji picker"
                      >
                        <MaterialIcon name="close" size={22} style={{ color: "#475569" }} />
                      </button>
                    </div>
                    <div style={emojiPickerBodyStyle}>
                      <EmojiPicker
                        onEmojiClick={(d) => {
                          insertEmojiAtCursor(d.emoji);
                          setEmojiPickerOpen(false);
                        }}
                        theme={Theme.LIGHT}
                        emojiStyle={EmojiStyle.NATIVE}
                        width="100%"
                        height={400}
                        searchPlaceHolder="Search emojis"
                        previewConfig={{ showPreview: true }}
                        autoFocusSearch={false}
                        style={{ width: "100%" }}
                      />
                    </div>
                  </div>
                </div>,
                document.body
              )
            : null}

          {file ? (
            <div style={fileChipCompactStyle}>
              <span style={fileChipNameStyle} title={file.name}>
                {file.name}
              </span>
              <button
                type="button"
                onClick={clearAttachment}
                style={fileChipClearStyle}
                aria-label="Remove attachment"
              >
                <MaterialIcon name="close" size={18} style={{ color: "#64748b" }} />
              </button>
            </div>
          ) : null}

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
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
  border: "1px solid rgba(255, 255, 255, 0.75)",
  borderRadius: 24,
  padding: "clamp(14px, 3vw, 18px)",
  background:
    "linear-gradient(180deg, rgba(255,255,255,0.78) 0%, rgba(241,245,249,0.55) 100%)",
  boxShadow:
    "0 16px 36px rgba(15, 23, 42, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.85)",
  display: "grid",
  gap: 16,
  minWidth: 0,
};

const chatHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  minWidth: 0,
};

const chatSectionTitleStyle: React.CSSProperties = {
  fontWeight: 800,
  fontSize: 18,
};

const subtleTextStyle: React.CSSProperties = {
  fontSize: 13,
  color: "rgba(15, 23, 42, 0.76)",
  lineHeight: 1.5,
};

const messagesAreaStyle: React.CSSProperties = {
  border: "1px solid rgba(148, 163, 184, 0.4)",
  borderRadius: 20,
  padding: 12,
  minHeight: 340,
  maxHeight: "58vh",
  overflowY: "auto",
  overflowX: "hidden",
  background:
    "linear-gradient(180deg, rgba(255,255,255,0.96) 0%, rgba(248,250,252,0.92) 100%)",
  minWidth: 0,
  WebkitOverflowScrolling: "touch",
  overscrollBehavior: "contain",
};

const emptyChatStateStyle: React.CSSProperties = {
  minHeight: 260,
  display: "grid",
  placeItems: "center",
  textAlign: "center",
  gap: 10,
  padding: "12px 8px",
  opacity: 0.95,
};

const emptyStateIconWrapStyle: React.CSSProperties = {
  display: "grid",
  placeItems: "center",
  width: 72,
  height: 72,
  borderRadius: 20,
  background: "linear-gradient(180deg, rgba(219, 234, 254, 0.9), rgba(255, 255, 255, 0.6))",
  border: "1px solid rgba(59, 130, 246, 0.22)",
  boxShadow: "0 6px 16px rgba(37, 99, 235, 0.08)",
};

const emptyStateTitleStyle: React.CSSProperties = {
  fontSize: 18,
  margin: 0,
  fontWeight: 800,
  letterSpacing: -0.2,
  color: "#0f172a",
};

const emptyStateSubStyle: React.CSSProperties = {
  fontSize: 14,
  margin: 0,
  maxWidth: 280,
  lineHeight: 1.5,
  color: "rgba(15, 23, 42, 0.58)",
};

const bubbleStyle: React.CSSProperties = {
  position: "relative",
  width: "fit-content",
  maxWidth: "92%",
  borderRadius: 18,
  padding: "14px 14px 12px",
  border: "1px solid rgba(148, 163, 184, 0.4)",
  minWidth: 0,
  wordBreak: "break-word",
  overflowWrap: "anywhere",
  boxShadow: "0 4px 12px rgba(0,0,0,0.22)",
};

const myBubbleStyle: React.CSSProperties = {
  background:
    "linear-gradient(135deg, rgba(59,130,246,0.22), rgba(99,102,241,0.18))",
};

const theirBubbleStyle: React.CSSProperties = {
  background: "rgba(255, 255, 255, 0.55)",
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
  wordBreak: "break-word",
};

const menuTriggerStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "#0f172a",
  fontSize: 18,
  cursor: "pointer",
  lineHeight: 1,
  padding: "2px 6px",
  borderRadius: 8,
  WebkitTapHighlightColor: "transparent",
  touchAction: "manipulation",
};

const menuCardStyle: React.CSSProperties = {
  position: "absolute",
  top: 28,
  right: 0,
  background: "rgba(255, 255, 255, 0.95)",
  backdropFilter: "blur(12px)",
  WebkitBackdropFilter: "blur(12px)",
  border: "1px solid rgba(148, 163, 184, 0.35)",
  borderRadius: 12,
  minWidth: 110,
  zIndex: 10,
  overflow: "hidden",
  boxShadow: "0 16px 30px rgba(15, 23, 42, 0.12)",
};

const menuBtnStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "10px 12px",
  background: "transparent",
  border: "none",
  color: "#0f172a",
  textAlign: "left",
  cursor: "pointer",
  fontWeight: 600,
  WebkitTapHighlightColor: "transparent",
  touchAction: "manipulation",
};

const editTextareaStyle: React.CSSProperties = {
  width: "100%",
  padding: 10,
  borderRadius: 12,
  border: "1px solid rgba(148, 163, 184, 0.4)",
  background: "rgba(255, 255, 255, 0.88)",
  color: "#0f172a",
  resize: "vertical",
  outline: "none",
  boxSizing: "border-box",
};

const editActionRowStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  marginTop: 10,
  flexWrap: "wrap",
};

const saveBtnStyle: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 12,
  border: "1px solid rgba(74,222,128,0.24)",
  background: "rgba(22,163,74,0.20)",
  color: "#dcfce7",
  cursor: "pointer",
  fontWeight: 700,
  WebkitTapHighlightColor: "transparent",
  touchAction: "manipulation",
};

const cancelBtnStyle: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 12,
  border: "1px solid rgba(148, 163, 184, 0.4)",
  background: "rgba(255,255,255,0.7)",
  color: "#0f172a",
  cursor: "pointer",
  fontWeight: 700,
  WebkitTapHighlightColor: "transparent",
  touchAction: "manipulation",
};

const messageTextStyle: React.CSSProperties = {
  margin: "6px 0 0 0",
  lineHeight: 1.6,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  overflowWrap: "anywhere",
  fontSize: 14,
};

const chatImageStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: "260px",
  borderRadius: 14,
  display: "block",
  border: "1px solid rgba(148, 163, 184, 0.4)",
};

const timestampStyle: React.CSSProperties = {
  marginTop: 10,
  fontSize: 12,
  color: "rgba(15, 23, 42, 0.45)",
};

const composerStyle: React.CSSProperties = {
  border: "1px solid rgba(148, 163, 184, 0.4)",
  borderRadius: 20,
  padding: "clamp(12px, 3vw, 16px)",
  background: "rgba(255, 255, 255, 0.5)",
  display: "grid",
  gap: 14,
  minWidth: 0,
};

const composerTextareaStyle: React.CSSProperties = {
  width: "100%",
  padding: 14,
  borderRadius: 16,
  border: "1px solid rgba(148, 163, 184, 0.4)",
  resize: "vertical",
  background: "rgba(255, 255, 255, 0.88)",
  color: "#0f172a",
  outline: "none",
  minHeight: 100,
  boxSizing: "border-box",
};

const fileInputHiddenStyle: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
};

const composerToolsRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "stretch",
  gap: 8,
  minWidth: 0,
  width: "100%",
};

const composerAttachCompactStyle: React.CSSProperties = {
  flexShrink: 0,
  width: 44,
  height: 44,
  borderRadius: 12,
  border: "1px solid rgba(59, 130, 246, 0.38)",
  background: "rgba(239, 246, 255, 0.9)",
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
  WebkitTapHighlightColor: "transparent",
  touchAction: "manipulation",
  boxShadow: "0 1px 0 rgba(255, 255, 255, 0.7) inset",
};

const emojiPickerOverlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 10000,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 12,
  background: "rgba(15, 23, 42, 0.45)",
  backdropFilter: "blur(4px)",
  WebkitBackdropFilter: "blur(4px)",
};

const emojiPickerDialogStyle: React.CSSProperties = {
  width: "min(100%, 400px)",
  maxWidth: "100%",
  maxHeight: "min(90vh, 640px)",
  display: "flex",
  flexDirection: "column",
  borderRadius: 20,
  overflow: "hidden",
  background: "rgba(255, 255, 255, 0.98)",
  border: "1px solid rgba(148, 163, 184, 0.35)",
  boxShadow: "0 24px 60px rgba(15, 23, 42, 0.2)",
  minWidth: 0,
};

const emojiPickerHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  padding: "10px 12px 8px",
  borderBottom: "1px solid rgba(148, 163, 184, 0.28)",
  flexShrink: 0,
};

const emojiPickerTitleStyle: React.CSSProperties = {
  fontSize: 17,
  fontWeight: 800,
  color: "#0f172a",
  letterSpacing: "-0.02em",
};

const emojiPickerCloseBtnStyle: React.CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: 10,
  border: "1px solid rgba(148, 163, 184, 0.4)",
  background: "rgba(248, 250, 252, 0.95)",
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
  flexShrink: 0,
  WebkitTapHighlightColor: "transparent",
  touchAction: "manipulation",
};

const emojiPickerBodyStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 0,
  flex: 1,
  overflow: "auto",
  WebkitOverflowScrolling: "touch",
};

const fileChipCompactStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "6px 10px",
  borderRadius: 12,
  background: "rgba(59,130,246,0.12)",
  border: "1px solid rgba(96,165,250,0.22)",
  minWidth: 0,
  width: "100%",
  boxSizing: "border-box",
};

const fileChipNameStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  fontSize: 13,
  fontWeight: 600,
  color: "#1e3a8a",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const fileChipClearStyle: React.CSSProperties = {
  flexShrink: 0,
  width: 32,
  height: 32,
  borderRadius: 8,
  border: "none",
  background: "rgba(255,255,255,0.85)",
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
  WebkitTapHighlightColor: "transparent",
  touchAction: "manipulation",
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
  width: "100%",
  WebkitTapHighlightColor: "transparent",
  touchAction: "manipulation",
};