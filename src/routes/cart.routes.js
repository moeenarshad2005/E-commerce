const express = require("express");

const {
  getCart,
  addCartItem,
  updateCartItem,
  removeCartItem,
  clearCart,
} = require("../controllers/cart.controller");

const { protect } = require("../middleware/auth.middleware");
const validate = require("../middleware/validate.middleware");

const {
  addCartItemSchema,
  updateCartItemSchema,
  cartItemParamSchema,
} = require("../validators/cart.validator");

const router = express.Router();

router.use(protect);

// GET /api/v1/cart - Get the signed-in user's cart
// DELETE /api/v1/cart - Clear the signed-in user's cart
router.route("/").get(getCart).delete(clearCart);

// POST /api/v1/cart/items - Add an item to the cart
router.post("/items", validate(addCartItemSchema), addCartItem);

// PATCH/PUT /api/v1/cart/items/:productId - Set an item's quantity
// DELETE /api/v1/cart/items/:productId - Remove an item from the cart
router
  .route("/items/:productId")
  .patch(validate(updateCartItemSchema), updateCartItem)
  .put(validate(updateCartItemSchema), updateCartItem)
  .delete(validate(cartItemParamSchema), removeCartItem);

module.exports = router;
