const fs = require("fs");
const path = require("path");

const files = process.argv.slice(2);

if (files.length === 0) {
  console.error("validate-ci-bucket requires at least one test file path");
  process.exit(1);
}

const missingFiles = files.filter((file) => {
  const resolved = path.resolve(__dirname, "..", file);

  try {
    return !fs.statSync(resolved).isFile();
  } catch {
    return true;
  }
});

if (missingFiles.length > 0) {
  console.error("Missing E2E bucket files:");
  for (const file of missingFiles) {
    console.error(`- ${file}`);
  }
  process.exit(1);
}

console.log(`Validated ${files.length} E2E bucket file(s).`);
