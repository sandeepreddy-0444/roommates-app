"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type SVGProps,
} from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { auth, db } from "@/app/lib/firebase";

type DayCode = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

const SCHEDULE_COLS = ["morning", "afternoon", "night", "cleaning"] as const;
type ColKind = (typeof SCHEDULE_COLS)[number];

const COL_LABEL: Record<ColKind, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  night: "Night",
  cleaning: "Cleaning",
};

type ColumnHidden = Record<ColKind, boolean>;

function defaultColumnHidden(): ColumnHidden {
  return { morning: false, afternoon: false, night: false, cleaning: false };
}

function normalizeColumnHidden(raw: unknown): ColumnHidden {
  const b = defaultColumnHidden();
  if (!raw || typeof raw !== "object") return b;
  const o = raw as Record<string, unknown>;
  for (const c of SCHEDULE_COLS) {
    if (typeof o[c] === "boolean") b[c] = o[c] as boolean;
  }
  return b;
}

/** Per weekday: morning / afternoon / night cook + cleaning. */
type DayRow = {
  morningUid: string | null;
  afternoonUid: string | null;
  nightUid: string | null;
  cleaningUid: string | null;
};

type ByDay = Record<DayCode, DayRow>;

type Roommate = { uid: string; name: string };

/** Legacy Firestore format — migrated to `byDay` on read. */
type LegacyRow = {
  uid: string;
  name: string;
  cookDay: DayCode;
  cookSlot: "afternoon" | "night";
  cleanDay: DayCode;
  cleanSlot: "afternoon" | "night";
};

const DAYS: { value: DayCode; label: string }[] = [
  { value: "mon", label: "Mon" },
  { value: "tue", label: "Tue" },
  { value: "wed", label: "Wed" },
  { value: "thu", label: "Thu" },
  { value: "fri", label: "Fri" },
  { value: "sat", label: "Sat" },
  { value: "sun", label: "Sun" },
];

const DAY_SET = new Set(DAYS.map((d) => d.value));

const SCHEDULE_DOC = "schedule";
const NO_UID = "__none__";

/** Ad-hoc tasks (trash, vacuum, etc.) — separate from the weekly cook/clean grid. */
type ExtraChoreRow = {
  id: string;
  title: string;
  assigneeUid: string | null;
  done: boolean;
};

function emptyRow(): DayRow {
  return { morningUid: null, afternoonUid: null, nightUid: null, cleaningUid: null };
}

function emptyByDay(): ByDay {
  return {
    mon: emptyRow(),
    tue: emptyRow(),
    wed: emptyRow(),
    thu: emptyRow(),
    fri: emptyRow(),
    sat: emptyRow(),
    sun: emptyRow(),
  };
}

function getCell(row: DayRow, col: ColKind): string | null {
  if (col === "morning") return row.morningUid;
  if (col === "afternoon") return row.afternoonUid;
  if (col === "night") return row.nightUid;
  return row.cleaningUid;
}

function setCell(row: DayRow, col: ColKind, uid: string | null): DayRow {
  if (col === "morning") return { ...row, morningUid: uid };
  if (col === "afternoon") return { ...row, afternoonUid: uid };
  if (col === "night") return { ...row, nightUid: uid };
  return { ...row, cleaningUid: uid };
}

function normalizeDayCode(v: string | undefined): DayCode | null {
  if (v && DAY_SET.has(v as DayCode)) return v as DayCode;
  return null;
}

function parseByDay(raw: unknown): ByDay | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const out = emptyByDay();
  for (const d of DAYS) {
    const v = o[d.value];
    if (!v || typeof v !== "object") continue;
    const r = v as Record<string, unknown>;
    const mor = r.morningUid;
    const a = r.afternoonUid;
    const n = r.nightUid;
    const c = r.cleaningUid;
    out[d.value] = {
      morningUid: typeof mor === "string" && mor ? mor : null,
      afternoonUid: typeof a === "string" && a ? a : null,
      nightUid: typeof n === "string" && n ? n : null,
      cleaningUid: typeof c === "string" && c ? c : null,
    };
  }
  return out;
}

