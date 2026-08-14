const AppError = require("../utils/AppError");
const env = require("../config/env");
const logger = require("../config/logger");
const { ERROR_CODES } = require("../config/constants");

const notFound = (req, res, next) => {
  next(AppError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
};

const normalise = (err) => {
  if (err instanceof AppError) return err;

  if (err.name === "ValidationError" && err.errors) {
    return AppError.badRequest(
      "Validation failed.",
      ERROR_CODES.VALIDATION_FAILED,
      Object.values(err.errors).map((e) => ({
        field: e.path,
        message: e.message,
      }))
    );
  }

  if (err.name === "CastError") {
    return AppError.badRequest(`Invalid value for ${err.path}.`);
  }

  if (err.name === "MulterError") {
    const UPLOAD_MESSAGES = {
      LIMIT_FILE_SIZE: "One of the files is too large.",
      LIMIT_FILE_COUNT: "Too many files were uploaded.",
      LIMIT_UNEXPECTED_FILE:
        "Too many files, or a file was sent under an unexpected field name.",
      LIMIT_PART_COUNT: "The upload has too many parts.",
      LIMIT_FIELD_COUNT: "The form has too many fields.",
      LIMIT_FIELD_KEY: "A form field name is too long.",
      LIMIT_FIELD_VALUE: "A form field value is too long.",
    };

    return AppError.badRequest(
      UPLOAD_MESSAGES[err.code] || "File upload failed."
    );
  }

  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0] || "field";
    return AppError.conflict(`That ${field} is already in use.`);
  }

  if (typeof err.type === "string" && err.type.startsWith("Stripe")) {
    if (err.type === "StripeCardError") {
      return new AppError(402, "That card was declined.", "PAYMENT_FAILED");
    }

    if (err.type === "StripeInvalidRequestError") {
      return new AppError(
        500,
        "Something went wrong on our end.",
        ERROR_CODES.INTERNAL
      );
    }

    return new AppError(
      503,
      "Payments are temporarily unavailable. Please try again shortly.",
      "PAYMENT_UNAVAILABLE"
    );
  }

  if (err.name === "JsonWebTokenError") {
    return AppError.unauthorized("Invalid token.", ERROR_CODES.INVALID_TOKEN);
  }

  if (err.name === "TokenExpiredError") {
    return AppError.unauthorized(
      "Your session has expired. Please log in again.",
      ERROR_CODES.INVALID_TOKEN
    );
  }

  if (err.type === "entity.parse.failed") {
    return AppError.badRequest("Request body is not valid JSON.");
  }

  if (err.type === "entity.too.large") {
    return AppError.badRequest("Request body is too large.");
  }

  return null;
};

const errorHandler = (err, req, res, next) => {
  const known = normalise(err);

  if (!known) {
    logger.error("unhandled error", {
      message: err.message,
      url: req.originalUrl,
      method: req.method,
      stack: err.stack,
    });

    return res.status(500).json({
      success: false,
      message: "Something went wrong on our end.",
      code: ERROR_CODES.INTERNAL,
      ...(env.isProduction ? {} : { debug: err.message }),
    });
  }

  if (known.statusCode >= 500) {
    logger.error(`${known.statusCode} ${known.code} — ${known.message}`, {
      url: req.originalUrl,
      method: req.method,
      stack: known.stack,
    });
  } else {
    logger.warn(`${known.statusCode} ${known.code} — ${known.message}`, {
      url: req.originalUrl,
    });
  }

  return res.status(known.statusCode).json({
    success: false,
    message: known.message,
    code: known.code,
    ...(known.details ? { errors: known.details } : {}),
  });
};

module.exports = { notFound, errorHandler };
