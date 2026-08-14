/**
 * Creates every index declared on the models.   npm run db:indexes
 *
 * Why this exists
 * ---------------
 * config/db.js sets `mongoose.set("autoIndex", !env.isProduction)`. That is the
 * right default — building an index blocks the collection, and you do not want
 * that happening automatically in whichever process happens to boot first
 * during a deploy.
 *
 * But it leaves a trap: in production Mongoose creates NOTHING. `unique: true`
 * on email and username is not a rule Mongoose enforces in JavaScript — it is a
 * unique index in MongoDB. Without that index nothing stops two accounts
 * sharing an email, and the duplicate-key handling in the error middleware
 * never fires because there is no key to duplicate.
 *
 * So run this once against production after deploying, and again whenever an
 * index is added or changed.
 *
 * `syncIndexes()` creates what is missing and drops what the schema no longer
 * declares, so it also cleans up after a removed field.
 */
require("../src/config/env");

const mongoose = require("mongoose");
const { connectDB, disconnectDB } = require("../src/config/db");

// Every model must be required so it registers itself with Mongoose before
// syncIndexes runs — an unregistered model is simply skipped, silently.
const User = require("../src/models/user.model");
const Category = require("../src/models/category.model");
const Product = require("../src/models/product.model");
const Cart = require("../src/models/cart.model");
const Order = require("../src/models/order.model");

// Cart carries the constraint that actually matters for correctness:
// that make concurrency safe: the unique `user` on carts, which turns two
// simultaneous "add to cart" clicks into one cart; and the unique
// `stripePaymentIntentId` on orders, which stops a redelivered Stripe webhook
// creating a second order for one payment.
const MODELS = [User, Category, Product, Cart, Order];

(async () => {
  try {
    await connectDB();

    console.log("");

    for (const Model of MODELS) {
      const name = Model.collection.name;

      // eslint-disable-next-line no-await-in-loop -- sequential on purpose:
      // building several indexes at once competes for the same disk and lock.
      const dropped = await Model.syncIndexes();

      // eslint-disable-next-line no-await-in-loop
      const indexes = await Model.collection.indexes();

      console.log(`${name}`);
      indexes.forEach((i) => {
        const unique = i.unique ? "  UNIQUE" : "";
        const partial = i.partialFilterExpression ? "  partial" : "";
        console.log(`  - ${i.name}${unique}${partial}`);
      });

      if (dropped && dropped.length) {
        console.log(`  (dropped stale: ${dropped.join(", ")})`);
      }
      console.log("");
    }

    console.log("All indexes are in sync.\n");
  } catch (error) {
    console.error("\nFailed to sync indexes:", error.message, "\n");
    process.exitCode = 1;
  } finally {
    await disconnectDB().catch(() => {});
    await mongoose.disconnect().catch(() => {});
  }
})();
