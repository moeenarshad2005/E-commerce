const express = require("express");

const { getMyOrders, getOrderById } = require("../controllers/order.controller");
const { protect } = require("../middleware/auth.middleware");
const validate = require("../middleware/validate.middleware");
const { listOrdersSchema, orderIdSchema } = require("../validators/order.validator");

const router = express.Router();

/**
 * Read-only, and always the caller's own orders.
 *
 * There is no POST, PATCH or DELETE here on purpose. An order is created by the
 * checkout flow and completed by the Stripe webhook; a customer must not be
 * able to invent one, reprice one, or mark one paid.
 */
router.use(protect);

router.get("/", validate(listOrdersSchema), getMyOrders);
router.get("/:id", validate(orderIdSchema), getOrderById);

module.exports = router;
