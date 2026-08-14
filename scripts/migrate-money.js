/**
 * Migrates product prices from floats in MAJOR units to integers in MINOR units.
 *
 *     npm run money:migrate                 # dry run — reads only, writes NOTHING
 *     npm run money:migrate -- --apply      # phase 1: adds the new fields
 *     npm run money:migrate -- --drop-legacy --apply   # phase 2: removes the old ones
 *
 * ── What actually changes ───────────────────────────────────────────────────
 *
 *     BEFORE   { price: 24999,    discountPrice: 19999   }   // ₨24,999.00
 *     AFTER    { priceCents: 2499900, discountPriceCents: 1999900 }
 *
 * The stored NUMBER is multiplied by 100. The AMOUNT OF MONEY does not change.
 * ₨24,999 before is ₨24,999 after. If that is not what the old numbers meant —
 * if `24999` was really ₨249.99 — then STOP, because this script will make
 * every product a hundred times more expensive. Check one product in the
 * admin panel against what you actually charge for it before running --apply.
 *
 * ── Why it is two phases ────────────────────────────────────────────────────
 * Phase 1 ADDS `priceCents` and leaves `price` untouched. Nothing is destroyed,
 * so if anything looks wrong the fix is to delete the new field, not to
 * reconstruct the old one from memory. Run the app, look at the catalogue, and
 * only then run phase 2 to drop the legacy fields.
 *
 * Both phases are idempotent: running either one twice does nothing the second
 * time.
 */

require("../src/config/env");

const mongoose = require("mongoose");

const { connectDB, disconnectDB } = require("../src/config/db");
const Product = require("../src/models/product.model");
const {
  toMinorUnits,
  roundToMinorUnits,
  formatMinorUnits,
} = require("../src/utils/money");

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const DROP_LEGACY = args.includes("--drop-legacy");

const pad = (value, width) => String(value).padEnd(width);

/* ---------------------------------------------------------------------------
 * Phase 1 — add the integer fields
 * ------------------------------------------------------------------------ */

const convert = (raw, label, problems, id) => {
  if (raw === null || raw === undefined) return null;

  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    problems.push(`${id}  ${label} is not a usable number: ${JSON.stringify(raw)}`);
    return undefined; // undefined = could not convert; skip this document
  }

  if (raw < 0) {
    problems.push(`${id}  ${label} is negative: ${raw}`);
    return undefined;
  }

  // The exact converter first. If the value has at most two decimals it is
  // converted with no rounding at all, which is the case for essentially every
  // real price.
  const exact = toMinorUnits(raw);
  if (exact !== null) return exact;

  // Otherwise it had more than two decimals — or float drift left it with a
  // long tail. Round, and record it so a human sees every value that moved.
  const rounded = roundToMinorUnits(raw);

  if (rounded === null) {
    problems.push(`${id}  ${label} could not be converted: ${raw}`);
    return undefined;
  }

  problems.push(
    `${id}  ${label} ${raw} was rounded to ${formatMinorUnits(rounded)}`
  );

  return rounded;
};

