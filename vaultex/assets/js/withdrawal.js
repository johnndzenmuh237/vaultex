/* =========================================================
   WITHDRAWALS.JS — backend implementation (Firebase Cloud
   Functions + Firestore) for the withdrawal review flow.

   This is the piece your frontend (withdrawal.js /
   admin-withdrawal.js) was already written against — it
   implements the exact API contract documented in those
   files' header comments.

   Firestore layout used (unified with your existing
   `transactions` collection/rules, rather than a separate
   `withdrawals` collection):

     users/{uid}                 -> { balance: number, email, ... }
     transactions/{id}           -> {
       uid, userEmail, type: "withdrawal",
       currency, address, amount, usdValue,
       status: "pending"|"approved"|"rejected",
       reason: string|null, createdAt, reviewedAt, reviewedBy
     }

   This matches your existing firestore.rules pattern:
     match /transactions/{txId} {
       allow read: if request.auth != null
                   && request.auth.uid == resource.data.uid;
       allow write: if false;
     }
   — client reads work directly against this collection for a
   user's own docs; all writes still go through these Cloud
   Functions (Admin SDK bypasses rules), so status/balance can
   never be set by the client.

   SECURITY MODEL (important):
   - Every route requires a valid Firebase ID token
     (Authorization: Bearer <token>).
   - Admin routes additionally require the caller's token to
     carry a custom claim `admin: true`. That claim can only
     be set server-side (see setAdminClaim() at the bottom,
     callable once manually / from a trusted script — never
     exposed as a public endpoint).
   - Balance is NEVER written by the client. It is only ever
     mutated inside the Firestore transaction in
     reviewWithdrawal(), and only on "approve".
   ========================================================= */

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const express = require("express");
const cors = require("cors");

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

const TRANSACTIONS = "transactions";
const TYPE = "withdrawal";

/* ---------------------------------------------------------
   AUTH MIDDLEWARE
--------------------------------------------------------- */

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer (.+)$/);
  if (!match) {
    return res.status(401).json({ success: false, message: "Missing auth token" });
  }
  try {
    req.user = await admin.auth().verifyIdToken(match[1]);
    next();
  } catch (e) {
    return res.status(401).json({ success: false, message: "Invalid or expired token" });
  }
}

async function requireAdmin(req, res, next) {
  if (!req.user?.admin) {
    return res.status(403).json({ success: false, message: "Admin access required" });
  }
  next();
}

/* ---------------------------------------------------------
   HELPERS
--------------------------------------------------------- */

const DAILY_LIMIT_USD = 100000;

// Placeholder currency->USD conversion. Replace with a real
// price feed (e.g. a cached CoinGecko/Chainlink lookup) before
// going live — treating amount as 1:1 USD is only correct for
// stablecoins.
function toUsdValue(currency, amount) {
  const stable = ["usdterc20", "usdttrc20", "usdtbep20"];
  if (stable.includes(currency)) return Number(amount);
  // TODO: real price lookup per currency
  return Number(amount);
}

function isValidAddress(currency, address) {
  if (!address || typeof address !== "string") return false;
  // Minimal sanity check — swap in real per-chain validation
  // (e.g. a checksum/regex per network) before production use.
  return address.trim().length >= 20 && address.trim().length <= 128;
}

/* ---------------------------------------------------------
   USER: POST /api/create-withdrawal
--------------------------------------------------------- */

