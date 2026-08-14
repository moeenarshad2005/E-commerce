const bcrypt = require("bcryptjs");

const User = require("../models/user.model");
const generateToken = require("../utils/generateToken");
const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/AppError");
const { sendSuccess } = require("../utils/apiResponse");
const {
  issueVerification,
  loginBlockedFor,
} = require("./emailVerification.controller");
const {
  ensureStripeCustomerInBackground,
} = require("../services/stripe.service");
const { ACCOUNT_STATUS, ERROR_CODES } = require("../config/constants");

const DUMMY_HASH =
  "$2a$12$eImiTXuWVxfM37uY4JANjQ..NRfPvZWnzHqZ4NRJnHUKAyEd/z2Bi";

// POST /api/v1/auth/register
const register = catchAsync(async (req, res) => {
  const { fullName, username, email, password } = req.body;

  const existing = await User.findOne({ $or: [{ email }, { username }] })
    .select("_id")
    .lean();

  if (existing) {
    throw AppError.conflict("Email or username is already in use.");
  }

  const user = await User.create({ fullName, username, email, password });

  await issueVerification(user);

  ensureStripeCustomerInBackground(user);

  return sendSuccess(res, {
    status: 201,
    message: "Registered successfully. Check your email to confirm it.",
    data: { user: user.toPublicJSON() },
  });
});

// POST /api/v1/auth/login
const login = catchAsync(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email }).select("+password");

  if (!user) {
    await bcrypt.compare(password, DUMMY_HASH);
    throw AppError.unauthorized(
      "Invalid credentials.",
      ERROR_CODES.INVALID_CREDENTIALS
    );
  }

  if (!(await user.comparePassword(password))) {
    throw AppError.unauthorized(
      "Invalid credentials.",
      ERROR_CODES.INVALID_CREDENTIALS
    );
  }

  if (user.accountStatus !== ACCOUNT_STATUS.ACTIVE) {
    throw AppError.forbidden(
      "This account is not active.",
      ERROR_CODES.ACCOUNT_NOT_ACTIVE
    );
  }

  if (loginBlockedFor(user)) {
    throw AppError.forbidden(
      "Please confirm your email address before logging in.",
      ERROR_CODES.EMAIL_NOT_VERIFIED
    );
  }

  return sendSuccess(res, {
    message: "Login successful.",
    data: { token: generateToken(user._id), user: user.toPublicJSON() },
  });
});

// GET /api/v1/auth/me 
const getMe = catchAsync(async (req, res) =>
  sendSuccess(res, { data: { user: req.user.toPublicJSON() } })
);

module.exports = { register, login, getMe };