const runAddPhase = async () => {
  // .lean() and the raw collection: this must read documents as they are ON
  // DISK. Hydrating through the model would apply the NEW schema, which has no
  // `price` path at all, and every legacy value would silently read as
  // undefined — the migration would report "nothing to do" and convert nothing.
  const docs = await Product.collection
    .find({}, { projection: { price: 1, discountPrice: 1, priceCents: 1, discountPriceCents: 1, name: 1, sku: 1 } })
    .toArray();

  console.log(`Products in collection: ${docs.length}\n`);

  if (!docs.length) {
    console.log("Nothing to migrate — the products collection is empty.\n");
    return { converted: 0, skipped: 0, problems: [] };
  }

  const problems = [];
  const plan = [];
  let alreadyDone = 0;

  for (const doc of docs) {
    const id = String(doc._id);

    if (typeof doc.priceCents === "number") {
      alreadyDone += 1;
      continue;
    }

    if (doc.price === undefined) {
      problems.push(`${id}  has neither price nor priceCents — left alone`);
      continue;
    }

    const priceCents = convert(doc.price, "price", problems, id);
    if (priceCents === undefined) continue;

    const discountCents = convert(
      doc.discountPrice,
      "discountPrice",
      problems,
      id
    );
    if (discountCents === undefined) continue;

    // A pair that is already invalid must not be quietly carried across. It
    // would then fail validation on the first save, in some unrelated request,
    // months from now.
    if (
      discountCents !== null &&
      priceCents !== null &&
      discountCents >= priceCents
    ) {
      problems.push(
        `${id}  discount (${formatMinorUnits(discountCents)}) is not below price (${formatMinorUnits(priceCents)}) — converted anyway, but fix it`
      );
    }

    plan.push({
      _id: doc._id,
      name: doc.name,
      sku: doc.sku,
      oldPrice: doc.price,
      oldDiscount: doc.discountPrice ?? null,
      priceCents,
      discountPriceCents: discountCents,
    });
  }

  if (alreadyDone) {
    console.log(`${alreadyDone} product(s) already migrated — skipping those.\n`);
  }

  if (plan.length) {
    console.log("PLAN — every value that will be written:\n");
    console.log(
      `  ${pad("SKU", 18)}${pad("name", 28)}${pad("price", 14)}-> ${pad("priceCents", 14)}${pad("discount", 12)}-> discountCents`
    );
    console.log(`  ${"-".repeat(104)}`);

    for (const row of plan) {
      console.log(
        `  ${pad(row.sku || "-", 18)}${pad(String(row.name || "-").slice(0, 26), 28)}${pad(row.oldPrice, 14)}-> ${pad(row.priceCents, 14)}${pad(row.oldDiscount ?? "-", 12)}-> ${row.discountPriceCents ?? "-"}`
      );
    }
    console.log("");
  }

  if (problems.length) {
    console.log("NEEDS YOUR ATTENTION:\n");
    problems.forEach((p) => console.log(`  ! ${p}`));
    console.log("");
  }

  if (!APPLY) {
    console.log(
      `DRY RUN — nothing was written. ${plan.length} product(s) would be converted.`
    );
    console.log("Re-run with --apply once the table above looks right.\n");
    return { converted: 0, skipped: alreadyDone, problems };
  }

  if (!plan.length) {
    console.log("Nothing to write.\n");
    return { converted: 0, skipped: alreadyDone, problems };
  }

  // Written through the raw collection, NOT through the model. A model save
  // would run the full validator set on documents that still carry legacy
  // fields, and would rewrite `updatedAt` on every product for a change the
  // customer never made.
  let written = 0;

  for (const row of plan) {
    // eslint-disable-next-line no-await-in-loop -- one at a time so a failure
    // halfway through leaves a clear, countable boundary rather than a partial
    // bulk write nobody can reconstruct.
    const result = await Product.collection.updateOne(
      { _id: row._id },
      {
        $set: {
          priceCents: row.priceCents,
          discountPriceCents: row.discountPriceCents,
        },
      }
    );

    if (result.matchedCount) written += 1;
  }

  console.log(`Wrote priceCents to ${written} product(s).\n`);
  console.log("Next: start the API and check a few prices in the catalogue.");
  console.log(
    "When you are satisfied, remove the old fields with:\n  npm run money:migrate -- --drop-legacy --apply\n"
  );

  return { converted: written, skipped: alreadyDone, problems };
};

/* ---------------------------------------------------------------------------
 * Phase 2 — drop the legacy float fields
 * ------------------------------------------------------------------------ */

const runDropPhase = async () => {
  const stragglers = await Product.collection.countDocuments({
    price: { $exists: true },
    priceCents: { $exists: false },
  });

  if (stragglers) {
    console.error(
      `REFUSING TO DROP: ${stragglers} product(s) still have a legacy price and no priceCents.`
    );
    console.error(
      "Dropping now would destroy their prices. Run the add phase first:\n  npm run money:migrate -- --apply\n"
    );
    process.exitCode = 1;
    return;
  }

  const withLegacy = await Product.collection.countDocuments({
    $or: [{ price: { $exists: true } }, { discountPrice: { $exists: true } }],
  });

  console.log(`Products still carrying legacy float fields: ${withLegacy}\n`);

  if (!withLegacy) {
    console.log("Already clean — nothing to drop.\n");
    return;
  }

  if (!APPLY) {
    console.log(
      `DRY RUN — nothing was written. ${withLegacy} product(s) would have 'price' and 'discountPrice' removed.`
    );
    console.log("Re-run with --drop-legacy --apply to do it.\n");
    return;
  }

  const result = await Product.collection.updateMany(
    { $or: [{ price: { $exists: true } }, { discountPrice: { $exists: true } }] },
    { $unset: { price: "", discountPrice: "" } }
  );

  console.log(`Removed legacy fields from ${result.modifiedCount} product(s).\n`);
  console.log("Migration complete. Run `npm run db:indexes` to finish.\n");
};

/* ------------------------------------------------------------------------ */

(async () => {
  try {
    await connectDB();

    console.log("");
    console.log("=".repeat(72));
    console.log(
      DROP_LEGACY
        ? "MONEY MIGRATION — phase 2: remove legacy float fields"
        : "MONEY MIGRATION — phase 1: add integer minor-unit fields"
    );
    console.log(APPLY ? "MODE: APPLY (this WILL write)" : "MODE: DRY RUN (read only)");
    console.log("=".repeat(72));
    console.log("");

    if (DROP_LEGACY) {
      await runDropPhase();
    } else {
      await runAddPhase();
    }
  } catch (error) {
    console.error("\nMigration failed:", error.message, "\n");
    process.exitCode = 1;
  } finally {
    await disconnectDB().catch(() => {});
    await mongoose.disconnect().catch(() => {});
  }
})();
