import { initializeApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { firebasePublicConfig } from "./firebase-public-config";

const app = getApps().length ? getApps()[0] : initializeApp(firebasePublicConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export { firebasePublicConfig } from "./firebase-public-config";
export { app as firebaseApp };