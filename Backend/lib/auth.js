const crypto = require("node:crypto");

function tokenHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function verifyHashMatch(candidateToken, expectedHashHex) {
  if (
    !candidateToken ||
    !expectedHashHex ||
    typeof expectedHashHex !== "string"
  ) {
    return false;
  }

  const candidateHex = tokenHash(String(candidateToken).trim());
  if (candidateHex.length !== expectedHashHex.length) {
    return false;
  }

  try {
    return crypto.timingSafeEqual(
      Buffer.from(candidateHex, "hex"),
      Buffer.from(expectedHashHex, "hex"),
    );
  } catch {
    return false;
  }
}

function setSessionCookie(res, sessionCookieName, token, secure, durationMs, sameSite = process.env.COOKIE_SAME_SITE || (secure ? "none" : "strict")) {
  res.cookie(sessionCookieName, token, {
    httpOnly: true,
    secure,
    sameSite,
    path: "/api",
    maxAge: durationMs,
  });
}

function clearSessionCookie(res, sessionCookieName, secure, sameSite = process.env.COOKIE_SAME_SITE || (secure ? "none" : "strict")) {
  res.clearCookie(sessionCookieName, {
    httpOnly: true,
    secure,
    sameSite,
    path: "/api",
  });
}

module.exports = {
  tokenHash,
  verifyHashMatch,
  setSessionCookie,
  clearSessionCookie,
};
