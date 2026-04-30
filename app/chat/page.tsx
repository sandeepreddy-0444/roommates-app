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

  const mine = (senderId: string) => uid && senderId === uid;

  return (
    <main className="safe-area flex min-h-dvh flex-col bg-[#f8fafc] text-slate-900">
      <header className="shrink-0 border-b border-[var(--app-border-subtle)] bg-[var(--app-surface-elevated)] px-4 py-3 shadow-[var(--app-shadow-sheet)] backdrop-blur-xl">
        <h1 className="text-lg font-bold tracking-tight text-[#0f172a]">Room chat</h1>
        {!groupId ? (
          <p className="mt-1 text-sm text-slate-600">Join a room to use group chat.</p>
        ) : null}
      </header>

      <div className="app-scroll mx-auto flex w-full max-w-lg flex-1 flex-col overflow-y-auto px-4 py-4">
        <div className="flex flex-col gap-3">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`max-w-[92%] rounded-[var(--app-radius-card)] border border-[var(--app-border-subtle)] px-3.5 py-3 shadow-sm ${
                mine(msg.senderId)
                  ? "ml-auto bg-slate-900 text-white"
                  : "mr-auto bg-[var(--app-surface-card)]"
              }`}
            >
              <p className={`text-xs font-bold uppercase tracking-wide ${mine(msg.senderId) ? "text-white/70" : "text-slate-500"}`}>
                {msg.senderName}
              </p>
              {msg.text ? <p className="mt-1 whitespace-pre-wrap text-[15px] leading-relaxed">{msg.text}</p> : null}
              {msg.imageUrl ? (
                <img
                  src={msg.imageUrl}
                  alt="Chat attachment"
                  className="mt-2 max-w-[220px] rounded-xl border border-white/20"
                />
              ) : null}
            </div>
          ))}
        </div>
      </div>

      <div className="shrink-0 border-t border-[var(--app-border-subtle)] bg-[var(--app-surface-elevated)] px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(15,23,42,0.06)] backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-lg flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="file"
              accept="image/*"
              disabled={!groupId}
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  setFile(e.target.files[0]);
                }
              }}
              className="max-w-full text-sm text-slate-600 file:mr-2 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-800"
            />
            {file ? <span className="text-xs text-slate-500">{file.name}</span> : null}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder={groupId ? "Message" : "Join a room first"}
              value={text}
              disabled={!groupId}
              onChange={(e) => setText(e.target.value)}
              className="min-h-[46px] flex-1 rounded-xl border border-[var(--app-border-subtle)] bg-white px-3 text-slate-900 outline-none placeholder:text-slate-400 disabled:bg-slate-100"
            />
            <button
              type="button"
              disabled={!groupId || (!text.trim() && !file)}
              onClick={sendMessage}
              className="min-h-[46px] shrink-0 rounded-xl bg-slate-900 px-4 font-semibold text-white shadow-md disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}