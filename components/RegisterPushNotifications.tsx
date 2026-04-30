"use client";

import { useEffect, useRef } from "react";
import { doc, setDoc, arrayUnion } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { getMessaging, getToken, isSupported } from "firebase/messaging";
import { auth, db, firebaseApp } from "@/app/lib/firebase";

const VAPID_KEY = process.env.NEXT_PUBLIC_FIREBASE_FCM_VAPID_KEY;

/**
 * Registers FCM web push for the signed-in user and stores the token on
 * `users/{uid}.fcmTokens` for Cloud Functions to target phone/desktop alerts.
 */
export function RegisterPushNotifications({ userId }: { userId: string | null }) {
  const triedRef = useRef(false);

  useEffect(() => {
    if (!userId || !VAPID_KEY || typeof window === "undefined") return;

    void (async () => {
      if (!(await isSupported())) return;

      if (Notification.permission === "denied") return;

      if (Notification.permission === "default" && !triedRef.current) {
        triedRef.current = true;
        const ok = await Notification.requestPermission();
        if (ok !== "granted") return;
      } else if (Notification.permission !== "granted") {
        return;
      }

      try {
        const registration = await navigator.serviceWorker.ready;
        const messaging = getMessaging(firebaseApp);
        const token = await getToken(messaging, {
          vapidKey: VAPID_KEY,
          serviceWorkerRegistration: registration,
        });
        if (!token) return;

        await setDoc(
          doc(db, "users", userId),
          { fcmTokens: arrayUnion(token) },
          { merge: true }
        );
      } catch (e) {
        console.warn("[Roommates] FCM token not registered:", e);
      }
    })();
  }, [userId]);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      if (!u) triedRef.current = false;
    });
  }, []);

  return null;
}
