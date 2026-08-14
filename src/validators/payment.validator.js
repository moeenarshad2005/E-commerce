const { z } = require("zod");

const { shippingAddressSchema } = require("./order.validator");

/**
 * The checkout body: a shipping address, and nothing else.
 *
 * `.strict()` on the outer object is the important part. Everything the payment
 * needs — who is paying, what is in their cart, what it costs — is already
 * known to the server, so there is no legitimate money field a client could
 * send. `{"amountCents": 1}` is answered with
 *
 *   400  { "success": false, "message": "Validation failed.",
 *          "errors": [{ "field": "body", "message": "Unrecognized key: \"amountCents\"" }] }
 *
 * rather than being quietly dropped. Both outcomes are safe; only one of them
 * shows up in the logs when somebody starts probing.
 */
const createIntentSchema = {
  body: z
    .object({
      shippingAddress: shippingAddressSchema,
    })
    .strict(),
};

module.exports = { createIntentSchema };
