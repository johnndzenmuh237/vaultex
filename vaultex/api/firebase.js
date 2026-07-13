import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import fs from "fs";
import path from "path";

/**
 * Resolve the service account credentials.
 *
 * Production (Vercel/etc.): set FIREBASE_SERVICE_ACCOUNT to the full JSON
 * (as a single-line string) in your environment variables. Never commit
 * firebase-admin.json to git — add it to .gitignore.
 *
 * Local dev fallback: reads ./firebase-admin.json if the env var isn't set.
 */
function loadServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } catch (e) {
      throw new Error(
        "FIREBASE_SERVICE_ACCOUNT env var is not valid JSON: " + e.message
      );
    }
  }

  const serviceAccountPath = path.join(process.cwd(), "firebase-admin.json");
  if (fs.existsSync(serviceAccountPath)) {
    return JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));
  }

  throw new Error(
    "No Firebase credentials found. Set FIREBASE_SERVICE_ACCOUNT env var " +
      "or provide firebase-admin.json locally."
  );
}

if (!getApps().length) {
  initializeApp({
    credential: cert(loadServiceAccount()),
  });
}

const db = getFirestore();
const auth = getAuth();

export { db, auth };