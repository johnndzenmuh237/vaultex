import axios from "axios";
import { db } from "./firebase.js";
import { requireAuth } from "./_auth.js";

// NOWPayments currency codes you want to support. Keep this in sync with
// what's enabled on your NOWPayments account (Settings -> Payments).
const SUPPORTED_CURRENCIES = new Set([
  "btc",
  "eth",
  "ltc",
  "sol",
  "trx",
  "bnb",
  "doge",
  "xrp",
  "usdterc20", // USDT on Ethereum
  "usdttrc20", // USDT on Tron
  "usdtbep20", // USDT on BNB Smart Chain
]);

const MIN_USD = 5;
const MAX_USD = 50000;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  let decoded;
  try {
    decoded = await requireAuth(req);
  } catch (e) {
    return res.status(e.statusCode || 401).json({ success: false, message: e.message });
  }

  const uid = decoded.uid;
  const email = decoded.email || req.body?.email || null;

  try {
    const { amount, pay_currency, price_currency = "usd" } = req.body;

    const numericAmount = Number(amount);

    if (!numericAmount || !pay_currency) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    if (!Number.isFinite(numericAmount) || numericAmount < MIN_USD || numericAmount > MAX_USD) {
      return res.status(400).json({
        success: false,
        message: `Amount must be between ${MIN_USD} and ${MAX_USD} ${price_currency.toUpperCase()}`,
      });
    }

    const currency = String(pay_currency).toLowerCase();
    if (!SUPPORTED_CURRENCIES.has(currency)) {
      return res.status(400).json({ success: false, message: "Unsupported currency" });
    }

    const orderId = `${uid}_${Date.now()}`;

    const response = await axios.post(
      "https://api.nowpayments.io/v1/payment",
      {
        price_amount: numericAmount,
        price_currency: String(price_currency).toLowerCase(),
        pay_currency: currency,
        order_id: orderId,
        order_description: "VoltiTrade Deposit",
        ipn_callback_url: `${process.env.SITE_URL}/api/webhook`,
        success_url: `${process.env.SITE_URL}/dashboard`,
        cancel_url: `${process.env.SITE_URL}/wallets.html`,
      },
      {
        headers: {
          "x-api-key": process.env.NOWPAYMENTS_API_KEY,
          "Content-Type": "application/json",
        },
        timeout: 15000,
      }
    );

    const payment = response.data;

    // Store using NOWPayments' payment_id as the doc id so the webhook can
    // look it up directly and update it in place.
    await db
      .collection("transactions")
      .doc(payment.payment_id.toString())
      .set({
        uid,
        email,
        order_id: orderId,
        price_amount: numericAmount,
        price_currency: String(price_currency).toLowerCase(),
        pay_currency: currency,
        pay_amount: payment.pay_amount || null,
        pay_address: payment.pay_address || null,
        payment_id: payment.payment_id,
        payment_status: payment.payment_status || "waiting",
        expiration_estimate_date: payment.expiration_estimate_date || null,
        credited: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

    return res.status(200).json({ success: true, payment });
  } catch (err) {
    console.error(err.response?.data || err);
    return res.status(500).json({
      success: false,
      error: err.response?.data || err.message,
    });
  }
}