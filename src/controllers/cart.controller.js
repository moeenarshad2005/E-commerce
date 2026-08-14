const Product = require("../models/product.model");

const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/AppError");
const { sendSuccess } = require("../utils/apiResponse");
const { getOrCreateCart, buildCartView } = require("../services/cart.service");
const {
  PRODUCT_STATUS,
  ERROR_CODES,
  MAX_CART_ITEM_QUANTITY,
  MAX_CART_LINES,
} = require("../config/constants");

const cartOwner = (req) => req.user._id;

const findPurchasableProduct = async (productId) => {
  const product = await Product.findById(productId).select(
    "name status stock priceCents discountPriceCents colors sizes"
  );

  if (!product || product.status !== PRODUCT_STATUS.ACTIVE) {
    throw AppError.notFound("Product not found.");
  }

  return product;
};

const assertStock = (product, quantity) => {
  if (product.stock < quantity) {
    throw AppError.badRequest(
      product.stock === 0
        ? `${product.name} is out of stock.`
        : `Only ${product.stock} of ${product.name} left.`,
      ERROR_CODES.INSUFFICIENT_STOCK
    );
  }
};

const resolveOption = (available, chosen, label, productName) => {
  const options = Array.isArray(available) ? available : [];

  if (!options.length) {
    if (chosen) {
      throw AppError.badRequest(
        `${productName} does not come in different ${label}s.`
      );
    }
    return "";
  }

  if (!chosen) {
    throw AppError.badRequest(
      `Choose a ${label} for ${productName}. Available: ${options.join(", ")}.`,
      ERROR_CODES.VALIDATION_FAILED
    );
  }

  const match = options.find(
    (option) => String(option).toLowerCase() === String(chosen).toLowerCase()
  );

  if (!match) {
    throw AppError.badRequest(
      `${productName} is not available in ${label} "${chosen}". Available: ${options.join(", ")}.`
    );
  }

  return match;
};

const sameLine = (item, productId, color, size) =>
  String(item.product) === String(productId) &&
  String(item.color || "").toLowerCase() === String(color || "").toLowerCase() &&
  String(item.size || "").toLowerCase() === String(size || "").toLowerCase();

const respondWithCart = async (res, cart, message, status = 200) => {
  const view = await buildCartView(cart);

  return sendSuccess(res, {
    status,
    message,
    data: { cart: view },
  });
};

// GET /api/v1/cart
const getCart = catchAsync(async (req, res) => {
  const cart = await getOrCreateCart(cartOwner(req));

  return respondWithCart(res, cart, "Cart fetched successfully.");
});

// POST /api/v1/cart/items
const addCartItem = catchAsync(async (req, res) => {
  const { productId, quantity } = req.body;

  const product = await findPurchasableProduct(productId);

  const color = resolveOption(product.colors, req.body.color, "colour", product.name);
  const size = resolveOption(product.sizes, req.body.size, "size", product.name);

  const cart = await getOrCreateCart(cartOwner(req));

  const existing = cart.items.find((item) => sameLine(item, productId, color, size));

  const nextQuantity = (existing?.quantity || 0) + quantity;

  if (nextQuantity > MAX_CART_ITEM_QUANTITY) {
    throw AppError.badRequest(
      `You can have at most ${MAX_CART_ITEM_QUANTITY} of one product in the cart.`
    );
  }

  assertStock(product, nextQuantity);

  if (existing) {
    existing.quantity = nextQuantity;
  } else {
    if (cart.items.length >= MAX_CART_LINES) {
      throw AppError.badRequest(
        `A cart can hold at most ${MAX_CART_LINES} different products.`
      );
    }

    cart.items.push({ product: productId, quantity, color, size });
  }

  await cart.save();

  return respondWithCart(res, cart, "Item added to cart.", existing ? 200 : 201);
});

// PATCH /api/v1/cart/items/:productId
const updateCartItem = catchAsync(async (req, res) => {
  const { productId } = req.params;
  const { quantity, color, size } = req.body;

  const cart = await getOrCreateCart(cartOwner(req));

  const narrowed = color !== undefined || size !== undefined;

  const existing = narrowed
    ? cart.items.find((item) => sameLine(item, productId, color, size))
    : cart.items.find((item) => String(item.product) === String(productId));

  if (!existing) {
    throw AppError.notFound("That item is not in your cart.");
  }

  const product = await findPurchasableProduct(productId);
  assertStock(product, quantity);

  existing.quantity = quantity;

  await cart.save();

  return respondWithCart(res, cart, "Cart updated.");
});

// DELETE /api/v1/cart/items/:productId
const removeCartItem = catchAsync(async (req, res) => {
  const { productId } = req.params;
  const { color, size } = req.query;

  const cart = await getOrCreateCart(cartOwner(req));

  const before = cart.items.length;

  const narrowed = color !== undefined || size !== undefined;

  cart.items = cart.items.filter((item) =>
    narrowed
      ? !sameLine(item, productId, color, size)
      : String(item.product) !== String(productId)
  );

  if (cart.items.length !== before) {
    await cart.save();
  }

  return respondWithCart(res, cart, "Item removed from cart.");
});

// DELETE /api/v1/cart
const clearCart = catchAsync(async (req, res) => {
  const cart = await getOrCreateCart(cartOwner(req));

  if (cart.items.length) {
    cart.items = [];
    await cart.save();
  }

  return respondWithCart(res, cart, "Cart cleared.");
});

module.exports = {
  getCart,
  addCartItem,
  updateCartItem,
  removeCartItem,
  clearCart,
};
