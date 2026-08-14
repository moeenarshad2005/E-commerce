/**
 * Promote an existing account to admin.   node scripts/make-admin.js you@example.com
 *
 * A script rather than an endpoint, deliberately. "Make me an admin" must never
 * be reachable over HTTP — no amount of guarding makes that safe, and the only
 * people who should be able to run this already have access to the server.
 */
require("../src/config/env");

const mongoose = require("mongoose");
const { connectDB, disconnectDB } = require("../src/config/db");
const User = require("../src/models/user.model");
const { ROLES } = require("../src/config/constants");

const email = String(process.argv[2] || "").trim().toLowerCase();
const demote = process.argv.includes("--demote");

(async () => {
  if (!email) {
    console.error("\nUsage: node scripts/make-admin.js <email> [--demote]\n");
    process.exit(1);
  }

  try {
    await connectDB();

    const user = await User.findOne({ email });

    if (!user) {
      console.error(`\nNo account found for ${email}.`);
      console.error("Register through the API first, then run this again.\n");
      process.exit(1);
    }

    const target = demote ? ROLES.USER : ROLES.ADMIN;

    if (user.role === target) {
      console.log(`\n${email} is already ${target}.\n`);
      return;
    }

    user.role = target;
    await user.save({ validateBeforeSave: false });

    console.log(`\n${email} is now ${target}.`);
    if (!demote) {
      console.log("Sign in to the admin panel with this email and its normal password.\n");
    }
  } catch (error) {
    console.error("\nFailed:", error.message, "\n");
    process.exitCode = 1;
  } finally {
    await disconnectDB().catch(() => {});
    await mongoose.disconnect().catch(() => {});
  }
})();
