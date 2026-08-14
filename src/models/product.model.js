const mongoose = require("mongoose");
const slugify = require("slugify");

const { PRODUCT_STATUS, PRODUCT_SIZES } = require("../config/constants");
const {
  isValidMinorUnits,
  toMajorUnits,
  MAX_MINOR_UNITS,
} = require("../utils/money");

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Product name is required."],
      trim: true,
      minlength: [2, "Product name must be at least 2 characters."],
      maxlength: [150, "Product name cannot exceed 150 characters."],
    },

    slug: {
      type: String,
      required: [true, "Product slug is required."],
      unique: true,
      trim: true,
      lowercase: true,
    },

    shortDescription: {
      type: String,
      trim: true,
      maxlength: [250, "Short description cannot exceed 250 characters."],
      default: "",
    },

    description: {
      type: String,
      required: [true, "Product description is required."],
      trim: true,
      maxlength: [5000, "Description cannot exceed 5000 characters."],
    },

    brand: {
      type: String,
      required: [true, "Brand is required."],
      trim: true,
      maxlength: [100, "Brand name cannot exceed 100 characters."],
    },

    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: [true, "Category is required."],
    },

    images: {
      type: [String],
      default: [],
      validate: [
        {
          validator: (images) => Array.isArray(images) && images.length > 0,
          message: "At least one product image is required.",
        },
        {
          validator: (images) => images.length <= 10,
          message: "A product can have at most 10 images.",
        },
      ],
    },

    thumbnail: {
      type: String,
      trim: true,
      default: "",
    },

    priceCents: {
      type: Number,
      required: [true, "Price is required."],
      validate: {
        validator: isValidMinorUnits,
        message: `Price must be a whole number of minor units between 0 and ${MAX_MINOR_UNITS} (for example 24999 for 249.99).`,
      },
    },

    discountPriceCents: {
      type: Number,
      default: null,
      validate: {
        validator: (v) => v === null || v === undefined || isValidMinorUnits(v),
        message:
          "Discount price must be a whole number of minor units, or empty for no discount.",
      },
    },

    colors: {
      type: [String],
      default: [],
      validate: {
        validator: (value) => value.length <= 20,
        message: "A product cannot have more than 20 colours.",
      },
    },

    sizes: {
      type: [String],
      default: [],
      enum: {
        values: PRODUCT_SIZES,
        message: `Size must be one of: ${PRODUCT_SIZES.join(", ")}.`,
      },
    },

    stock: {
      type: Number,
      required: [true, "Stock is required."],
      default: 0,
      min: [0, "Stock cannot be negative."],
    },

    sku: {
      type: String,
      required: [true, "SKU is required."],
      unique: true,
      trim: true,
      uppercase: true,
    },

    status: {
      type: String,
      enum: Object.values(PRODUCT_STATUS),
      default: PRODUCT_STATUS.DRAFT,
    },

    featured: {
      type: Boolean,
      default: false,
    },

    tags: {
      type: [String],
      default: [],
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

productSchema.pre("validate", async function ensureSlug(next) {
  if (this.slug || !this.name) return next();

  const base = slugify(this.name, { lower: true, strict: true }).slice(0, 90);

  if (!base) {
    return next(
      new Error("Could not build a URL slug from that product name.")
    );
  }

  let candidate = base;
  let suffix = 1;

  /* eslint-disable no-await-in-loop -- collisions are rare, and each check
     depends on the candidate the previous one produced. */
  while (
    await this.constructor.exists({ slug: candidate, _id: { $ne: this._id } })
  ) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
  /* eslint-enable no-await-in-loop */

  this.slug = candidate;
  return next();
});

productSchema.pre("validate", function checkDiscountBelowPrice(next) {
  const price = this.priceCents;
  const discount = this.discountPriceCents;

  if (discount === null || discount === undefined) return next();

  if (typeof price !== "number" || Number.isNaN(price)) return next();

  if (discount >= price) {
    this.invalidate(
      "discountPriceCents",
      "Discount price must be lower than the price.",
      discount
    );
  }

  return next();
});

productSchema.pre("save", function ensureThumbnail(next) {
  if (!this.thumbnail && Array.isArray(this.images) && this.images.length) {
    this.thumbnail = this.images[0];
  }
  return next();
});

productSchema.virtual("finalPriceCents").get(function finalPriceCents() {
  return this.discountPriceCents ?? this.priceCents;
});

productSchema.virtual("price").get(function price() {
  return toMajorUnits(this.priceCents);
});

productSchema.virtual("discountPrice").get(function discountPrice() {
  return this.discountPriceCents === null ||
    this.discountPriceCents === undefined
    ? null
    : toMajorUnits(this.discountPriceCents);
});

productSchema.virtual("finalPrice").get(function finalPrice() {
  return toMajorUnits(this.finalPriceCents);
});

productSchema.virtual("inStock").get(function inStock() {
  return this.stock > 0;
});

productSchema.index(
  {
    name: "text",
    brand: "text",
    tags: "text",
    shortDescription: "text",
    description: "text",
  },
  {
    weights: { name: 10, brand: 6, tags: 5, shortDescription: 2, description: 1 },
    name: "product_search",
  }
);

productSchema.index({ status: 1, category: 1, priceCents: 1 });

productSchema.index({ status: 1, createdAt: -1 });

productSchema.index({ status: 1, featured: 1, createdAt: -1 });

productSchema.index({ category: 1 });
productSchema.index({ brand: 1 });

module.exports = mongoose.model("Product", productSchema);
