const User = require("../models/user.model");
const env = require("../config/env");
const logger = require("../config/logger");
const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/AppError");
const { sendSuccess } = require("../utils/apiResponse");
const { createHashedToken, hashToken } = require("../utils/tokens");
const { sendVerificationEmail } = require("../utils/email");
const { RESEND_COOLDOWN_MS, ERROR_CODES } = require("../config/constants");

const buildVerifyUrl = (token) =>
  `${env.API_URL.replace(/\/+$/, "")}/api/v1/auth/verify-email/${token}`;

const issueVerification = async (user) => {
  try {
    if (!user || user.isEmailVerified) {
      return { sent: false, reason: "not-needed" };
    }

    const { raw, hashed } = createHashedToken();

    user.emailVerificationToken = hashed;
    user.emailVerificationExpires = new Date(
      Date.now() + env.EMAIL_TOKEN_TTL_MINUTES * 60 * 1000
    );
    user.emailVerificationSentAt = new Date();

    await user.save({ validateBeforeSave: false });

    await sendVerificationEmail({
      to: user.email,
      name: user.fullName,
      url: buildVerifyUrl(raw),
      expiresInMinutes: env.EMAIL_TOKEN_TTL_MINUTES,
    });

    return { sent: true };
  } catch (error) {
    logger.error("issueVerification failed", {
      message: error.message,
      userId: user?._id,
    });
    return { sent: false, reason: "send-failed" };
  }
};

const loginBlockedFor = (user) =>
  env.REQUIRE_EMAIL_VERIFICATION && !user.isEmailVerified;

// GET /api/v1/auth/verify-email/:token
const verifyEmail = catchAsync(async (req, res) => {
  const { token } = req.params;

  const user = await User.findOne({
    emailVerificationToken: hashToken(token),
    emailVerificationExpires: { $gt: new Date() },
  }).select("+emailVerificationToken +emailVerificationExpires");

  if (!user) {
    throw AppError.badRequest(
      "This verification link is invalid or has expired.",
      ERROR_CODES.INVALID_TOKEN
    );
  }

  user.isEmailVerified = true;
  user.emailVerificationToken = null;
  user.emailVerificationExpires = null;
  await user.save({ validateBeforeSave: false });

  if (env.CLIENT_URL) {
    return res.redirect(
      `${env.CLIENT_URL.replace(/\/+$/, "")}/login?verified=1`
    );
  }

  return sendSuccess(res, { message: "Email confirmed. You can log in now." });
});

// POST /api/v1/auth/resend-verification
const resendVerification = catchAsync(async (req, res) => {
  const { email } = req.body;

  const user = await User.findOne({ email }).select("+emailVerificationSentAt");

  const genericReply = {
    message: "If that address needs confirming, a new link is on its way.",
  };

  if (!user || user.isEmailVerified) {
    return sendSuccess(res, genericReply);
  }

  const withinCooldown =
    user.emailVerificationSentAt &&
    Date.now() - user.emailVerificationSentAt.getTime() < RESEND_COOLDOWN_MS;

  if (!withinCooldown) {
    issueVerification(user);
  }

  return sendSuccess(res, genericReply);
});

module.exports = {
  issueVerification,
  loginBlockedFor,
  verifyEmail,
  resendVerification,
};
