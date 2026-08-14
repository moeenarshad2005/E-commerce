const bcrypt = require("bcryptjs");

const User = require("../models/user.model");
const Product = require("../models/product.model");
const Category = require("../models/category.model");
const Cart = require("../models/cart.model");
const {
  ROLES,
  ACCOUNT_STATUS,
  PRODUCT_STATUS,
  PRODUCT_SIZES,
  BCRYPT_ROUNDS,
} = require("../config/constants");
const { formatMinorUnits } = require("../utils/money");

const prepareNewPassword = async (request) => {
  if (request.method !== "post") return request;

  const payload = request.payload || {};

  if (!payload.password) delete payload.password;

  request.payload = payload;
  return request;
};

const prepareEditedPassword = async (request) => {
  if (request.method !== "post") return request;

  const payload = request.payload || {};

  if (payload.password) {
    payload.password = await bcrypt.hash(payload.password, BCRYPT_ROUNDS);

    payload.passwordChangedAt = new Date(Date.now() - 1000);
  } else {
    delete payload.password;
  }

  request.payload = payload;
  return request;
};

const stampAuthor = (field) => async (request, context) => {
  if (request.method !== "post") return request;

  const adminId = context?.currentAdmin?.id;

  if (!adminId) {
    throw new Error(
      "Sign in with a real admin account to do this. The bootstrap .env login has no user record to attribute the change to — run: npm run make:admin your@email.com"
    );
  }

  request.payload = { ...(request.payload || {}), [field]: adminId };
  return request;
};

const userResource = {
  resource: User,

  options: {
    navigation: { name: "Accounts", icon: "User" },

    listProperties: [
      "email",
      "username",
      "fullName",
      "role",
      "isEmailVerified",
      "accountStatus",
      "createdAt",
    ],

    showProperties: [
      "_id",
      "fullName",
      "username",
      "email",
      "role",
      "isEmailVerified",
      "accountStatus",
      "stripeCustomerId",
      "createdAt",
      "updatedAt",
    ],

    editProperties: [
      "fullName",
      "username",
      "email",
      "password",
      "role",
      "isEmailVerified",
      "accountStatus",
    ],

    filterProperties: [
      "email",
      "username",
      "fullName",
      "role",
      "isEmailVerified",
      "accountStatus",
      "stripeCustomerId",
      "createdAt",
    ],

    sort: { sortBy: "createdAt", direction: "desc" },

    properties: {
      _id: { isVisible: { list: false, show: true, edit: false, filter: false } },

      fullName: { position: 1, isTitle: true },
      username: { position: 2 },
      email: { position: 3 },

      password: {
        type: "password",
        position: 4,
        isVisible: { list: false, show: false, edit: true, filter: false },
        description:
          "Leave blank to keep the current password. Anything entered here is hashed before saving, and signs the user out of other sessions.",
      },

      role: {
        position: 5,
        availableValues: Object.values(ROLES).map((value) => ({
          value,
          label: value === ROLES.ADMIN ? "Admin" : "User",
        })),
        description: "Admins can sign in to this panel. Change with care.",
      },

      isEmailVerified: {
        position: 6,
        description:
          "Tick to confirm an address manually, for example if a user never received the email.",
      },

      accountStatus: {
        position: 7,
        availableValues: Object.values(ACCOUNT_STATUS).map((value) => ({
          value,
          label: value.charAt(0).toUpperCase() + value.slice(1),
        })),
        description:
          "Anything other than Active blocks both login and existing tokens immediately.",
      },

      stripeCustomerId: {
        isVisible: { list: false, show: true, edit: false, filter: true },
        description: "Managed by the API. Read-only.",
      },

      createdAt: { isVisible: { list: true, show: true, edit: false, filter: true } },
      updatedAt: { isVisible: { list: false, show: true, edit: false, filter: false } },

      emailVerificationToken: { isVisible: false },
      emailVerificationExpires: { isVisible: false },
      emailVerificationSentAt: { isVisible: false },
      passwordResetToken: { isVisible: false },
      passwordResetExpires: { isVisible: false },
      passwordChangedAt: { isVisible: false },
      __v: { isVisible: false },
    },

    actions: {
      new: { before: prepareNewPassword },
      edit: { before: prepareEditedPassword },
    },
  },
};

const categoryResource = {
  resource: Category,

  options: {
    navigation: { name: "Catalogue", icon: "List" },

    listProperties: ["name", "slug", "isActive", "createdAt"],
    showProperties: [
      "_id",
      "name",
      "slug",
      "description",
      "image",
      "isActive",
      "createdBy",
      "updatedBy",
      "createdAt",
      "updatedAt",
    ],
    editProperties: ["name", "slug", "description", "image", "isActive"],
    filterProperties: ["name", "slug", "isActive", "createdAt"],

    sort: { sortBy: "createdAt", direction: "desc" },

    properties: {
      _id: { isVisible: { list: false, show: true, edit: false, filter: false } },
      name: { isTitle: true, position: 1 },
      slug: {
        position: 2,
        description: "Used in URLs. Lowercase letters, numbers and hyphens.",
      },
      description: { type: "textarea", position: 3 },
      image: { position: 4, description: "A full image URL." },
      isActive: { position: 5 },

      createdBy: { isVisible: { list: false, show: true, edit: false, filter: true } },
      updatedBy: { isVisible: { list: false, show: true, edit: false, filter: false } },
      __v: { isVisible: false },
    },

    actions: {
      new: { before: stampAuthor("createdBy") },
      edit: { before: stampAuthor("updatedBy") },
    },
  },
};

