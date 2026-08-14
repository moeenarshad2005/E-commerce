const express = require("express");

const {
  createProduct,
  getProducts,
  getProductById,
  updateProduct,
  deleteProduct,
} = require("../controllers/product.controller");

const {
  protect,
  restrictTo,
  attachUserIfPresent,
} = require("../middleware/auth.middleware");
const validate = require("../middleware/validate.middleware");
const { uploadProductImages } = require("../middleware/upload.middleware");
const { ROLES } = require("../config/constants");

const {
  createProductSchema,
  updateProductSchema,
  listProductsSchema,
  productIdSchema,
} = require("../validators/product.validator");

const router = express.Router();

// GET /api/v1/products - List products
router.get(
  "/",
  attachUserIfPresent,
  validate(listProductsSchema),
  getProducts
);

// GET /api/v1/products/:id - Get a single product by id
router.get(
  "/:id",
  attachUserIfPresent,
  validate(productIdSchema),
  getProductById
);

// POST /api/v1/products - Create a product with images (admin)
router.post(
  "/",
  protect,
  restrictTo(ROLES.ADMIN),
  uploadProductImages,
  validate(createProductSchema),
  createProduct
);

// PUT/PATCH /api/v1/products/:id - Update a product (admin)
router
  .route("/:id")
  .put(protect, restrictTo(ROLES.ADMIN), validate(updateProductSchema), updateProduct)
  .patch(protect, restrictTo(ROLES.ADMIN), validate(updateProductSchema), updateProduct);

// DELETE /api/v1/products/:id - Archive (soft-delete) a product (admin)
router.delete(
  "/:id",
  protect,
  restrictTo(ROLES.ADMIN),
  validate(productIdSchema),
  deleteProduct
);

module.exports = router;