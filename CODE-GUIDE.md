# The whole project, file by file, with code

54 JavaScript files, ~7,500 lines. Every one is here: what it does, the code that
matters, and why it is written that way.

Read the two sections below first — they are the spine everything else hangs
off.

---

## The one rule

> **The customer's browser never decides what anything costs, and an order is
> paid only when Stripe says so.**

Almost every design decision in this codebase traces back to that sentence. When
a file looks over-careful, that is usually why.

## The path of one request

```
server.js          connect DB → mount admin panel → listen
  app.js           helmet → CORS → WEBHOOK (raw) → JSON parser → rate limit
    routes/        match the URL
      middleware/auth.middleware      who are you?
      middleware/validate.middleware  is this input the right shape?
        controllers/                  HTTP concerns
          services/                   business logic with >1 caller
            models/                   schema, hooks, indexes
              MongoDB
  middleware/error.middleware         anything thrown lands here
```

## The complete checkout flow

```
1  POST /cart/items              add a product + colour + size
2  POST /payment/create-intent   validate address → re-price cart from DB
                                 → create Order (UNPAID) → create PaymentIntent
3  browser confirms the card directly with Stripe
4  POST /webhooks/stripe         Stripe → verify signature
                                 → mark paid → decrement stock → clear cart
5  GET  /orders                  the customer sees their order
```

Step 4 is the only thing that can mark an order paid. Not the browser, not an
admin, not any route.

---

# 1 · Entry point

## `src/server.js`

Starts the process. Three things, in an order that matters.

```js
const start = async () => {
  await connectDB();                    // models need a connection
  await mountAdmin(app.adminRouter);    // AdminJS builds resources from models
  server = app.listen(env.PORT, ...);   // only NOW can a request arrive
};
```

The listener opens **last** so no request can hit a half-initialised app.
`mountAdmin` is awaited because AdminJS v7 is ESM-only and has to be loaded with
`await import()`.

Shutdown drains properly:

```js
const shutdown = async (signal) => {
  server.close(async () => {     // stop accepting, let in-flight requests finish
    await disconnectDB();        // only then drop the database handle
    process.exit(0);
  });

  const force = setTimeout(() => process.exit(1), 10000);
  force.unref();                 // ← the line that makes this work
};
```

`force.unref()` tells Node "this timer should not keep the process alive". Without
it the timer itself holds the event loop open for the full ten seconds, so every
clean shutdown becomes a ten-second stall.

`unhandledRejection` takes the graceful path; `uncaughtException` exits
immediately, because after an uncaught throw the process state is untrustworthy.

---

## `src/app.js`

Builds the Express app. **The order of these lines is the file's meaning.**

**Split Helmet** — AdminJS ships a bundled React UI that a strict
Content-Security-Policy breaks. Rather than weakening CSP everywhere, it is
disabled only under the admin path:

```js
app.use((req, res, next) =>
  req.path.startsWith(env.ADMIN_ROOT_PATH)
    ? helmetNoCsp(req, res, next)
    : helmetStrict(req, res, next));
```

**CORS** allowlists `CLIENT_URL`. A blocked origin is rejected with an `AppError`,
not a plain `Error` — a plain one falls through to the "unknown error" branch and
a routine refusal gets logged as a 500.

**The webhook, mounted before the JSON parser.** The single most
position-sensitive line in the project:

```js
app.use("/api/v1/webhooks", webhookRoutes);   // ← express.raw() inside

app.use(express.json({ limit: JSON_BODY_LIMIT }));
```

Stripe signs the exact bytes of the request body. Once `express.json()` has
consumed the stream those bytes are gone, and re-serialising the object produces
different ones — different key order, different whitespace. Move this line below
the parser and **every genuine payment notification fails signature
verification**. The failure is silent: checkout still works, money is still
taken, and no order is ever marked paid.

**Static uploads** import both the directory and the URL prefix from
`upload.middleware.js`, so the write path and the read path cannot drift. A
comment records the bug that motivated it: two mounts once pointed at neither
directory multer wrote to, and every uploaded image 404'd forever.

**Rate limiting** sits after the request logger (so a throttled request is still
recorded) and after the static mount (so images never count against a quota).

**Health check** returns 503, not 200-with-a-flag, when the database is down —
which is what makes it usable as a load-balancer probe.

Route mounts, in order:

```js
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/users", userRoutes);
app.use("/api/v1/categories", categoryRoutes);
app.use("/api/v1/products", productRoutes);
app.use("/api/v1/cart", cartRoutes);
app.use("/api/v1/payment", paymentRoutes);
app.use("/api/v1/orders", orderRoutes);
```

Then `notFound`, then `errorHandler` — last, because Express only routes errors
to middleware registered after everything else.

---

# 2 · Configuration — `src/config/`

## `src/config/env.js`

Every environment variable passes a Zod schema **at boot**. Misconfiguration kills
the process with a list of exactly what is wrong, rather than surfacing as a
mystery 500 an hour later.

**`booleanish`** — env vars are always strings:

```js
const booleanish = (fallback = "false") =>
  z.enum(["true", "false", "1", "0", ""])
    .default(fallback)
    .transform((v) => v === "true" || v === "1");
```

The obvious `z.coerce.boolean()` is wrong here: `Boolean("false")` is `true`.

**Placeholder detection**, production only, two-pronged:

```js
const PLACEHOLDER_WORDS =
  /replace|change.?me|your.?(secret|key|password)|example|placeholder|s3cret|^secret|xxxx|1234567890/i;

const looksLikePlaceholder = (value) => {
  if (!value) return true;
  if (PLACEHOLDER_WORDS.test(value)) return true;

  // A real 48-byte hex string has ~16 distinct characters. A handful of unique
  // characters is a pattern somebody typed, not entropy.
  return new Set(value).size < 8;
};
```

It exists because `replace-me-with-a-long-random-string` is 36 characters and
sails past a length check — the placeholder *being long* is what makes it
dangerous. Production-only, because failing local boots over it just teaches
people to work around the check.

**Stripe keys are shape-checked:**

```js
STRIPE_SECRET_KEY: z.string().optional().default("")
  .refine((v) => v === "" || v.startsWith("sk_"), {
    message: "STRIPE_SECRET_KEY must start with 'sk_'. A pk_ key is the publishable one and belongs in the frontend.",
  }),

STRIPE_WEBHOOK_SECRET: z.string().optional().default("")
  .refine((v) => v === "" || v.startsWith("whsec_"), {
    message: "STRIPE_WEBHOOK_SECRET must start with 'whsec_'. It is the webhook signing secret, not the API key.",
  }),
```

**Cross-field rules**, each closing a specific half-configured state:

| Rule | What it prevents |
|---|---|
| production + `STRIPE_SECRET_KEY` ⇒ `STRIPE_WEBHOOK_SECRET` | Payments succeed and nothing can confirm them |
| `REQUIRE_EMAIL_VERIFICATION` ⇒ `SMTP_HOST` | Nobody could ever confirm their address |
| production ⇒ `CLIENT_URL` | CORS with an empty allowlist |
| `ADMIN_COOKIE_SECRET` ≠ `JWT_SECRET` | Session and API key separation |

