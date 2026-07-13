import { db } from "./firebase.js";
import { requireAuth } from "./_auth.js";

export default async function handler(req, res) {
  let decoded;
  try {
    decoded = await requireAuth(req);
  } catch (e) {
    return res.status(e.statusCode || 401).json({ success: false, message: e.message });
  }

  // Ignore any uid in the query string — always use the verified token's uid,
  // so a user can never read someone else's balance by changing the query param.
  const uid = decoded.uid;

  try {
    const doc = await db.collection("users").doc(uid).get();

    if (!doc.exists) {
      return res.status(200).json({ success: true, balance: 0 });
    }

    return res.status(200).json({ success: true, balance: doc.data().balance || 0 });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}