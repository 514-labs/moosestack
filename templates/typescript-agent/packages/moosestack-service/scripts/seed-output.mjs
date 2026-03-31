// biome-ignore lint/complexity/useRegexLiterals: the literal form trips noControlCharactersInRegex for the ESC byte.
const ANSI_ESCAPE_SEQUENCE_PATTERN = new RegExp(
  String.raw`\u001B(?:\[[0-?]*[ -/]*[@-~]|[@-Z\\-_])`,
  "g",
);

function isObjectRecord(value) {
  return typeof value === "object" && value !== null;
}

export function stripAnsiSequences(value) {
  return value.replaceAll(ANSI_ESCAPE_SEQUENCE_PATTERN, "");
}

export function extractJsonRowsFromOutput(output) {
  const rows = [];

  for (const rawLine of output.split("\n")) {
    const line = stripAnsiSequences(rawLine).trim();

    if (!line) {
      continue;
    }

    try {
      const parsed = JSON.parse(line);

      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (isObjectRecord(item)) {
            rows.push(item);
          }
        }
        continue;
      }

      if (isObjectRecord(parsed)) {
        rows.push(parsed);
      }
    } catch {}
  }

  return rows;
}