function migrateLegacyRows(rows: LegacyRow[]): ByDay {
  const byDay = emptyByDay();
  for (const r of rows) {
    const cd = normalizeDayCode(r.cookDay);
    const cld = normalizeDayCode(r.cleanDay);
    if (!r.uid) continue;
    if (cd) {
      if (r.cookSlot === "afternoon") {
        byDay[cd] = { ...byDay[cd], afternoonUid: r.uid };
      } else {
        byDay[cd] = { ...byDay[cd], nightUid: r.uid };
      }
    }
    if (cld) {
      byDay[cld] = { ...byDay[cld], cleaningUid: r.uid };
    }
  }
  return byDay;
}

function hasAnyAssignment(by: ByDay): boolean {
  for (const d of DAYS) {
    const r = by[d.value];
    if (r.morningUid || r.afternoonUid || r.nightUid || r.cleaningUid) return true;
  }
  return false;
}

function EyeIcon({ style, ...rest }: { style?: CSSProperties } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      aria-hidden
      {...rest}
    >
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon({ style, ...rest }: { style?: CSSProperties } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      aria-hidden
      {...rest}
    >
      <path d="M3.98 8.223A10.477 10.477 0 0 0 1.93 12c1.28 4.12 5.3 7.2 10.07 7.2.95 0 1.9-.12 2.8-.35" />
      <path d="M6.2 6.2A10.4 10.4 0 0 1 12 4.5c4.8 0 8.8 3.1 10.1 7.3a10.5 10.5 0 0 1-1.1 2.2" />
      <path d="M1 1l22 22" />
      <path d="M14.1 14.1a3 3 0 0 1-3.2-3.2" />
    </svg>
  );
}

