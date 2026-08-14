# E-Commerce Backend

A REST API for a small online store: accounts, an admin panel, a product
catalogue with colour and size options, a cart, and card payment through Stripe.

**Node.js · Express · MongoDB / Mongoose · JWT · bcrypt · AdminJS · Stripe**

The flow it implements, end to end:

```
register → verify email → log in → browse products → pick colour/size
→ add to cart → checkout → Stripe PaymentIntent → card payment
```

---

## Running it

```bash
npm install
cp .env.example .env      # then fill in the values below
npm run dev               # http://localhost:5000
```

Only two variables are strictly required:

```bash
MONGO_URI=mongodb://127.0.0.1:27017/ecommerce
JWT_SECRET=              # node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Everything else degrades gracefully. With no `SMTP_HOST` the verification link
is printed to the console instead of emailed. With no `STRIPE_SECRET_KEY` the
payment endpoint answers 503 and the rest of the API is unaffected. Every
variable is explained in `.env.example`, and the server refuses to start if one
is missing or malformed, naming exactly which.

Make yourself an admin so you can reach the panel:

```bash
npm run make:admin -- you@example.com
```

Then sign in at `http://localhost:5000/admin`.

---

## API

Base path `/api/v1`. Responses are always the same shape:

```json
{ "success": true,  "message": "Product created successfully.", "data": { } }
{ "success": false, "message": "Invalid request." }
```

### Auth

| Method | Path | Access |
|---|---|---|
| POST | `/auth/register` | Public |
| POST | `/auth/login` | Public |
| GET | `/auth/verify-email/:token` | Public |
| POST | `/auth/resend-verification` | Public |
| POST | `/auth/forgot-password` | Public |
| POST | `/auth/reset-password` | Public |
| PATCH | `/auth/password` | Authenticated |
| GET | `/auth/me` | Authenticated |

### Users

| Method | Path | Access |
|---|---|---|
| GET | `/users/me` | Authenticated |
| PATCH | `/users/me` | Authenticated |

### Products

| Method | Path | Access |
|---|---|---|
| GET | `/products` | Public |
| GET | `/products/:id` | Public |
| POST | `/products` | Admin (multipart, for images) |
| PUT · PATCH | `/products/:id` | Admin |
| DELETE | `/products/:id` | Admin (archives, does not erase) |

### Categories

| Method | Path | Access |
|---|---|---|
| GET | `/categories` · `/categories/:id` | Public |
| POST · PATCH · DELETE | `/categories` · `/categories/:id` | Admin |

### Cart — all authenticated, always your own

| Method | Path |
|---|---|
| GET | `/cart` |
| POST | `/cart/items` |
| PATCH · PUT | `/cart/items/:productId` |
| DELETE | `/cart/items/:productId` |
| DELETE | `/cart` |

### Payment

| Method | Path | Access |
|---|---|---|
| POST | `/payment/create-intent` | Authenticated |

---

## How payment works

```
browser                         this API                      Stripe
───────                         ────────                      ──────
POST /payment/create-intent  →  read the cart
                                price it from the products
                                create a PaymentIntent    →    client_secret
                          ←──   { clientSecret, amountCents }
stripe.confirmCardPayment(clientSecret, { card })  ──────→     charges the card
```

The request body must be **empty**. The server reads the cart, looks up each
product's current price, and computes the total itself. A request carrying
`{"amountCents": 1}` is rejected with a 400 naming the unexpected field.

**No card data ever reaches this server.** Stripe.js collects the number, CVC
and expiry in the browser and sends them straight to Stripe. The API only ever
handles an opaque `client_secret`, which authorises confirming that one payment
and nothing else. The secret key stays on the server.

Test with Stripe's card `4242 4242 4242 4242`, any future expiry, any CVC.

---

## Products, colours and sizes

```json
{
  "name": "Cotton T-Shirt",
  "price": 2500,
  "priceCents": 250000,
  "stock": 20,
  "colors": ["Black", "White", "Blue"],
  "sizes": ["S", "M", "L", "XL"],
  "images": ["/uploads/products/shirt-front.jpg"]
}
```

**Colours are free text; sizes are a fixed list** (`XS S M L XL XXL`). Colour
names are marketing decisions that change every season, so an enum would mean a
code change to add "Sage Green". The size ladder genuinely is fixed, so an enum
stops an admin typing "Med" and creating a size no dropdown will ever offer.

**Both may be empty, and that is the normal case for anything that is not
clothing.** A phone has no sizes. When a product has options the cart requires a
choice; when it has none it refuses one.

Adding to the cart validates the choice against the product's own lists:

