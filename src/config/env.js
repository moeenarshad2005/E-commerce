const path = require("path");
const { z } = require("zod");

require("dotenv").config({ path: path.resolve(process.cwd(), ".env") });

const booleanish = (fallback = "false") =>
  z
    .enum(["true", "false", "1", "0", ""])
    .default(fallback)
    .transform((v) => v === "true" || v === "1");

/**
 * Catches secrets that are long enough to pass the length rule but are clearly
 * still the example value — or are too repetitive to be random.
 */
const PLACEHOLDER_WORDS =
  /replace|change.?me|your.?(secret|key|password)|example|placeholder|s3cret|^secret|xxxx|1234567890/i;

const looksLikePlaceholder = (value) => {
  if (!value) return true;
  if (PLACEHOLDER_WORDS.test(value)) return true;

  // A real 48-byte hex string has ~16 distinct characters. Anything with a
  // handful of unique characters is a pattern somebody typed, not entropy.
  return new Set(value).size < 8;
};

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().int().positive().default(5000),

    API_URL: z.string().url().default("http://localhost:5000"),

    CLIENT_URL: z.string().url().optional(),

    MONGO_URI: z.string().min(1, "MONGO_URI is required."),

    JWT_SECRET: z
      .string()
      .min(32, "JWT_SECRET must be at least 32 characters."),
    JWT_EXPIRES_IN: z.string().default("7d"),

    REQUIRE_EMAIL_VERIFICATION: booleanish(),
    EMAIL_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(60),

    // Shorter than the verification window on purpose: a reset link is a
    // temporary master key to an account, so it should be usable for minutes
    // rather than an hour.
    PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().positive().default(15),

    SMTP_HOST: z.string().optional().default(""),
    SMTP_PORT: z.coerce.number().int().positive().default(587),
    SMTP_SECURE: booleanish(),
    SMTP_USER: z.string().optional().default(""),
    SMTP_PASS: z.string().optional().default(""),
    MAIL_FROM: z.string().default("E-Commerce <no-reply@example.com>"),

    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
    RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),

    // Ceiling for ALL API traffic from one address, so the public catalogue
    // cannot be hammered. Generous, because a single page view legitimately
    // makes several requests.
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),

    ADMIN_ENABLED: booleanish("true"),
    ADMIN_ROOT_PATH: z
      .string()
      .startsWith("/", "ADMIN_ROOT_PATH must start with a slash.")
      .default("/admin"),
    ADMIN_BRAND_NAME: z.string().default("Admin"),

    ADMIN_COOKIE_SECRET: z
      .string()
      .min(32, "ADMIN_COOKIE_SECRET must be at least 32 characters."),

    ADMIN_EMAIL: z.string().optional().default(""),
    ADMIN_PASSWORD: z.string().optional().default(""),

    // ---------- Stripe ----------
    //
    // Optional. Left empty, every Stripe call becomes a no-op and the rest of
    // the API is unaffected — so a missing key never breaks registration.
    //
    // This is a SERVER-ONLY secret. It must never reach a browser: anyone
    // holding it can read your customers, refund charges, and move money. The
    // browser gets the publishable key (pk_...), which is not stored here
    // because nothing on the server needs it.
    STRIPE_SECRET_KEY: z
      .string()
      .optional()
      .default("")
      .refine((v) => v === "" || v.startsWith("sk_"), {
        message:
          "STRIPE_SECRET_KEY must start with 'sk_'. A pk_ key is the publishable one and belongs in the frontend.",
      }),

    /**
     * Signs the webhook payloads Stripe sends you.
     *
     * WITHOUT THIS THE WEBHOOK IS AN OPEN ENDPOINT. Anyone who knows the URL
     * could POST a fabricated `payment_intent.succeeded` and mark any order
     * paid without paying. The secret is what proves the request came from
     * Stripe, so the handler refuses to run at all when it is empty.
     *
     * It is NOT the API key. It comes from the webhook endpoint's own page in
     * the dashboard, or from `stripe listen` while developing.
     */
    STRIPE_WEBHOOK_SECRET: z
      .string()
      .optional()
      .default("")
      .refine((v) => v === "" || v.startsWith("whsec_"), {
        message:
          "STRIPE_WEBHOOK_SECRET must start with 'whsec_'. It is the webhook signing secret, not the API key.",
      }),

    /**
     * ISO 4217, lowercase, as Stripe expects it.
     *
     * One currency for the whole store. Multi-currency is not a config value —
     * it is a per-product price list and an exchange-rate policy, and pretending
     * otherwise here would let someone charge 24999 JPY for a 249.99 USD item.
     */
    CURRENCY: z
      .string()
      .trim()
      .toLowerCase()
      .length(3, "CURRENCY must be a 3-letter ISO code, for example 'usd'.")
      .default("usd"),

    LOG_LEVEL: z.enum(["error", "warn", "info", "silent"]).default("info"),
  })
  /**
   * A Stripe key with no webhook secret is the dangerous half-configuration:
   * payments succeed and nothing ever marks the order paid. Fail the boot in
   * production rather than ship that.
   */
  .refine(
    (env) =>
      env.NODE_ENV !== "production" ||
      !env.STRIPE_SECRET_KEY ||
      Boolean(env.STRIPE_WEBHOOK_SECRET),
    {
      message:
        "STRIPE_SECRET_KEY is set but STRIPE_WEBHOOK_SECRET is empty, so no payment could ever be confirmed.",
      path: ["STRIPE_WEBHOOK_SECRET"],
    }
  )
  .refine((env) => !env.REQUIRE_EMAIL_VERIFICATION || Boolean(env.SMTP_HOST), {
    message:
      "REQUIRE_EMAIL_VERIFICATION is true but SMTP_HOST is empty, so nobody could ever confirm their address.",
    path: ["SMTP_HOST"],
  })
  .refine((env) => env.NODE_ENV !== "production" || Boolean(env.CLIENT_URL), {
    message:
      "CLIENT_URL is required in production so CORS has an origin allowlist.",
    path: ["CLIENT_URL"],
  })
  .refine((env) => env.ADMIN_COOKIE_SECRET !== env.JWT_SECRET, {
    message: "ADMIN_COOKIE_SECRET must be different from JWT_SECRET.",
    path: ["ADMIN_COOKIE_SECRET"],
  })
  /**
   * A length check alone is not enough. "replace-me-with-a-long-random-string"
   * is 36 characters and sails straight through — the placeholder being long
   * is exactly what makes it dangerous.
   *
   * Production only. A memorable secret is harmless on a laptop, and failing
   * local boots over it just teaches people to work around the check.
   */
  .refine(
    (env) =>
      env.NODE_ENV !== "production" || !looksLikePlaceholder(env.JWT_SECRET),
    {
      message:
        "JWT_SECRET looks like a placeholder. Generate a real one with: node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\"",
      path: ["JWT_SECRET"],
    }
  )
  .refine(
    (env) =>
      env.NODE_ENV !== "production" ||
      !looksLikePlaceholder(env.ADMIN_COOKIE_SECRET),
    {
      message:
        "ADMIN_COOKIE_SECRET looks like a placeholder. Generate a real one with: node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\"",
      path: ["ADMIN_COOKIE_SECRET"],
    }
  )
  .refine(
    (env) => !env.ADMIN_PASSWORD || env.ADMIN_PASSWORD.length >= 12,
    {
      message: "ADMIN_PASSWORD must be at least 12 characters if it is set.",
      path: ["ADMIN_PASSWORD"],
    }
  )
  .refine(
    (env) => Boolean(env.ADMIN_EMAIL) === Boolean(env.ADMIN_PASSWORD),
    {
      message: "Set both ADMIN_EMAIL and ADMIN_PASSWORD, or neither.",
      path: ["ADMIN_EMAIL"],
    }
  );

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("\n");

  console.error(`Invalid environment configuration:\n${details}\n`);
  console.error("Copy .env.example to .env and fill in the missing values.");
  process.exit(1);
}

const env = Object.freeze({
  ...parsed.data,
  isProduction: parsed.data.NODE_ENV === "production",
  isTest: parsed.data.NODE_ENV === "test",
});

module.exports = env;
