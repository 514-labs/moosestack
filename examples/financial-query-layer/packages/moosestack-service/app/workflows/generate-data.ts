import { Task, Workflow, getMooseUtils } from "@514labs/moose-lib";

// --- Random helpers ---

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randChoice<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randDecimal(min: number, max: number): string {
  return (Math.random() * (max - min) + min).toFixed(2);
}

function toClickHouseDateTime(d: Date): string {
  return d.toISOString().replace("T", " ").replace("Z", "").slice(0, 19);
}

function weightedChoice<T>(items: readonly T[], weights: number[]): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

// --- Reference data ---

const REGIONS = [
  "NA-East",
  "NA-West",
  "EU-West",
  "EU-Central",
  "APAC",
  "LATAM",
] as const;

const PLANS = ["free", "pro", "enterprise"] as const;
const PLAN_WEIGHTS = [0.6, 0.3, 0.1];

const CATEGORIES = [
  "Electronics",
  "Software",
  "Services",
  "Hardware",
  "Accessories",
  "Support",
] as const;

const PAYMENT_METHODS = [
  "credit_card",
  "debit_card",
  "bank_transfer",
  "paypal",
  "crypto",
] as const;
const PAYMENT_WEIGHTS = [0.4, 0.25, 0.15, 0.15, 0.05];

const CURRENCIES = ["USD", "EUR", "GBP"] as const;
const CURRENCY_WEIGHTS = [0.6, 0.25, 0.15];

const STATUSES = ["pending", "completed", "failed", "refunded"] as const;
const STATUS_WEIGHTS = [0.1, 0.75, 0.05, 0.1];

const FIRST_NAMES = [
  "James",
  "Emma",
  "Liam",
  "Olivia",
  "Noah",
  "Ava",
  "Sophia",
  "Mason",
  "Isabella",
  "Lucas",
  "Mia",
  "Ethan",
  "Harper",
  "Aiden",
  "Ella",
  "Chen",
  "Yuki",
  "Priya",
  "Santiago",
  "Fatima",
];

const LAST_NAMES = [
  "Smith",
  "Johnson",
  "Williams",
  "Brown",
  "Jones",
  "Garcia",
  "Miller",
  "Davis",
  "Rodriguez",
  "Martinez",
  "Hernandez",
  "Lopez",
  "Gonzalez",
  "Wilson",
  "Anderson",
  "Thomas",
  "Taylor",
  "Moore",
  "Jackson",
  "Lee",
];

const PRODUCT_ADJECTIVES = [
  "Pro",
  "Ultra",
  "Basic",
  "Advanced",
  "Premium",
  "Lite",
  "Max",
  "Elite",
  "Core",
  "Plus",
];
const PRODUCT_NOUNS = [
  "Suite",
  "Platform",
  "License",
  "Module",
  "Package",
  "Plan",
  "Toolkit",
  "Service",
  "Engine",
  "Hub",
];

// --- Task ---

interface GenerateDataOutput {
  usersGenerated: number;
  productsGenerated: number;
  transactionsGenerated: number;
  lineItemsGenerated: number;
}

