const express = require("express");

const { stripeWebhook } = require("../controllers/webhook.controller");

const router = express.Router();

/**
 * express.raw(), NOT express.json().
 *
 * Stripe signs the exact bytes of the request body. The JSON parser consumes
 * the stream and hands you an object; re-serialising that object produces
 * different bytes — different key order, different whitespace — and every
 * signature check fails.
 *
 * The route declares its own parser so the requirement travels with the route
 * rather than depending on someone remembering the mount order in app.js.
 */
router.post(
  "/stripe",
  express.raw({ type: "application/json" }),
  stripeWebhook
);

module.exports = router;
