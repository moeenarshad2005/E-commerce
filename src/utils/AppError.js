const { ERROR_CODES } = require("../config/constants");

class AppError extends Error {
  constructor(statusCode, message, code = ERROR_CODES.INTERNAL, details) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message, code = ERROR_CODES.VALIDATION_FAILED, details) {
    return new AppError(400, message, code, details);
  }

  static unauthorized(message, code = ERROR_CODES.NOT_AUTHENTICATED) {
    return new AppError(401, message, code);
  }

  static forbidden(message, code = ERROR_CODES.FORBIDDEN) {
    return new AppError(403, message, code);
  }

  static notFound(message = "Resource not found.") {
    return new AppError(404, message, ERROR_CODES.NOT_FOUND);
  }

  static conflict(message, code = ERROR_CODES.DUPLICATE_RESOURCE) {
    return new AppError(409, message, code);
  }

  static tooManyRequests(message) {
    return new AppError(429, message, ERROR_CODES.RATE_LIMITED);
  }
}

module.exports = AppError;
