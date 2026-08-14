/**
 * Prints every product's money fields exactly as they are ON DISK. Read only —
 * it opens no write, so it is safe to run at any time.
 *
 *   node scripts/inspect-money.js
 *
 * Why this exists: the dry run reports "8 already migrated" but says nothing
 * about WHAT those eight hold. If some were written in major units and others
 * in minor units, the catalogue is silently inconsistent by a factor of 100 and
 * the migration would leave it that way. This shows all nine side by side so
 * that is visible before --apply, not after.
 *
 * Delete this file once the migration is confirmed.
 */
require("../src/config/env");

const { connectDB, disconnectDB } = require("../src/config/db");
const Product = require("../src/models/product.model");
const { formatMinorUnits } = require("../src/utils/money");

const pad = (v, w) => String(v).padEnd(w);

(async () => {
  try {
    await connectDB();

    // The RAW collection, not the model: the current schema has no `price`
    // path, so hydrating would drop the legacy field and hide exactly the
    // documents this is meant to show.
    const docs = await Product.collection
      .find(
        {},
        {
          projection: {
            name: 1,
            sku: 1,
            price: 1,
            discountPrice: 1,
            priceCents: 1,
            discountPriceCents: 1,
          },
        }
      )
      .toArray();

    console.log(`\nProducts: ${docs.length}\n`);
    console.log(
      `  ${pad("SKU", 16)}${pad("name", 26)}${pad("legacy price", 14)}${pad("priceCents", 13)}${pad("reads as", 14)}state`
    );
    console.log(`  ${"-".repeat(100)}`);

    const migrated = [];

    for (const d of docs) {
      const has = typeof d.priceCents === "number";
      const state = has
        ? d.price === undefined
          ? "migrated"
          : "migrated (legacy field still present)"
        : "PENDING";

      if (has) migrated.push(d);

      console.log(
        `  ${pad(d.sku || "-", 16)}${pad(String(d.name || "-").slice(0, 24), 26)}${pad(
          d.price === undefined ? "-" : d.price,
          14
        )}${pad(has ? d.priceCents : "-", 13)}${pad(
          has ? formatMinorUnits(d.priceCents) : "-",
          14
        )}${state}`
      );
    }

    /**
     * The consistency check that matters.
     *
     * A price stored in minor units is at least 100x the same price stored in
     * major units, so a catalogue that mixes the two shows up as an enormous
     * spread between the cheapest and dearest product. This will not catch
     * every case — a genuinely wide catalogue looks similar — but it reliably
     * flags the "somebody typed 7999 into a priceCents field" mistake.
     */
    if (migrated.length > 1) {
      const values = migrated.map((d) => d.priceCents).filter((v) => v > 0);
      const min = Math.min(...values);
      const max = Math.max(...values);

      console.log(
        `\n  Already-migrated range: ${formatMinorUnits(min)} to ${formatMinorUnits(max)}`
      );

      if (max / min >= 100) {
        console.log(
          "\n  ⚠  The cheapest and dearest differ by 100x or more. That is the\n" +
            "     signature of MIXED units — check whether the cheap ones were\n" +
            "     written in major units by mistake before running --apply."
        );
      } else {
        console.log(
          "\n  ✓  All migrated products sit within a plausible single-unit range."
        );
      }
    }

    console.log("");
  } catch (error) {
    console.error("\ninspect-money failed:", error.message, "\n");
    process.exitCode = 1;
  } finally {
    await disconnectDB();
  }
})();
