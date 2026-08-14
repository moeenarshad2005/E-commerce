const mongoose = require("mongoose");

const env = require("./env");
const logger = require("./logger");

const connectDB = async (uri = env.MONGO_URI) => {
  mongoose.set("strictQuery", true);

  mongoose.set("autoIndex", !env.isProduction);

  mongoose.connection.on("error", (err) => {
    logger.error("mongodb connection error", { message: err.message });
  });

  mongoose.connection.on("disconnected", () => {
    logger.warn("mongodb disconnected — driver will retry");
  });

  const conn = await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000,
    maxPoolSize: 10,
  });

  logger.info(`MongoDB connected: ${conn.connection.host}`);
  return conn;
};

const disconnectDB = () => mongoose.connection.close(false);

module.exports = { connectDB, disconnectDB };
