import { auth } from "./firebase.js";

/**
 * Verifies the Firebase ID token in the Authorization: Bearer <token> header.
 * Returns the decoded token (contains .uid, .email, custom claims like
 * .admin) or throws if missing/invalid.
 *
 * Never trust a uid sent in the request body — always derive it from the
 * verified token instead.
 */
export async function requireAuth(req) {
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer (.+)$/);
  if (!match) {
    const err = new Error("Missing Authorization bearer token");
    err.statusCode = 401;
    throw err;
  }

  try {
    const decoded = await auth.verifyIdToken(match[1]);
    return decoded;
  } catch (e) {
    const err = new Error("Invalid or expired token");
    err.statusCode = 401;
    throw err;
  }
}

export async function requireAdmin(req) {
  const decoded = await requireAuth(req);
  if (!decoded.admin) {
    const err = new Error("Admin privileges required");
    err.statusCode = 403;
    throw err;
  }
  return decoded;
}