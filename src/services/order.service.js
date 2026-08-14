const Cart = require("../models/cart.model");
const Order = require("../models/order.model");
const Product = require("../models/product.model");

const env = require("../config/env");
const logger = require("../config/logger");
const { ORDER_STATUS, PAYMENT_STATUS } = require("../config/constants");

/**
 * Everything that turns a cart into an order.
 *
 * Two functions with two different callers — the payment controller creates the
 * pending order, the webhook fulfils it — which is why this is a service rather
 * than code sitting inside one controller.
 */

/**
 * Creates the order BEFORE Stripe is called, in the `unpaid` state.
 *
 * The ordering matters: when the payment confirmation arrives, the order it
 * refers to already exists and already carries the amounts that were quoted.
 * Creating it afterwards instead would leave the webhook holding a successful
 * payment with nothing to attach it to.
 *
 * `view` comes from buildCartView, which re-reads every product from the
 * database. Nothing the client sent contributes to any amount here.
 */
const createPendingOrder = async ({
  userId,
  view,
  shippingAddress,
  paymentIntentId,
}) => {
  const items = view.items.map((line) => ({
    product: line.product,
    name: line.name,
    sku: line.sku || "",
    color: line.color || "",
    size: line.size || "",
    quantity: line.quantity,
    unitPriceCents: line.unitPriceCents,
    subtotalCents: line.lineTotalCents,
  }));

  return Order.create({
    user: userId,
    items,
    totalCents: view.subtotalCents,
    currency: env.CURRENCY,
    shippingAddress,
    status: ORDER_STATUS.PENDING,
    paymentStatus: PAYMENT_STATUS.UNPAID,
    stripePaymentIntentId: paymentIntentId,
  });
};

/**
 * Marks an order paid — once, and only once.
 *
 * The whole guard is the filter: `paymentStatus: UNPAID`. Two concurrent
 * deliveries of the same Stripe event both run this, and MongoDB applies the
 * update to exactly one of them; the loser matches nothing and gets null back.
 *
 * A read-then-write (`if (order.paymentStatus === "unpaid") order.save()`)
 * would let both deliveries read "unpaid" before either wrote, and both would
 * proceed.
 *
 * Returns the updated order, or null if it was already paid.
 */
const markOrderPaid = async (paymentIntentId) =>
  Order.findOneAndUpdate(
    {
      stripePaymentIntentId: paymentIntentId,
      paymentStatus: PAYMENT_STATUS.UNPAID,
    },
    {
      $set: {
        paymentStatus: PAYMENT_STATUS.PAID,
        status: ORDER_STATUS.PAID,
        paidAt: new Date(),
      },
    },
    { new: true }
  );

/**
 * Takes the stock for a paid order — once, and only once.
 *
 * Two independent guards, because they protect against two different things:
 *
 *  1. `stockCommitted: false` flips to true in a single conditional update, so
 *     a redelivered event cannot decrement the same order twice.
 *
 *  2. Each product decrement carries `{ stock: { $gte: quantity } }`, so it
 *     either succeeds atomically or does not happen. Read-then-write would let
 *     two DIFFERENT customers both pass the check and drive stock negative.
 *
 * ── When there is not enough stock ──────────────────────────────────────────
 * The money has already moved. Refusing to record the order would lose a paid
 * sale, which is far worse than overselling — so the shortfall is logged loudly
 * for a human to resolve and the order still stands.
 */
const commitStock = async (orderId) => {
  const order = await Order.findOneAndUpdate(
    { _id: orderId, stockCommitted: false },
    { $set: { stockCommitted: true } },
    { new: true }
  );

  if (!order) return { committed: false, oversold: [] };

  const oversold = [];

  for (const item of order.items) {
    // eslint-disable-next-line no-await-in-loop -- each decrement is its own
    // conditional write; batching them would lose the per-line guard.
    const result = await Product.updateOne(
      { _id: item.product, stock: { $gte: item.quantity } },
      { $inc: { stock: -item.quantity } }
    );

    if (!result.matchedCount) {
      oversold.push({ product: String(item.product), name: item.name });
    }
  }

  if (oversold.length) {
    logger.error("order oversold — stock could not be decremented", {
      orderId: String(order._id),
      oversold,
    });
  }

  return { committed: true, oversold };
};

/**
 * Empties the cart after a successful payment.
 *
 * Never called on a failed payment: the customer keeps their basket so they can
 * try again with another card.
 */
const clearCart = async (userId) => {
  await Cart.updateOne({ user: userId }, { $set: { items: [] } });
};

module.exports = {
  createPendingOrder,
  markOrderPaid,
  commitStock,
  clearCart,
};
