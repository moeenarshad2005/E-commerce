/**
 * Deletes user accounts from the database. Development helper.
 *
 *   npm run users:list                    show every account, delete nothing
 *   npm run users:delete                  delete ALL accounts (asks first)
 *   npm run users:delete -- test@x.com    delete one account by email
 *   npm run users:delete -- --force       delete ALL, skipping the prompt
 *
 * Refuses to run when NODE_ENV=production. Deleting every user is not
 * something you ever want to do by accident against real data, and a guard in
 * code is more reliable than a guard in your memory.
 */
require("../src/config/env");

const readline = require("readline");
const mongoose = require("mongoose");

const env = require("../src/config/env");
const { connectDB, disconnectDB } = require("../src/config/db");
const User = require("../src/models/user.model");

const args = process.argv.slice(2);
const force = args.includes("--force");
const listOnly = args.includes("--list");
const targetEmail = args.find((a) => !a.startsWith("--"))?.toLowerCase();

// Reads a single line from the terminal. Wrapped in a promise so the main flow
// can just await it.
const ask = (question) =>
  new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });

const describe = (u) =>
  `  ${u.email.padEnd(34)} @${(u.username || "").padEnd(16)} ${
    u.isEmailVerified ? "verified" : "unverified"
  }`;

(async () => {
  if (env.isProduction) {
    console.error("\nRefusing to delete users while NODE_ENV=production.\n");
    process.exit(1);
  }

  try {
    await connectDB();

    const filter = targetEmail ? { email: targetEmail } : {};
    const users = await User.find(filter).select("email username isEmailVerified");

    if (!users.length) {
      console.log(
        targetEmail
          ? `\nNo account found for ${targetEmail}.\n`
          : "\nThe users collection is already empty.\n"
      );
      return;
    }

    console.log(`\n${users.length} account${users.length === 1 ? "" : "s"}:\n`);
    users.forEach((u) => console.log(describe(u)));
    console.log("");

    if (listOnly) {
      console.log("List only — nothing deleted.\n");
      return;
    }

    // Deleting one named account is low risk. Deleting everything is not, so
    // that path asks for an explicit word rather than a y/n anyone taps through.
    if (!force) {
      const prompt = targetEmail
        ? `Delete ${targetEmail}? (y/N) `
        : `Type DELETE to remove all ${users.length} accounts: `;

      const answer = await ask(prompt);
      const confirmed = targetEmail
        ? answer.toLowerCase() === "y"
        : answer === "DELETE";

      if (!confirmed) {
        console.log("\nCancelled. Nothing was deleted.\n");
        return;
      }
    }

    const { deletedCount } = await User.deleteMany(filter);
    console.log(
      `\nDeleted ${deletedCount} account${deletedCount === 1 ? "" : "s"}.`
    );
    console.log("You can now register with the same email again.\n");
  } catch (error) {
    console.error("\nFailed:", error.message, "\n");
    process.exitCode = 1;
  } finally {
    await disconnectDB().catch(() => {});
    await mongoose.disconnect().catch(() => {});
  }
})();
