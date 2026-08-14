const mongoose = require("mongoose");

const { ORDER_STATUS, PAYMENT_STATUS } = require("../config/constants");
const { isValidMinorUnits } = require("../utils/money");

/**
 * A completed (or in-progress) purchase.
 *
 * ── Why every line is a SNAPSHOT ────────────────────────────────────────────
 *
 * The product reference exists only so you can link back to the catalogue. The
 * name, price, colour and size are COPIED onto the order at checkout and never
 * read from the product again.
 *
 * An order that renders itself by populating the product shows "Unknown
 * product" the moment that product is deleted — and, worse, shows the WRONG
 * PRICE the moment it is repriced. What the customer paid is a fact about the
 * past; it must not change because the shop changed its mind afterwards.
 */
const orderItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },

    // Snapshots.
    name: { type: String, required: true },
    sku: { type: String, default: "" },
    color: { type: String, default: "" },
    size: { type: String, default: "" },

    quantity: {
      type: Number,
      required: true,
      min: [1, "Quantity must be at least 1."],
    },

    /** What one unit cost, in minor units, at the moment of purchase. */
    unitPriceCents: {
      type: Number,
      required: true,
      validate: {
        validator: isValidMinorUnits,
        message: "Unit price must be a whole number of minor units.",
      },
    },

    /**
     * Stored even though it is unitPrice × quantity.
     *
     * Normally deriving beats storing, but this is a financial record: if the
     * multiplication rule ever changes, every past order must still read back
     * exactly as it was charged.
     */
    subtotalCents: {
      type: Number,
      required: true,
      validate: {
        validator: isValidMinorUnits,
        message: "Subtotal must be a whole number of minor units.",
      },
    },
  },
  { _id: false }
);

/**
 * The delivery address, copied at checkout.
 *
 * A snapshot, not a reference to some address book — if the customer later
 * moves house, the order must still say where it was actually sent.
 */
const shippingAddressSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    address: { type: String, required: true, trim: true },
    city: { type: String, required: true, trim: true },
    postalCode: { type: String, default: "", trim: true },
    country: { type: String, required: true, trim: true },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    items: {
      type: [orderItemSchema],
      required: true,
      validate: {
        validator: (items) => items.length > 0,
        message: "An order must contain at least one item.",
      },
    },

    totalCents: {
      type: Number,
      required: true,
      validate: {
        validator: isValidMinorUnits,
        message: "Total must be a whole number of minor units.",
      },
    },

    currency: { type: String, required: true, lowercase: true },

    shippingAddress: { type: shippingAddressSchema, required: true },

    status: {
      type: String,
      enum: Object.values(ORDER_STATUS),
      default: ORDER_STATUS.PENDING,
    },

    /**
     * Written by the Stripe webhook and by nothing else.
     *
     * There is no route, admin field or validator anywhere that can set this —
     * which is what makes "an order is paid only when Stripe says so" true by
     * construction rather than by discipline.
     */
    paymentStatus: {
      type: String,
      enum: Object.values(PAYMENT_STATUS),
      default: PAYMENT_STATUS.UNPAID,
    },

    /**
     * The idempotency key for the whole fulfilment step.
     *
     * Unique, so a duplicate webhook delivery cannot produce a second order for
     * one payment. The webhook then flips paymentStatus with a CONDITIONAL
     * update on this order, so the work either happens exactly once or not at
     * all.
     */
    stripePaymentIntentId: {
      type: String,
      required: true,
      unique: true,
    },

    /**
     * Whether stock has already been taken for this order.
     *
     * A separate flag rather than an inference from paymentStatus, because
     * Stripe can deliver the same event twice and "is this already paid?" is
     * answered a fraction of a second before the second delivery asks it.
     */
    stockCommitted: { type: Boolean, default: false },

    paidAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false }
);

// The customer's "my orders" page: their orders, newest first.
orderSchema.index({ user: 1, createdAt: -1 });

/**
 * Re-checks the arithmetic on every write.
 *
 * The totals are computed by the server already, so this can only fail if a
 * future change introduces a bug. It is the last line of defence for the one
 * thing in the system that must never be wrong.
 */
orderSchema.pre("validate", function verifyTotals(next) {
  let expected = 0;

  for (const item of this.items || []) {
    if (item.unitPriceCents * item.quantity !== item.subtotalCents) {
      this.invalidate(
        "items",
        `Line total for ${item.name} does not match unit price × quantity.`
      );
      return next();
    }
    expected += item.subtotalCents;
  }

  if (expected !== this.totalCents) {
    this.invalidate(
      "totalCents",
      `Total ${this.totalCents} does not match the sum of the lines (${expected}).`
    );
  }

  return next();
});

module.exports = mongoose.model("Order", orderSchema);
