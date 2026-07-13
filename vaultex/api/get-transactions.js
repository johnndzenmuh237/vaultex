import { db } from "./firebase.js";
import { requireAuth } from "./_auth.js";

export default async function handler(req, res) {
  let decoded;
  try {
    decoded = await requireAuth(req);
  } catch (e) {
    return res.status(e.statusCode || 401).json({ success: false, message: e.message });
  }

  const limit = Math.min(Number(req.query.limit) || 20, 100);

  try {
    let query = db.collection("transactions").orderBy("createdAt", "desc").limit(limit);

    // Non-admins only ever see their own deposits. Admins can pass ?uid=
    // to inspect a specific user, or omit it to see everything (for the
    // admin dashboard's global transaction view).
    if (!decoded.admin) {
      query = query.where("uid", "==", decoded.uid);
    } else if (req.query.uid) {
      query = query.where("uid", "==", req.query.uid);
    }

    const snap = await query.get();
    const transactions = snap.docs.map((d) => d.data());

    return res.status(200).json({ success: true, transactions });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}