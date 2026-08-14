const express = require("express");

const { createIntent } = require("../controllers/payment.controller");
const { protect } = require("../middleware/auth.middleware");
const validate = require("../middleware/validate.middleware");
const { createIntentSchema } = require("../validators/payment.validator");

const router = express.Router();

router.use(protect);

// POST /api/v1/payment/create-intent - Create a Stripe payment intent for the signed-in user's cart
router.post("/create-intent", validate(createIntentSchema), createIntent);

module.exports = router;
