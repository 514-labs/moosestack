/**
 * Simple test to validate JSON parsing structure matches our expectations
 * This can run without Docker to test the parsing logic
 */

// Mock PlanOutput structure based on actual Rust InfraPlan
const mockPlanOutput = {
  target_infra_map: {
    default_database: "local",
    tables: {},
  },
  changes: {
    olap_changes: [
      {
        Table: {
          Added: {
            name: "FullyManagedTest",
            database: "local",
          },
        },
      },
    ],
    streaming_engine_changes: [],
    processes_changes: [],
    api_changes: [],
    web_app_changes: [],
  },
};

// Test the helper functions
function hasTableAdded(plan: any, tableName: string): boolean {
  if (!plan.changes?.olap_changes) return false;
  return plan.changes.olap_changes.some((change: any) => {
    const tableChange = change.Table;
    if (!tableChange) return false;
    return tableChange.Added?.name === tableName;
  });
}

function hasTableRemoved(plan: any, tableName: string): boolean {
  if (!plan.changes?.olap_changes) return false;
  return plan.changes.olap_changes.some((change: any) => {
    const tableChange = change.Table;
    if (!tableChange) return false;
    return tableChange.Removed?.name === tableName;
  });
}

function hasTableUpdated(plan: any, tableName: string): boolean {
  if (!plan.changes?.olap_changes) return false;
  return plan.changes.olap_changes.some((change: any) => {
    const tableChange = change.Table;
    if (!tableChange) return false;
    if (tableChange.Updated) {
      return (
        tableChange.Updated.before?.name === tableName ||
        tableChange.Updated.after?.name === tableName
      );
    }
    return false;
  });
}

function getTableChanges(
  plan: any,
  tableName: string,
): Array<{ type: string; details: any }> {
  const results: Array<{ type: string; details: any }> = [];

  if (!plan.changes?.olap_changes) return results;

  for (const change of plan.changes.olap_changes) {
    for (const [changeType, details] of Object.entries(change)) {
      if (changeType === "Table") {
        const tableChange = details as any;
        let matches = false;

        if (tableChange.Added?.name === tableName) {
          matches = true;
        } else if (tableChange.Removed?.name === tableName) {
          matches = true;
        } else if (tableChange.Updated) {
          matches =
            tableChange.Updated.before?.name === tableName ||
            tableChange.Updated.after?.name === tableName;
        }

        if (matches) {
          results.push({ type: changeType, details: tableChange });
        }
      }
    }
  }

  return results;
}

// Run tests
console.log("Testing JSON parsing structure...\n");

// Test 1: hasTableAdded
const test1 = hasTableAdded(mockPlanOutput, "FullyManagedTest");
console.log(`✓ hasTableAdded("FullyManagedTest"): ${test1} (expected: true)`);
if (!test1) {
  console.error("❌ FAILED: hasTableAdded should return true");
  process.exit(1);
}

// Test 2: hasTableRemoved (should be false)
const test2 = hasTableRemoved(mockPlanOutput, "FullyManagedTest");
console.log(
  `✓ hasTableRemoved("FullyManagedTest"): ${test2} (expected: false)`,
);
if (test2) {
  console.error("❌ FAILED: hasTableRemoved should return false");
  process.exit(1);
}

// Test 3: hasTableUpdated (should be false)
const test3 = hasTableUpdated(mockPlanOutput, "FullyManagedTest");
console.log(
  `✓ hasTableUpdated("FullyManagedTest"): ${test3} (expected: false)`,
);
if (test3) {
  console.error("❌ FAILED: hasTableUpdated should return false");
  process.exit(1);
}

// Test 4: getTableChanges
const test4 = getTableChanges(mockPlanOutput, "FullyManagedTest");
console.log(
  `✓ getTableChanges("FullyManagedTest"): ${test4.length} change(s) found (expected: 1)`,
);
if (test4.length !== 1) {
  console.error("❌ FAILED: getTableChanges should return 1 change");
  process.exit(1);
}

// Test 5: Test with empty changes
const emptyPlan = {
  target_infra_map: {},
  changes: {
    olap_changes: [],
    streaming_engine_changes: [],
    processes_changes: [],
    api_changes: [],
    web_app_changes: [],
  },
};
const test5 = hasTableAdded(emptyPlan, "FullyManagedTest");
console.log(`✓ hasTableAdded with empty changes: ${test5} (expected: false)`);
if (test5) {
  console.error(
    "❌ FAILED: hasTableAdded should return false for empty changes",
  );
  process.exit(1);
}

// Test 6: Test with undefined changes
const undefinedPlan = {
  target_infra_map: {},
  changes: undefined,
};
const test6 = hasTableAdded(undefinedPlan, "FullyManagedTest");
console.log(
  `✓ hasTableAdded with undefined changes: ${test6} (expected: false)`,
);
if (test6) {
  console.error(
    "❌ FAILED: hasTableAdded should return false for undefined changes",
  );
  process.exit(1);
}

console.log("\n✅ All JSON parsing tests passed!");
console.log("\nThe structure matches the expected format:");
console.log("- changes.olap_changes (not olap)");
console.log("- changes.streaming_engine_changes (not streaming)");
console.log("- changes.processes_changes (not process)");
console.log("- changes.api_changes (not api)");
console.log("- changes.web_app_changes (new field)");
