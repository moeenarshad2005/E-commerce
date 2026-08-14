const Category = require("../models/category.model");

const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/AppError");
const { sendSuccess } = require("../utils/apiResponse");

// POST /api/v1/categories
const createCategory = catchAsync(async (req, res) => {
  const { name, slug, description, image, isActive } = req.body;

  const existingCategory = await Category.findOne({
    $or: [{ name }, { slug }],
  })
    .select("_id")
    .lean();

  if (existingCategory) {
    throw AppError.conflict(
      "A category with this name or slug already exists."
    );
  }

  const category = await Category.create({
    name,
    slug,
    description,
    image,
    isActive,
    createdBy: req.user._id,
  });

  return sendSuccess(res, {
    status: 201,
    message: "Category created successfully.",
    data: { category },
  });
});

const escapeRegex = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// GET /api/v1/categories
const getCategories = catchAsync(async (req, res) => {
  const { page, limit, search, isActive } = req.query;
  const skip = (page - 1) * limit;

  const filter = {};

  if (search) {
    filter.name = { $regex: escapeRegex(search), $options: "i" };
  }

  if (isActive !== undefined) {
    filter.isActive = isActive;
  }

  const [categories, total] = await Promise.all([
    Category.find(filter)
      .populate("createdBy", "fullName")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),

    Category.countDocuments(filter),
  ]);

  return sendSuccess(res, {
    data: {
      categories,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    },
  });
});

// GET /api/v1/categories/:id
const getCategoryById = catchAsync(async (req, res) => {
  const category = await Category.findById(req.params.id)
    .populate("createdBy", "fullName email")
    .populate("updatedBy", "fullName email");

  if (!category) {
    throw AppError.notFound("Category not found.");
  }

  return sendSuccess(res, {
    data: { category },
  });
});

// PATCH /api/v1/categories/:id
const updateCategory = catchAsync(async (req, res) => {
  const category = await Category.findById(req.params.id);

  if (!category) {
    throw AppError.notFound("Category not found.");
  }

  const { name, slug, description, image, isActive } = req.body;

  if (name && name !== category.name) {
    const exists = await Category.findOne({
      name,
      _id: { $ne: category._id },
    })
      .select("_id")
      .lean();

    if (exists) {
      throw AppError.conflict("Category name already exists.");
    }

    category.name = name;
  }

  if (slug && slug !== category.slug) {
    const exists = await Category.findOne({
      slug,
      _id: { $ne: category._id },
    })
      .select("_id")
      .lean();

    if (exists) {
      throw AppError.conflict("Category slug already exists.");
    }

    category.slug = slug;
  }

  if (description !== undefined) {
    category.description = description;
  }

  if (image !== undefined) {
    category.image = image;
  }

  if (isActive !== undefined) {
    category.isActive = isActive;
  }

  category.updatedBy = req.user._id;

  await category.save();

  return sendSuccess(res, {
    message: "Category updated successfully.",
    data: { category },
  });
});

// DELETE /api/v1/categories/:id
const deleteCategory = catchAsync(async (req, res) => {
  const category = await Category.findById(req.params.id);

  if (!category) {
    throw AppError.notFound("Category not found.");
  }

  category.isActive = false;
  category.updatedBy = req.user._id;

  await category.save();

  return sendSuccess(res, {
    message: "Category deleted successfully.",
  });
});

module.exports = {
  createCategory,
  getCategories,
  getCategoryById,
  updateCategory,
  deleteCategory,
};