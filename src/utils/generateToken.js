const jwt = require("jsonwebtoken");
const env = require("../config/env");

const generateToken = (userId) =>
  jwt.sign({ sub: String(userId) }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
    issuer: "e-commerce-api",
  });

module.exports = generateToken;
