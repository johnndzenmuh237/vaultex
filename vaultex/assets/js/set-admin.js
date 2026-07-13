// set-admin.js
//
// Usage:
//   node set-admin.js user@example.com          -> grants admin
//   node set-admin.js user@example.com --revoke -> revokes admin
//
// Requires the same credentials as your API routes. Either set
// FIREBASE_SERVICE_ACCOUNT in your shell env, or run this from the project
// root where firebase-admin.json lives (same fallback as api/firebase.js).
//
// Run with: node set-admin.js <email> [--revoke]
// (Add "type": "module" to package.json, or rename this file to set-admin.mjs,
// since it uses ES module imports like the rest of the project.)
//
// This is run directly with `node`, not through `vercel dev`, so nothing
// loads .env.local automatically the way Vercel does for your API routes.
// dotenv/config fixes that here; it's a no-op if no .env file is found.
import "dotenv/config";

import { auth } from "./api/firebase.js";

async function main() {
  const [, , email, flag] = process.argv;

  if (!email) {
    console.error("Usage: node set-admin.js <email> [--revoke]");
    process.exit(1);
  }

  const revoke = flag === "--revoke";

  const user = await auth.getUserByEmail(email);

  await auth.setCustomUserClaims(user.uid, { admin: !revoke });

  // Custom claims only take effect on the user's NEXT token refresh /
  // sign-in, not their current session. If they're already logged in
  // client-side, they need to sign out and back in (or call
  // getIdToken(true) to force a refresh) before the admin claim applies.
  console.log(
    `${revoke ? "Revoked" : "Granted"} admin claim for ${email} (uid: ${user.uid}).`
  );
  console.log(
    "Note: this only applies once the user gets a fresh ID token (re-login or getIdToken(true))."
  );
}

main().catch((err) => {
  console.error("Failed to update admin claim:", err.message);
  process.exit(1);
});