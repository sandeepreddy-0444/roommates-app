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
    // previous month key: YYYY-MM
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
        .where("settledAt", "!=", null) // ✅ only delete settled
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