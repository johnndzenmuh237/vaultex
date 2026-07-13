import { db } from "./firebase.js";

export default async function handler(req, res) {
  try {
    await db.collection("test").doc("connection").set({
      status: "connected",
      timestamp: new Date().toISOString(),
    });

    res.status(200).json({
      success: true,
      message: "Firebase connected successfully",
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack,
    });
  }
}