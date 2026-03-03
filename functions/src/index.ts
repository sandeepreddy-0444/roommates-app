import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";

admin.initializeApp();
const db = admin.firestore();

/**
 * Runs on the 1st of every month at 12:05 AM America/Chicago.
 * Deletes LAST MONTH's SETTLED expenses (safe).
 */
export const deleteLastMonthsSettledExpenses = onSchedule(
  {
    schedule: "5 0 1 * *",
    timeZone: "America/Chicago",
  },
  async () => {
    const now = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevKey = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;

    const groupsSnap = await db.collection("groups").get();

    for (const g of groupsSnap.docs) {
      const groupId = g.id;

      const expensesSnap = await db
        .collection("groups")
        .doc(groupId)
        .collection("expenses")
        .where("monthKey", "==", prevKey)
        .where("settledAt", "!=", null)
        .get();

      if (expensesSnap.empty) continue;

      let batch = db.batch();
      let count = 0;

      for (const ex of expensesSnap.docs) {
        batch.delete(ex.ref);
        count++;

        if (count % 400 === 0) {
          await batch.commit();
          batch = db.batch();
        }
      }

      await batch.commit();
      console.log(
        `Deleted ${count} settled expenses for group=${groupId}, monthKey=${prevKey}`
      );
    }
  }
);

/**
 * ✅ Reminder sender (3/2/1 days before due date)
 * ✅ Monthly reminders roll forward after passing (handles 28/30/31)
 *
 * Writes notifications to:
 * groups/{groupId}/notifications
 * Fields match your NotificationsPanel.
 *
 * NOTE: For TESTING this runs every 5 minutes.
 * After testing, change schedule back to: "0 9 * * *"
 */
export const sendDueRemindersDaily = onSchedule(
  {
    schedule: "*/5 * * * *", // ✅ TEST MODE: every 5 minutes
    timeZone: "America/Chicago",
  },
  async () => {
    const tz = "America/Chicago";
    const todayStr = getTodayYMDInTimeZone(tz); // "YYYY-MM-DD"

    const groupsSnap = await db.collection("groups").get();

    for (const g of groupsSnap.docs) {
      const groupId = g.id;

      const remindersSnap = await db
        .collection("groups")
        .doc(groupId)
        .collection("reminders")
        .where("isActive", "==", true)
        .get();

      if (remindersSnap.empty) continue;

      for (const rDoc of remindersSnap.docs) {
        const r = rDoc.data() as any;
        const title = String(r?.title ?? "").trim() || "Reminder";
        const dueDateStr = String(r?.dueDate ?? ""); // "YYYY-MM-DD"
        const repeat = String(r?.repeat ?? "none"); // "none" | "monthly"

        if (!isValidYMD(dueDateStr)) continue;

        const daysUntil = diffDaysYMD(todayStr, dueDateStr);

        // ✅ Send notifications for last 3 days
        if (daysUntil === 3 || daysUntil === 2 || daysUntil === 1) {
          // marker doc prevents duplicates for each dueDate + daysUntil
          const markerId = `${dueDateStr}_${daysUntil}`;
          const markerRef = db
            .collection("groups")
            .doc(groupId)
            .collection("reminders")
            .doc(rDoc.id)
            .collection("sentMarkers")
            .doc(markerId);

          const markerSnap = await markerRef.get();
          if (!markerSnap.exists) {
            const notifTitle =
              daysUntil === 1
                ? `${title} due tomorrow`
                : `${title} due in ${daysUntil} days`;

            const body = `Due on ${dueDateStr}`;

            const notifRef = db
              .collection("groups")
              .doc(groupId)
              .collection("notifications")
              .doc();

            const batch = db.batch();
            batch.set(notifRef, {
              type: "reminder",
              title: notifTitle,
              body,
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
              createdBy: "system",
              readBy: [],
            });

            batch.set(markerRef, {
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
              today: todayStr,
            });

            await batch.commit();
            console.log(
              `Sent reminder notif group=${groupId} reminder=${rDoc.id} daysUntil=${daysUntil}`
            );
          }
        }

        // ✅ Monthly repeat roll-forward AFTER it passes (handles 28/30/31)
        if (repeat === "monthly" && daysUntil < 0) {
          let nextDue = addOneMonthClamped(dueDateStr);

          // If still in the past, keep pushing forward (guarded)
          let guard = 0;
          while (diffDaysYMD(todayStr, nextDue) < 0 && guard < 24) {
            nextDue = addOneMonthClamped(nextDue);
            guard++;
          }

          await rDoc.ref.update({ dueDate: nextDue });
          console.log(
            `Rolled monthly reminder forward group=${groupId} reminder=${rDoc.id} ${dueDateStr} -> ${nextDue}`
          );
        }
      }
    }
  }
);

// ----------------- helpers -----------------

function isValidYMD(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function ymdToUTCDate(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function diffDaysYMD(fromYMD: string, toYMD: string) {
  const a = ymdToUTCDate(fromYMD).getTime();
  const b = ymdToUTCDate(toYMD).getTime();
  return Math.round((b - a) / 86400000);
}

function getTodayYMDInTimeZone(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;

  return `${y}-${m}-${d}`;
}

function daysInMonth(year: number, month1to12: number) {
  return new Date(year, month1to12, 0).getDate();
}

function addOneMonthClamped(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);

  const targetMonth = m + 1;
  const ny = targetMonth > 12 ? y + 1 : y;
  const nm = targetMonth > 12 ? 1 : targetMonth;

  const dim = daysInMonth(ny, nm);
  const nd = Math.min(d, dim);

  return `${String(ny).padStart(4, "0")}-${String(nm).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}