Errors print with `console.error`, not the logger — the logger imports `env`, so
at that moment it does not exist yet.

---

## `src/config/db.js`

```js
mongoose.set("strictQuery", true);
mongoose.set("autoIndex", !env.isProduction);

const conn = await mongoose.connect(uri, {
  serverSelectionTimeoutMS: 10000,
  socketTimeoutMS: 45000,
  maxPoolSize: 10,
});

const disconnectDB = () => mongoose.connection.close(false);
```

`strictQuery` makes an unknown query field an error rather than something that
silently matches everything. **`autoIndex` off in production** is why
`npm run db:indexes` exists — building indexes against a large collection is slow
and unpredictable, so it becomes a deliberate deployment step. `close(false)`
means "do not force" — in-flight operations finish.

---

## `src/config/logger.js`

A dependency-free level filter with secret redaction. `LOG_LEVEL=silent` maps to
`-1`, below every real level. Redaction walks nested objects to depth 4 and
replaces `password`, `token`, `authorization`, `smtp_pass`, `pass` with
`[redacted]`.

Note it is **exact-key, not substring** — `accessToken` would not be caught.

---

## `src/config/constants.js`

Frozen enums whose string values are exactly what is stored in MongoDB, so
changing one is a data migration rather than a rename.

```js
const PRODUCT_SIZES = Object.freeze(["XS", "S", "M", "L", "XL", "XXL"]);

const ORDER_STATUS = Object.freeze({
  PENDING: "pending", PAID: "paid", SHIPPED: "shipped",
  DELIVERED: "delivered", CANCELLED: "cancelled",
});

const PAYMENT_STATUS = Object.freeze({
  UNPAID: "unpaid", PAID: "paid", FAILED: "failed",
});
```

**`status` and `paymentStatus` are two separate fields on purpose.** `status` is
where the *order* is in its life; `paymentStatus` is where the *money* is. An
order can be paid but not yet shipped. Collapsing them is what forces the
invention of states like `paid_but_cancelled` six months later.

`MAX_CART_ITEM_QUANTITY = 99` stops `quantity: 999999999` from being priced and
keeps line totals inside safe-integer range. `MAX_CART_LINES = 50` because a cart
is re-priced on every read, so an unbounded one is a self-inflicted slow query.

---

# 3 · Utilities — `src/utils/`

## `src/utils/money.js` — the most important file here

**Money is an integer count of minor units. Never a float. Anywhere.**

```
0.1 + 0.2     → 0.30000000000000004
1999.99 * 3   → 5999.969999999999
```

The customer is billed one figure and the receipt says another, and there is no
bug to find because every individual step was "right".

The cleverest decision in the codebase — `toMinorUnits` **parses digits instead
of multiplying**:

```js
//   Math.round(1.005 * 100)   → 100   (1.005 is really 1.00499999999999989)
//   toMinorUnits("1.005")     → null  (three decimals: rejected, not guessed)

const [whole, fraction = ""] = String(value).split(".");
if (fraction.length > 2) return null;
return Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
```

`"5.1"` becomes 510, not 51. Every failure returns `null`, documented as "reject
this input" — never `0`, so a caller can never mistake a failure for "free".

```js
const roundToMinorUnits = ...   // lenient sibling, used ONLY by the migration
const toMajorUnits = ...        // display only — never sum or compare these
const isValidMinorUnits = ...   // wired into the Mongoose validators
```

`isValidMinorUnits` being in the model validators is what stops a non-integer
amount reaching the database from **any** writer — controller, AdminJS, or script.

---

## `src/utils/tokens.js`

```js
const createHashedToken = (bytes = 32) => {
  const raw = crypto.randomBytes(bytes).toString("hex");
  return { raw, hashed: hashToken(raw) };
};

const hashToken = (token) =>
  crypto.createHash("sha256").update(String(token)).digest("hex");
```

**The raw/hashed split is the whole point.** `raw` goes in the email; `hashed`
goes in the database. If the database leaks, the stored digests cannot be turned
back into working reset links.

Plain SHA-256 rather than bcrypt is *correct* here. Slow hashing defends
low-entropy human-chosen secrets against brute force; a 256-bit random token has
no brute-force surface, and this hash runs on every lookup so it must be fast.

---

## `src/utils/generateToken.js`

```js
const generateToken = (userId) =>
  jwt.sign({ sub: String(userId) }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
    issuer: "e-commerce-api",
  });
```

**`sub` is the only claim.** No role, no email. That means privilege and account
status are re-read from the database on every request, so a ban or a demotion
takes effect immediately instead of waiting for the token to expire.

---

## `src/utils/catchAsync.js`

```js
const catchAsync = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);
```

Five lines that matter. Express 4 does not await handlers, so a `throw` inside an
`async` function becomes an unhandled rejection and the request hangs until it
times out. This converts it into `next(err)`.

---

## `src/utils/apiResponse.js`

```js
const sendSuccess = (res, { status = 200, message, data } = {}) =>
  res.status(status).json({
    success: true,
    ...(message ? { message } : {}),
    ...(data !== undefined ? { data } : {}),
  });
```

The two conditions differ deliberately: `message` uses truthiness, `data` uses
`!== undefined`, so a legitimately falsy payload — `0`, `false`, `[]` — is still
included.

---

## `src/utils/AppError.js`

An operational error carrying `statusCode`, a machine-readable `code`, optional
`details`, and `isOperational = true`. That flag separates "a condition we chose
to signal" from a genuine bug, which is what lets the error handler log the first
at `warn` and the second at `error` with a stack.

`Error.captureStackTrace(this, this.constructor)` removes the constructor frame,
so the trace starts at the controller line that threw.

Factories: `badRequest` (400), `unauthorized` (401), `forbidden` (403),
`notFound` (404), `conflict` (409), `tooManyRequests` (429). Only `badRequest`
forwards `details` — auth failures deliberately cannot leak specifics.

---

## `src/utils/email.js`

Lazily-configured nodemailer plus the two transactional templates. The cache uses
`undefined` vs `null` as distinct states: `undefined` means "not decided yet",
`null` means "decided: no SMTP configured", so the branch is evaluated once.

When SMTP is absent, `sendMail` **logs the message and returns
`{ delivered: false }` instead of throwing** — which is what lets registration
work on a laptop with no mail server. Safe, because `env.js` hard-fails if
`REQUIRE_EMAIL_VERIFICATION` is on without `SMTP_HOST`.
---

# 4 · Models — `src/models/`

## `src/models/user.model.js`

Credentials, role, verification and reset state, Stripe linkage, account status.

**Eight fields are `select: false`** — `password`, three `emailVerification*`,
two `passwordReset*`, `passwordChangedAt`, and `stripeCustomerId`. They are
additionally stripped by a transform registered on **both** serialisation paths:

```js
const stripSensitive = (doc, ret) => {
  delete ret.password;
  delete ret.emailVerificationToken;
  /* …every token and expiry… */
  delete ret.stripeCustomerId;
  delete ret.__v;
  return ret;
};

userSchema.set("toJSON",   { transform: stripSensitive });
userSchema.set("toObject", { transform: stripSensitive });
```

