const Order = require("../models/order.model");

const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/AppError");
const { sendSuccess } = require("../utils/apiResponse");

/**
 * Reading your own orders. That is the whole controller.
 *
 * ── How ownership is enforced ───────────────────────────────────────────────
 *
 * The user id goes into the QUERY, never into an `if` afterwards:
 *
 *     Order.findOne({ _id: id, user: req.user._id })
 *
 * An `if (order.user !== req.user._id) throw` is one early return away from
 * being skipped. A filter that cannot match someone else's order cannot be
 * bypassed at all.
 *
 * A missing or foreign order returns 404, not 403 — telling a stranger "this
 * order exists but is not yours" confirms it exists.
 */

// GET /api/v1/orders
const getMyOrders = catchAsync(async (req, res) => {
  const { page, limit } = req.query;

  const filter = { user: req.user._id };

  const [orders, total] = await Promise.all([
    Order.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Order.countDocuments(filter),
  ]);

  return sendSuccess(res, {
    message: "Orders fetched successfully.",
    data: {
      orders,
      pagination: {
        total,
        page,
        limit,
        pages: Math.max(1, Math.ceil(total / limit)),
      },
    },
  });
});

// GET /api/v1/orders/:id
const getOrderById = catchAsync(async (req, res) => {
  const order = await Order.findOne({
    _id: req.params.id,
    user: req.user._id,
  });

  if (!order) {
    throw AppError.notFound("Order not found.");
  }

  return sendSuccess(res, {
    message: "Order fetched successfully.",
    data: { order },
  });
});

module.exports = { getMyOrders, getOrderById };
