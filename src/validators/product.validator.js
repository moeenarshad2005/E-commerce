const { z } = require("zod");

const {
  PRODUCT_STATUS,
  PRODUCT_SIZES,
} = require("../config/constants");
const { toMinorUnits, MAX_MINOR_UNITS } = require("../utils/money");

const objectId = z
  .string()
  .trim()
  .regex(/^[a-f\d]{24}$/i, "Must be a valid id.");

const booleanish = z.union([
  z.boolean(),
  z.enum(["true", "false", "1", "0"]).transform((v) => v === "true" || v === "1"),
]);

const listOf = (each) =>
  z.union([each, z.array(each)]).transform((v) => (Array.isArray(v) ? v : [v]));

const name = z
  .string()
  .trim()
  .min(2, "Product name must be at least 2 characters.")
  .max(150, "Product name must be at most 150 characters.");

const slug = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, "Slug is required.")
  .max(200, "Slug must be at most 200 characters.")
  .regex(
    /^[a-z0-9-]+$/,
    "Slug may only contain lowercase letters, numbers and hyphens."
  );

const shortDescription = z
  .string()
  .trim()
  .max(250, "Short description must be at most 250 characters.")
  .optional();

const description = z
  .string()
  .trim()
  .min(10, "Description must be at least 10 characters.")
  .max(5000, "Description must be at most 5000 characters.");

const brand = z
  .string()
  .trim()
  .min(2, "Brand must be at least 2 characters.")
  .max(100, "Brand must be at most 100 characters.");

const money = (label) =>
  z
    .union([z.string(), z.number()])
    .transform((value, ctx) => {
      const minor = toMinorUnits(value);

      if (minor === null) {
        ctx.addIssue({
          code: "custom",
          message: `${label} must be an amount with at most 2 decimal places, for example 249.99.`,
        });
        return z.NEVER;
      }

      if (minor < 0) {
        ctx.addIssue({
          code: "custom",
          message: `${label} cannot be negative.`,
        });
        return z.NEVER;
      }

      if (minor > MAX_MINOR_UNITS) {
        ctx.addIssue({
          code: "custom",
          message: `${label} is implausibly large.`,
        });
        return z.NEVER;
      }

      return minor;
    });

const stock = z.coerce
  .number()
  .int("Stock must be a whole number.")
  .nonnegative("Stock cannot be negative.")
  .max(10_000_000, "Stock is implausibly large.");

const sku = z
  .string()
  .trim()
  .min(2, "SKU is required.")
  .max(100, "SKU must be at most 100 characters.");

const status = z.enum(Object.values(PRODUCT_STATUS));

const tags = listOf(z.string().trim().min(1).max(40)).pipe(
  z.array(z.string()).max(25, "At most 25 tags.")
);

const colors = listOf(z.string().trim().min(1).max(40))
  .pipe(z.array(z.string()).max(20, "At most 20 colours."))
  .transform((list) => {
    const seen = new Set();
    return list.filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });

const sizes = listOf(z.string().trim().toUpperCase())
  .pipe(
    z.array(
      z.enum(PRODUCT_SIZES, {
        message: `Size must be one of: ${PRODUCT_SIZES.join(", ")}.`,
      })
    )
  )
  .transform((list) =>
    [...new Set(list)].sort(
      (a, b) => PRODUCT_SIZES.indexOf(a) - PRODUCT_SIZES.indexOf(b)
    )
  );

/**
 * An image reference.
 *
 * Two shapes are legitimate, and accepting only one of them was a bug: images
 * uploaded through POST /products are stored as the RELATIVE path multer wrote
 * ("/uploads/products/….jpg"), so a `.url()` rule rejected the very values this
 * API had just handed back — a PUT that echoed the product's own images 400'd,
 * and no thumbnail could be set to an uploaded file.
 *
 * ".." is refused so a stored path cannot point outside the uploads directory.
 */
const imageRef = (label) =>
  z
    .string()
    .trim()
    .max(2000)
    .refine(
      (value) =>
        (/^https?:\/\//i.test(value) ||
          /^\/uploads\/[\w\-./]+$/.test(value)) &&
        !value.includes(".."),
      `${label} must be a full http(s) URL, or an /uploads/... path returned by this API.`
    );

const imageUrls = listOf(imageRef("Each image")).pipe(
  z.array(z.string()).max(10, "At most 10 images.")
);

const thumbnail = imageRef("Thumbnail").optional();

const discountBelowPrice = (data) =>
  data.discountPrice === undefined ||
  data.discountPrice === null ||
  data.price === undefined ||
  data.discountPrice < data.price;

const DISCOUNT_MESSAGE = {
  message: "Discount price must be lower than the price.",
  path: ["discountPrice"],
};

const toStoredMoney = (data) => {
  const { price, discountPrice, ...rest } = data;

  return {
    ...rest,
    ...(price !== undefined ? { priceCents: price } : {}),
    ...(discountPrice !== undefined
      ? { discountPriceCents: discountPrice }
      : {}),
  };
};

const createProductSchema = {
  body: z
    .object({
      name,
      slug: slug.optional(),
      shortDescription,
      description,
      brand,
      category: objectId,
      thumbnail,
      price: money("Price"),
      discountPrice: money("Discount price").optional(),
      stock,
      sku,
      featured: booleanish.optional(),
      status: status.optional(),
      tags: tags.optional(),
      colors: colors.optional(),
      sizes: sizes.optional(),
    })
    .strict()
    .refine(discountBelowPrice, DISCOUNT_MESSAGE)
    .transform(toStoredMoney),
};

const updateProductSchema = {
  params: z.object({ id: objectId }),
  body: z
    .object({
      name: name.optional(),
      slug: slug.optional(),
      shortDescription,
      description: description.optional(),
      brand: brand.optional(),
      category: objectId.optional(),
      images: imageUrls.optional(),
      thumbnail,
      price: money("Price").optional(),
      discountPrice: money("Discount price").nullable().optional(),
      stock: stock.optional(),
      sku: sku.optional(),
      featured: booleanish.optional(),
      status: status.optional(),
      tags: tags.optional(),
      colors: colors.optional(),
      sizes: sizes.optional(),
    })
    .strict()
    .refine((d) => Object.keys(d).length > 0, {
      message: "Provide at least one field to update.",
    })
    .refine(discountBelowPrice, DISCOUNT_MESSAGE)
    .transform(toStoredMoney),
};

const SORTABLE = [
  "-createdAt",
  "createdAt",
  "price",
  "-price",
  "name",
  "-name",
];

const listProductsSchema = {
  query: z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(10),
      category: objectId.optional(),
      brand: z.string().trim().max(100).optional(),
      status: status.optional(),
      featured: booleanish.optional(),
      minPrice: money("minPrice").optional(),
      maxPrice: money("maxPrice").optional(),
      search: z.string().trim().min(1).max(120).optional(),
      sort: z.enum(SORTABLE).default("-createdAt"),
    })
    .strict()
    .refine(
      (q) =>
        q.minPrice === undefined ||
        q.maxPrice === undefined ||
        q.minPrice <= q.maxPrice,
      { message: "minPrice cannot be greater than maxPrice.", path: ["minPrice"] }
    ),
};

const productIdSchema = {
  params: z.object({ id: objectId }),
};

module.exports = {
  createProductSchema,
  updateProductSchema,
  listProductsSchema,
  productIdSchema,
  SORTABLE,
};
