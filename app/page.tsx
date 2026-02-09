"use client";

import { useEffect } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { useRouter } from "next/navigation";
import { auth, db } from "@/app/lib/firebase";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.replace("/login");
        return;
      }

      const userDoc = await getDoc(doc(db, "users", user.uid));
      const groupId = userDoc.exists() ? userDoc.data().groupId : null;

      if (!groupId) {
        router.replace("/room");
      } else {
        router.replace("/dashboard");
      }
    });

    return () => unsub();
  }, [router]);

  return <div className="p-6">Loading...</div>;
}