export const generateDataTask = new Task<void, GenerateDataOutput>(
  "generate-data-task",
  {
    run: async () => {
      const { client } = await getMooseUtils();
      const ch = client.query.client;
      const db = "local";

      // --- Check existing counts ---
      const countQuery = async (table: string): Promise<number> => {
        const result = await ch.query({
          query: `SELECT count() as c FROM ${db}.${table}`,
          format: "JSONEachRow",
        });
        const rows: { c: string }[] = await result.json();
        return Number(rows[0]?.c ?? 0);
      };

      const [existingUserCount, existingProductCount] = await Promise.all([
        countQuery("users"),
        countQuery("products"),
      ]);

      // --- Fetch existing reference data ---
      const [userIdsResult, productsResult] = await Promise.all([
        ch.query({
          query: `SELECT userId FROM ${db}.users ORDER BY rand() LIMIT 1000`,
          format: "JSONEachRow",
        }),
        ch.query({
          query: `SELECT productId, unitPrice, category FROM ${db}.products ORDER BY rand() LIMIT 200`,
          format: "JSONEachRow",
        }),
      ]);

      const existingUserIds: string[] = (await userIdsResult.json()).map(
        (r: { userId: string }) => r.userId,
      );
      const existingProducts: Array<{
        productId: string;
        unitPrice: string;
        category: string;
      }> = await productsResult.json();

      const now = new Date();

      // --- Generate Users ---
      const userCount =
        existingUserCount < 200 ? randInt(100, 200) : randInt(50, 150);
      const newUsers = Array.from({ length: userCount }, () => {
        const firstName = randChoice(FIRST_NAMES);
        const lastName = randChoice(LAST_NAMES);
        return {
          userId: crypto.randomUUID(),
          createdAt: toClickHouseDateTime(
            new Date(now.getTime() - randInt(0, 15_000)),
          ),
          name: `${firstName} ${lastName}`,
          email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}${randInt(1, 9999)}@example.com`,
          region: randChoice(REGIONS),
          plan: weightedChoice(PLANS, PLAN_WEIGHTS),
        };
      });

      await ch.insert({
        table: `${db}.users`,
        values: newUsers,
        format: "JSONEachRow",
      });

      // --- Generate Products ---
      let productCount = 0;
      if (existingProductCount < 30) {
        productCount = randInt(20, 35);
      } else if (Math.random() < 0.15) {
        productCount = randInt(1, 5);
      }

      const newProducts = Array.from({ length: productCount }, () => ({
        productId: crypto.randomUUID(),
        name: `${randChoice(PRODUCT_ADJECTIVES)} ${randChoice(PRODUCT_NOUNS)}`,
        category: randChoice(CATEGORIES),
        unitPrice: randDecimal(5, 500),
        createdAt: toClickHouseDateTime(
          new Date(now.getTime() - randInt(0, 15_000)),
        ),
      }));

      if (newProducts.length > 0) {
        await ch.insert({
          table: `${db}.products`,
          values: newProducts,
          format: "JSONEachRow",
        });
      }

      // --- Build reference pools ---
      const allUserIds = [...existingUserIds, ...newUsers.map((u) => u.userId)];
      const allProducts = [
        ...existingProducts,
        ...newProducts.map((p) => ({
          productId: p.productId,
          unitPrice: p.unitPrice,
          category: p.category,
        })),
      ];

      if (allUserIds.length === 0 || allProducts.length === 0) {
        return {
          usersGenerated: newUsers.length,
          productsGenerated: newProducts.length,
          transactionsGenerated: 0,
          lineItemsGenerated: 0,
        };
      }

      // --- Generate Transactions + Line Items ---
      const txCount = randInt(800, 1200);
      const transactions: Record<string, unknown>[] = [];
      const lineItems: Record<string, unknown>[] = [];

      for (let i = 0; i < txCount; i++) {
        const txId = crypto.randomUUID();
        const txTimestamp = toClickHouseDateTime(
          new Date(now.getTime() - randInt(0, 15_000)),
        );
        const userId = randChoice(allUserIds);
        const region = randChoice(REGIONS);
        const status = weightedChoice(STATUSES, STATUS_WEIGHTS);

        // 1-8 line items per transaction, skewed toward 3-5
        const itemCount = Math.min(
          8,
          Math.max(1, Math.round(randInt(2, 6) + (Math.random() - 0.5) * 4)),
        );
        let txTotal = 0;

        for (let j = 0; j < itemCount; j++) {
          const product = randChoice(allProducts);
          const quantity = weightedChoice(
            [1, 2, 3, 4, 5],
            [0.4, 0.3, 0.15, 0.1, 0.05],
          );
          // ±20% price variation from list price
          const unitPrice =
            parseFloat(product.unitPrice) * (0.8 + Math.random() * 0.4);
          const amount = quantity * unitPrice;
          txTotal += amount;

          lineItems.push({
            lineItemId: crypto.randomUUID(),
            transactionId: txId,
            timestamp: txTimestamp,
            productId: product.productId,
            quantity,
            unitPrice: unitPrice.toFixed(2),
            amount: amount.toFixed(2),
          });
        }

        transactions.push({
          transactionId: txId,
          timestamp: txTimestamp,
          userId,
          status,
          region,
          currency: weightedChoice(CURRENCIES, CURRENCY_WEIGHTS),
          paymentMethod: weightedChoice(PAYMENT_METHODS, PAYMENT_WEIGHTS),
          totalAmount: txTotal.toFixed(2),
        });
      }

      // Batch insert
      await ch.insert({
        table: `${db}.transactions`,
        values: transactions,
        format: "JSONEachRow",
      });

      await ch.insert({
        table: `${db}.transaction_line_items`,
        values: lineItems,
        format: "JSONEachRow",
      });

      return {
        usersGenerated: newUsers.length,
        productsGenerated: newProducts.length,
        transactionsGenerated: transactions.length,
        lineItemsGenerated: lineItems.length,
      };
    },
    retries: 2,
    timeout: "30s",
  },
);

export const generateDataWorkflow = new Workflow("generate-data", {
  startingTask: generateDataTask,
  schedule: "@every 15s",
});