const checkDiscountOnEdit = async (request, context) => {
  const stamped = await stampAuthor("updatedBy")(request, context);
  if (stamped.method !== "post") return stamped;

  const payload = stamped.payload || {};
  const current = context?.record?.params || {};

  const price =
    payload.priceCents !== undefined && payload.priceCents !== ""
      ? Number(payload.priceCents)
      : Number(current.priceCents);

  const raw = payload.discountPriceCents;
  const discount =
    raw !== undefined
      ? raw === "" || raw === null
        ? null
        : Number(raw)
      : current.discountPriceCents === undefined ||
          current.discountPriceCents === null
        ? null
        : Number(current.discountPriceCents);

  if (discount !== null && Number.isFinite(price) && discount >= price) {
    throw new Error(
      `Discount price must be lower than the price (price is ${price} = ${formatMinorUnits(price)}).`
    );
  }

  return stamped;
};

const checkMoneyIsIntegerMinorUnits = (request) => {
  if (request.method !== "post") return request;

  const payload = request.payload || {};

  for (const field of ["priceCents", "discountPriceCents"]) {
    const raw = payload[field];
    if (raw === undefined || raw === null || raw === "") continue;

    const value = Number(raw);

    if (!Number.isInteger(value)) {
      throw new Error(
        `${field} must be a WHOLE number of minor units — no decimal point. For ${value} in the store currency, type ${Math.round(value * 100)}.`
      );
    }
  }

  return request;
};

const productResource = {
  resource: Product,

  options: {
    navigation: { name: "Catalogue", icon: "Package" },

    listProperties: [
      "name",
      "sku",
      "category",
      "priceCents",
      "discountPriceCents",
      "stock",
      "status",
      "featured",
    ],

    showProperties: [
      "_id",
      "name",
      "slug",
      "sku",
      "brand",
      "category",
      "shortDescription",
      "description",
      "priceCents",
      "discountPriceCents",
      "stock",
      "status",
      "featured",
      "tags",
      "colors",
      "sizes",
      "thumbnail",
      "images",
      "createdBy",
      "updatedBy",
      "createdAt",
      "updatedAt",
    ],

    editProperties: [
      "name",
      "slug",
      "sku",
      "brand",
      "category",
      "shortDescription",
      "description",
      "priceCents",
      "discountPriceCents",
      "stock",
      "status",
      "featured",
      "tags",
      "colors",
      "sizes",
      "thumbnail",
      "images",
    ],

    filterProperties: [
      "name",
      "sku",
      "brand",
      "category",
      "status",
      "featured",
      "priceCents",
      "stock",
      "createdAt",
    ],

    sort: { sortBy: "createdAt", direction: "desc" },

    properties: {
      _id: { isVisible: { list: false, show: true, edit: false, filter: false } },

      name: { isTitle: true, position: 1 },

      slug: {
        position: 2,
        description:
          "Leave blank on a new product and one is generated from the name. Changing it changes the public URL.",
      },

      sku: { position: 3 },
      brand: { position: 4 },

      category: { position: 5 },

      shortDescription: {
        type: "textarea",
        position: 6,
        description: "One line, shown on product cards.",
      },
      description: { type: "textarea", position: 7 },

      priceCents: {
        position: 8,
        description:
          "MINOR UNITS — no decimal point. 24999 means 249.99, NOT 24,999. Must be higher than the discount price.",
      },
      discountPriceCents: {
        position: 9,
        description:
          "MINOR UNITS — no decimal point. Leave blank for no discount. Must be lower than the price.",
      },

      stock: { position: 10 },

      status: {
        position: 11,
        availableValues: Object.values(PRODUCT_STATUS).map((value) => ({
          value,
          label: value.charAt(0).toUpperCase() + value.slice(1),
        })),
        description:
          "Only Active products appear in the public catalogue. Draft is invisible to shoppers; Archived hides it from the catalogue.",
      },

      featured: { position: 12 },
      tags: { position: 13 },

      colors: {
        position: 16,
        description:
          'One entry per colour, exactly as it should appear to the customer — for example "Black", "Navy". Leave empty for products with no colour choice.',
      },

      sizes: {
        position: 17,
        availableValues: PRODUCT_SIZES.map((value) => ({
          value,
          label: value,
        })),
        description:
          "Leave empty for anything that is not clothing — a phone has no size. Order does not matter; the API sorts them.",
      },

      thumbnail: {
        position: 14,
        description:
          "Leave blank and the first image is used. Paste a URL to override it.",
      },

      images: {
        position: 15,
        description:
          "Image URLs. Files are normally uploaded through the API; paths added here must already exist under /uploads.",
      },

      createdBy: { isVisible: { list: false, show: true, edit: false, filter: true } },
      updatedBy: { isVisible: { list: false, show: true, edit: false, filter: false } },
      __v: { isVisible: false },
    },

    actions: {
      new: {
        before: async (request, context) =>
          checkMoneyIsIntegerMinorUnits(
            await stampAuthor("createdBy")(request, context)
          ),
      },
      edit: {
        before: async (request, context) =>
          checkMoneyIsIntegerMinorUnits(
            await checkDiscountOnEdit(request, context)
          ),
      },
    },
  },
};

const cartResource = {
  resource: Cart,

  options: {
    navigation: { name: "Sales", icon: "ShoppingCart" },

    listProperties: ["user", "items", "updatedAt"],
    showProperties: ["_id", "user", "items", "createdAt", "updatedAt"],
    filterProperties: ["user", "updatedAt"],

    sort: { sortBy: "updatedAt", direction: "desc" },

    properties: {
      _id: { isVisible: { list: false, show: true, edit: false, filter: false } },
      user: { isTitle: true },
    },

    actions: {
      new: { isAccessible: false },
      edit: { isAccessible: false },
    },
  },
};

module.exports = {
  userResource,
  categoryResource,
  productResource,
  cartResource,
};
