const Product = require("../models/product.model");
const Category = require("../models/category.model");

const { PRODUCT_STATUS, ROLES } = require("../config/constants");

const canSeeAllStatuses = (user) => Boolean(user) && user.role === ROLES.ADMIN;

const STAFF_FIELDS = "fullName";

const SORT_FIELDS = Object.freeze({
  price: "priceCents",
  "-price": "-priceCents",
});

const toStoredSort = (sort) => SORT_FIELDS[sort] || sort;

const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/AppError");
const { sendSuccess } = require("../utils/apiResponse");
const { productImageUrl } = require("../middleware/upload.middleware");

// POST /api/v1/products
const createProduct = catchAsync(async (req, res) => {
  const {
  name,
  slug,
  shortDescription,
  description,
  brand,
  category,
  thumbnail,
  priceCents,
  discountPriceCents,
  stock,
  sku,
  status,
  featured,
  tags,
  colors,
  sizes,
} = req.body;

const images = (req.files || []).map(productImageUrl);

if (!images.length) {
  throw AppError.badRequest(
    "At least one product image is required. Send the files as multipart/form-data under the field name 'images'."
  );
}


  const existingCategory = await Category.findById(category);

  if (!existingCategory) {
    throw AppError.notFound("Category not found.");
  }

  const slugExists = slug
    ? await Product.findOne({ slug }).select("_id").lean()
    : null;

  if (slugExists) {
    throw AppError.conflict("Product slug already exists.");
  }

  const skuExists = await Product.findOne({ sku }).select("_id").lean();

  if (skuExists) {
    throw AppError.conflict("SKU already exists.");
  }

  const product = await Product.create({
    name,
    slug,
    shortDescription,
    description,
    brand,
    category,
    images,
    thumbnail,
    priceCents,
    discountPriceCents,
    stock,
    sku,
    status,
    featured,
    tags,
    colors,
    sizes,
    createdBy: req.user._id,
  });

  await product.populate([
    {
      path: "category",
      select: "name slug",
    },
    {
      path: "createdBy",
      select: "fullName email",
    },
  ]);

  return sendSuccess(res, {
    status: 201,
    message: "Product created successfully.",
    data: {
      product,
    },
  });
});
// GET /api/v1/products
const getProducts = catchAsync(async (req, res) => {
  const {
    category,
    brand,
    status,
    featured,
    minPrice,
    maxPrice,
    search,
    page = 1,
    limit = 10,
    sort = "-createdAt",
  } = req.query;

  const filter = {};

  if (canSeeAllStatuses(req.user)) {
    filter.status = status || { $ne: PRODUCT_STATUS.ARCHIVED };
  } else if (status && status !== PRODUCT_STATUS.ACTIVE) {
    filter.status = { $in: [] };
  } else {
    filter.status = PRODUCT_STATUS.ACTIVE;
  }

  if (category) {
    filter.category = category;
  }

  if (brand) {
    filter.brand = brand;
  }

  if (featured !== undefined) {
    filter.featured = featured;
  }

  if (minPrice !== undefined || maxPrice !== undefined) {
    filter.priceCents = {};
    if (minPrice !== undefined) filter.priceCents.$gte = minPrice;
    if (maxPrice !== undefined) filter.priceCents.$lte = maxPrice;
  }

  if (search) {
    filter.$text = {
      $search: search,
    };
  }

  const currentPage = page;
  const pageSize = limit;
  const skip = (currentPage - 1) * pageSize;

  const [products, total] = await Promise.all([
    Product.find(filter)
      .populate("category", "name slug")
      .populate("createdBy", STAFF_FIELDS)
      .sort(toStoredSort(sort))
      .skip(skip)
      .limit(pageSize),
    Product.countDocuments(filter),
  ]);

  return sendSuccess(res, {
    message: "Products fetched successfully.",
    data: {
      products,
      pagination: {
        total,
        page: currentPage,
        limit: pageSize,
        pages: Math.ceil(total / pageSize),
      },
    },
  });
});
// GET /api/v1/products/:id
const getProductById = catchAsync(async (req, res) => {
  const { id } = req.params;

  const product = await Product.findById(id)
    .populate("category", "name slug description")
    .populate("createdBy", STAFF_FIELDS)
    .populate("updatedBy", STAFF_FIELDS);

  if (!product) {
    throw AppError.notFound("Product not found.");
  }

  const visible =
    canSeeAllStatuses(req.user) ||
    product.status === PRODUCT_STATUS.ACTIVE;

  if (!visible) {
    throw AppError.notFound("Product not found.");
  }
  return sendSuccess(res, {
    message: "Product fetched successfully.",
    data: {
      product,
    },
  });
});
// PUT /api/v1/products/:id
const updateProduct = catchAsync(async (req, res) => {
  const { id } = req.params;

  const product = await Product.findById(id);

  if (!product) {
    throw AppError.notFound("Product not found.");
  }
  if (product.status === PRODUCT_STATUS.ARCHIVED) {
    throw AppError.badRequest("Archived products cannot be updated.");
  }

  const {
    name,
    slug,
    shortDescription,
    description,
    brand,
    category,
    images,
    thumbnail,
    priceCents,
    discountPriceCents,
    stock,
    sku,
    status,
    featured,
    tags,
    colors,
    sizes,
  } = req.body;

  if (category && String(category) !== String(product.category)) {
    const existingCategory = await Category.findById(category);

    if (!existingCategory) {
      throw AppError.notFound("Category not found.");
    }

    product.category = category;
  }

  if (slug && slug !== product.slug) {
    const slugExists = await Product.findOne({
      slug,
      _id: { $ne: id },
    });

    if (slugExists) {
      throw AppError.conflict("Product slug already exists.");
    }

    product.slug = slug;
  }

  if (sku && sku !== product.sku) {
    const skuExists = await Product.findOne({
      sku,
      _id: { $ne: id },
    });

    if (skuExists) {
      throw AppError.conflict("SKU already exists.");
    }

    product.sku = sku;
  }

  if (name !== undefined) product.name = name;

  if (shortDescription !== undefined)
    product.shortDescription = shortDescription;

  if (description !== undefined)
    product.description = description;

  if (brand !== undefined) product.brand = brand;

  if (priceCents !== undefined) product.priceCents = priceCents;

  if (discountPriceCents !== undefined)
    product.discountPriceCents = discountPriceCents;

  if (stock !== undefined) product.stock = stock;

  if (status !== undefined) product.status = status;

  if (featured !== undefined) product.featured = featured;

  if (tags !== undefined) product.tags = tags;
  if (colors !== undefined) product.colors = colors;
  if (sizes !== undefined) product.sizes = sizes;

  if (images !== undefined) {
    product.images = images;

    if (thumbnail === undefined) {
      product.thumbnail = "";
    }
  }

  if (thumbnail !== undefined) {
    product.thumbnail = thumbnail;
  }

  product.updatedBy = req.user._id;

  await product.save();

  await product.populate([
    {
      path: "category",
      select: "name slug",
    },
    {
      path: "createdBy",
      select: "fullName email",
    },
    {
      path: "updatedBy",
      select: "fullName email",
    },
  ]);

  return sendSuccess(res, {
    message: "Product updated successfully.",
    data: {
      product,
    },
  });
});
// DELETE /api/v1/products/:id
const deleteProduct = catchAsync(async (req, res) => {
  const { id } = req.params;

  const product = await Product.findById(id);

  if (!product) {
    throw AppError.notFound("Product not found.");
  }

  if (product.status === PRODUCT_STATUS.ARCHIVED) {
    throw AppError.badRequest("Product is already archived.");
  }

  product.status = PRODUCT_STATUS.ARCHIVED;
  product.updatedBy = req.user._id;

  await product.save();

  return sendSuccess(res, {
    message: "Product archived successfully.",
  });
});
module.exports = {
  createProduct,
  getProducts,
  getProductById,
  updateProduct,
  deleteProduct,
};