const express = require("express");

const { register, login, getMe } = require("../controllers/auth.controller");
const {
  verifyEmail,
  resendVerification,
} = require("../controllers/emailVerification.controller");
const {
  forgotPassword,
  resetPassword,
  changePassword,
} = require("../controllers/password.controller");

const { protect } = require("../middleware/auth.middleware");
const validate = require("../middleware/validate.middleware");
const {
  authLimiter,
  registerLimiter,
  emailLimiter,
} = require("../middleware/rateLimit.middleware");
const schemas = require("../validators/auth.validator");

const router = express.Router();

// POST /api/v1/auth/register - Create a new user account
router.post(
  "/register",
  registerLimiter,
  validate(schemas.registerSchema),
  register
);
// POST /api/v1/auth/login - Authenticate and receive a token
router.post("/login", authLimiter, validate(schemas.loginSchema), login);
// GET /api/v1/auth/verify-email/:token - Confirm an account's email address
router.get(
  "/verify-email/:token",
  validate(schemas.verifyEmailSchema),
  verifyEmail
);
// POST /api/v1/auth/resend-verification - Resend the email verification link
router.post(
  "/resend-verification",
  emailLimiter,
  validate(schemas.resendVerificationSchema),
  resendVerification
);

// POST /api/v1/auth/forgot-password - Request a password reset email
router.post(
  "/forgot-password",
  emailLimiter,
  validate(schemas.forgotPasswordSchema),
  forgotPassword
);
// POST /api/v1/auth/reset-password - Reset password using a reset token
router.post(
  "/reset-password",
  authLimiter,
  validate(schemas.resetPasswordSchema),
  resetPassword
);

// GET /api/v1/auth/me - Get the signed-in user's profile
router.get("/me", protect, getMe);
// PATCH /api/v1/auth/password - Change the signed-in user's password
router.patch(
  "/password",
  protect,
  validate(schemas.changePasswordSchema),
  changePassword
);

module.exports = router;
