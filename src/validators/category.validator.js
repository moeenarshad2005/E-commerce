const { z } = require("zod");

const name = z
  .string()
  .trim()
  .min(2, "Category name must be at least 2 characters.")
  .max(100, "Category name must be at most 100 characters.");

const slug = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, "Slug is required.")
  .max(100, "Slug must be at most 100 characters.")
  .regex(
    /^[a-z0-9-]+$/,
    "Slug may only contain lowercase letters, numbers and hyphens."
  );

const description = z
  .string()
  .trim()
  .max(500, "Description must be at most 500 characters.")
  .optional();

const image = z
  .string()
  .trim()
  .url("Image must be a valid URL.")
  .optional();

const isActive = z.boolean().optional();

const createCategorySchema = {
  body: z
    .object({
      name,
      slug,
      description,
      image,
      isActive,
    })
    .strict(),
};

const objectId = z
  .string()
  .trim()
  .regex(/^[a-f\d]{24}$/i, "Must be a valid id.");

const updateCategorySchema = {
  params: z.object({ id: objectId }),
  body: z
    .object({
      name: name.optional(),
      slug: slug.optional(),
      description,
      image,
      isActive,
    })
    .strict()
    .refine((d) => Object.keys(d).length > 0, {
      message: "Provide at least one field to update.",
    }),
};

const listCategoriesSchema = {
  query: z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(10),
      search: z.string().trim().min(1).max(80).optional(),
      isActive: z
        .union([
          z.boolean(),
          z.enum(["true", "false"]).transform((v) => v === "true"),
        ])
        .optional(),
    })
    .strict(),
};

const categoryIdSchema = {
  params: z.object({ id: objectId }),
};

module.exports = {
  createCategorySchema,
  updateCategorySchema,
  listCategoriesSchema,
  categoryIdSchema,
};