export default function ChoresPanel() {
  const [uid, setUid] = useState<string | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [roommates, setRoommates] = useState<Roommate[]>([]);
  const [savedByDay, setSavedByDay] = useState<ByDay | null>(null);
  const [columnHidden, setColumnHidden] = useState<ColumnHidden>(defaultColumnHidden);
  /** Only while editing — which columns to hide. Saved to Firestore on Done. */
  const [draftColumnHidden, setDraftColumnHidden] = useState<ColumnHidden | null>(null);
  const [draftByDay, setDraftByDay] = useState<ByDay | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [extraChores, setExtraChores] = useState<ExtraChoreRow[]>([]);
  const [extraTitle, setExtraTitle] = useState("");
  const [extraAssignee, setExtraAssignee] = useState<string>(NO_UID);
  const [extraSaving, setExtraSaving] = useState(false);
  const [extraDeletingId, setExtraDeletingId] = useState<string | null>(null);

  const nameByUid = useMemo(() => {
    const m: Record<string, string> = {};
    for (const r of roommates) m[r.uid] = r.name;
    return m;
  }, [roommates]);

  const effectiveColumnHidden = useMemo((): ColumnHidden => {
    if (editing && draftColumnHidden) return draftColumnHidden;
    return columnHidden;
  }, [editing, draftColumnHidden, columnHidden]);

  const visibleScheduleCols = useMemo(
    () => SCHEDULE_COLS.filter((c) => !effectiveColumnHidden[c]),
    [effectiveColumnHidden]
  );

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        setLoading(false);
        return;
      }
      setUid(u.uid);
      const userSnap = await getDoc(doc(db, "users", u.uid));
      const userData = userSnap.exists() ? (userSnap.data() as Record<string, unknown>) : {};
      setGroupId((userData.groupId as string) || null);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!groupId) {
      setRoommates([]);
      return;
    }
    const unsub = onSnapshot(collection(db, "groups", groupId, "members"), async (snap) => {
      const rows = await Promise.all(
        snap.docs.map(async (memberDoc) => {
          const userSnap = await getDoc(doc(db, "users", memberDoc.id));
          const data = userSnap.exists() ? (userSnap.data() as Record<string, unknown>) : {};
          return {
            uid: memberDoc.id,
            name: (data.name as string) || memberDoc.id.slice(0, 6),
          };
        })
      );
      setRoommates(rows);
    });
    return () => unsub();
  }, [groupId]);

  useEffect(() => {
    if (!groupId) {
      setSavedByDay(null);
      return;
    }
    const ref = doc(db, "groups", groupId, "choreTable", SCHEDULE_DOC);
    const unsub = onSnapshot(ref, (snap) => {
      if (!snap.exists()) {
        setSavedByDay(null);
        setColumnHidden(defaultColumnHidden());
        return;
      }
      const data = snap.data() as { byDay?: unknown; rows?: LegacyRow[]; columnHidden?: unknown };
      if (data.columnHidden !== undefined) {
        setColumnHidden(normalizeColumnHidden(data.columnHidden));
      } else {
        setColumnHidden(defaultColumnHidden());
      }
      let next: ByDay;
      if (data.byDay) {
        const p = parseByDay(data.byDay);
        next = p ?? emptyByDay();
      } else if (Array.isArray(data.rows) && data.rows.length) {
        next = migrateLegacyRows(data.rows);
      } else {
        next = emptyByDay();
      }
      setSavedByDay(next);
    });
    return () => unsub();
  }, [groupId]);

  useEffect(() => {
    if (!groupId) {
      setExtraChores([]);
      return;
    }
    const q = query(
      collection(db, "groups", groupId, "choreExtras"),
      orderBy("createdAt", "desc")
    );
    const unsub = onSnapshot(q, (snap) => {
      setExtraChores(
        snap.docs.map((d) => {
          const data = d.data() as Record<string, unknown>;
          const aid = data.assigneeUid;
          return {
            id: d.id,
            title: typeof data.title === "string" ? data.title : "",
            assigneeUid: typeof aid === "string" && aid ? aid : null,
            done: !!data.done,
          };
        })
      );
    });
    return () => unsub();
  }, [groupId]);

  async function addExtraChore() {
    if (!groupId || !uid || extraSaving) return;
    const title = extraTitle.trim();
    if (title.length < 2) {
      setErr("Enter a task name (at least 2 characters).");
      return;
    }
    setErr(null);
    setExtraSaving(true);
    try {
      await addDoc(collection(db, "groups", groupId, "choreExtras"), {
        title,
        assigneeUid: extraAssignee === NO_UID ? null : extraAssignee,
        done: false,
        createdAt: serverTimestamp(),
        createdBy: uid,
      });
      setExtraTitle("");
      setExtraAssignee(NO_UID);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not add task.");
    } finally {
      setExtraSaving(false);
    }
  }

  async function toggleExtraDone(row: ExtraChoreRow) {
    if (!groupId || extraDeletingId) return;
    try {
      await updateDoc(doc(db, "groups", groupId, "choreExtras", row.id), {
        done: !row.done,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not update task.");
    }
  }

  async function deleteExtra(id: string) {
    if (!groupId || extraDeletingId) return;
    setExtraDeletingId(id);
    setErr(null);
    try {
      await deleteDoc(doc(db, "groups", groupId, "choreExtras", id));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not remove task.");
    } finally {
      setExtraDeletingId(null);
    }
  }

  const displayByDay = useMemo(() => savedByDay ?? emptyByDay(), [savedByDay]);

  const tableByDay = useMemo(
    () => (editing && draftByDay ? draftByDay : displayByDay),
    [editing, draftByDay, displayByDay]
  );

  const updateCell = useCallback(
    (day: DayCode, col: ColKind, u: string | null) => {
      setDraftByDay((prev) => {
        if (!prev) return prev;
        return { ...prev, [day]: setCell({ ...prev[day] }, col, u) };
      });
    },
    []
  );

  const startEdit = useCallback(() => {
    setErr(null);
    const copy: ByDay = emptyByDay();
    for (const d of DAYS) {
      const r = displayByDay[d.value];
      copy[d.value] = { ...r };
    }
    setDraftByDay(copy);
    setDraftColumnHidden({ ...columnHidden });
    setEditing(true);
  }, [displayByDay, columnHidden]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setDraftByDay(null);
    setDraftColumnHidden(null);
    setErr(null);
  }, []);

  const handleToggleColumn = useCallback((col: ColKind) => {
    setDraftColumnHidden((prev) => {
      if (!prev) return prev;
      const next = { ...prev, [col]: !prev[col] };
      if (SCHEDULE_COLS.every((c) => next[c])) return prev;
      return next;
    });
  }, []);

  async function saveSchedule() {
    if (!groupId || !uid || !draftByDay) return;
    const hidden = draftColumnHidden ?? columnHidden;
    setSaving(true);
    setErr(null);
    try {
      const ref = doc(db, "groups", groupId, "choreTable", SCHEDULE_DOC);
      const byDay: Record<
        string,
        {
          morningUid: string | null;
          afternoonUid: string | null;
          nightUid: string | null;
          cleaningUid: string | null;
        }
      > = {};
      for (const d of DAYS) {
        const r = draftByDay[d.value];
        byDay[d.value] = {
          morningUid: r.morningUid,
          afternoonUid: r.afternoonUid,
          nightUid: r.nightUid,
          cleaningUid: r.cleaningUid,
        };
      }
      await setDoc(
        ref,
        {
          byDay,
          columnHidden: hidden,
          rows: deleteField(),
          updatedAt: serverTimestamp(),
          updatedBy: uid,
        },
        { merge: true }
      );
      setDraftByDay(null);
      setDraftColumnHidden(null);
      setEditing(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save schedule.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div style={{ color: "rgba(15, 23, 42, 0.6)", padding: "10px 2px", fontSize: 13 }}>Loading…</div>
    );
  }
  if (!groupId) {
    return (
      <div style={{ color: "rgba(15, 23, 42, 0.72)", padding: "10px 2px", fontSize: 13 }}>
        You are not in a room yet.
      </div>
    );
  }

  const hasSchedule = savedByDay && hasAnyAssignment(savedByDay);

  return (
    <div style={{ display: "grid", gap: 12, color: "#0f172a", minWidth: 0 }}>
      <div>
        <h2
          style={{
            margin: 0,
            fontSize: "clamp(17px, 4vw, 20px)",
            fontWeight: 800,
            letterSpacing: "-0.02em",
          }}
        >
          Chores
        </h2>
        <p
          style={{
            margin: "4px 0 0",
            fontSize: "clamp(11px, 2.8vw, 12px)",
            color: "rgba(15, 23, 42, 0.65)",
            lineHeight: 1.45,
          }}
        >
          Pick who cooks (morning, afternoon, or night) and who cleans, per <strong>day</strong>. When
          you <strong>Edit schedule</strong>, you can show or hide whole columns (e.g. hide Morning if
          your house doesn’t use it) — that layout is saved for everyone. One person per cell; same
          name can appear on multiple days. Use <strong>Other tasks</strong> below for anything else
          (trash, vacuum, supplies…).
        </p>
      </div>

      {err ? (
        <div
          style={{
            fontSize: 12,
            color: "#b91c1c",
            padding: "8px 10px",
            borderRadius: 10,
            background: "rgba(254, 226, 226, 0.6)",
            border: "1px solid rgba(248, 113, 113, 0.35)",
          }}
        >
          {err}
        </div>
      ) : null}

      <div style={cardStyle}>
        <div style={toolbarStyle}>
          {!editing ? (
            <button type="button" onClick={startEdit} style={primaryBtnStyle} disabled={roommates.length === 0}>
              {hasSchedule ? "Edit schedule" : "Set schedule"}
            </button>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <button
                type="button"
                onClick={() => void saveSchedule()}
                style={primaryBtnStyle}
                disabled={saving || roommates.length === 0 || !draftByDay}
              >
                {saving ? "Saving…" : "Done"}
              </button>
              <button type="button" onClick={cancelEdit} style={ghostBtnStyle} disabled={saving}>
                Cancel
              </button>
            </div>
          )}
        </div>

        {roommates.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, opacity: 0.75 }}>No roommates yet.</p>
        ) : (
          <>
            {editing && draftColumnHidden ? (
              <div style={columnToggleRowStyle} role="group" aria-label="Show or hide schedule columns">
                <span style={columnToggleLabelStyle}>
                  <EyeIcon style={eyeInLabelStyle} aria-hidden />
                  Columns
                </span>
                {SCHEDULE_COLS.map((col) => {
                  const hidden = draftColumnHidden[col];
                  return (
                    <button
                      key={col}
                      type="button"
                      onClick={() => handleToggleColumn(col)}
                      style={hidden ? colToggleHiddenStyle : colToggleVisibleStyle}
                    >
                      {hidden ? <EyeOffIcon style={eyeInBtnStyle} /> : <EyeIcon style={eyeInBtnStyle} />}
                      {hidden ? `Show ${COL_LABEL[col]}` : `Hide ${COL_LABEL[col]}`}
                    </button>
                  );
                })}
              </div>
            ) : null}

            <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>
                      <div style={thLineStyle}>Day</div>
                    </th>
                    {visibleScheduleCols.map((col) => (
                      <th key={col} style={thStyle}>
                        <div style={thLineStyle}>{COL_LABEL[col]}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {DAYS.map(({ value: day, label: dayLabel }) => {
                    const row = tableByDay[day];
                    return (
                      <tr key={day}>
                        <td style={tdStyle}>
                          <span style={dayPillStyle}>{dayLabel}</span>
                        </td>
                        {visibleScheduleCols.map((col) => {
                          const current = getCell(row, col);
                          const isFilled = Boolean(current);
                          return (
                            <td key={col} style={tdStyle}>
                              {editing && draftByDay ? (
                                <select
                                  aria-label={`${dayLabel} ${COL_LABEL[col]}`}
                                  value={current || NO_UID}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    updateCell(day, col, v === NO_UID ? null : v);
                                  }}
                                  style={selectStyle}
                                >
                                  <option value={NO_UID}>—</option>
                                  {roommates.map((m) => (
                                    <option key={m.uid} value={m.uid}>
                                      {m.name}
                                    </option>
                                  ))}
                                </select>
                              ) : isFilled ? (
                                <span style={viewNameStyle}>
                                  {nameByUid[current!] || current?.slice(0, 6)}
                                </span>
                              ) : (
                                <span style={viewEmptyStyle}>—</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <div style={cardStyle}>
        <div style={extrasHeadingStyle}>Other tasks</div>
        <p style={extrasHelpStyle}>
          Add chores that aren’t on the weekly grid — optional assignee. Everyone in the room sees
          this list.
        </p>

        <div style={extrasFormStyle}>
          <input
            type="text"
            placeholder="e.g. Take out trash, vacuum stairs…"
            value={extraTitle}
            onChange={(e) => setExtraTitle(e.target.value)}
            style={extrasInputStyle}
            disabled={extraSaving || roommates.length === 0}
          />
          <select
            aria-label="Assign to"
            value={extraAssignee}
            onChange={(e) => setExtraAssignee(e.target.value)}
            style={extrasSelectStyle}
            disabled={extraSaving || roommates.length === 0}
          >
            <option value={NO_UID}>Anyone</option>
            {roommates.map((m) => (
              <option key={m.uid} value={m.uid}>
                {m.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void addExtraChore()}
            style={primaryBtnStyle}
            disabled={extraSaving || roommates.length === 0 || extraTitle.trim().length < 2}
          >
            {extraSaving ? "Adding…" : "Add"}
          </button>
        </div>

        {extraChores.length === 0 ? (
          <p style={extrasEmptyStyle}>No extra tasks yet.</p>
        ) : (
          <ul style={extrasListStyle}>
            {extraChores.map((row) => (
              <li key={row.id} style={extrasRowStyle}>
                <label style={extrasLabelStyle}>
                  <input
                    type="checkbox"
                    checked={row.done}
                    onChange={() => void toggleExtraDone(row)}
                    disabled={extraDeletingId === row.id}
                    style={extrasCheckboxStyle}
                  />
                  <span style={row.done ? extrasTitleDoneStyle : extrasTitleStyle}>{row.title}</span>
                </label>
                <span style={extrasMetaStyle}>
                  {row.assigneeUid
                    ? nameByUid[row.assigneeUid] || row.assigneeUid.slice(0, 6)
                    : "Anyone"}
                </span>
                <button
                  type="button"
                  onClick={() => void deleteExtra(row.id)}
                  disabled={extraDeletingId === row.id}
                  style={extrasDeleteBtnStyle}
                  aria-label="Remove task"
                >
                  {extraDeletingId === row.id ? "…" : "Remove"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

const extrasHeadingStyle: CSSProperties = {
  margin: 0,
  fontSize: "clamp(14px, 3.3vw, 16px)",
  fontWeight: 800,
  letterSpacing: "-0.02em",
  color: "#0f172a",
};

const extrasHelpStyle: CSSProperties = {
  margin: "6px 0 0",
  fontSize: "clamp(11px, 2.7vw, 12px)",
  color: "rgba(15, 23, 42, 0.65)",
  lineHeight: 1.45,
};

const extrasFormStyle: CSSProperties = {
  display: "grid",
  gap: 8,
};

const extrasInputStyle: CSSProperties = {
  width: "100%",
  minHeight: 42,
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(148, 163, 184, 0.45)",
  background: "rgba(255,255,255,0.95)",
  color: "#0f172a",
  fontSize: "clamp(13px, 3vw, 14px)",
  boxSizing: "border-box",
};

const extrasSelectStyle: CSSProperties = {
  width: "100%",
  minHeight: 42,
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(148, 163, 184, 0.45)",
  background: "rgba(255,255,255,0.95)",
  color: "#0f172a",
  fontSize: 13,
};

const extrasEmptyStyle: CSSProperties = {
  margin: "8px 0 0",
  fontSize: 13,
  color: "rgba(15, 23, 42, 0.5)",
};

const extrasListStyle: CSSProperties = {
  listStyle: "none",
  margin: "10px 0 0",
  padding: 0,
  display: "grid",
  gap: 8,
};

const extrasRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr auto auto",
  alignItems: "center",
  gap: 8,
  padding: "10px 10px",
  borderRadius: 12,
  border: "1px solid rgba(148, 163, 184, 0.28)",
  background: "rgba(248, 250, 252, 0.85)",
};

const extrasLabelStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 10,
  minWidth: 0,
  cursor: "pointer",
};

const extrasCheckboxStyle: CSSProperties = {
  marginTop: 3,
  flexShrink: 0,
  width: 18,
  height: 18,
};

const extrasTitleStyle: CSSProperties = {
  fontSize: "clamp(13px, 3vw, 14px)",
  fontWeight: 650,
  lineHeight: 1.35,
  wordBreak: "break-word",
};

const extrasTitleDoneStyle: CSSProperties = {
  fontSize: "clamp(13px, 3vw, 14px)",
  fontWeight: 650,
  lineHeight: 1.35,
  wordBreak: "break-word",
  textDecoration: "line-through",
  color: "rgba(15, 23, 42, 0.45)",
};

const extrasMetaStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 650,
  color: "rgba(15, 23, 42, 0.5)",
  whiteSpace: "nowrap",
};

const extrasDeleteBtnStyle: CSSProperties = {
  border: "1px solid rgba(248, 113, 113, 0.45)",
  borderRadius: 10,
  padding: "6px 10px",
  background: "rgba(254, 226, 226, 0.7)",
  color: "#991b1b",
  fontSize: 12,
  fontWeight: 650,
  cursor: "pointer",
  flexShrink: 0,
};

const cardStyle: CSSProperties = {
  border: "1px solid var(--app-border-subtle, rgba(148, 163, 184, 0.32))",
  borderRadius: 16,
  padding: "12px 12px 14px",
  background: "var(--app-surface-card, rgba(255, 255, 255, 0.94))",
  boxShadow: "var(--app-shadow-sheet, 0 6px 20px rgba(15, 23, 42, 0.06))",
  display: "grid",
  gap: 10,
  minWidth: 0,
};

const toolbarStyle: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  flexWrap: "wrap",
  gap: 8,
};

const columnToggleRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 6,
  padding: "4px 0 2px",
  borderBottom: "1px solid rgba(148, 163, 184, 0.2)",
  marginBottom: 2,
};

const columnToggleLabelStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "rgba(15, 23, 42, 0.45)",
  marginRight: 4,
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
};

const eyeInLabelStyle: CSSProperties = {
  flexShrink: 0,
  opacity: 0.65,
};

const eyeInBtnStyle: CSSProperties = {
  flexShrink: 0,
  opacity: 0.85,
};

const colToggleBase: CSSProperties = {
  borderRadius: 10,
  padding: "6px 10px",
  fontSize: "clamp(11px, 2.6vw, 12px)",
  fontWeight: 650,
  cursor: "pointer",
  border: "1px solid var(--app-border-subtle)",
  WebkitTapHighlightColor: "transparent",
  whiteSpace: "nowrap",
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
};

const colToggleVisibleStyle: CSSProperties = {
  ...colToggleBase,
  background: "var(--app-secondary-surface, rgba(248, 250, 252, 0.95))",
  color: "#0f172a",
};

const colToggleHiddenStyle: CSSProperties = {
  ...colToggleBase,
  background: "rgba(99, 102, 241, 0.12)",
  borderColor: "rgba(99, 102, 241, 0.35)",
  color: "#4338ca",
};

const primaryBtnStyle: CSSProperties = {
  border: "1px solid rgba(37, 99, 235, 0.4)",
  borderRadius: 12,
  padding: "8px 14px",
  background: "linear-gradient(135deg, #60a5fa, #2563eb)",
  color: "white",
  fontWeight: 750,
  fontSize: "clamp(12px, 2.9vw, 14px)",
  cursor: "pointer",
  minHeight: 40,
  WebkitTapHighlightColor: "transparent",
};

const ghostBtnStyle: CSSProperties = {
  border: "1px solid var(--app-border-subtle)",
  borderRadius: 12,
  padding: "8px 14px",
  background: "var(--app-secondary-surface, rgba(248, 250, 252, 0.95))",
  color: "#0f172a",
  fontWeight: 650,
  fontSize: "clamp(12px, 2.9vw, 14px)",
  cursor: "pointer",
  minHeight: 40,
};

const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "clamp(11px, 2.7vw, 12px)",
};

const thLineStyle: CSSProperties = {
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  fontSize: 10,
  fontWeight: 800,
};

const thStyle: CSSProperties = {
  textAlign: "left",
  padding: "6px 6px 8px",
  borderBottom: "1px solid rgba(148, 163, 184, 0.45)",
  color: "rgba(15, 23, 42, 0.55)",
  fontWeight: 800,
  verticalAlign: "bottom",
  whiteSpace: "nowrap",
};

const tdStyle: CSSProperties = {
  padding: "8px 6px",
  borderBottom: "1px solid rgba(148, 163, 184, 0.2)",
  verticalAlign: "top",
};

const dayPillStyle: CSSProperties = {
  fontWeight: 800,
  fontSize: "clamp(12px, 2.9vw, 14px)",
  letterSpacing: "-0.02em",
};

const selectStyle: CSSProperties = {
  width: "100%",
  minWidth: 0,
  maxWidth: 200,
  minHeight: 38,
  padding: "6px 8px",
  borderRadius: 8,
  border: "1px solid rgba(148, 163, 184, 0.45)",
  background: "rgba(255,255,255,0.95)",
  color: "#0f172a",
  fontSize: 12,
};

const viewNameStyle: CSSProperties = {
  fontSize: "clamp(12px, 2.8vw, 13px)",
  fontWeight: 700,
  lineHeight: 1.3,
  color: "#0f172a",
};

const viewEmptyStyle: CSSProperties = {
  fontSize: 12,
  color: "rgba(15, 23, 42, 0.38)",
  fontStyle: "italic",
};
