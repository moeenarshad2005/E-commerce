const { z } = require("zod");

const { MAX_CART_ITEM_QUANTITY } = require("../config/constants");

const objectId = z
  .string()
  .trim()
  .regex(/^[a-f\d]{24}$/i, "Must be a valid id.");

const quantity = z.coerce
  .number()
  .int("Quantity must be a whole number.")
  .min(1, "Quantity must be at least 1.")
  .max(
    MAX_CART_ITEM_QUANTITY,
    `Quantity cannot exceed ${MAX_CART_ITEM_QUANTITY} per product.`
  );

const color = z.string().trim().max(40, "Colour name is too long.").optional();

const size = z
  .string()
  .trim()
  .toUpperCase()
  .max(10, "Size is too long.")
  .optional();

// POST /api/v1/cart/items - add, or increase an existing line
const addCartItemSchema = {
  body: z
    .object({
      productId: objectId,
      quantity: quantity.default(1),
      color,
      size,
    })
    .strict(),
};

// PATCH /api/v1/cart/items/:productId - set an absolute quantity
const updateCartItemSchema = {
  params: z.object({ productId: objectId }),
  body: z.object({ quantity, color, size }).strict(),
};

// DELETE /api/v1/cart/items/:productId - colour and size narrow it to one line
const cartItemParamSchema = {
  params: z.object({ productId: objectId }),
  query: z.object({ color, size }).strict(),
};

module.exports = {
  addCartItemSchema,
  updateCartItemSchema,
  cartItemParamSchema,
};
