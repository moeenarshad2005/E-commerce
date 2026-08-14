const AppError = require("../utils/AppError");
const { ERROR_CODES } = require("../config/constants");

const validate = (schemas) => (req, res, next) => {
  const issues = [];

  for (const key of ["body", "query", "params"]) {
    const schema = schemas[key];
    if (!schema) continue;

    const result = schema.safeParse(req[key] ?? {});

    if (!result.success) {
      issues.push(
        ...result.error.issues.map((i) => ({
          field: [key, ...i.path].join("."),
          message: i.message,
        }))
      );
      continue;
    }

    if (key === "query") {
      Object.keys(req.query).forEach((k) => delete req.query[k]);
      Object.assign(req.query, result.data);
    } else {
      req[key] = result.data;
    }
  }

  if (issues.length) {
    return next(
      AppError.badRequest(
        "Validation failed.",
        ERROR_CODES.VALIDATION_FAILED,
        issues
      )
    );
  }

  return next();
};

module.exports = validate;