The `toObject` half matters: it is an independent path used by plugins and
adapters — including AdminJS — and previously had no protection, so it returned
the bcrypt hash and every live token.

**The password hook, and the one-second backdate:**

```js
userSchema.pre("save", async function hashPassword(next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, BCRYPT_ROUNDS);

  if (!this.isNew) this.passwordChangedAt = new Date(Date.now() - 1000);
  return next();
});
```

Not on a new document, because a fresh account has no earlier tokens to
invalidate and stamping it would reject the token issued at signup. Backdated one
second because JWT `iat` has only second precision — without the offset a
just-issued token can look *older* than the change and be rejected immediately,
logging the user out of the session they just created.

**Indexes use `partialFilterExpression`, not `sparse`:**

```js
userSchema.index(
  { stripeCustomerId: 1 },
  { unique: true, partialFilterExpression: { stripeCustomerId: { $type: "string" } } }
);
```

A sparse index skips only *absent* fields, but these carry `default: null`, so
they are present on every user and a sparse index would contain the whole
collection. Filtering on `$type: "string"` indexes only the rows that matter.
Unique, because two users pointing at one Stripe customer would mean billing one
person for another's order.

---

## `src/models/product.model.js`

**Stored money:** `priceCents`, `discountPriceCents` — integers, minor units.

**Virtual money (never in MongoDB):** `finalPriceCents`, `price`,
`discountPrice`, `finalPrice`, plus `inStock`.

The rename from a float `price` was deliberate:

> A rename makes the two impossible to confuse: any code still reading
> `product.price` as a stored number gets `undefined` and fails loudly, instead
> of silently pricing everything at 1% of its value.

```js
productSchema.virtual("finalPriceCents").get(function () {
  return this.discountPriceCents ?? this.priceCents;
});
```

`finalPriceCents` is documented as **the** authoritative amount — cart, order and
Stripe code read it and nothing else, because re-deriving that expression in four
places is how one of them eventually forgets the discount and undercharges.

**Colours and sizes — and why they are modelled differently:**

```js
colors: {
  type: [String],
  default: [],
  validate: { validator: (v) => v.length <= 20, message: "…" },
},

sizes: {
  type: [String],
  default: [],
  enum: { values: PRODUCT_SIZES, message: `Size must be one of: …` },
},
```

Colours are free text because "Midnight Blue" and "Sage Green" are marketing
names that change every season, and an enum would mean a code change to add one.
Sizes are an enum because the ladder genuinely is fixed, and a typo like `"Med"`
would otherwise become a size no dropdown will ever offer.

**Both may be empty, and that is the normal case** for anything that is not
clothing. A phone has no size.

**Three hooks:**

1. `pre("validate")` **slug generation** — `slugify`, then a collision loop
   producing `nike-air-max`, `nike-air-max-2`, `nike-air-max-3`. It deliberately
   does *not* re-slug on rename: a slug is a public URL, and silently changing it
   breaks existing links.

2. `pre("validate")` **discount below price** — document-level, not field-level.
   Mongoose runs a field validator only when *that* field is modified, so
   lowering `price` while leaving `discountPrice` alone used to save happily and
   leave the product advertising a saving above its own price. Uses `>=`, since a
   "discount" equal to the price is not a discount.

3. `pre("save")` **thumbnail** — fills from `images[0]` only when empty, so
   AdminJS and scripts get one too. An explicit thumbnail is never overwritten.

**Indexes** come from what the listing query actually runs:

```js
productSchema.index({ name: "text", brand: "text", tags: "text", … },
                    { weights: { name: 10, brand: 6, tags: 5, shortDescription: 2, description: 1 } });

productSchema.index({ status: 1, category: 1, priceCents: 1 });
productSchema.index({ status: 1, createdAt: -1 });
```

Declared on `priceCents`, not `price`, because an index on a virtual would be
built over a field absent from every document. `{ status: 1 }` alone was
**removed** — it is a strict prefix of three compound indexes, so it can never be
chosen over them and only costs writes.

---

## `src/models/cart.model.js`

```js
Cart {
  user,                                         // unique
  items: [{ product, color, size, quantity, addedAt }]
}
```

**No price. No line total. No subtotal. The omission is the design.**

> A cart that remembers the price it saw at "add to cart" time is a cart that
> charges yesterday's price. It is also a place a client can write a number into:
> any endpoint that accepts a price from the browser is one request away from a
> ₨1 laptop.

Colour and size *are* stored, because those are the customer's choices — the
server cannot re-derive them, and they do not go stale.

`user` is unique so two concurrent "add to cart" clicks cannot create two carts;
from then on every read would return whichever `findOne` reached first, and items
would appear to vanish.

**A cart line is identified by the triple, not the product:**

```js
cartSchema.pre("validate", function rejectDuplicateVariants(next) {
  const seen = new Set();
  for (const item of this.items || []) {
    const key = `${item.product}|${item.color || ""}|${item.size || ""}`;
    if (seen.has(key)) {
      this.invalidate("items", "The same product, colour and size appears twice…");
      return next();
    }
    seen.add(key);
  }
  return next();
});
```

A black M and a white L of one shirt are two legitimate lines. Asserted at the
model layer because AdminJS and scripts write here too, and a duplicated line
double-charges at checkout while showing the customer one row.

---

## `src/models/order.model.js`

The immutable financial record.

**Every line is a snapshot:**

```js
const orderItemSchema = new mongoose.Schema({
  product: { type: ObjectId, ref: "Product", required: true },

  name: { type: String, required: true },     // ← copied, not populated
  sku:  { type: String, default: "" },
  color:{ type: String, default: "" },
  size: { type: String, default: "" },

  quantity: { type: Number, required: true, min: 1 },
  unitPriceCents: { type: Number, required: true, validate: isValidMinorUnits },
  subtotalCents:  { type: Number, required: true, validate: isValidMinorUnits },
}, { _id: false });
```

> An order that renders itself by populating the product shows "Unknown product"
> the moment that product is deleted — and shows the WRONG PRICE the moment it is
> repriced, which is a legal problem rather than a cosmetic one.

`subtotalCents` is stored despite being derivable. Normally deriving beats
storing, but this is a financial record: if the multiplication rule ever changes,
past orders must still read back exactly as charged.

**The shipping address is a snapshot too** — if the customer later moves house,
the order must still say where it was actually sent.

**The two fields that make the webhook safe:**

```js
stripePaymentIntentId: { type: String, required: true, unique: true },
stockCommitted:        { type: Boolean, default: false },
```

`stripePaymentIntentId` being **unique** is the idempotency key for the whole
fulfilment step — a duplicate delivery cannot produce a second order for one
payment. `stockCommitted` is a stored flag rather than an inference from
`paymentStatus`, because Stripe can deliver the same event twice and "is this
already paid?" gets answered a fraction of a second before the second delivery
asks it.

**`paymentStatus` has no writer anywhere except the webhook.** No route, no
validator, no admin field can set it.

**The arithmetic is re-checked on every write:**

```js
orderSchema.pre("validate", function verifyTotals(next) {
  let expected = 0;
  for (const item of this.items || []) {
    if (item.unitPriceCents * item.quantity !== item.subtotalCents) {
      this.invalidate("items", `Line total for ${item.name} does not match…`);
      return next();
    }
    expected += item.subtotalCents;
  }
  if (expected !== this.totalCents) {
    this.invalidate("totalCents", `Total ${this.totalCents} does not match…`);
  }
  return next();
});
```

