import crypto from "crypto";
import { db } from "./firebase.js";

// NOWPayments sends the raw JSON body and an x-nowpayments-sig header.
// Verifying it requires the *exact* raw bytes, so we must disable Next's
// automatic body parsing and read + verify before touching req.body.
export const config = {
  api: {
    bodyParser: false,
  },
};

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

// NOWPayments computes the signature over the JSON payload with object keys
// sorted alphabetically (recursively) before stringifying.
function sortObject(obj) {
  if (Array.isArray(obj)) return obj.map(sortObject);
  if (obj !== null && typeof obj === "object") {
    return Object.keys(obj)
      .sort()
      .reduce((acc, key) => {
        acc[key] = sortObject(obj[key]);
        return acc;
      }, {});
  }
  return obj;
}

function verifySignature(parsedBody, signatureHeader) {
  const secret = process.env.NOWPAYMENTS_IPN_SECRET;
  if (!secret) throw new Error("NOWPAYMENTS_IPN_SECRET is not configured");
  if (!signatureHeader) return false;

  const sortedString = JSON.stringify(sortObject(parsedBody));
  const expected = crypto
    .createHmac("sha512", secret)
    .update(sortedString)
    .digest("hex");

  // Constant-time comparison
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signatureHeader, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Statuses that mean funds have actually landed and should be credited.
const CREDIT_STATUSES = new Set(["finished", "confirmed"]);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  let raw;
  try {
    raw = await readRawBody(req);
  } catch (e) {
    console.error("Failed to read webhook body", e);
    return res.status(400).json({ success: false, message: "Bad request body" });
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (e) {
    return res.status(400).json({ success: false, message: "Invalid JSON" });
  }

  const signature = req.headers["x-nowpayments-sig"];
  let validSig = false;
  try {
    validSig = verifySignature(payload, signature);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, message: "Server misconfigured" });
  }

  if (!validSig) {
    console.warn("Webhook received with invalid signature", { payment_id: payload.payment_id });
    return res.status(401).json({ success: false, message: "Invalid signature" });
  }

  const paymentId = payload.payment_id?.toString();
  if (!paymentId) {
    return res.status(400).json({ success: false, message: "Missing payment_id" });
  }

  try {
    const txRef = db.collection("transactions").doc(paymentId);

    // Run everything inside a Firestore transaction so a duplicate IPN
    // (NOWPayments retries until it gets a 200) can never double-credit
    // the user's balance.
    await db.runTransaction(async (t) => {
      const txSnap = await t.get(txRef);
      if (!txSnap.exists) {
        throw new Error(`No local transaction found for payment_id ${paymentId}`);
      }
      const txData = txSnap.data();

      const shouldCredit =
        CREDIT_STATUSES.has(payload.payment_status) && !txData.credited;

      t.update(txRef, {
        payment_status: payload.payment_status,
        actually_paid: payload.actually_paid || txData.actually_paid || null,
        updatedAt: new Date().toISOString(),
        ...(shouldCredit ? { credited: true, creditedAt: new Date().toISOString() } : {}),
      });

      if (shouldCredit) {
        const userRef = db.collection("users").doc(txData.uid);
        const userSnap = await t.get(userRef);
        const currentBalance = userSnap.exists ? userSnap.data().balance || 0 : 0;
        // Credit the fiat price_amount (what was actually invoiced/confirmed),
        // not the crypto amount, since balances are tracked in price_currency.
        const creditAmount = txData.price_amount;
        t.set(
          userRef,
          { balance: currentBalance + creditAmount, updatedAt: new Date().toISOString() },
          { merge: true }
        );
      }
    });

    return res.status(200).json({ success: true, message: "Webhook processed" });
  } catch (error) {
    console.error("Webhook processing error:", error.message);
    // Still return 200 for statuses we simply don't act on but did receive,
    // otherwise NOWPayments will retry indefinitely. Only fail (non-200) for
    // real problems like a missing local record we need to investigate.
    return res.status(500).json({ success: false, error: error.message });
  }
}