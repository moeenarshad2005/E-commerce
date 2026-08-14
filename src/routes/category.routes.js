const express = require("express");

const {
  createCategory,
  getCategories,
  getCategoryById,
  updateCategory,
  deleteCategory,
} = require("../controllers/category.controller");

const {
  createCategorySchema,
  updateCategorySchema,
  listCategoriesSchema,
  categoryIdSchema,
} = require("../validators/category.validator");

const validate = require("../middleware/validate.middleware");
const { protect, restrictTo } = require("../middleware/auth.middleware");
const { ROLES } = require("../config/constants");

const router = express.Router();

// POST /api/v1/categories - Create a category (admin)
router.post(
  "/",
  protect,
  restrictTo(ROLES.ADMIN),
  validate(createCategorySchema),
  createCategory
);

// GET /api/v1/categories - List categories
router.get("/", validate(listCategoriesSchema), getCategories);

// GET /api/v1/categories/:id - Get a category by id
router.get("/:id", validate(categoryIdSchema), getCategoryById);

// PATCH /api/v1/categories/:id - Update a category (admin)
router.patch(
  "/:id",
  protect,
  restrictTo(ROLES.ADMIN),
  validate(updateCategorySchema),
  updateCategory
);

// DELETE /api/v1/categories/:id - Soft-delete a category (admin)
router.delete(
  "/:id",
  protect,
  restrictTo(ROLES.ADMIN),
  validate(categoryIdSchema),
  deleteCategory
);

module.exports = router;