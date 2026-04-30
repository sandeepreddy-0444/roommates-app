"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/app/lib/firebase";

type PollOption = { id: string; text: string; votes: string[] };
type PollItem = {
  id: string;
  question: string;
  options: PollOption[];
  createdBy: string;
  closed: boolean;
};

const mkId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export default function VotingPollsPanel({
  groupId,
  myUid,
  myName,
}: {
  groupId: string;
  myUid: string;
  myName: string;
}) {
  const [polls, setPolls] = useState<PollItem[]>([]);
  const [question, setQuestion] = useState("");
  const [draftOptions, setDraftOptions] = useState<string[]>(["", ""]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [editingPollId, setEditingPollId] = useState<string | null>(null);
  const [editQuestion, setEditQuestion] = useState("");
  const [editOptions, setEditOptions] = useState<string[]>([]);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    const q = query(collection(db, "groups", groupId, "polls"), orderBy("createdAt", "desc"));
    return onSnapshot(q, (snap) => {
      setPolls(
        snap.docs.map((d) => {
          const data = d.data() as any;
          const options = Array.isArray(data?.options) ? data.options : [];
          return {
            id: d.id,
            question: typeof data?.question === "string" ? data.question : "Untitled poll",
            createdBy: typeof data?.createdBy === "string" ? data.createdBy : "",
            closed: !!data?.closed,
            options: options.map((o: any, i: number) => ({
              id: typeof o?.id === "string" ? o.id : `${d.id}-${i}`,
              text: typeof o?.text === "string" ? o.text : "",
              votes: Array.isArray(o?.votes) ? o.votes.filter((v: unknown) => typeof v === "string") : [],
            })),
          };
        })
      );
    });
  }, [groupId]);

  const canCreate = useMemo(() => {
    const clean = draftOptions.map((o) => o.trim()).filter(Boolean);
    return question.trim().length >= 3 && clean.length >= 2;
  }, [question, draftOptions]);

  async function createPoll() {
    const clean = draftOptions.map((o) => o.trim()).filter(Boolean);
    if (question.trim().length < 3) {
      setCreateError("Enter a question with at least 3 characters.");
      return;
    }
    if (clean.length < 2) {
      setCreateError("Add at least 2 options.");
      return;
    }
    if (creating) return;

    setCreateError(null);
    setCreating(true);
    const options = draftOptions
      .map((o) => o.trim())
      .filter(Boolean)
      .map((text) => ({ id: mkId(), text, votes: [] as string[] }));
    try {
      await addDoc(collection(db, "groups", groupId, "polls"), {
        question: question.trim(),
        options,
        createdBy: myUid,
        createdByName: myName,
        closed: false,
        createdAt: serverTimestamp(),
      });
      setQuestion("");
      setDraftOptions(["", ""]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not create poll. Try again.";
      setCreateError(msg);
    } finally {
      setCreating(false);
    }
  }

  async function vote(p: PollItem, optionId: string) {
    if (p.closed) return;
    const next = p.options.map((o) => {
      if (o.id !== optionId) return o;
      const withoutMe = o.votes.filter((uid) => uid !== myUid);
      return o.votes.includes(myUid) ? { ...o, votes: withoutMe } : { ...o, votes: [...withoutMe, myUid] };
    });
    await updateDoc(doc(db, "groups", groupId, "polls", p.id), { options: next });
  }

  function startEdit(p: PollItem) {
    setEditingPollId(p.id);
    setEditQuestion(p.question);
    setEditOptions(p.options.map((o) => o.text));
    setConfirmDeleteId(null);
  }

  async function saveEdit(p: PollItem) {
    const q = editQuestion.trim();
    const cleanOptions = editOptions.map((o) => o.trim()).filter(Boolean);
    if (q.length < 3 || cleanOptions.length < 2) return;

    const nextOptions = cleanOptions.map((text, idx) => ({
      id: p.options[idx]?.id ?? mkId(),
      text,
      votes: p.options[idx]?.votes ?? [],
    }));

    await updateDoc(doc(db, "groups", groupId, "polls", p.id), {
      question: q,
      options: nextOptions,
    });
    setEditingPollId(null);
  }

  async function removePoll(p: PollItem) {
    await deleteDoc(doc(db, "groups", groupId, "polls", p.id));
    setConfirmDeleteId(null);
    if (editingPollId === p.id) setEditingPollId(null);
  }

  return (
    <div style={wrap}>
      <div>
        <h2 style={{ margin: 0, fontSize: 28 }}>Voting / Polls</h2>
        <div style={sub}>Simple polls for quick room decisions.</div>
      </div>

      <section style={panel}>
        <div style={heading}>New poll</div>
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="What should we decide?"
          style={input}
        />
        <div style={{ display: "grid", gap: 8 }}>
          {draftOptions.map((opt, i) => (
            <div key={`d-${i}`} style={row}>
              <input
                value={opt}
                onChange={(e) => setDraftOptions((prev) => prev.map((p, ix) => (ix === i ? e.target.value : p)))}
                placeholder={`Option ${i + 1}`}
                style={{ ...input, flex: 1 }}
              />
              {draftOptions.length > 2 ? (
                <button
                  type="button"
                  style={tinyDangerBtn}
                  onClick={() => setDraftOptions((prev) => prev.filter((_, ix) => ix !== i))}
                >
                  Remove
                </button>
              ) : null}
            </div>
          ))}
        </div>
        <div style={row}>
          <button type="button" onClick={() => setDraftOptions((p) => [...p, ""])} style={secondaryBtn}>
            + Add option
          </button>
          <button type="button" onClick={createPoll} style={primaryBtn} disabled={creating}>
            {creating ? "Creating..." : "Create Poll"}
          </button>
        </div>
        {createError ? <div style={errorText}>{createError}</div> : null}
        {!canCreate && !createError ? (
          <div style={hintText}>Enter question + at least 2 non-empty options.</div>
        ) : null}
      </section>

      <section style={panel}>
        <div style={heading}>Polls</div>
        {polls.length === 0 ? <div style={empty}>No polls yet.</div> : null}
        <div style={{ display: "grid", gap: 12 }}>
          {polls.map((p) => {
            const totalVotes = p.options.reduce((sum, o) => sum + o.votes.length, 0);
            const isOwner = p.createdBy === myUid;
            const isEditing = editingPollId === p.id;
            return (
              <article key={p.id} style={card}>
                <div style={topRow}>
                  <strong style={{ fontSize: 16 }}>{p.question}</strong>
                  {isOwner ? (
                    <div style={cornerActionsRow}>
                      <button type="button" style={tinyGhostBtn} onClick={() => startEdit(p)}>
                        Edit
                      </button>
                      {confirmDeleteId === p.id ? (
                        <>
                          <button type="button" style={tinyDangerBtn} onClick={() => removePoll(p)}>
                            Confirm
                          </button>
                          <button type="button" style={tinyGhostBtn} onClick={() => setConfirmDeleteId(null)}>
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button type="button" style={tinyDangerBtn} onClick={() => setConfirmDeleteId(p.id)}>
                          Delete
                        </button>
                      )}
                    </div>
                  ) : null}
                </div>

                {isEditing ? (
                  <div style={{ display: "grid", gap: 8 }}>
                    <input value={editQuestion} onChange={(e) => setEditQuestion(e.target.value)} style={input} />
                    {editOptions.map((opt, idx) => (
                      <div key={`${p.id}-opt-${idx}`} style={editOptionRow}>
                        <input
                          value={opt}
                          onChange={(e) =>
                            setEditOptions((prev) => prev.map((v, i) => (i === idx ? e.target.value : v)))
                          }
                          style={{ ...input, flex: 1 }}
                          placeholder={`Option ${idx + 1}`}
                        />
                        <button
                          type="button"
                          style={tinyGhostBtn}
                          onClick={() =>
                            setEditOptions((prev) => {
                              if (idx <= 0) return prev;
                              const out = [...prev];
                              [out[idx - 1], out[idx]] = [out[idx], out[idx - 1]];
                              return out;
                            })
                          }
                          aria-label="Move option up"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          style={tinyGhostBtn}
                          onClick={() =>
                            setEditOptions((prev) => {
                              if (idx >= prev.length - 1) return prev;
                              const out = [...prev];
                              [out[idx + 1], out[idx]] = [out[idx], out[idx + 1]];
                              return out;
                            })
                          }
                          aria-label="Move option down"
                        >
                          ↓
                        </button>
                        {editOptions.length > 2 ? (
                          <button
                            type="button"
                            style={tinyDangerBtn}
                            onClick={() => setEditOptions((prev) => prev.filter((_, ix) => ix !== idx))}
                            aria-label="Remove option"
                          >
                            Remove
                          </button>
                        ) : null}
                      </div>
                    ))}
                    <div style={row}>
                      <button type="button" style={primaryBtn} onClick={() => saveEdit(p)}>
                        Save
                      </button>
                      <button type="button" style={secondaryBtn} onClick={() => setEditingPollId(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: 8 }}>
                    {p.options.map((o) => {
                    const mine = o.votes.includes(myUid);
                    const pct = totalVotes ? Math.round((o.votes.length / totalVotes) * 100) : 0;
                    return (
                      <button key={o.id} type="button" onClick={() => vote(p, o.id)} style={voteBtn(mine)} disabled={p.closed}>
                        <span>{o.text}</span>
                        <span style={{ opacity: 0.75 }}>{o.votes.length} ({pct}%)</span>
                      </button>
                    );
                  })}
                  </div>
                )}
                {p.closed ? <span style={badge(true)}>Closed</span> : null}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

const wrap: React.CSSProperties = { display: "grid", gap: 16 };
const sub: React.CSSProperties = { marginTop: 6, color: "rgba(15,23,42,0.6)" };
const panel: React.CSSProperties = {
  border: "1px solid var(--app-border-subtle, rgba(148,163,184,0.32))",
  borderRadius: 18,
  padding: 14,
  display: "grid",
  gap: 12,
  background: "var(--app-surface-elevated, linear-gradient(180deg,#fff 0%,#f1f5f9 100%))",
};
const heading: React.CSSProperties = { fontWeight: 800, fontSize: 17 };
const row: React.CSSProperties = { display: "flex", gap: 8, flexWrap: "wrap" };
const topRow: React.CSSProperties = { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 };
const cornerActionsRow: React.CSSProperties = { display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" };
const editOptionRow: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr auto auto auto", gap: 6, alignItems: "center" };
const input: React.CSSProperties = {
  borderRadius: 10,
  border: "1px solid rgba(148,163,184,0.45)",
  padding: "10px 12px",
  fontSize: 14,
  background: "rgba(255,255,255,0.95)",
};
const card: React.CSSProperties = { border: "1px solid rgba(148,163,184,0.3)", borderRadius: 14, padding: 10, display: "grid", gap: 10 };
const primaryBtn: React.CSSProperties = { borderRadius: 10, border: "1px solid #1d4ed8", background: "#1d4ed8", color: "#fff", padding: "9px 12px", fontWeight: 700, cursor: "pointer" };
const secondaryBtn: React.CSSProperties = { borderRadius: 10, border: "1px solid rgba(148,163,184,0.45)", background: "rgba(255,255,255,0.9)", color: "#0f172a", padding: "9px 12px", fontWeight: 700, cursor: "pointer" };
const tinyGhostBtn: React.CSSProperties = { borderRadius: 8, border: "1px solid rgba(148,163,184,0.45)", background: "rgba(255,255,255,0.9)", color: "#334155", padding: "4px 8px", fontSize: 12, fontWeight: 700, cursor: "pointer" };
const tinyDangerBtn: React.CSSProperties = { borderRadius: 8, border: "1px solid rgba(220,38,38,0.45)", background: "rgba(254,242,242,0.95)", color: "#b91c1c", padding: "4px 8px", fontSize: 12, fontWeight: 700, cursor: "pointer" };
const empty: React.CSSProperties = { color: "rgba(15,23,42,0.6)", fontSize: 14 };
const hintText: React.CSSProperties = { color: "rgba(15,23,42,0.58)", fontSize: 12, marginTop: -4 };
const errorText: React.CSSProperties = { color: "#b91c1c", fontSize: 12, marginTop: -4 };
const voteBtn = (mine: boolean): React.CSSProperties => ({
  width: "100%",
  borderRadius: 10,
  border: mine ? "1px solid #2563eb" : "1px solid rgba(148,163,184,0.45)",
  background: mine ? "rgba(37,99,235,0.12)" : "rgba(255,255,255,0.9)",
  color: "#0f172a",
  padding: "9px 11px",
  display: "flex",
  justifyContent: "space-between",
  gap: 10,
  alignItems: "center",
  cursor: "pointer",
  textAlign: "left",
});
const badge = (closed: boolean): React.CSSProperties => ({
  borderRadius: 999,
  fontSize: 12,
  padding: "2px 8px",
  border: closed ? "1px solid rgba(148,163,184,0.4)" : "1px solid rgba(34,197,94,0.35)",
  color: closed ? "#475569" : "#166534",
  background: closed ? "rgba(148,163,184,0.12)" : "rgba(34,197,94,0.12)",
});
