const mongoose = require("mongoose");

const {
  MAX_CART_ITEM_QUANTITY,
  MAX_CART_LINES,
} = require("../config/constants");

const cartItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },

    color: {
      type: String,
      trim: true,
      default: "",
    },

    size: {
      type: String,
      trim: true,
      uppercase: true,
      default: "",
    },

    quantity: {
      type: Number,
      required: true,
      min: [1, "Quantity must be at least 1."],
      max: [
        MAX_CART_ITEM_QUANTITY,
        `Quantity cannot exceed ${MAX_CART_ITEM_QUANTITY}.`,
      ],
      validate: {
        validator: Number.isInteger,
        message: "Quantity must be a whole number.",
      },
    },

    addedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const cartSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },

    items: {
      type: [cartItemSchema],
      default: [],
      validate: {
        validator: (items) => items.length <= MAX_CART_LINES,
        message: `A cart can hold at most ${MAX_CART_LINES} different products.`,
      },
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

cartSchema.pre("validate", function rejectDuplicateVariants(next) {
  const seen = new Set();

  for (const item of this.items || []) {
    const key = `${item.product}|${item.color || ""}|${item.size || ""}`;

    if (seen.has(key)) {
      this.invalidate(
        "items",
        "The same product, colour and size appears twice in this cart. Combine the lines instead."
      );
      return next();
    }

    seen.add(key);
  }

  return next();
});

module.exports = mongoose.model("Cart", cartSchema);
