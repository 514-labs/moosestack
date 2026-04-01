import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractJsonRowsFromOutput } from "./seed-output.mjs";

const currentDir = dirname(fileURLToPath(import.meta.url));
const packageDir = join(currentDir, "..");
const seedDir = join(currentDir, "..", "seed");
const mooseCli = process.platform === "win32" ? "moose-cli.cmd" : "moose-cli";

function runMooseQuery(args, description) {
  const result = spawnSync(mooseCli, ["query", ...args], {
    cwd: packageDir,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    if (result.stdout) {
      process.stdout.write(result.stdout);
    }
    if (result.stderr) {
      process.stderr.write(result.stderr);
    }
    throw new Error(`Failed to ${description}.`);
  }

  return result.stdout;
}
function queryJsonRows(sql) {
  const output = runMooseQuery([sql], "query seeded data");
  return extractJsonRowsFromOutput(output);
}

function queryCount(sql) {
  const [row] = queryJsonRows(sql);
  return typeof row?.total === "number" ? row.total : 0;
}

const totalBefore = queryCount("SELECT count() AS total FROM tenant_knowledge");

console.log("Seeding starter data...");

const seedFileName = "tenant_knowledge.sql";
runMooseQuery(["-f", join(seedDir, seedFileName)], `apply ${seedFileName}`);
console.log(`- Applied ${seedFileName}`);

const totalAfter = queryCount("SELECT count() AS total FROM tenant_knowledge");
const totalsByOrg = queryJsonRows(`
  SELECT org_id, count() AS total
  FROM tenant_knowledge
  GROUP BY org_id
  ORDER BY org_id
`);

console.log(
  `- Inserted ${Math.max(0, totalAfter - totalBefore)} records into tenant_knowledge`,
);
console.log("- Current totals by org:");

for (const row of totalsByOrg) {
  console.log(`  ${row.org_id}: ${row.total}`);
}
