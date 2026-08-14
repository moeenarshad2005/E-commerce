const ACCOUNT_STATUS = Object.freeze({
  ACTIVE: "active",
  SUSPENDED: "suspended",
  BANNED: "banned",
});

const ROLES = Object.freeze({
  USER: "user",
  ADMIN: "admin",
});

const ERROR_CODES = Object.freeze({
  VALIDATION_FAILED: "VALIDATION_FAILED",
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  EMAIL_NOT_VERIFIED: "EMAIL_NOT_VERIFIED",
  ACCOUNT_NOT_ACTIVE: "ACCOUNT_NOT_ACTIVE",
  DUPLICATE_RESOURCE: "DUPLICATE_RESOURCE",
  NOT_AUTHENTICATED: "NOT_AUTHENTICATED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  RATE_LIMITED: "RATE_LIMITED",
  INVALID_TOKEN: "INVALID_TOKEN",
  INTERNAL: "INTERNAL",

  // Cart and checkout.
  CART_EMPTY: "CART_EMPTY",
  // A line in the cart can no longer be bought as-is: the product was
  // unpublished, deleted, or someone else took the last of the stock. Its own
  // code because a storefront has to react to it differently from a bad
  // request — it re-renders the cart rather than showing a form error.
  CART_UNAVAILABLE: "CART_UNAVAILABLE",
  INSUFFICIENT_STOCK: "INSUFFICIENT_STOCK",
  PAYMENT_FAILED: "PAYMENT_FAILED",
  PAYMENT_UNAVAILABLE: "PAYMENT_UNAVAILABLE",
  ORDER_NOT_PAYABLE: "ORDER_NOT_PAYABLE",
});

const BCRYPT_ROUNDS = 12;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;
const RESEND_COOLDOWN_MS = 60 * 1000;
const JSON_BODY_LIMIT = "10kb";

/**
 * The size ladder, in display order.
 *
 * Frozen and shared so the model enum, the validator and the AdminJS dropdown
 * cannot drift apart. Products with no sizes (electronics, books) simply carry
 * an empty array — the list is what is ALLOWED, not what is required.
 */
const PRODUCT_SIZES = Object.freeze(["XS", "S", "M", "L", "XL", "XXL"]);

const PRODUCT_STATUS = Object.freeze({
  DRAFT: "draft",
  ACTIVE: "active",
  ARCHIVED: "archived",
});

/* ---------------------------------------------------------------------------
 * Cart
 * ------------------------------------------------------------------------ */

/** Per line. Stops "quantity: 999999999" from being priced, and keeps any one
 *  line's total well inside safe-integer range. */
const MAX_CART_ITEM_QUANTITY = 99;

/** Distinct products in one cart. A cart is loaded with a populate on every
 *  read, so an unbounded one is a self-inflicted slow query. */
const MAX_CART_LINES = 50;

/* ---------------------------------------------------------------------------
 * Orders
 *
 * Two separate fields, deliberately: `status` is where the ORDER is in its
 * life, `paymentStatus` is where the MONEY is. An order can be paid but not yet
 * shipped, so collapsing them into one field is what forces the invention of
 * states like "paid_but_cancelled" later.
 * ------------------------------------------------------------------------ */

const ORDER_STATUS = Object.freeze({
  // Created at checkout, nothing charged yet.
  PENDING: "pending",
  // The webhook confirmed payment.
  PAID: "paid",
  // Staff moved it along. Set from the admin panel, not by the customer.
  SHIPPED: "shipped",
  DELIVERED: "delivered",
  CANCELLED: "cancelled",
});

const PAYMENT_STATUS = Object.freeze({
  UNPAID: "unpaid",
  PAID: "paid",
  FAILED: "failed",
});

module.exports = {
  ACCOUNT_STATUS,
  ROLES,
  ERROR_CODES,
  BCRYPT_ROUNDS,
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
  RESEND_COOLDOWN_MS,
  JSON_BODY_LIMIT,
  PRODUCT_STATUS,
  PRODUCT_SIZES,
  ORDER_STATUS,
  PAYMENT_STATUS,
  MAX_CART_ITEM_QUANTITY,
  MAX_CART_LINES,
};