The server computed these already, so this can only fail if a future change
introduces a bug. It is the last line of defence for the one thing that must
never be wrong.

---

## `src/models/category.model.js`

Name, slug, description, image, `isActive`, and author references. Notably `slug`
is **required with no auto-generation**, unlike Product.

---

# 5 · Middleware — `src/middleware/`

## `src/middleware/auth.middleware.js`

**`protect`** — the real gate:

```js
const decoded = jwt.verify(token, env.JWT_SECRET, {
  algorithms: ["HS256"],          // the token cannot choose how it is checked
  issuer: "e-commerce-api",
});

if (!mongoose.isValidObjectId(decoded.sub)) throw AppError.unauthorized("Invalid token.");

const user = await User.findById(decoded.sub).select("+passwordChangedAt");
if (!user) throw AppError.unauthorized("Not authorized, this account no longer exists.");

if (user.changedPasswordAfter(decoded.iat))
  throw AppError.unauthorized("Your password was changed. Please log in again.");

if (user.accountStatus !== ACCOUNT_STATUS.ACTIVE)
  throw AppError.forbidden("This account is not active.");

req.user = user;
```

The **database lookup is deliberate** rather than trusting the token: a suspended,
banned or deleted user must lose access on their very next request.

There is no `try`/`catch` around `jwt.verify` on purpose — the global handler maps
`JsonWebTokenError` and `TokenExpiredError` to 401, and wrapping it would also
swallow database failures and report an outage as "invalid token".

**`attachUserIfPresent`** — optional auth for the public-but-role-aware
catalogue. It repeats *every* condition `protect` enforces, so a suspended user is
treated as anonymous rather than quietly keeping admin visibility. Its own comment
is the warning: *it cannot fail, so it grants nothing. Never use it to protect
anything.*

**`restrictTo(...roles)`** reads the role from the freshly-loaded document, never
the token. Its no-user branch returns **401, not 403**, because reaching it means
`protect` was left off the route.

---

## `src/middleware/validate.middleware.js`

```js
const validate = (schemas) => (req, res, next) => {
  const issues = [];

  for (const key of ["body", "query", "params"]) {
    const schema = schemas[key];
    if (!schema) continue;

    const result = schema.safeParse(req[key] ?? {});
    if (!result.success) {
      issues.push(...result.error.issues.map((i) => ({
        field: [key, ...i.path].join("."),
        message: i.message,
      })));
      continue;                            // ← collect, do not stop
    }

    if (key === "query") {
      Object.keys(req.query).forEach((k) => delete req.query[k]);
      Object.assign(req.query, result.data);
    } else {
      req[key] = result.data;
    }
  }

  if (issues.length) return next(AppError.badRequest("Validation failed.", …, issues));
  return next();
};
```

Two details. It **aggregates** rather than short-circuits, so one response reports
problems in body, query and params at once, namespaced `body.price`, `params.id`.
And the parsed output *replaces* the input — that is how `.strict()`,
`.default()` and `.transform()` effects reach the controller. `query` is mutated
in place rather than reassigned, because on newer Express versions `req.query` is
a getter.

---

## `src/middleware/error.middleware.js`

`normalise(err)` converts every foreign error shape into an `AppError`, checked in
a strict order: `AppError` → Mongoose `ValidationError` → `CastError` →
`MulterError` → duplicate key (11000) → Stripe → JWT → body-parser.

```js
if (typeof err.type === "string" && err.type.startsWith("Stripe")) {
  if (err.type === "StripeCardError")
    return new AppError(402, "That card was declined.", "PAYMENT_FAILED");

  if (err.type === "StripeInvalidRequestError")
    return new AppError(500, "Something went wrong on our end.", ERROR_CODES.INTERNAL);

  return new AppError(503, "Payments are temporarily unavailable…", "PAYMENT_UNAVAILABLE");
}
```

**The Stripe message is never forwarded** — it can contain API-key fragments and
internal request ids. Only the logs get the detail.

The 402/500 split is the interesting one: a declined card is the customer's
problem and retryable; *your* malformed request to Stripe is your bug and must
show up as a server fault in monitoring rather than hiding among 4xx noise.

Errors ≥500 log with a stack; 4xx log at `warn` with the URL only.

---

## `src/middleware/rateLimit.middleware.js`

| Limiter | Window | Limit | Note |
|---|---|---|---|
| `globalLimiter` | env | 300 | Skips the admin panel and `/uploads` |
| `authLimiter` | env | 10 | `skipSuccessfulRequests` — only failures count |
| `registerLimiter` | 1 h | 10 | Counts successes too |
| `emailLimiter` | 1 h | 5 | Strictest |

`registerLimiter` counts successes deliberately: each success creates an account
**and sends an email**, so skipping them would allow unlimited outbound mail and
could get the sending account flagged. The admin panel is skipped because one
AdminJS page legitimately fires many requests.

---

## `src/middleware/upload.middleware.js`

Owns the directory, the filename, the mimetype whitelist, the limits and the URL
builder — one file, so nothing can drift.

```js
const EXTENSION_BY_MIME = {
  "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp",
};

const filename = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${EXTENSION_BY_MIME[file.mimetype]}`;
```

**The extension comes from the sniffed mimetype, never the filename.**
`path.extname("a.png .js")` yields `.js`, and `express.static` would then serve it
as JavaScript. Filenames are random rather than sequential because two uploads in
the same millisecond would collide and silently overwrite.

Paths resolve from `__dirname`, not `process.cwd()`, because a relative path moved
the upload directory depending on where `npm start` ran. Rejections use
`AppError`, not a plain `Error` — a plain one is unrecognised and becomes a 500
with the reason discarded.
---

# 6 · Validators — `src/validators/`

These are the trust boundary. Every schema is `.strict()`, so an unexpected field
is a **400 naming it** rather than a silent drop — a smuggled `"price": 1` shows
up in your logs instead of passing quietly.

## `src/validators/product.validator.js` — the money boundary

The create route is **multipart**, so multer delivers every field as a string
(`"24999"`, never `24999`). A plain `z.number()` would reject every real request.

```js
const money = (label) =>
  z.union([z.string(), z.number()]).superRefine? ... :
  z.any().transform((value, ctx) => {
    const minor = toMinorUnits(value);
    if (minor === null) {
      ctx.addIssue({ code: "custom", message: `${label} must be a valid amount…` });
      return z.NEVER;
    }
    return minor;
  });
```

`z.coerce.number()` is **deliberately not used** — it would turn `"249.999"` into
a float and lose the third decimal before anyone could object, and it accepts
`"Infinity"` and `"1e9"`, both of which poison every total they touch.

> Convert here and nowhere else: two conversion sites is how an amount eventually
> gets multiplied by 100 twice.

**Then a two-step: refine, then rename.**

```js
.refine(discountBelowPrice, DISCOUNT_MESSAGE)   // runs FIRST, on client names
.transform(toStoredMoney)                        // price → priceCents
```

Order matters: the discount check runs while the values still carry the names the
client sent, so the error says `discountPrice`, not `discountPriceCents`.

**Colours are deduplicated case-insensitively; sizes are sorted into ladder
order:**

```js
const colors = listOf(z.string().trim().min(1).max(40))
  .pipe(z.array(z.string()).max(20))
  .transform((list) => { /* drop case-insensitive duplicates */ });

