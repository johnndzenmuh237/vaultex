import { db } from "./firebase.js";
import { requireAuth } from "./_auth.js";

export default async function handler(req, res) {
  let decoded;
  try {
    decoded = await requireAuth(req);
  } catch (e) {
    return res.status(e.statusCode || 401).json({ success: false, message: e.message });
  }

  const { payment_id } = req.query;
  if (!payment_id) {
    return res.status(400).json({ success: false, message: "Missing payment_id" });
  }

  try {
    const doc = await db.collection("transactions").doc(payment_id.toString()).get();

    if (!doc.exists) {
      return res.status(404).json({ success: false, message: "Payment not found" });
    }

    const data = doc.data();

    // A user can only poll their own payment.
    if (data.uid !== decoded.uid && !decoded.admin) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    return res.status(200).json({
      success: true,
      payment_id: data.payment_id,
      payment_status: data.payment_status,
      pay_address: data.pay_address,
      pay_amount: data.pay_amount,
      pay_currency: data.pay_currency,
      price_amount: data.price_amount,
      price_currency: data.price_currency,
      expiration_estimate_date: data.expiration_estimate_date,
      credited: data.credited,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}