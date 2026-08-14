const rateLimit = require("express-rate-limit");

const env = require("../config/env");
const { ERROR_CODES } = require("../config/constants");

const handler = (message) => (req, res) =>
  res.status(429).json({
    success: false,
    message,
    code: ERROR_CODES.RATE_LIMITED,
  });

const baseOptions = {
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: () => env.isTest,
};

const globalLimiter = rateLimit({
  ...baseOptions,
  windowMs: env.RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
  limit: env.RATE_LIMIT_MAX,
  skip: (req) =>
    env.isTest ||
    req.path.startsWith(env.ADMIN_ROOT_PATH) ||
    req.path.startsWith("/uploads"),
  handler: handler("Too many requests. Please slow down."),
});

const authLimiter = rateLimit({
  ...baseOptions,
  windowMs: env.RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
  limit: env.AUTH_RATE_LIMIT_MAX,
  skipSuccessfulRequests: true,
  handler: handler(
    "Too many attempts from this address. Please try again later."
  ),
});

const registerLimiter = rateLimit({
  ...baseOptions,
  windowMs: 60 * 60 * 1000,
  limit: 10,
  handler: handler(
    "Too many accounts created from this address. Please try again later."
  ),
});

const emailLimiter = rateLimit({
  ...baseOptions,
  windowMs: 60 * 60 * 1000,
  limit: 5,
  handler: handler("Too many emails requested. Please try again in an hour."),
});

module.exports = {
  globalLimiter,
  authLimiter,
  registerLimiter,
  emailLimiter,
};