app.post("/create-withdrawal", requireAuth, async (req, res) => {
  const uid = req.user.uid;
  const { currency, address, amount } = req.body || {};

  const amt = Number(amount);
  if (!currency || !isValidAddress(currency, address) || !amt || amt <= 0) {
    return res.status(400).json({ success: false, message: "Invalid withdrawal request" });
  }

  const usdValue = toUsdValue(currency, amt);
  const userRef = db.collection("users").doc(uid);

  try {
    const withdrawal = await db.runTransaction(async (tx) => {
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists) throw new Error("User not found");
      const balance = Number(userSnap.data().balance || 0);

      if (usdValue > balance) {
        throw new Error("Amount exceeds available balance");
      }

      // Daily limit is checked against APPROVED withdrawals only —
      // pending ones haven't touched the balance yet.
      const todayStart = admin.firestore.Timestamp.fromDate(
        new Date(new Date().setHours(0, 0, 0, 0))
      );
      const approvedTodaySnap = await tx.get(
        db.collection(TRANSACTIONS)
          .where("uid", "==", uid)
          .where("type", "==", TYPE)
          .where("status", "==", "approved")
          .where("reviewedAt", ">=", todayStart)
      );
      const usedToday = approvedTodaySnap.docs.reduce(
        (sum, d) => sum + Number(d.data().usdValue || 0), 0
      );
      if (usedToday + usdValue > DAILY_LIMIT_USD) {
        throw new Error(`Exceeds daily withdrawal limit of $${DAILY_LIMIT_USD.toLocaleString()}`);
      }

      const txRef = db.collection(TRANSACTIONS).doc();
      const record = {
        uid,
        userEmail: req.user.email || null,
        type: TYPE,
        currency,
        address: address.trim(),
        amount: amt,
        usdValue,
        status: "pending",
        reason: null,
        userBalance: balance, // snapshot shown to admins for context
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        reviewedAt: null,
        reviewedBy: null,
      };
      tx.set(txRef, record);
      return { id: txRef.id, ...record, createdAt: new Date().toISOString() };
    });

    // TODO: notify admins (email / Slack webhook / internal queue)
    // that a new withdrawal needs review.

    return res.json({ success: true, withdrawal });
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message });
  }
});

/* ---------------------------------------------------------
   USER: GET /api/get-withdrawal-status?id=...
--------------------------------------------------------- */

app.get("/get-withdrawal-status", requireAuth, async (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).json({ success: false, message: "Missing id" });

  const snap = await db.collection(TRANSACTIONS).doc(id).get();
  if (!snap.exists || snap.data().uid !== req.user.uid || snap.data().type !== TYPE) {
    return res.status(404).json({ success: false, message: "Not found" });
  }
  const d = snap.data();
  return res.json({ success: true, status: d.status, reason: d.reason || null });
});

/* ---------------------------------------------------------
   USER: GET /api/get-withdrawals?limit=10
--------------------------------------------------------- */

app.get("/get-withdrawals", requireAuth, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 10, 50);
  const snap = await db.collection(TRANSACTIONS)
    .where("uid", "==", req.user.uid)
    .where("type", "==", TYPE)
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();

  const withdrawals = snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      currency: data.currency,
      address: data.address,
      amount: data.amount,
      usd_value: data.usdValue,
      status: data.status,
      reason: data.reason,
      createdAt: data.createdAt?.toDate?.().toISOString() || null,
    };
  });

  return res.json({ success: true, withdrawals });
});

/* ---------------------------------------------------------
   USER: GET /api/get-balance
   (also doubles as the account summary the dashboard needs)
--------------------------------------------------------- */

app.get("/get-balance", requireAuth, async (req, res) => {
  const snap = await db.collection("users").doc(req.user.uid).get();
  const balance = snap.exists ? Number(snap.data().balance || 0) : 0;
  return res.json({ success: true, balance });
});

app.get("/account/summary", requireAuth, async (req, res) => {
  const uid = req.user.uid;
  const [userSnap, txSnap] = await Promise.all([
    db.collection("users").doc(uid).get(),
    db.collection(TRANSACTIONS)
      .where("uid", "==", uid)
      .orderBy("createdAt", "desc")
      .limit(10)
      .get(),
  ]);

  const balance = userSnap.exists ? Number(userSnap.data().balance || 0) : 0;
  const transactions = txSnap.docs.map((d) => {
    const w = d.data();
    return {
      date: w.createdAt?.toDate?.().toLocaleDateString() || "--",
      type: w.type === TYPE ? "Withdrawal" : (w.type || "Transaction"),
      amount: w.amount,
      asset: (w.currency || "").toUpperCase(),
      status: w.status === "approved" ? "Completed" : w.status === "rejected" ? "Rejected" : "Pending",
    };
  });

  return res.json({
    success: true,
    totalBalance: balance,
    balanceHistory: null, // TODO: wire real historical snapshots
    allocation: null,     // TODO: wire real per-asset breakdown
    transactions,
  });
});

/* ---------------------------------------------------------
   ADMIN: GET /api/admin/get-pending-withdrawals
--------------------------------------------------------- */

