import { initializeApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDDNQ4rbFBaxKk9U5dWG_PRVo-Sk-Gr35c",
  authDomain: "roommates-b0638.firebaseapp.com",
  projectId: "roommates-b0638",
  storageBucket: "roommates-b0638.firebasestorage.app",
  messagingSenderId: "470303323936",
  appId: "1:470303323936:web:00e61dd3d38cec1b300945",
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
