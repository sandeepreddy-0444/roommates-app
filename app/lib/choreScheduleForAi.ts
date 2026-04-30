/**
 * Parse chore schedule docs for AI context (same Firestore shape as ChoresPanel).
 */

export type DayCode = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

type DayRow = {
  morningUid: string | null;
  afternoonUid: string | null;
  nightUid: string | null;
  cleaningUid: string | null;
};

type ByDay = Record<DayCode, DayRow>;

type LegacyRow = {
  uid: string;
  cookDay: DayCode;
  cookSlot: "afternoon" | "night";
  cleanDay: DayCode;
  cleanSlot: "afternoon" | "night";
};

const DAYS: DayCode[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

const DAY_LONG: Record<DayCode, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

const DAY_SET = new Set<string>(DAYS);

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

function normalizeDayCode(v: string | undefined): DayCode | null {
  if (v && DAY_SET.has(v)) return v as DayCode;
  return null;
}

function parseByDay(raw: unknown): ByDay | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const out = emptyByDay();
  for (const d of DAYS) {
    const v = o[d];
    if (!v || typeof v !== "object") continue;
    const r = v as Record<string, unknown>;
    const mor = r.morningUid;
    const a = r.afternoonUid;
    const n = r.nightUid;
    const c = r.cleaningUid;
    out[d] = {
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

export function choreFirestoreDocToAiSchedule(
  data: Record<string, unknown> | undefined,
  users: Record<string, string>
): Record<string, Record<string, string>> | null {
  if (!data) return null;

  let byDay: ByDay | null = null;
  if (data.byDay) {
    byDay = parseByDay(data.byDay);
  } else if (Array.isArray(data.rows) && data.rows.length) {
    byDay = migrateLegacyRows(data.rows as LegacyRow[]);
  }

  if (!byDay) return null;

  const out: Record<string, Record<string, string>> = {};
  const name = (uid: string | null) =>
    uid ? users[uid] || uid.slice(0, 8) : "";

  for (const d of DAYS) {
    const row = byDay[d];
    const dayLabel = DAY_LONG[d];
    const slots: Record<string, string> = {};
    if (row.morningUid) slots["Morning"] = name(row.morningUid);
    if (row.afternoonUid) slots["Afternoon"] = name(row.afternoonUid);
    if (row.nightUid) slots["Night"] = name(row.nightUid);
    if (row.cleaningUid) slots["Cleaning"] = name(row.cleaningUid);
    if (Object.keys(slots).length > 0) out[dayLabel] = slots;
  }

  return Object.keys(out).length ? out : null;
}
