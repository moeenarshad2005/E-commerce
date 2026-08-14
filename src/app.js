const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const mongoose = require("mongoose");
const env = require("./config/env");
const logger = require("./config/logger");

const authRoutes = require("./routes/auth.routes");
const categoryRoutes = require("./routes/category.routes");
const productRoutes = require("./routes/product.routes");
const cartRoutes = require("./routes/cart.routes");
const paymentRoutes = require("./routes/payment.routes");
const orderRoutes = require("./routes/order.routes");
const webhookRoutes = require("./routes/webhook.routes");
const userRoutes = require("./routes/user.routes");


const { notFound, errorHandler } = require("./middleware/error.middleware");
const AppError = require("./utils/AppError");
const { JSON_BODY_LIMIT } = require("./config/constants");
const { globalLimiter } = require("./middleware/rateLimit.middleware");
const {
  UPLOAD_ROOT,
  UPLOAD_URL_PREFIX,
} = require("./middleware/upload.middleware");

const app = express();

app.set("trust proxy", 1);

// Stops the response advertising "Express" to anyone scanning for known bugs.
app.disable("x-powered-by");

// Security headers.
const helmetStrict = helmet();
const helmetNoCsp = helmet({ contentSecurityPolicy: false });

app.use((req, res, next) =>
  req.path.startsWith(env.ADMIN_ROOT_PATH)
    ? helmetNoCsp(req, res, next)
    : helmetStrict(req, res, next)
);

/**
 * AdminJS router
 */
const adminRouter = express.Router();
app.use(env.ADMIN_ROOT_PATH, adminRouter);

// CORS
const allowedOrigins = [env.CLIENT_URL].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      if (!allowedOrigins.length && !env.isProduction) {
        return callback(null, true);
      }

      // AppError rather than a plain Error: the error handler recognises this
      // as a deliberate refusal and answers 403. A plain Error falls through
      // to the unknown branch, so a blocked origin got a 500 and filled the
      // logs with "unhandled error" for what is normal, expected behaviour.
      return callback(
        AppError.forbidden(`Origin ${origin} is not allowed by CORS.`)
      );
    },
    credentials: true,
  })
);


/**
 * Stripe webhook — MOUNTED BEFORE THE JSON PARSER, DELIBERATELY.
 *
 * This is the most position-sensitive line in the file. Stripe signs the exact
 * bytes of the request body and `constructEvent` re-computes that signature
 * over them. Once express.json() has parsed the body those bytes are gone, and
 * re-serialising the object produces different ones — different key order,
 * different whitespace — so every signature check fails.
 *
 * The route supplies its own express.raw() parser (see webhook.routes.js), so
 * it receives a Buffer while every other route still gets parsed JSON.
 *
 * Move this below the parser and the failure is SILENT: checkout still works,
 * money is still taken, and no order is ever marked paid.
 */
app.use("/api/v1/webhooks", webhookRoutes);

// JSON body parser
app.use(express.json({ limit: JSON_BODY_LIMIT }));

/**
 * Uploaded files.
 *
 * There were previously two mounts here, neither pointing at the directory
 * multer actually wrote to, so every uploaded image returned 404. Both the
 * directory and this prefix now come from upload.middleware.js, so the write
 * path and the read path cannot drift apart again.
 *
 * Filenames are unique and never reused, so the files can be cached hard.
 */
app.use(
  UPLOAD_URL_PREFIX,
  express.static(UPLOAD_ROOT, {
    maxAge: "7d",
    index: false,     // no directory listings
    dotfiles: "deny", // never serve .something out of the upload folder
  })
);

// Request logger
app.use((req, res, next) => {
  const startedAt = Date.now();

  res.on("finish", () => {
    logger.info(
      `${req.method} ${req.originalUrl} ${res.statusCode} ${
        Date.now() - startedAt
      }ms`
    );
  });

  next();
});

// Applies to every API route below. Mounted after the request logger so a
// rate-limited request is still recorded, and after the static mount so
// uploaded images are never counted.
app.use(globalLimiter);

// Health check
app.get("/api/v1/health", (req, res) => {
  const dbUp = mongoose.connection.readyState === 1;

  res.status(dbUp ? 200 : 503).json({
    success: dbUp,
    status: dbUp ? "ok" : "degraded",
    database: dbUp ? "connected" : "disconnected",
    uptime: Math.round(process.uptime()),
  });
});

/**
 * ===========================
 * API Routes
 * ===========================
 */

app.use("/api/v1/auth", authRoutes);

app.use("/api/v1/users", userRoutes);

app.use("/api/v1/categories", categoryRoutes);

app.use("/api/v1/products", productRoutes);

app.use("/api/v1/cart", cartRoutes);

app.use("/api/v1/payment", paymentRoutes);

app.use("/api/v1/orders", orderRoutes);

/**
 * Root Route
 */
app.get("/", (req, res) => {
  res.json({
    name: "E-Commerce API",
    version: "v1",
    health: "/api/v1/health",
  });
});

/**
 * Error Handling
 */
app.use(notFound);
app.use(errorHandler);

module.exports = app;
module.exports.adminRouter = adminRouter;