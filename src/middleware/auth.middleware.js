const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

const User = require("../models/user.model");
const env = require("../config/env");
const AppError = require("../utils/AppError");
const catchAsync = require("../utils/catchAsync");
const { ACCOUNT_STATUS, ERROR_CODES } = require("../config/constants");

const extractToken = (req) => {
  const header = req.headers.authorization;
  if (!header) return null;

  const [scheme, ...rest] = header.split(" ");
  if (scheme.toLowerCase() !== "bearer") return null;

  return rest.join(" ").trim() || null;
};

const protect = catchAsync(async (req, res, next) => {
  const token = extractToken(req);

  if (!token) {
    throw AppError.unauthorized("Not authorized, no token provided.");
  }

  const decoded = jwt.verify(token, env.JWT_SECRET, {
    algorithms: ["HS256"],
    issuer: "e-commerce-api",
  });

  if (!mongoose.isValidObjectId(decoded.sub)) {
    throw AppError.unauthorized("Invalid token.", ERROR_CODES.INVALID_TOKEN);
  }

  const user = await User.findById(decoded.sub).select("+passwordChangedAt");

  if (!user) {
    throw AppError.unauthorized("Not authorized, this account no longer exists.");
  }

  if (user.changedPasswordAfter(decoded.iat)) {
    throw AppError.unauthorized(
      "Your password was changed. Please log in again.",
      ERROR_CODES.INVALID_TOKEN
    );
  }

  if (user.accountStatus !== ACCOUNT_STATUS.ACTIVE) {
    throw AppError.forbidden(
      "This account is not active.",
      ERROR_CODES.ACCOUNT_NOT_ACTIVE
    );
  }

  req.user = user;
  return next();
});

const attachUserIfPresent = catchAsync(async (req, res, next) => {
  const token = extractToken(req);
  if (!token) return next();

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, {
      algorithms: ["HS256"],
      issuer: "e-commerce-api",
    });

    if (!mongoose.isValidObjectId(decoded.sub)) return next();

    const user = await User.findById(decoded.sub).select("+passwordChangedAt");

    if (
      user &&
      user.accountStatus === ACCOUNT_STATUS.ACTIVE &&
      !user.changedPasswordAfter(decoded.iat)
    ) {
      req.user = user;
    }
  } catch {}

  return next();
});

const restrictTo =
  (...roles) =>
  (req, res, next) => {
    if (!req.user) {
      return next(
        AppError.unauthorized("Not authorized, no token provided.")
      );
    }

    if (!roles.includes(req.user.role)) {
      return next(
        AppError.forbidden(
          "You do not have permission to perform this action.",
          ERROR_CODES.FORBIDDEN
        )
      );
    }

    return next();
  };

module.exports = { protect, restrictTo, attachUserIfPresent };
