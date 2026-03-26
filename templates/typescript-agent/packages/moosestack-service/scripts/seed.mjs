import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

function stripAnsiSequences(value) {
  let result = "";
  let skippingSequence = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (!skippingSequence && char === String.fromCharCode(27) && value[index + 1] === "[") {
      skippingSequence = true;
      continue;
    }

    if (skippingSequence) {
      if ((char >= "A" && char <= "Z") || (char >= "a" && char <= "z")) {
        skippingSequence = false;
      }
      continue;
    }

    result += char;
  }

  return result;
}

function queryJsonRows(sql) {
  const output = runMooseQuery([sql], "query seeded data");

  return output
    .split("\n")
    .map((line) => stripAnsiSequences(line).trim())
    .filter((line) => line.startsWith("{") || line.startsWith("["))
    .map((line) => JSON.parse(line));
}

function queryCount(sql) {
  const [row] = queryJsonRows(sql);
  return typeof row?.total === "number" ? row.total : 0;
}

const totalBefore = queryCount("SELECT count() AS total FROM tenant_knowledge");

console.log("Seeding starter data...");

for (const fileName of ["tenant_knowledge.sql"]) {
  runMooseQuery(["-f", join(seedDir, fileName)], `apply ${fileName}`);
  console.log(`- Applied ${fileName}`);
}

const totalAfter = queryCount("SELECT count() AS total FROM tenant_knowledge");
const totalsByTenant = queryJsonRows(`
  SELECT tenant_id, count() AS total
  FROM tenant_knowledge
  GROUP BY tenant_id
  ORDER BY tenant_id
`);

console.log(`- Inserted ${Math.max(0, totalAfter - totalBefore)} records into tenant_knowledge`);
console.log("- Current totals by tenant:");

for (const row of totalsByTenant) {
  console.log(`  ${row.tenant_id}: ${row.total}`);
}