const sizes = listOf(z.string().trim().toUpperCase())
  .pipe(z.array(z.enum(PRODUCT_SIZES)))
  .transform((list) => [...new Set(list)]
    .sort((a, b) => PRODUCT_SIZES.indexOf(a) - PRODUCT_SIZES.indexOf(b)));
```

So a product entered as "L, S, M" displays as "S, M, L", and "Black" plus "black"
becomes one colour rather than two identical dropdown entries — and, worse, two
separate cart lines.

`listOf` exists because a multipart form sends `colors=A&colors=B` as an array
but a single `colors=A` as a bare string.

The **query** filters `minPrice`/`maxPrice` go through the same converter, so a
storefront slider sending `250` filters correctly against stored minor units.
Without it, `?maxPrice=500` would match nothing. `sort` is a whitelist so nobody
can sort by an unindexed field; `limit` is capped at 100.

---

## `src/validators/cart.validator.js`

```js
const addCartItemSchema = {
  body: z.object({
    productId: objectId,
    quantity: quantity.default(1),
    color,
    size,
  }).strict(),
};
```

**There is no `price` field anywhere, and the absence is the point.** The client
says *which* product, *how many*, and *which variant*; the server decides what it
costs.

`.int()` is chained before `.min()` so `"1.5"` is reported as "must be a whole
number" rather than passing a fractional quantity into an integer multiplication.
`size` is uppercased so "m" and "M" are one size, not two lines.

Whether a colour is *acceptable* is not decided here — the schema cannot know
which colours a given product offers. That check lives in the controller.

---

## `src/validators/order.validator.js`

```js
const shippingAddressSchema = z.object({
  fullName:   z.string().trim().min(2).max(80),
  phone:      z.string().trim().min(7).max(20)
                .regex(/^[\d+\-() ]+$/, "…only digits, spaces and + - ( )."),
  address:    z.string().trim().min(5).max(200),
  city:       z.string().trim().min(2).max(80),
  postalCode: z.string().trim().max(20).optional().default(""),
  country:    z.string().trim().min(2).max(60),
}).strict();
```

Six fields — what a parcel actually needs. The phone rule is deliberately loose:
formats vary enormously by country and a strict pattern rejects more valid numbers
than invalid ones. `postalCode` is the only optional field, because plenty of
addresses in Pakistan and elsewhere do not have a meaningful one.

---

## `src/validators/payment.validator.js` — the strictest schema in the project

```js
const createIntentSchema = {
  body: z.object({
    shippingAddress: shippingAddressSchema,
  }).strict(),
};
```

An address and **nothing else**. Everything the payment needs — who is paying,
what is in their cart, what it costs — is already known to the server.
`{"amountCents": 1}` is answered:

```json
400 { "success": false, "message": "Validation failed.",
      "errors": [{ "field": "body", "message": "Unrecognized key: \"amountCents\"" }] }
```

Both outcomes are safe; only one shows up in the logs when somebody starts
probing.

---

## `src/validators/user.validator.js` · `auth.validator.js` · `category.validator.js`

`user.validator.js` is interesting for what it **omits**: no `role`, no
`accountStatus`, no `isEmailVerified`, no `stripeCustomerId`, no `password`, no
`email`. Combined with `.strict()`, a privilege-escalation attempt is a 400
naming the field rather than a silent no-op.

`auth.validator.js` covers register, login, verify (`params.token`), resend,
forgot, reset and change-password. `category.validator.js` escapes the search
term before it reaches `$regex`.

---

# 7 · Routes — `src/routes/`

Each file reads left to right as the pipeline the request goes through.

## `src/routes/auth.routes.js`

```js
router.post("/register", registerLimiter, validate(schemas.registerSchema), register);
router.post("/login",    authLimiter,     validate(schemas.loginSchema),    login);
router.get("/verify-email/:token", validate(schemas.verifyEmailSchema), verifyEmail);
router.post("/resend-verification", emailLimiter, …);
router.post("/forgot-password",     emailLimiter, …);
router.post("/reset-password",      authLimiter,  …);
router.get("/me",        protect, getMe);
router.patch("/password", protect, validate(schemas.changePasswordSchema), changePassword);
```

The token is a **path parameter**, not a query string — a path segment keeps the
secret out of `Referer` headers and most access-log formats.

## `src/routes/cart.routes.js`

```js
router.use(protect);          // ← the whole router, not per route

router.route("/").get(getCart).delete(clearCart);
router.post("/items", validate(addCartItemSchema), addCartItem);
router.route("/items/:productId")
  .patch(validate(updateCartItemSchema), updateCartItem)
  .put(validate(updateCartItemSchema), updateCartItem)
  .delete(validate(cartItemParamSchema), removeCartItem);
```

`protect` goes on the **router**: listing it five times is five chances to forget
it once, and the one you forget is a cart readable by anyone. There is no admin
route here — a cart is identified solely by `req.user._id`.

## `src/routes/product.routes.js`

```js
router.post("/",
  protect, restrictTo(ROLES.ADMIN),
  uploadProductImages,                       // ← BEFORE validate
  validate(createProductSchema),
  createProduct);
```

The order is load-bearing: multer is what parses `multipart/form-data` and fills
`req.body`. Swap them and every product creation fails on an empty body.

## `src/routes/order.routes.js`

```js
router.use(protect);
router.get("/",    validate(listOrdersSchema), getMyOrders);
router.get("/:id", validate(orderIdSchema),    getOrderById);
```

**Read-only.** No POST, PATCH or DELETE — a customer must not be able to invent an
order, reprice one, or mark one paid.

## `src/routes/webhook.routes.js`

```js
router.post("/stripe", express.raw({ type: "application/json" }), stripeWebhook);
```

The route declares its own parser, so the raw-body requirement travels with the
route rather than depending on someone remembering the mount order in `app.js`.

---

# 8 · Controllers — `src/controllers/`

## `src/controllers/auth.controller.js`

**Login is timing-equalised:**

```js
const user = await User.findOne({ email }).select("+password");

if (!user) {
  await bcrypt.compare(password, DUMMY_HASH);      // ← same work either way
  throw AppError.unauthorized("Invalid credentials.", ERROR_CODES.INVALID_CREDENTIALS);
}

if (!(await user.comparePassword(password)))
  throw AppError.unauthorized("Invalid credentials.", ERROR_CODES.INVALID_CREDENTIALS);
