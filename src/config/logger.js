const env = require("./env");
const LEVELS = { error: 0, warn: 1, info: 2, silent: -1 };
const threshold = LEVELS[env.LOG_LEVEL] ?? LEVELS.info;

const SECRET_KEYS = ["password", "token", "authorization", "smtp_pass", "pass"];

const redact = (value, depth = 0) => {
  if (depth > 4 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));

  return Object.fromEntries(
    Object.entries(value).map(([key, v]) => [
      key,
      SECRET_KEYS.includes(key.toLowerCase()) ? "[redacted]" : redact(v, depth + 1),
    ])
  );
};

const write = (level, message, meta) => {
  if (threshold < LEVELS[level]) return;

  const time = new Date().toISOString().slice(11, 19);
  const line = `[${time}] ${level.toUpperCase().padEnd(5)} ${message}`;

  if (meta === undefined) console[level === "info" ? "log" : level](line);
  else console[level === "info" ? "log" : level](line, redact(meta));
};

module.exports = {
  info: (message, meta) => write("info", message, meta),
  warn: (message, meta) => write("warn", message, meta),
  error: (message, meta) => write("error", message, meta),
};
