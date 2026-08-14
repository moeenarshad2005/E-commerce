const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/AppError");
const { sendSuccess } = require("../utils/apiResponse");
const env = require("../config/env");
const { ERROR_CODES } = require("../config/constants");
const { getOrCreateCart, buildCartView } = require("../services/cart.service");
const { createPendingOrder } = require("../services/order.service");
const {
  isStripeEnabled,
  createPaymentIntent,
} = require("../services/stripe.service");

/**
 * Checkout.
 *
 * ── The flow ────────────────────────────────────────────────────────────────
 *
 *   browser                       this endpoint                    Stripe
 *   ───────                       ─────────────                    ──────
 *   POST /payment/create-intent   validate the address
 *   { shippingAddress }           read + re-price the cart
 *                                 create a PaymentIntent      ->   client_secret
 *                                 create the order (UNPAID)
 *                            <--  { clientSecret, orderId }
 *   stripe.confirmCardPayment(clientSecret) -------------------->  charges
 *                                                             <--  webhook
 *                                 mark paid, take stock, clear cart
 *
 * ── Why the order is created BEFORE the browser can pay ─────────────────────
 *
 * The intent has to come first, because the order stores its id as the unique
 * key the webhook looks it up by. What matters is that BOTH exist before the
 * client secret is handed out: when the webhook arrives, the order it refers to
 * already exists and already carries the amounts that were quoted. Building the
 * order from the webhook instead would mean reconstructing the basket from a
 * payment notification — and the cart may have changed by then.
 *
 * The order is created `unpaid`. It becomes paid only when Stripe says so.
 *
 * ── What is NOT accepted here ───────────────────────────────────────────────
 *
 * No amount, no price, no total, no product list, no quantities. The body is a
 * shipping address and nothing else, enforced by a .strict() schema — so a
 * client sending `"amountCents": 1` gets a 400 naming the field.
 */

// POST /api/v1/payment/create-intent
const createIntent = catchAsync(async (req, res) => {
  if (!isStripeEnabled()) {
    throw new AppError(
      503,
      "Payments are not available right now.",
      ERROR_CODES.PAYMENT_UNAVAILABLE
    );
  }

  const { shippingAddress } = req.body;

  const cart = await getOrCreateCart(req.user._id);

  // Re-reads every product NOW: current price, current stock, current status.
  // The stored cart contributes only ids, quantities and the chosen variant.
  const view = await buildCartView(cart);

  if (!view.items.length) {
    throw AppError.badRequest("Your cart is empty.", ERROR_CODES.CART_EMPTY);
  }

  // One unavailable line fails the whole checkout. Quietly dropping it and
  // charging for the rest means billing a total the customer never saw.
  if (!view.checkoutReady) {
    throw AppError.badRequest(
      "Some items in your cart are no longer available.",
      ERROR_CODES.CART_UNAVAILABLE,
      view.issues
    );
  }

  const intent = await createPaymentIntent({
    user: req.user,
    amountCents: view.subtotalCents,
    itemCount: view.itemCount,
  });

  const order = await createPendingOrder({
    userId: req.user._id,
    view,
    shippingAddress,
    paymentIntentId: intent.id,
  });

  return sendSuccess(res, {
    status: 201,
    message: "Payment intent created successfully.",
    data: {
      /**
       * The only Stripe value the browser needs. It authorises confirming THIS
       * payment and nothing else — it cannot read the account, list customers,
       * or create a second charge. The secret key never leaves the server.
       */
      clientSecret: intent.client_secret,

      orderId: String(order._id),

      // For display only. What Stripe will actually charge is already fixed on
      // the intent; this is so the browser can show the customer a total.
      amountCents: view.subtotalCents,
      currency: env.CURRENCY,
      itemCount: view.itemCount,
    },
  });
});

module.exports = { createIntent };
