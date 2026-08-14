const { z } = require("zod");

const objectId = z
  .string()
  .trim()
  .regex(/^[a-f\d]{24}$/i, "Must be a valid id.");

/**
 * The delivery address, captured at checkout.
 *
 * Six fields, which is what a parcel actually needs. No address book, no saved
 * addresses, no geocoding — the address is copied onto the order as a snapshot
 * and never referenced again.
 *
 * `postalCode` is the only optional one: plenty of addresses in Pakistan and
 * elsewhere do not have a meaningful one, and rejecting those would block real
 * customers for no benefit.
 */
const shippingAddressSchema = z
  .object({
    fullName: z
      .string()
      .trim()
      .min(2, "Full name must be at least 2 characters.")
      .max(80, "Full name cannot exceed 80 characters."),

    // Deliberately loose. Phone formats vary enormously by country, and a
    // strict pattern rejects more valid numbers than invalid ones.
    phone: z
      .string()
      .trim()
      .min(7, "Phone number looks too short.")
      .max(20, "Phone number looks too long.")
      .regex(/^[\d+\-() ]+$/, "Phone number may contain only digits, spaces and + - ( )."),

    address: z
      .string()
      .trim()
      .min(5, "Address must be at least 5 characters.")
      .max(200, "Address cannot exceed 200 characters."),

    city: z
      .string()
      .trim()
      .min(2, "City must be at least 2 characters.")
      .max(80, "City cannot exceed 80 characters."),

    postalCode: z
      .string()
      .trim()
      .max(20, "Postal code cannot exceed 20 characters.")
      .optional()
      .default(""),

    country: z
      .string()
      .trim()
      .min(2, "Country must be at least 2 characters.")
      .max(60, "Country cannot exceed 60 characters."),
  })
  .strict();

/** GET /orders — simple pagination, nothing else. */
const listOrdersSchema = {
  query: z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(50).default(10),
    })
    .strict(),
};

/** GET /orders/:id */
const orderIdSchema = {
  params: z.object({ id: objectId }),
};

module.exports = {
  shippingAddressSchema,
  listOrdersSchema,
  orderIdSchema,
};