```

Without the dummy compare, a missing account returns after one indexed lookup
(~2 ms) while a real one pays ~300 ms of bcrypt. That gap is measurable over the
network and is a working user-enumeration oracle. Both branches return the
identical message and code.

**Check order is load-bearing:** account status and email verification are
evaluated only *after* the password is proven correct. If they ran first, an
attacker with only an email address could learn "this account exists and is
suspended".

Registration awaits the verification email but fires Stripe customer creation
**in the background** — registration has already committed, and a Stripe outage
must not turn a created account into a 500.

## `src/controllers/emailVerification.controller.js`

```js
const user = await User.findOne({
  emailVerificationToken: hashToken(token),
  emailVerificationExpires: { $gt: new Date() },     // ← expiry IN the query
});
```

Enforcing the expiry in the query means an expired token simply matches no
document — there is no branch that could fall through.

**The cooldown answers 200, not 429.** The sharpest decision in the file:

> A 429 proved the address was registered AND unconfirmed — handing an attacker
> precisely the fact the generic message exists to hide.

And the send is deliberately **not awaited**, because sending mail takes far
longer than any other branch, so waiting on it makes a slow response mean "this
address is registered and unconfirmed" — the same leak by a different route.

## `src/controllers/password.controller.js`

Reset TTL is **15 minutes**, a quarter of the verification window, because a reset
link is a temporary master key to an account. `deliverResetEmail` clears the
stored token if sending fails, because a reset token nobody can use is worse than
none — it would block the next attempt. Completing a reset sets
`isEmailVerified = true`: it proves control of the mailbox, which is exactly what
verification tests.

## `src/controllers/product.controller.js`

**Status visibility, three branches:**

| Caller | Filter |
|---|---|
| Admin | `status \|\| { $ne: ARCHIVED }` |
| Shopper asking for a non-active status | `{ $in: [] }` — an honest empty page |
| Everyone else | `status: ACTIVE` |

An equality match, not `$ne`, so the compound index is usable. A comment records
the prior bug: the old default `{ $ne: "archived" }` **included drafts**.

**The sort mapping:**

```js
const SORT_FIELDS = Object.freeze({ price: "priceCents", "-price": "-priceCents" });
```

`price` is a virtual, and **MongoDB cannot sort on virtuals** — `.sort("price")`
against a schema with no `price` path is answered without error, every document
ties, and "cheapest first" comes back in arbitrary order. Silent, and the kind of
thing nobody notices until a customer does.

A hidden product returns **404, not 403** — a 403 confirms an unreleased product
exists to anyone guessing ids.

## `src/controllers/cart.controller.js`

The distinctive part is variant validation:

```js
const resolveOption = (available, chosen, label, productName) => {
  const options = Array.isArray(available) ? available : [];

  if (!options.length) {
    if (chosen) throw AppError.badRequest(`${productName} does not come in different ${label}s.`);
    return "";                                    // product has no such option
  }

  if (!chosen)
    throw AppError.badRequest(`Choose a ${label} for ${productName}. Available: ${options.join(", ")}.`);

  const match = options.find((o) => String(o).toLowerCase() === String(chosen).toLowerCase());
  if (!match)
    throw AppError.badRequest(`${productName} is not available in ${label} "${chosen}"…`);

  return match;          // ← the PRODUCT's spelling, not the client's
};
```

Three cases, and the middle one matters most for a catalogue where most things
are not clothing. Returning `match` rather than `chosen` is what stops "black"
and "Black" becoming two cart lines.

```js
const sameLine = (item, productId, color, size) =>
  String(item.product) === String(productId) &&
  String(item.color || "").toLowerCase() === String(color || "").toLowerCase() &&
  String(item.size  || "").toLowerCase() === String(size  || "").toLowerCase();
```

**Stock is checked against the COMBINED quantity**, not the increment — adding 1
at a time to a product with 3 in stock would otherwise pass every individual
check and build a cart of 40.

Remove and clear are idempotent: no 404 for removing something absent, because
that makes a double-clicked button look like a failure.

## `src/controllers/order.controller.js`

```js
const order = await Order.findOne({ _id: req.params.id, user: req.user._id });
if (!order) throw AppError.notFound("Order not found.");
```

**Ownership lives in the query, not in an `if`.**

> An `if (order.user !== req.user._id) throw` is one early return away from being
> skipped; a filter that cannot match someone else's order cannot be bypassed.

404 rather than 403, for the same reason as hidden products.
---

# 9 · The payment path in full

This is the part worth knowing line by line.

## `src/controllers/payment.controller.js`

```js
const createIntent = catchAsync(async (req, res) => {
  if (!isStripeEnabled())
    throw new AppError(503, "Payments are not available right now.", ERROR_CODES.PAYMENT_UNAVAILABLE);

  const { shippingAddress } = req.body;          // the ONLY thing accepted

  const cart = await getOrCreateCart(req.user._id);
  const view = await buildCartView(cart);        // re-reads every product NOW

  if (!view.items.length)
    throw AppError.badRequest("Your cart is empty.", ERROR_CODES.CART_EMPTY);

  if (!view.checkoutReady)
    throw AppError.badRequest("Some items in your cart are no longer available.",
                              ERROR_CODES.CART_UNAVAILABLE, view.issues);

  const intent = await createPaymentIntent({
    user: req.user,
    amountCents: view.subtotalCents,             // computed, never received
    itemCount: view.itemCount,
  });

  const order = await createPendingOrder({
    userId: req.user._id, view, shippingAddress, paymentIntentId: intent.id,
  });

  return sendSuccess(res, { status: 201, data: {
    clientSecret: intent.client_secret,
    orderId: String(order._id),
    amountCents: view.subtotalCents, currency: env.CURRENCY, itemCount: view.itemCount,
  }});
});
```

**Why the order is created BEFORE Stripe is confirmed:** so that when the webhook
arrives, the order it refers to already exists and already carries the amounts
that were quoted. Building it *from* the webhook instead would mean
reconstructing the basket from a payment notification — and the cart may have
changed by then.

It is created `unpaid`. Nothing here can make it paid.

**One unavailable line fails the whole checkout.** Quietly dropping it and
charging for the rest means billing a total the customer never saw.

## `src/services/stripe.service.js`

```js
const ensureStripeCustomer = async (user) => {
  const stripe = getStripe();
  if (!stripe || !user) return null;

  let customerId = user.stripeCustomerId;

  // `undefined` means the field was not selected (it is select:false), which is
  // different from `null` meaning "selected, and this user has no customer".
  if (customerId === undefined) {
    const fresh = await User.findById(user._id).select("+stripeCustomerId");
    customerId = fresh ? fresh.stripeCustomerId : null;
  }

  if (customerId) return customerId;             // guard 1: no API call at all

  const customer = await stripe.customers.create(
    { email: user.email, name: user.fullName, metadata: { userId: String(user._id) } },
    { idempotencyKey: `user-customer-${user._id}` }    // guard 2: retry-safe
  );

  await User.updateOne({ _id: user._id }, { stripeCustomerId: customer.id });
  user.stripeCustomerId = customer.id;
  return customer.id;
};
```

Three guards against duplicate customers, each covering a different cause: a
stored id short-circuits it entirely; the idempotency key means a timed-out and
retried request returns the *same* customer; and the unique database index
catches anything else. The write uses `updateOne` rather than `save()` so it
cannot fire the password hooks or trip validation on an unrelated field.

```js
const createPaymentIntent = async ({ user, amountCents, itemCount }) => {
  const stripe = getStripe();
  if (!stripe) return null;

  const customerId = await ensureStripeCustomer(user);

  return stripe.paymentIntents.create({
    amount: amountCents,                        // ← NO arithmetic
    currency: env.CURRENCY,
    ...(customerId ? { customer: customerId } : {}),
    automatic_payment_methods: { enabled: true },
    metadata: { userId: String(user._id), itemCount: String(itemCount) },
  });
};
```

`amount: amountCents` with no conversion is the entire payoff of the money
migration. Stripe's `amount` is already minor units and so is everything stored
here — the one place a rounding error becomes a real charge is the one place with
no maths in it.

`metadata.userId` is how you get from a Stripe dashboard row back to a database
record during a support call.

## `src/services/cart.service.js`

```js
const PRODUCT_FIELDS =
  "name slug sku thumbnail status stock priceCents discountPriceCents colors sizes";
