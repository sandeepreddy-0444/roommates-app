"use client";

import { useEffect, useState } from "react";
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
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { auth, db, storage } from "@/app/lib/firebase";

type Message = {
  id: string;
  text: string;
  senderId: string;
  senderName: string;
  imageUrl?: string;
  createdAt?: any;
};

export default function ChatPage() {
  const [uid, setUid] = useState<string | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [senderName, setSenderName] = useState("");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) return;

      setUid(user.uid);

      const userRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userRef);

      if (userSnap.exists()) {
        const data = userSnap.data();
        setGroupId(data.groupId || null);
        setSenderName(data.name || user.email || "User");
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

  const sendMessage = async () => {
    if (!groupId || !uid) return;
    if (!text.trim() && !file) return;

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
  };

  return (
    <div style={{ padding: "20px" }}>
      <h1>Room Chat</h1>

      <div style={{ marginBottom: "20px" }}>
        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              padding: "10px",
              border: "1px solid #ddd",
              borderRadius: "8px",
              marginBottom: "12px",
            }}
          >
            <p><strong>{msg.senderName}</strong></p>
            {msg.text && <p>{msg.text}</p>}
            {msg.imageUrl && (
              <img
                src={msg.imageUrl}
                alt="chat upload"
                style={{ width: "220px", borderRadius: "8px" }}
              />
            )}
          </div>
        ))}
      </div>

      <input
        type="text"
        placeholder="Type a message"
        value={text}
        onChange={(e) => setText(e.target.value)}
        style={{ marginRight: "10px" }}
      />

      <input
        type="file"
        accept="image/*"
        onChange={(e) => {
          if (e.target.files && e.target.files[0]) {
            setFile(e.target.files[0]);
          }
        }}
        style={{ marginRight: "10px" }}
      />

      <button onClick={sendMessage}>Send</button>
    </div>
  );
}