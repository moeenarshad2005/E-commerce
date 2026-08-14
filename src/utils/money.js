const MINOR_UNITS_PER_MAJOR = 100;

const MAX_MINOR_UNITS = 1_000_000_000;

const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;

const toMinorUnits = (value) => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return null;

  const text = typeof value === "number" ? String(value) : String(value).trim();

  if (!DECIMAL_PATTERN.test(text)) return null;

  const negative = text.startsWith("-");
  const [whole, fraction = ""] = text.replace("-", "").split(".");

  if (fraction.length > 2) return null;

  const paddedFraction = (fraction + "00").slice(0, 2);
  const minor =
    Number(whole) * MINOR_UNITS_PER_MAJOR + Number(paddedFraction);

  if (!Number.isSafeInteger(minor)) return null;

  return negative ? -minor : minor;
};

const roundToMinorUnits = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;

  return toMinorUnits(number.toFixed(2));
};

const toMajorUnits = (minor) => {
  if (typeof minor !== "number" || !Number.isFinite(minor)) return null;

  return Math.round(minor) / MINOR_UNITS_PER_MAJOR;
};

const formatMinorUnits = (minor) => {
  if (typeof minor !== "number" || !Number.isFinite(minor)) return "";

  const negative = minor < 0;
  const absolute = Math.abs(Math.round(minor));
  const whole = Math.floor(absolute / MINOR_UNITS_PER_MAJOR);
  const fraction = String(absolute % MINOR_UNITS_PER_MAJOR).padStart(2, "0");

  return `${negative ? "-" : ""}${whole}.${fraction}`;
};

const isValidMinorUnits = (value) =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value <= MAX_MINOR_UNITS;

module.exports = {
  MINOR_UNITS_PER_MAJOR,
  MAX_MINOR_UNITS,
  toMinorUnits,
  roundToMinorUnits,
  toMajorUnits,
  formatMinorUnits,
  isValidMinorUnits,
};