```

Narrow on purpose: a cart is read on nearly every page, and populating full
documents with 5,000-character descriptions makes it the slowest query in the app.

```js
const getOrCreateCart = async (userId) => {
  const existing = await Cart.findOne({ user: userId });
  if (existing) return existing;

  try {
    return await Cart.create({ user: userId, items: [] });
  } catch (error) {
    if (error && error.code === 11000) return Cart.findOne({ user: userId });
    throw error;
  }
};
```

E11000 is treated as **success**: the loser of a double-click race wanted a cart,
and the cart it wanted now exists.

`buildCartView` is where every total comes from:

```js
const unitPriceCents = product.finalPriceCents;      // ONE definition of "what is charged"
const lineTotalCents = unitPriceCents * item.quantity;
subtotalCents += lineTotalCents;
```

Nothing is trusted from the stored cart except product ids, quantities, colour
and size. A cart can sit for weeks; in that time a product can be repriced,
unpublished, sold out, or deleted. Three failure modes are **reported rather than
hidden** — `removed`, `unavailable`, `insufficient_stock` — each excluded from the
subtotal but still shown:

> A cart that quietly loses an item is indistinguishable from a bug.

Integer arithmetic throughout: minor units times a whole quantity is exact. The
same multiplication on major units (`249.99 * 3`) produces `749.9699999999999`.

## `src/services/order.service.js`

```js
const createPendingOrder = async ({ userId, view, shippingAddress, paymentIntentId }) => {
  const items = view.items.map((line) => ({
    product: line.product,
    name: line.name, sku: line.sku || "",
    color: line.color || "", size: line.size || "",
    quantity: line.quantity,
    unitPriceCents: line.unitPriceCents,
    subtotalCents: line.lineTotalCents,
  }));

  return Order.create({
    user: userId, items,
    totalCents: view.subtotalCents,
    currency: env.CURRENCY,
    shippingAddress,
    status: ORDER_STATUS.PENDING,
    paymentStatus: PAYMENT_STATUS.UNPAID,
    stripePaymentIntentId: paymentIntentId,
  });
};
```

Every value comes from `view`, which came from the database. The client
contributed the shipping address and nothing else.

**The idempotency guard, and why it is a conditional write:**

```js
const markOrderPaid = async (paymentIntentId) =>
  Order.findOneAndUpdate(
    { stripePaymentIntentId: paymentIntentId, paymentStatus: PAYMENT_STATUS.UNPAID },
    { $set: { paymentStatus: PAYMENT_STATUS.PAID, status: ORDER_STATUS.PAID, paidAt: new Date() } },
    { new: true }
  );
```

Two concurrent deliveries of the same Stripe event both run this. MongoDB applies
the update to exactly one; the loser matches nothing and gets `null`.

A read-then-write — `if (order.paymentStatus === "unpaid") order.save()` — would
let both deliveries read "unpaid" before either wrote, and both would proceed.

**Stock, with two independent guards:**

```js
const commitStock = async (orderId) => {
  const order = await Order.findOneAndUpdate(
    { _id: orderId, stockCommitted: false },      // guard 1: once per ORDER
    { $set: { stockCommitted: true } },
    { new: true }
  );

  if (!order) return { committed: false, oversold: [] };

  const oversold = [];

  for (const item of order.items) {
    const result = await Product.updateOne(
      { _id: item.product, stock: { $gte: item.quantity } },   // guard 2: atomic
      { $inc: { stock: -item.quantity } }
    );
    if (!result.matchedCount) oversold.push({ product: String(item.product), name: item.name });
  }

  if (oversold.length) logger.error("order oversold — stock could not be decremented", { … });
  return { committed: true, oversold };
};
```

They protect against two different things. Guard 1 stops a *redelivered event*
decrementing the same order twice. Guard 2 stops *two different customers* both
passing a stock check and driving it negative — the filter and the decrement are
one atomic operation, so it either succeeds or does not happen.

**When there is not enough stock**, the money has already moved. Refusing to
record the order would lose a paid sale, which is far worse than overselling — so
the shortfall is logged loudly for a human and the order still stands.

```js
const clearCart = async (userId) => {
  await Cart.updateOne({ user: userId }, { $set: { items: [] } });
};
```

Never called on a failed payment: the customer keeps their basket to try another
card.

## `src/controllers/webhook.controller.js`

The endpoint cannot sit behind `protect`, because the caller is Stripe.

> The ONLY thing separating a real payment confirmation from a forged one is the
> signature check.

```js
if (!stripe || !env.STRIPE_WEBHOOK_SECRET) {
  logger.error("stripe webhook called but STRIPE_WEBHOOK_SECRET is not set");
  return res.status(503).send("Webhook not configured.");
}

let event;
try {
  event = stripe.webhooks.constructEvent(
    req.body,                              // a Buffer — express.raw() ran
    req.headers["stripe-signature"],
    env.STRIPE_WEBHOOK_SECRET
  );
} catch (error) {
  logger.warn("stripe webhook signature rejected", { message: error.message });
  return res.status(400).send("Invalid signature.");
}
// everything below is PROVEN to have come from Stripe
```

Three rules follow: the raw body is required; **nothing is read from the body
before verification** — not the order id, not the amount, not even the event
type; and a missing secret means the endpoint refuses to work at all, because an
unverified "just for local dev" branch is precisely the branch that ends up in
production.

The rejection message is deliberately uninformative — a detailed one tells
whoever is probing exactly how their forgery was detected.

**No `catchAsync` here, on purpose.** To Stripe the status code is an
instruction:

| Situation | Status | What Stripe does |
|---|---|---|
| Not configured | 503 | Keep the event, retry |
| Bad signature | **400** | **Stop retrying** |
| Already processed | 200 | Done |
| Unknown event type | 200 | Done |
| Handler threw | 500 | Retry |
| Success | 200 | Done |

A 500 for a bad signature would invite an attacker's forged request to be retried
by us forever.

```js
const order = await markOrderPaid(intent.id);

if (!order) {
  logger.info("stripe webhook: already processed", { paymentIntent: intent.id });
  return res.status(200).json({ received: true, duplicate: true });
}

if (intent.amount !== order.totalCents) {
  logger.error("stripe webhook: amount mismatch", { … });   // logged, NOT thrown
}

