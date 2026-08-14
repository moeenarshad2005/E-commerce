const User = require("../models/user.model");
const env = require("../config/env");
const logger = require("../config/logger");
const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/AppError");
const generateToken = require("../utils/generateToken");
const { sendSuccess } = require("../utils/apiResponse");
const { createHashedToken, hashToken } = require("../utils/tokens");
const { sendPasswordResetEmail } = require("../utils/email");
const { ACCOUNT_STATUS, ERROR_CODES } = require("../config/constants");

const buildResetUrl = (token) => {
  const base = (env.CLIENT_URL || env.API_URL).replace(/\/+$/, "");
  return `${base}/reset-password?token=${token}`;
};

const deliverResetEmail = async (user, rawToken) => {
  try {
    await sendPasswordResetEmail({
      to: user.email,
      name: user.fullName,
      url: buildResetUrl(rawToken),
      expiresInMinutes: env.PASSWORD_RESET_TTL_MINUTES,
    });
  } catch (error) {
    try {
      user.passwordResetToken = null;
      user.passwordResetExpires = null;
      await user.save({ validateBeforeSave: false });
    } catch (cleanupError) {
      logger.error("could not clear an unusable reset token", {
        message: cleanupError.message,
        userId: String(user._id),
      });
    }

    logger.error("password reset email failed", {
      message: error.message,
      userId: String(user._id),
    });
  }
};

// POST /api/v1/auth/forgot-password
const forgotPassword = catchAsync(async (req, res) => {
  const { email } = req.body;

  const user = await User.findOne({ email });

  const genericReply = {
    message: "If an account exists for that address, a reset link is on its way.",
  };

  if (!user || user.accountStatus !== ACCOUNT_STATUS.ACTIVE) {
    return sendSuccess(res, genericReply);
  }

  const { raw, hashed } = createHashedToken();

  user.passwordResetToken = hashed;
  user.passwordResetExpires = new Date(
    Date.now() + env.PASSWORD_RESET_TTL_MINUTES * 60 * 1000
  );
  await user.save({ validateBeforeSave: false });

  deliverResetEmail(user, raw);

  return sendSuccess(res, genericReply);
});

// POST /api/v1/auth/reset-password
const resetPassword = catchAsync(async (req, res) => {
  const { token, password } = req.body;

  const user = await User.findOne({
    passwordResetToken: hashToken(token),
    passwordResetExpires: { $gt: new Date() },
  }).select("+passwordResetToken +passwordResetExpires +password");

  if (!user) {
    throw AppError.badRequest(
      "This reset link is invalid or has expired.",
      ERROR_CODES.INVALID_TOKEN
    );
  }

  user.password = password;
  user.passwordResetToken = null;
  user.passwordResetExpires = null;

  user.isEmailVerified = true;

  await user.save();

  return sendSuccess(res, {
    message: "Password updated. You are now logged in on this device.",
    data: { token: generateToken(user._id), user: user.toPublicJSON() },
  });
});

// PATCH /api/v1/auth/password  (authenticated)
const changePassword = catchAsync(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  const user = await User.findById(req.user._id).select("+password");

  if (!user || !(await user.comparePassword(currentPassword))) {
    throw AppError.unauthorized(
      "Your current password is incorrect.",
      ERROR_CODES.INVALID_CREDENTIALS
    );
  }

  user.password = newPassword;
  await user.save();

  return sendSuccess(res, {
    message: "Password changed. Other sessions have been signed out.",
    data: { token: generateToken(user._id), user: user.toPublicJSON() },
  });
});

module.exports = { forgotPassword, resetPassword, changePassword };
