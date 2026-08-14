const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const User = require("../models/user.model");
const env = require("../config/env");
const logger = require("../config/logger");
const { ROLES, ACCOUNT_STATUS } = require("../config/constants");

const safeEqual = (a, b) => {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  const hashA = crypto.createHash("sha256").update(bufA).digest();
  const hashB = crypto.createHash("sha256").update(bufB).digest();
  return crypto.timingSafeEqual(hashA, hashB);
};

const authenticate = async (email, password) => {
  const normalisedEmail = String(email || "").trim().toLowerCase();

  if (!normalisedEmail || !password) return null;

  try {
    const user = await User.findOne({ email: normalisedEmail }).select("+password");

    if (user) {
      const passwordMatches = await user.comparePassword(password);

      if (!passwordMatches) {
        logger.warn("admin login rejected: wrong password", { email: normalisedEmail });
        return null;
      }

      if (user.role !== ROLES.ADMIN) {
        logger.warn("admin login rejected: not an admin", { email: normalisedEmail });
        return null;
      }

      if (user.accountStatus !== ACCOUNT_STATUS.ACTIVE) {
        logger.warn("admin login rejected: account not active", { email: normalisedEmail });
        return null;
      }

      logger.info("admin signed in", { email: normalisedEmail });

      return { email: user.email, title: user.fullName, id: String(user._id) };
    }

    if (env.ADMIN_EMAIL && env.ADMIN_PASSWORD) {
      const emailOk = safeEqual(normalisedEmail, env.ADMIN_EMAIL.toLowerCase());
      const passwordOk = safeEqual(password, env.ADMIN_PASSWORD);

      if (emailOk && passwordOk) {
        logger.warn(
          "admin signed in with bootstrap .env credentials — create a real admin account and clear ADMIN_EMAIL/ADMIN_PASSWORD"
        );
        return { email: env.ADMIN_EMAIL, title: "Bootstrap Admin" };
      }
    }

    await bcrypt.compare(
      String(password),
      "$2a$12$eImiTXuWVxfM37uY4JANjQ..NRfPvZWnzHqZ4NRJnHUKAyEd/z2Bi"
    );

    logger.warn("admin login rejected: unknown account", { email: normalisedEmail });
    return null;
  } catch (error) {
    logger.error("admin authenticate failed", { message: error.message });
    return null;
  }
};

module.exports = { authenticate };
