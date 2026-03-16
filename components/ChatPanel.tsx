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
    return <div>Loading chat...</div>;
  }

  if (!uid) {
    return <div>Please log in first.</div>;
  }

  if (!groupId) {
    return <div>You are not in a room yet.</div>;
  }

  return (
    <div
      style={{
        display: "grid",
        gap: 16,
      }}
    >
      <h2 style={{ margin: 0 }}>Room Chat</h2>

      <div
        style={{
          border: "1px solid #333",
          borderRadius: 12,
          padding: 16,
          height: "500px",
          overflowY: "auto",
          backgroundColor: "#111",
        }}
      >
        {messages.length === 0 ? (
          <p>No messages yet.</p>
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
                    position: "relative",
                    maxWidth: "70%",
                    backgroundColor: isMe ? "#1f3a2a" : "#1a1a1a",
                    border: "1px solid #333",
                    borderRadius: 12,
                    padding: "10px 12px",
                  }}
                >
                  <p
                    style={{
                      margin: "0 0 6px 0",
                      fontWeight: 600,
                      fontSize: 14,
                      paddingRight: isMe ? 20 : 0,
                    }}
                  >
                    {isMe ? "You" : msg.senderName}
                  </p>

                  {isMe && (
                    <div style={{ position: "absolute", top: 8, right: 8 }}>
                      <button
                        onClick={() =>
                          setOpenMenuId(openMenuId === msg.id ? null : msg.id)
                        }
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "white",
                          fontSize: 18,
                          cursor: "pointer",
                          lineHeight: 1,
                        }}
                      >
                        ⋮
                      </button>

                      {openMenuId === msg.id && (
                        <div
                          style={{
                            position: "absolute",
                            top: 24,
                            right: 0,
                            background: "#222",
                            border: "1px solid #444",
                            borderRadius: 8,
                            minWidth: 100,
                            zIndex: 10,
                            overflow: "hidden",
                          }}
                        >
                          <button
                            onClick={() => {
                              startEdit(msg);
                              setOpenMenuId(null);
                            }}
                            style={{
                              display: "block",
                              width: "100%",
                              padding: "8px 12px",
                              background: "transparent",
                              border: "none",
                              color: "white",
                              textAlign: "left",
                              cursor: "pointer",
                            }}
                          >
                            Edit
                          </button>

                          <button
                            onClick={() => {
                              deleteMessage(msg);
                              setOpenMenuId(null);
                            }}
                            style={{
                              display: "block",
                              width: "100%",
                              padding: "8px 12px",
                              background: "transparent",
                              border: "none",
                              color: "#ff8080",
                              textAlign: "left",
                              cursor: "pointer",
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {editingId === msg.id ? (
                    <div style={{ marginBottom: 8 }}>
                      <textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        rows={2}
                        style={{
                          width: "100%",
                          padding: 8,
                          borderRadius: 8,
                          border: "1px solid #444",
                          marginBottom: 8,
                          background: "#0b0b0b",
                          color: "white",
                          resize: "vertical",
                        }}
                      />
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          onClick={() => saveEdit(msg)}
                          style={{
                            padding: "6px 12px",
                            borderRadius: 8,
                            border: "none",
                            background: "#2d6a4f",
                            color: "white",
                            cursor: "pointer",
                          }}
                        >
                          Save
                        </button>

                        <button
                          onClick={cancelEdit}
                          style={{
                            padding: "6px 12px",
                            borderRadius: 8,
                            border: "none",
                            background: "#444",
                            color: "white",
                            cursor: "pointer",
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {msg.text && (
                        <p style={{ margin: "0 0 8px 0", lineHeight: "1.4" }}>
                          {msg.text}
                        </p>
                      )}
                    </>
                  )}

                  {msg.imageUrl && (
                    <img
                      src={msg.imageUrl}
                      alt="chat upload"
                      style={{
                        width: "100%",
                        maxWidth: "260px",
                        borderRadius: 10,
                        display: "block",
                        marginBottom: 8,
                      }}
                    />
                  )}

                  <p
                    style={{
                      margin: 0,
                      fontSize: 12,
                      color: "#aaa",
                    }}
                  >
                    {formatTime(msg.createdAt)}
                  </p>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      <div
        style={{
          border: "1px solid #333",
          borderRadius: 12,
          padding: 16,
          backgroundColor: "#111",
        }}
      >
        <textarea
          placeholder="Type a message"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          style={{
            width: "100%",
            padding: 10,
            borderRadius: 8,
            border: "1px solid #444",
            marginBottom: 12,
            resize: "vertical",
            background: "#0b0b0b",
            color: "white",
          }}
        />

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={(e) => {
            if (e.target.files && e.target.files[0]) {
              setFile(e.target.files[0]);
            }
          }}
          style={{ marginBottom: 10 }}
        />

        {file && (
          <p style={{ margin: "0 0 12px 0", fontSize: 14 }}>
            Selected file: <strong>{file.name}</strong>
          </p>
        )}

        <button
          onClick={sendMessage}
          disabled={sending || (!text.trim() && !file)}
          style={{
            padding: "10px 18px",
            borderRadius: 8,
            border: "none",
            cursor: sending ? "not-allowed" : "pointer",
            background: "#222",
            color: "white",
          }}
        >
          {sending ? "Sending..." : "Send"}
        </button>
      </div>
    </div>
  );
}