app.get("/admin/get-pending-withdrawals", requireAuth, requireAdmin, async (req, res) => {
  const snap = await db.collection(TRANSACTIONS)
    .where("type", "==", TYPE)
    .where("status", "==", "pending")
    .orderBy("createdAt", "asc")
    .get();

  const withdrawals = snap.docs.map((d) => {
    const w = d.data();
    return {
      id: d.id,
      userId: w.uid,
      userEmail: w.userEmail,
      currency: w.currency,
      address: w.address,
      amount: w.amount,
      userBalance: w.userBalance,
      createdAt: w.createdAt?.toDate?.().toISOString() || null,
    };
  });

  return res.json({ success: true, withdrawals });
});

/* ---------------------------------------------------------
   ADMIN: GET /api/admin/get-reviewed-withdrawals?limit=20
--------------------------------------------------------- */

app.get("/admin/get-reviewed-withdrawals", requireAuth, requireAdmin, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const snap = await db.collection(TRANSACTIONS)
    .where("type", "==", TYPE)
    .where("status", "in", ["approved", "rejected"])
    .orderBy("reviewedAt", "desc")
    .limit(limit)
    .get();

  const withdrawals = snap.docs.map((d) => {
    const w = d.data();
    return {
      id: d.id,
      userId: w.uid,
      userEmail: w.userEmail,
      currency: w.currency,
      amount: w.amount,
      status: w.status,
      reason: w.reason,
      reviewedAt: w.reviewedAt?.toDate?.().toISOString() || null,
    };
  });

  return res.json({ success: true, withdrawals });
});

/* ---------------------------------------------------------
   ADMIN: POST /api/admin/review-withdrawal
   body: { id, decision: "approve" | "reject", reason? }
--------------------------------------------------------- */

app.post("/admin/review-withdrawal", requireAuth, requireAdmin, async (req, res) => {
  const { id, decision, reason } = req.body || {};

  if (!id || !["approve", "reject"].includes(decision)) {
    return res.status(400).json({ success: false, message: "Invalid review payload" });
  }
  if (decision === "reject" && !reason?.trim()) {
    return res.status(400).json({ success: false, message: "A reason is required to reject" });
  }

  const txRef = db.collection(TRANSACTIONS).doc(id);

  try {
    await db.runTransaction(async (tx) => {
      const wdSnap = await tx.get(txRef);
      if (!wdSnap.exists || wdSnap.data().type !== TYPE) throw new Error("Withdrawal not found");
      const wd = wdSnap.data();
      if (wd.status !== "pending") throw new Error("Withdrawal has already been reviewed");

      if (decision === "approve") {
        const userRef = db.collection("users").doc(wd.uid);
        const userSnap = await tx.get(userRef);
        if (!userSnap.exists) throw new Error("User not found");
        const balance = Number(userSnap.data().balance || 0);

        // Re-check balance at approval time — it may have changed
        // since the withdrawal was requested.
        if (Number(wd.usdValue) > balance) {
          throw new Error("User's current balance no longer covers this withdrawal");
        }

        tx.update(userRef, {
          balance: admin.firestore.FieldValue.increment(-Number(wd.usdValue)),
        });
        tx.update(txRef, {
          status: "approved",
          reason: null,
          reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
          reviewedBy: req.user.uid,
        });

        // TODO: trigger the actual on-chain payout here (or enqueue
        // it to a payout worker) now that the balance is reserved.
      } else {
        tx.update(txRef, {
          status: "rejected",
          reason: reason.trim(),
          reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
          reviewedBy: req.user.uid,
        });
        // Balance is untouched on rejection.
      }
    });

    return res.json({ success: true });
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message });
  }
});

exports.api = functions.https.onRequest(app);

/* ---------------------------------------------------------
   ONE-TIME ADMIN SETUP (run manually via a trusted script,
   e.g. `node grantAdmin.js someone@example.com` — never
   expose this as an HTTP endpoint):

     const admin = require("firebase-admin");
     admin.initializeApp();
     admin.auth().getUserByEmail(process.argv[2]).then((u) =>
       admin.auth().setCustomUserClaims(u.uid, { admin: true })
     );
--------------------------------------------------------- */
