"use client";

import { useEffect, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { auth, db, storage } from "@/app/lib/firebase";

type Message = {
  id: string;
  text: string;
  senderId: string;
  senderName: string;
  imageUrl?: string;
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

      if (file) {
        const fileName = `${Date.now()}-${file.name}`;
        const storageRef = ref(storage, `chatImages/${groupId}/${fileName}`);
        await uploadBytes(storageRef, file);
        imageUrl = await getDownloadURL(storageRef);
      }

      await addDoc(collection(db, "groups", groupId, "messages"), {
        text: text.trim(),
        senderId: uid,
        senderName,
        imageUrl,
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
                    }}
                  >
                    {isMe ? "You" : msg.senderName}
                  </p>

                  {msg.text && (
                    <p style={{ margin: "0 0 8px 0", lineHeight: "1.4" }}>
                      {msg.text}
                    </p>
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