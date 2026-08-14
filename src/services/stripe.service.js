const Stripe = require("stripe");

const env = require("../config/env");
const logger = require("../config/logger");
const User = require("../models/user.model");

let cachedClient;

const getStripe = () => {
  if (cachedClient !== undefined) return cachedClient;

  cachedClient = env.STRIPE_SECRET_KEY
    ? new Stripe(env.STRIPE_SECRET_KEY)
    : null;

  return cachedClient;
};

const isStripeEnabled = () => Boolean(getStripe());

const ensureStripeCustomer = async (user) => {
  const stripe = getStripe();
  if (!stripe || !user) return null;

  let customerId = user.stripeCustomerId;

  if (customerId === undefined) {
    const fresh = await User.findById(user._id).select("+stripeCustomerId");
    customerId = fresh ? fresh.stripeCustomerId : null;
  }

  if (customerId) return customerId;

  const customer = await stripe.customers.create(
    {
      email: user.email,
      name: user.fullName,
      metadata: { userId: String(user._id) },
    },
    { idempotencyKey: `user-customer-${user._id}` }
  );

  await User.updateOne(
    { _id: user._id },
    { stripeCustomerId: customer.id }
  );

  user.stripeCustomerId = customer.id;

  logger.info("stripe customer created", {
    userId: String(user._id),
    customerId: customer.id,
  });

  return customer.id;
};

const ensureStripeCustomerInBackground = (user) => {
  if (!isStripeEnabled()) return;

  ensureStripeCustomer(user).catch((error) => {
    logger.error("stripe customer creation failed", {
      userId: String(user?._id),
      message: error.message,
      type: error.type,
    });
  });
};

const createPaymentIntent = async ({ user, amountCents, itemCount }) => {
  const stripe = getStripe();
  if (!stripe) return null;

  const customerId = await ensureStripeCustomer(user);

  return stripe.paymentIntents.create({
    amount: amountCents,
    currency: env.CURRENCY,
    ...(customerId ? { customer: customerId } : {}),

    automatic_payment_methods: { enabled: true },

    metadata: {
      userId: String(user._id),
      itemCount: String(itemCount),
    },
  });
};

module.exports = {
  getStripe,
  isStripeEnabled,
  ensureStripeCustomer,
  ensureStripeCustomerInBackground,
  createPaymentIntent,
};
