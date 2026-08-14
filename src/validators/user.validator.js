const { z } = require("zod");

const updateProfileSchema = {
  body: z
    .object({
      fullName: z
        .string()
        .trim()
        .min(2, "Full name must be at least 2 characters.")
        .max(80, "Full name cannot exceed 80 characters.")
        .optional(),

      username: z
        .string()
        .trim()
        .toLowerCase()
        .min(3, "Username must be at least 3 characters.")
        .max(30, "Username cannot exceed 30 characters.")
        .regex(
          /^[a-z0-9_.]+$/,
          "Username may contain only letters, numbers, dots and underscores."
        )
        .optional(),
    })
    .strict()
    .refine((body) => Object.keys(body).length > 0, {
      message: "Provide at least one field to update.",
    }),
};

module.exports = { updateProfileSchema };
