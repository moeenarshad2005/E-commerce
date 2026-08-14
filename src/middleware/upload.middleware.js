const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");

const AppError = require("../utils/AppError");

const UPLOAD_ROOT = path.join(__dirname, "..", "..", "uploads");
const PRODUCT_IMAGE_DIR = path.join(UPLOAD_ROOT, "products");

const UPLOAD_URL_PREFIX = "/uploads";
const PRODUCT_IMAGE_URL_PREFIX = `${UPLOAD_URL_PREFIX}/products`;

fs.mkdirSync(PRODUCT_IMAGE_DIR, { recursive: true });

const EXTENSION_BY_MIME = Object.freeze({
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, PRODUCT_IMAGE_DIR),
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}`;
    cb(null, `${unique}${EXTENSION_BY_MIME[file.mimetype]}`);
  },
});

const fileFilter = (req, file, cb) => {
  if (!EXTENSION_BY_MIME[file.mimetype]) {
    return cb(
      AppError.badRequest("Only jpeg, png and webp images are allowed.")
    );
  }
  return cb(null, true);
};

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_FILES = 10;

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES },
});

const uploadProductImages = upload.array("images", MAX_FILES);

const productImageUrl = (file) =>
  `${PRODUCT_IMAGE_URL_PREFIX}/${file.filename}`;

module.exports = {
  uploadProductImages,
  productImageUrl,
  UPLOAD_ROOT,
  UPLOAD_URL_PREFIX,
  PRODUCT_IMAGE_URL_PREFIX,
  MAX_FILES,
  MAX_FILE_BYTES,
};