```
POST /cart/items { "productId": "…", "quantity": 2, "color": "black", "size": "m" }
→ 201, stored as color "Black", size "M"       ← the product's spelling, not yours

POST /cart/items { "productId": "…", "color": "Green", "size": "M" }
→ 400  Cotton T-Shirt is not available in colour "Green". Available: Black, White, Blue.
```

A cart line is identified by the **triple** (product, colour, size), so a black
M and a white L of one shirt are two separate lines, and adding the same triple
twice raises the quantity instead of duplicating the row.

---

## Money

Stored as **integers in minor units** — `priceCents: 250000` is ₨2,500.00.

Floating point cannot represent money: `0.1 + 0.2` is `0.30000000000000004`, and
`1999.99 * 3` is `5999.969999999999`. Every individual step looks right and the
customer is billed a figure the receipt disagrees with. Integers add exactly.

It also happens to be what Stripe wants — `amount` is already minor units — so
the value goes to Stripe with **no conversion at all**. The one place where a
rounding error becomes a real charge is the place with no arithmetic in it.

The API still speaks normal prices. `price: 2500` is a read-only virtual
computed from `priceCents`, so a frontend never has to divide by 100.

---

## The cart stores no prices

This is the single most important design decision in the project, and it is an
*omission*:

```js
Cart {
  user,
  items: [{ product, quantity, color, size }]
}
```

No unit price, no line total, no subtotal. Two reasons:

1. A cart that remembers the price it saw at "add to cart" time charges
   yesterday's price when the product is repriced.
2. Anything the cart stores is something a client could try to write. Any
   endpoint that accepts a price from the browser is one request away from a
   ₨1 laptop.

Totals are recomputed from the live product rows on every read, and again when
the PaymentIntent is created. Colour and size *are* stored, because those are
the customer's choices — the server cannot re-derive them, and they do not go
stale.

---

## Security

| Concern | How |
|---|---|
| Passwords | bcrypt, 12 rounds, hashed in a `pre("save")` hook so no code path can skip it |
| Sessions | JWT carrying only `sub`; the role is re-read from MongoDB on every request, so a demotion takes effect immediately |
| Token theft | Changing a password invalidates every token issued before it |
| Verification & reset links | Only the SHA-256 **digest** is stored, so a database dump contains no usable links. Single-use, with expiry |
| Enumeration | Login answers the same 401 for "no such user" and "wrong password", and does a dummy bcrypt compare so the two take the same time |
| Authorisation | `restrictTo("admin")` reads the live role; the cart and profile read `req.user._id` and never an id from the request |
| Input | Zod schemas on body, query and params — all `.strict()`, so unexpected fields are a 400, not a silent drop |
| Uploads | Extension comes from the sniffed mimetype, not the filename, so `evil.js` cannot ride in as an image. 5 MB and 10-file caps |
| Transport | helmet, CORS allowlist, rate limits (tighter on auth and email routes), 10 kb body cap |
| Secrets | Validated at boot and never logged. Stripe error messages are never forwarded to clients — they can contain key fragments |
| Card data | Never touches this server |

---

## Project structure

```
src/
├── app.js              middleware stack and route mounting
├── server.js           connect DB → mount admin → listen
├── config/             env validation, DB, logger, constants
├── middleware/         auth, validation, errors, rate limits, uploads
├── validators/         Zod schemas — the trust boundary
├── routes/             thin: rate limit → validate → handle
├── controllers/        HTTP concerns
├── services/           cart pricing, Stripe
├── models/             schema, hooks, virtuals, indexes
└── admin/              AdminJS panel

scripts/
├── make-admin.js       npm run make:admin -- you@example.com
├── ensure-indexes.js   npm run db:indexes    (required in production)
├── delete-users.js     npm run users:list / users:delete
└── migrate-money.js    npm run money:migrate (one-off; delete once run)
```

A service exists only where there is a second caller — `stripe.service.js`,
because registration and payment both need "make sure this user has a Stripe
customer". There is no `productService` wrapping four Mongoose calls for the
sake of symmetry.

`npm run db:indexes` matters in production: `autoIndex` is off there, and
`unique: true` is not a rule Mongoose enforces in JavaScript — it is an index in
MongoDB. Without it, nothing stops two accounts sharing an email.

---

## Admin panel

AdminJS at `/admin`, admin accounts only. Manage users, categories and products
— including uploading images, setting price, stock, colours and sizes. Carts are
visible but read-only, since a cart belongs to the customer.

Passwords in the panel are write-only: never displayed, hashed exactly once, and
changing one signs that user out of their other sessions.
