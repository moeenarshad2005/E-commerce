const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const {
  ACCOUNT_STATUS,
  ROLES,
  BCRYPT_ROUNDS,
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
} = require("../config/constants");

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_PATTERN = /^[a-z0-9_.]+$/;

const userSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: [true, "Full name is required."],
      trim: true,
      minlength: [2, "Full name must be at least 2 characters."],
      maxlength: [80, "Full name must be at most 80 characters."],
    },

    username: {
      type: String,
      required: [true, "Username is required."],
      unique: true,
      trim: true,
      lowercase: true,
      minlength: [3, "Username must be at least 3 characters."],
      maxlength: [30, "Username must be at most 30 characters."],
      match: [
        USERNAME_PATTERN,
        "Username may only contain letters, numbers, dots and underscores.",
      ],
    },

    email: {
      type: String,
      required: [true, "Email is required."],
      unique: true,
      trim: true,
      lowercase: true,
      match: [EMAIL_PATTERN, "Please provide a valid email address."],
    },

    password: {
      type: String,
      required: [true, "Password is required."],
      minlength: [
        MIN_PASSWORD_LENGTH,
        `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      ],
      maxlength: [
        MAX_PASSWORD_LENGTH,
        `Password must be at most ${MAX_PASSWORD_LENGTH} characters.`,
      ],
      select: false,
    },

    role: {
      type: String,
      enum: Object.values(ROLES),
      default: ROLES.USER,
    },

    isEmailVerified: {
      type: Boolean,
      default: false,
    },


    emailVerificationToken: { type: String, default: null, select: false },
    emailVerificationExpires: { type: Date, default: null, select: false },
    emailVerificationSentAt: { type: Date, default: null, select: false },

    passwordResetToken: { type: String, default: null, select: false },
    passwordResetExpires: { type: Date, default: null, select: false },

    passwordChangedAt: { type: Date, default: null, select: false },

    stripeCustomerId: {
      type: String,
      default: null,
      select: false,
    },

    accountStatus: {
      type: String,
      enum: Object.values(ACCOUNT_STATUS),
      default: ACCOUNT_STATUS.ACTIVE,
    },
  },
  { timestamps: true }
);


userSchema.index(
  { emailVerificationToken: 1 },
  { partialFilterExpression: { emailVerificationToken: { $type: "string" } } }
);

userSchema.index(
  { passwordResetToken: 1 },
  { partialFilterExpression: { passwordResetToken: { $type: "string" } } }
);

userSchema.index(
  { stripeCustomerId: 1 },
  {
    unique: true,
    partialFilterExpression: { stripeCustomerId: { $type: "string" } },
  }
);

userSchema.pre("save", async function hashPassword(next) {
  if (!this.isModified("password")) return next();

  try {
    this.password = await bcrypt.hash(this.password, BCRYPT_ROUNDS);

    if (!this.isNew) this.passwordChangedAt = new Date(Date.now() - 1000);

    return next();
  } catch (error) {
    return next(error);
  }
});

userSchema.methods.comparePassword = function comparePassword(candidate) {
  if (!this.password) return Promise.resolve(false);
  return bcrypt.compare(candidate, this.password);
};

userSchema.methods.changedPasswordAfter = function changedPasswordAfter(
  tokenIssuedAtSeconds
) {
  if (!this.passwordChangedAt || !tokenIssuedAtSeconds) return false;
  return this.passwordChangedAt.getTime() / 1000 > tokenIssuedAtSeconds;
};

userSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id,
    fullName: this.fullName,
    username: this.username,
    email: this.email,
    role: this.role,
    isEmailVerified: this.isEmailVerified,
    createdAt: this.createdAt,
  };
};

const stripSensitive = (doc, ret) => {
  delete ret.password;
  delete ret.emailVerificationToken;
  delete ret.emailVerificationExpires;
  delete ret.emailVerificationSentAt;
  delete ret.passwordResetToken;
  delete ret.passwordResetExpires;
  delete ret.passwordChangedAt;
  delete ret.stripeCustomerId;
  delete ret.__v;
  return ret;
};

userSchema.set("toJSON", { transform: stripSensitive });
userSchema.set("toObject", { transform: stripSensitive });

module.exports = mongoose.model("User", userSchema);
