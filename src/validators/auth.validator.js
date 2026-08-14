const { z } = require("zod");

const {
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
} = require("../config/constants");


const email = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Email is required.")
  .max(254)
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Please provide a valid email address.");

const password = z
  .string()
  .min(
    MIN_PASSWORD_LENGTH,
    `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
  )
  .max(
    MAX_PASSWORD_LENGTH,
    `Password must be at most ${MAX_PASSWORD_LENGTH} characters.`
  );

const username = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Username must be at least 3 characters.")
  .max(30, "Username must be at most 30 characters.")
  .regex(
    /^[a-z0-9_.]+$/,
    "Username may only contain letters, numbers, dots and underscores."
  );

const fullName = z
  .string()
  .trim()
  .min(2, "Full name must be at least 2 characters.")
  .max(80, "Full name must be at most 80 characters.");

const registerSchema = {
  body: z.object({ fullName, username, email, password }).strict(),
};

const loginSchema = {
  body: z
    .object({ email, password: z.string().min(1, "Password is required.") })
    .strict(),
};

const verifyEmailSchema = {
  params: z.object({
    token: z.string().trim().min(1, "Token is required.").max(256),
  }),
};

const resendVerificationSchema = {
  body: z.object({ email }).strict(),
};

const resetToken = z.string().trim().min(1, "Token is required.").max(256);

const forgotPasswordSchema = {
  body: z.object({ email }).strict(),
};

const resetPasswordSchema = {
  body: z.object({ token: resetToken, password }).strict(),
};

const changePasswordSchema = {
  body: z
    .object({
      currentPassword: z.string().min(1, "Current password is required."),
      newPassword: password,
    })
    .strict()
    .refine((d) => d.currentPassword !== d.newPassword, {
      message: "The new password must be different from the current one.",
      path: ["newPassword"],
    }),
};

module.exports = {
  registerSchema,
  loginSchema,
  verifyEmailSchema,
  resendVerificationSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
};
