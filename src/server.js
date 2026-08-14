const env = require("./config/env");
const logger = require("./config/logger");
const app = require("./app");
const { connectDB, disconnectDB } = require("./config/db");
const { mountAdmin } = require("./admin/admin");

let server;

const start = async () => {
  try {
    await connectDB();

    await mountAdmin(app.adminRouter);

    server = app.listen(env.PORT, () => {
      logger.info(
        `Server listening on http://localhost:${env.PORT} (${env.NODE_ENV})`
      );
    });
  } catch (error) {
    logger.error("failed to start server", { message: error.message });
    process.exit(1);
  }
};

const shutdown = (signal) => async () => {
  logger.info(`${signal} received — shutting down`);

  const force = setTimeout(() => {
    logger.error("graceful shutdown timed out — forcing exit");
    process.exit(1);
  }, 10000);
  force.unref();

  try {
    if (server) await new Promise((resolve) => server.close(resolve));
    await disconnectDB();
    logger.info("shutdown complete");
    process.exit(0);
  } catch (error) {
    logger.error("error during shutdown", { message: error.message });
    process.exit(1);
  }
};

process.on("SIGTERM", shutdown("SIGTERM"));
process.on("SIGINT", shutdown("SIGINT"));

process.on("unhandledRejection", (reason) => {
  logger.error("unhandled promise rejection", { reason: String(reason) });
  shutdown("unhandledRejection")();
});

process.on("uncaughtException", (error) => {
  logger.error("uncaught exception", { message: error.message });
  process.exit(1);
});

start();
