const session = require("express-session");

const MongoStore = require("connect-mongo").default;

const env = require("../config/env");
const logger = require("../config/logger");
const { authenticate } = require("./admin.auth");
const {
  userResource,
  categoryResource,
  productResource,
  cartResource,
} = require("./admin.resources");

const mountAdmin = async (adminRouter) => {
  if (!env.ADMIN_ENABLED) {
    logger.info("Admin panel disabled (ADMIN_ENABLED=false)");
    return null;
  }

  const { default: AdminJS } = await import("adminjs");
  const { default: AdminJSExpress } = await import("@adminjs/express");
  const AdminJSMongoose = await import("@adminjs/mongoose");

  AdminJS.registerAdapter({
    Database: AdminJSMongoose.Database,
    Resource: AdminJSMongoose.Resource,
  });

  const admin = new AdminJS({
    rootPath: env.ADMIN_ROOT_PATH,
    loginPath: `${env.ADMIN_ROOT_PATH}/login`,
    logoutPath: `${env.ADMIN_ROOT_PATH}/logout`,

    resources: [
      userResource,
      categoryResource,
      productResource,
      cartResource,
    ],

    branding: {
      companyName: env.ADMIN_BRAND_NAME,
      withMadeWithLove: false,
    },

    locale: {
      language: "en",
      translations: {
        en: {
          messages: {
            loginWelcome: "Sign in with an admin account.",
          },

          labels: {
            User: "Users",
            Category: "Categories",
            Product: "Products",
            Cart: "Carts",
          },
        },
      },
    },
  });

  const router = AdminJSExpress.buildAuthenticatedRouter(
    admin,
    {
      authenticate,
      cookieName: "adminjs",
      cookiePassword: env.ADMIN_COOKIE_SECRET,
    },
    null,
    {
      store: MongoStore.create({
        mongoUrl: env.MONGO_URI,
        collectionName: "adminSessions",
        ttl: 12 * 60 * 60,
      }),
      secret: env.ADMIN_COOKIE_SECRET,
      resave: false,
      saveUninitialized: false,
      name: "adminjs",
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: env.isProduction,
        maxAge: 12 * 60 * 60 * 1000,
      },
    }
  );

  adminRouter.use(router);

  if (!env.isProduction && !env.isTest) {
    await admin.watch();
  }

  logger.info(
    `Admin panel at http://localhost:${env.PORT}${admin.options.rootPath}`
  );

  return admin;
};

module.exports = { mountAdmin };
