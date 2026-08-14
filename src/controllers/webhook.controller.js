const env = require("../config/env");
const logger = require("../config/logger");
const { getStripe } = require("../services/stripe.service");
const {
  markOrderPaid,
  commitStock,
  clearCart,
} = require("../services/order.service");

const stripeWebhook = async (req, res) => {
  const stripe = getStripe();

  if (!stripe || !env.STRIPE_WEBHOOK_SECRET) {
    logger.error("stripe webhook called but STRIPE_WEBHOOK_SECRET is not set");
    return res.status(503).send("Webhook not configured.");
  }

  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body, // a Buffer, because express.raw() ran instead of express.json()
      req.headers["stripe-signature"],
      env.STRIPE_WEBHOOK_SECRET
    );
  } catch (error) {
    // Deliberately uninformative. A detailed message tells whoever is probing
    // exactly how their forgery was detected.
    logger.warn("stripe webhook signature rejected", { message: error.message });
    return res.status(400).send("Invalid signature.");
  }

  // Everything below this line is proven to have come from Stripe.

  if (event.type !== "payment_intent.succeeded") {
    // Anything else is acknowledged so Stripe stops resending it. Handling more
    // event types is the wrong default: each one is a code path that must be
    // correct, and this project only needs the one.
    return res.status(200).json({ received: true, ignored: event.type });
  }

  const intent = event.data.object;

  try {
    /**
     * The conditional update is the idempotency guard. If the event has already
     * been processed the order is no longer `unpaid`, nothing matches, and this
     * returns null — so a redelivery cannot decrement stock or clear the cart a
     * second time.
     */
    const order = await markOrderPaid(intent.id);

    if (!order) {
      logger.info("stripe webhook: already processed", { paymentIntent: intent.id });
      return res.status(200).json({ received: true, duplicate: true });
    }

    // Compared as integers, both in minor units. Logged rather than thrown: the
    // money has genuinely moved, so refusing the order would lose a paid sale.
    // A human reconciles from the log.
    if (intent.amount !== order.totalCents) {
      logger.error("stripe webhook: amount mismatch", {
        orderId: String(order._id),
        stripeAmount: intent.amount,
        orderTotal: order.totalCents,
      });
    }

    const { oversold } = await commitStock(order._id);

    await clearCart(order.user);

    logger.info("order paid", {
      orderId: String(order._id),
      userId: String(order.user),
      totalCents: order.totalCents,
      oversold: oversold.length,
    });

    return res.status(200).json({ received: true, orderId: String(order._id) });
  } catch (error) {
    // 500 asks Stripe to retry. The order is left exactly as this run found it,
    // so the retry re-runs the same guarded steps safely.
    logger.error("stripe webhook handler failed", {
      paymentIntent: intent.id,
      message: error.message,
    });
    return res.status(500).send("Webhook handler failed.");
  }
};

module.exports = { stripeWebhook };
