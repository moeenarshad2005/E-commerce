const express = require("express");

const { getProfile, updateProfile } = require("../controllers/user.controller");
const { protect } = require("../middleware/auth.middleware");
const validate = require("../middleware/validate.middleware");
const { updateProfileSchema } = require("../validators/user.validator");

const router = express.Router();

router.use(protect);

// GET /api/v1/users/me - Get the signed-in user's profile
// PATCH /api/v1/users/me - Update the signed-in user's profile
router
  .route("/me")
  .get(getProfile)
  .patch(validate(updateProfileSchema), updateProfile);

module.exports = router;