const { oversold } = await commitStock(order._id);
await clearCart(order.user);
```

The amount mismatch is logged rather than thrown because the money genuinely
moved — refusing the order would lose a paid sale. A human reconciles from the
log.

---

# 10 · Admin panel — `src/admin/`

## `src/admin/admin.js`

```js
const { default: AdminJS } = await import("adminjs");
const { default: AdminJSExpress } = await import("@adminjs/express");
const AdminJSMongoose = await import("@adminjs/mongoose");
```

`mountAdmin` is async because **AdminJS v7 is ESM-only and cannot be `require`d**
from this CommonJS project. That single constraint is why `server.js` awaits it
before listening.

```js
const router = AdminJSExpress.buildAuthenticatedRouter(admin, { authenticate, … }, null, {
  store: MongoStore.create({ mongoUrl: env.MONGO_URI, collectionName: "adminSessions", ttl: 12*60*60 }),
  cookie: { httpOnly: true, sameSite: "lax", secure: env.isProduction, maxAge: 12*60*60*1000 },
});
```

`buildAuthenticatedRouter`, not `buildRouter` — the latter would leave every user
record and delete button open to anyone who guesses the URL. Sessions live in
MongoDB because the default memory store leaks and drops every logged-in admin on
restart.

Two gotchas recorded in comments: `require("connect-mongo").default` is mandatory
(v6 is ESM, so `.create` is `undefined` from CommonJS), and the TTL is **seconds**
for the store but **milliseconds** for the cookie.

**No custom resource `id`.** Setting `id: "categories"` broke every reference
dropdown, because a Mongoose `ref: "Category"` makes AdminJS look up a resource
named `Category`:

```
There are no resources with given id: "Category"
```

The plural sidebar names come from the locale's `labels` block instead, which
changes the display without touching identity.

## `src/admin/admin.auth.js`

Four gates in order: password → role is admin → account active → success. Plus a
`.env` bootstrap login guarded by `timingSafeEqual` over SHA-256 digests — the
hashing step exists because `timingSafeEqual` throws on length mismatch, which
would itself be a leak. A throwaway `bcrypt.compare` runs when nothing matched,
so "no such account" and "wrong password" take similar time.

The bootstrap admin returns **no `id`**, which is what makes `stampAuthor` throw
for it: bootstrap can browse but cannot create products or categories.

## `src/admin/admin.resources.js`

The largest file, and it exists because of one asymmetry:

```
create → new Model(params).save()      ⇒ pre("save") hooks DO run
update → Model.findOneAndUpdate(...)   ⇒ hooks are BYPASSED
```

So password hashing, the `passwordChangedAt` stamp and the discount rule are
automatic on create and **absent** on edit. Every hook here re-applies an
invariant on the edit path — and must *not* on create, or the work is done twice.
That is not hypothetical: hashing on create as well produced **a hash of a hash**,
and the account could never log in with the password that was typed.

```js
// edit only
payload.password = await bcrypt.hash(payload.password, BCRYPT_ROUNDS);
payload.passwordChangedAt = new Date(Date.now() - 1000);
```

Without the second line, an admin resetting a compromised account's password
would leave the attacker's existing token working until it expired.

| Resource | Access |
|---|---|
| Users | Full CRUD; password write-only; tokens hidden; `stripeCustomerId` visible, never editable |
| Categories | Full CRUD; `createdBy`/`updatedBy` stamped automatically |
| Products | Full CRUD; discount rule and integer-money check re-enforced on edit |
| Carts | **Read-only** (delete allowed — emptying a stuck cart is legitimate support) |

**Money is shown and edited as raw minor units**, with loud descriptions:

```
"MINOR UNITS — no decimal point. 24999 means 249.99, NOT 24,999."
```

Unfriendly, and a considered trade: a "nice" major-unit field would need a
converting hook inbound and a formatter outbound — a second conversion site, in
the one place where a mistake is made by a human under time pressure rather than
caught by a test. A guard hook catches `249.99` typed into a cents field and
replies with what to type instead.

---

# 11 · Scripts — `scripts/`

| Script | Command | Safe by default? |
|---|---|---|
| `make-admin.js` | `npm run make:admin -- you@email.com` | writes immediately |
| `ensure-indexes.js` | `npm run db:indexes` | writes immediately |
| `delete-users.js` | `npm run users:list` / `users:delete` | list yes; delete prompts for `DELETE` |
| `migrate-money.js` | `npm run money:migrate` | **yes — dry run** |
| `inspect-money.js` | `node scripts/inspect-money.js` | **yes — read only** |

`make-admin.js` is a script rather than an endpoint, deliberately: *"make me an
admin" must never be reachable over HTTP.*

`ensure-indexes.js` matters because `autoIndex` is off in production, and
`unique: true` is not a rule Mongoose enforces in JavaScript — it is an index in
MongoDB. Without it nothing stops two accounts sharing an email, **and the unique
`stripePaymentIntentId` that makes webhook idempotency work would not exist.**

Both money scripts read and write through `Product.collection` — the **raw
driver**, never the model — because the current schema has no `price` path, so
hydrating would drop the legacy field and hide exactly the data being migrated.

---

# 12 · The five ideas to take into an interview

**1 · The client never says what anything costs.**
The cart stores no money. Checkout accepts only an address. Every schema is
`.strict()`, so a smuggled `totalCents` is a loud 400. Prices come from
`Product.finalPriceCents`, are snapshotted onto the order by the server, and are
re-checked by a model hook before saving.

**2 · Money is an integer, everywhere.**
Converted from major units at exactly one place (the product validator),
converted back only for display through a virtual documented as unsafe for
arithmetic, and sent to Stripe with no conversion at all.

**3 · Payment is confirmed only by a verified webhook.**
`paymentStatus` is unreachable from every route, including admin. It is written
by one function, called only after `constructEvent` succeeds against the raw
request bytes.

**4 · Everything that can happen twice is idempotent.**

| Guard | Prevents |
|---|---|
| Unique `stripePaymentIntentId` | Two orders for one payment |
| `findOneAndUpdate({ paymentStatus: UNPAID })` | Applying payment twice |
| `findOneAndUpdate({ stockCommitted: false })` | Decrementing stock twice for one order |
| `updateOne({ stock: { $gte: qty } }, { $inc: … })` | Overselling across different orders |
| Stripe `idempotencyKey` per user | Two Stripe customers for one person |
| E11000-tolerant `Cart.create` | A double-clicked first request failing |

**5 · Hidden resources return 404, never 403.**
Draft products, archived products, other people's orders. A 403 confirms the
resource exists to whoever is guessing ids; a 404 tells them nothing.

---

# 13 · Known limitations

Be able to name these; they are scope decisions, not oversights.

**Stock is per product, not per variant.** `Product.stock` is one number, so a
Black/M sale and a Blue/L sale decrement the same counter. Correct for this
schema — per-variant inventory was explicitly out of scope.

**No refunds, cancellations or admin order management.** Orders are read-only for
customers and not exposed in AdminJS at all.

**Only `payment_intent.succeeded` is handled.** A failed payment leaves the order
`unpaid` forever rather than being marked `failed`.

**No stock reservation.** Between adding to the cart and paying, someone else can
buy the last unit. The atomic decrement means you find out at fulfilment rather
than overselling silently — but the customer has already paid, so a human
resolves it.
