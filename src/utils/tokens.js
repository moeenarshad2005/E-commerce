const crypto = require("crypto");

const createHashedToken = (bytes = 32) => {
  const raw = crypto.randomBytes(bytes).toString("hex");
  return { raw, hashed: hashToken(raw) };
};

const hashToken = (token) =>
  crypto.createHash("sha256").update(String(token)).digest("hex");

module.exports = { createHashedToken, hashToken };
