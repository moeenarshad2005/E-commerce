const Cart = require("../models/cart.model");
const Product = require("../models/product.model");

const { PRODUCT_STATUS } = require("../config/constants");

const PRODUCT_FIELDS =
  "name slug sku thumbnail status stock priceCents discountPriceCents colors sizes";

const getOrCreateCart = async (userId) => {
  const existing = await Cart.findOne({ user: userId });
  if (existing) return existing;

  try {
    return await Cart.create({ user: userId, items: [] });
  } catch (error) {
    if (error && error.code === 11000) {
      return Cart.findOne({ user: userId });
    }
    throw error;
  }
};

const buildCartView = async (cart) => {
  const items = cart?.items || [];

  if (!items.length) {
    return {
      items: [],
      itemCount: 0,
      subtotalCents: 0,
      issues: [],
      checkoutReady: false,
    };
  }

  const products = await Product.find({
    _id: { $in: items.map((item) => item.product) },
  }).select(PRODUCT_FIELDS);

  const byId = new Map(products.map((product) => [String(product._id), product]));

  const issues = [];
  let subtotalCents = 0;
  let itemCount = 0;

  const lines = items.map((item) => {
    const id = String(item.product);
    const product = byId.get(id);

    const base = {
      product: id,
      quantity: item.quantity,
      color: item.color || "",
      size: item.size || "",
      addedAt: item.addedAt,
    };

    if (!product) {
      issues.push({ product: id, reason: "removed" });
      return {
        ...base,
        available: false,
        reason: "This product is no longer available.",
        unitPriceCents: null,
        lineTotalCents: 0,
      };
    }

    const unitPriceCents = product.finalPriceCents;

    const snapshot = {
      ...base,
      name: product.name,
      slug: product.slug,
      sku: product.sku,
      thumbnail: product.thumbnail,
      unitPriceCents,
      stock: product.stock,
    };

    if (product.status !== PRODUCT_STATUS.ACTIVE) {
      issues.push({ product: id, reason: "unavailable" });
      return {
        ...snapshot,
        available: false,
        reason: "This product is not currently for sale.",
        lineTotalCents: 0,
      };
    }

    if (product.stock < item.quantity) {
      issues.push({
        product: id,
        reason: "insufficient_stock",
        available: product.stock,
        requested: item.quantity,
      });
      return {
        ...snapshot,
        available: false,
        reason:
          product.stock === 0
            ? "This product is out of stock."
            : `Only ${product.stock} left — reduce the quantity to continue.`,
        lineTotalCents: 0,
      };
    }

    const lineTotalCents = unitPriceCents * item.quantity;

    subtotalCents += lineTotalCents;
    itemCount += item.quantity;

    return { ...snapshot, available: true, reason: null, lineTotalCents };
  });

  return {
    items: lines,
    itemCount,
    subtotalCents,
    issues,
    checkoutReady: lines.length > 0 && issues.length === 0,
  };
};

module.exports = { getOrCreateCart, buildCartView, PRODUCT_FIELDS };
