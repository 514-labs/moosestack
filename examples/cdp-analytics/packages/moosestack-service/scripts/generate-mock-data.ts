/**
 * Mock Data Generator for Customer Data Platform
 *
 * Generates realistic fake data for all CDP tables:
 * - Customers
 * - Products
 * - Sessions
 * - Events
 * - Transactions
 * - Transaction Items
 *
 * Usage: npx ts-node scripts/generate-mock-data.ts
 *
 * Requires the Moose dev server to be running.
 * Data will be sent to the ingest API endpoints.
 */

import { randomUUID } from "crypto";

// Configuration
const CONFIG = {
  baseUrl: process.env.MOOSE_URL || "http://localhost:4000",
  apiKey: process.env.MCP_API_KEY || "",
  counts: {
    customers: 10000,
    products: 200,
    sessionsPerCustomer: { min: 1, max: 8 }, // Variable sessions based on engagement
    eventsPerSession: { min: 2, max: 15 },
    transactionsPerCustomer: { min: 0, max: 2 }, // Most don't convert
    itemsPerTransaction: 3,
  },
  // Realistic funnel conversion rates
  conversionRates: {
    engaged: 0.45, // 45% have 2+ sessions
    active: 0.25, // 25% have significant page views
    converted: 0.08, // 8% make a purchase
  },
};

// Helper functions
const randomElement = <T>(arr: T[]): T =>
  arr[Math.floor(Math.random() * arr.length)];
const randomInt = (min: number, max: number): number =>
  Math.floor(Math.random() * (max - min + 1)) + min;
const randomFloat = (min: number, max: number, decimals = 2): number =>
  parseFloat((Math.random() * (max - min) + min).toFixed(decimals));
const randomDate = (start: Date, end: Date): Date =>
  new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
const randomBool = (probability = 0.5): boolean => Math.random() < probability;

// Generate GA4-style client ID (format: randomNumber.timestamp)
const generateClientId = (): string => {
  const randomNum = Math.floor(Math.random() * 1000000000);
  const timestamp = Math.floor(Date.now() / 1000) - randomInt(0, 86400 * 365);
  return `${randomNum}.${timestamp}`;
};

// Generate Meta fbc (Facebook Click ID) - format: fb.1.timestamp.fbclid
const generateFbc = (): string => {
  if (!randomBool(0.3)) return ""; // Only 30% have fbc (came from Facebook ad)
  const timestamp = Date.now() - randomInt(0, 86400000 * 30);
  const fbclid = `IwAR${Array.from(
    { length: 40 },
    () =>
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"[
        randomInt(0, 61)
      ],
  ).join("")}`;
  return `fb.1.${timestamp}.${fbclid}`;
};

// Generate Meta fbp (Facebook Browser ID) - format: fb.1.timestamp.randomNumber
const generateFbp = (): string => {
  const timestamp = Date.now() - randomInt(0, 86400000 * 180);
  const randomNum = Math.floor(Math.random() * 10000000000);
  return `fb.1.${timestamp}.${randomNum}`;
};

// Reference data
const FIRST_NAMES = [
  "Emma",
  "Liam",
  "Olivia",
  "Noah",
  "Ava",
  "Ethan",
  "Sophia",
  "Mason",
  "Isabella",
  "William",
  "Mia",
  "James",
  "Charlotte",
  "Oliver",
  "Amelia",
  "Benjamin",
  "Harper",
  "Elijah",
  "Evelyn",
  "Lucas",
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
  "Martin",
];
const COUNTRIES = ["US", "CA", "GB", "DE", "FR", "AU", "JP", "BR", "IN", "MX"];
const CITIES = [
  "New York",
  "Los Angeles",
  "Chicago",
  "Houston",
  "Phoenix",
  "Toronto",
  "London",
  "Berlin",
  "Paris",
  "Sydney",
  "Tokyo",
  "Sao Paulo",
  "Mumbai",
  "Mexico City",
];
const GENDERS = ["male", "female", "other", "prefer_not_to_say"];
const ACQUISITION_CHANNELS = [
  "organic",
  "paid_search",
  "social",
  "referral",
  "email",
];
const CUSTOMER_TIERS = ["bronze", "silver", "gold", "platinum"];
const DEVICE_TYPES = ["desktop", "mobile", "tablet"];
const BROWSERS = [
  "Chrome 120",
  "Firefox 121",
  "Safari 17",
  "Edge 120",
  "Chrome Mobile 120",
  "Safari Mobile 17",
];
const OPERATING_SYSTEMS = [
  "Windows 11",
  "macOS 14",
  "iOS 17",
  "Android 14",
  "Linux",
  "Windows 10",
];
const TRAFFIC_SOURCES = [
  "direct",
  "organic_search",
  "paid_search",
  "social",
  "referral",
  "email",
];
const EVENT_TYPES = [
  "page_view",
  "click",
  "form_submit",
  "add_to_cart",
  "remove_from_cart",
  "search",
  "login",
  "logout",
];
const PAYMENT_METHODS = [
  "credit_card",
  "debit_card",
  "paypal",
  "apple_pay",
  "google_pay",
  "bank_transfer",
];
const ORDER_STATUSES = ["pending", "completed", "refunded", "cancelled"];
const ORDER_STATES = ["OPEN", "COMPLETED", "CANCELED", "DRAFT"];
const ORDER_SOURCES = ["online", "pos", "api", "mobile_app"];
const CONSENT_STATUSES = ["granted", "denied", "pending"];
const PRODUCT_CATEGORIES = [
  "electronics",
  "clothing",
  "home",
  "beauty",
  "sports",
  "food",
];
const BRANDS = [
  "TechPro",
  "StyleMax",
  "HomeEssentials",
  "BeautyGlow",
  "SportFit",
  "FreshFood",
  "GadgetWorld",
  "FashionPlus",
  "CozyHome",
  "NaturalBeauty",
];

const PAGES = [
  { url: "/", title: "Home" },
  { url: "/products", title: "Products" },
  { url: "/products/electronics", title: "Electronics" },
  { url: "/products/clothing", title: "Clothing" },
  { url: "/cart", title: "Shopping Cart" },
  { url: "/checkout", title: "Checkout" },
  { url: "/account", title: "My Account" },
  { url: "/orders", title: "Order History" },
  { url: "/search", title: "Search Results" },
  { url: "/about", title: "About Us" },
];

const UTM_SOURCES = [
  "google",
  "facebook",
  "instagram",
  "twitter",
  "linkedin",
  "email",
  "",
];
const UTM_MEDIUMS = ["cpc", "organic", "social", "email", "referral", ""];
const UTM_CAMPAIGNS = [
  "summer_sale",
  "black_friday",
  "new_arrivals",
  "loyalty_program",
  "retargeting",
  "",
];

// Generator functions
function generateCustomer(index: number) {
  const firstName = randomElement(FIRST_NAMES);
  const lastName = randomElement(LAST_NAMES);
  // Concentrate customers in recent 8 weeks for better cohort analysis
  const weeksAgo = randomInt(0, 7);
  const daysOffset = weeksAgo * 7 + randomInt(0, 6);
  const createdAt = new Date(Date.now() - daysOffset * 24 * 60 * 60 * 1000);

  return {
    customerId: randomUUID(),
    externalId: randomBool(0.7) ? `CRM-${String(index).padStart(6, "0")}` : "", // 70% have CRM ID
    email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}${index}@example.com`,
    firstName,
    lastName,
    phone: `+1${randomInt(200, 999)}${randomInt(100, 999)}${randomInt(1000, 9999)}`,
    country: randomElement(COUNTRIES),
    city: randomElement(CITIES),
    dateOfBirth: randomDate(
      new Date("1960-01-01"),
      new Date("2005-12-31"),
    ).toISOString(),
    gender: randomElement(GENDERS),
    createdAt: createdAt.toISOString(),
    updatedAt: randomDate(createdAt, new Date()).toISOString(),
    acquisitionChannel: randomElement(ACQUISITION_CHANNELS),
    acquisitionCampaign: `campaign_${randomInt(1, 20)}`,
    lifetimeValue: randomFloat(0, 5000),
    customerTier: randomElement(CUSTOMER_TIERS),
    marketingOptIn: randomBool(0.7),
    fbc: generateFbc(),
    fbp: generateFbp(),
    consentStatus: randomElement(CONSENT_STATUSES),
  };
}

function generateProduct(index: number) {
  const category = randomElement(PRODUCT_CATEGORIES);
  const price = randomFloat(9.99, 499.99);
  const originalPrice =
    randomBool(0.3) ? randomFloat(price, price * 1.5) : price;

  return {
    productSku: `SKU-${category.substring(0, 3).toUpperCase()}-${String(index).padStart(5, "0")}`,
    productName: `${randomElement(BRANDS)} ${category} Item ${index}`,
    description: `High-quality ${category} product with excellent features and durability.`,
    category,
    subcategory: `${category}_sub_${randomInt(1, 5)}`,
    brand: randomElement(BRANDS),
    price,
    originalPrice,
    costPrice: randomFloat(price * 0.3, price * 0.6),
    stockQuantity: randomInt(0, 500),
    isActive: randomBool(0.9),
    createdAt: randomDate(
      new Date("2022-01-01"),
      new Date("2024-06-01"),
    ).toISOString(),
    updatedAt: new Date().toISOString(),
    avgRating: randomFloat(3.0, 5.0, 1),
    reviewCount: randomInt(0, 500),
  };
}

function generateSession(
  customerId: string,
  clientId: string,
  customerCreatedAt: Date,
) {
  // Sessions occur after customer creation, within the past 8 weeks
  const sessionStart = new Date(
    customerCreatedAt.getTime() + randomInt(0, 7 * 24 * 60 * 60 * 1000),
  );
  const startedAt = sessionStart > new Date() ? new Date() : sessionStart;
  const durationSeconds = randomInt(30, 1800);
  const endedAt = new Date(startedAt.getTime() + durationSeconds * 1000);
  const hasConversion = randomBool(0.15);
  const utmSource = randomElement(UTM_SOURCES);

  return {
    sessionId: randomUUID(),
    clientId, // GA4-style persistent browser ID
    customerId,
    anonymousId: randomBool(0.2) ? randomUUID() : "", // Segment-style pre-auth ID
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationSeconds,
    pageViewCount: randomInt(1, 20),
    eventCount: randomInt(5, 50),
    landingPage: randomElement(PAGES).url,
    exitPage: randomElement(PAGES).url,
    deviceType: randomElement(DEVICE_TYPES),
    browser: randomElement(BROWSERS),
    operatingSystem: randomElement(OPERATING_SYSTEMS),
    screenResolution: randomElement([
      "1920x1080",
      "1366x768",
      "2560x1440",
      "375x812",
      "390x844",
    ]),
    trafficSource: randomElement(TRAFFIC_SOURCES),
    referrerDomain:
      randomBool(0.5) ?
        randomElement([
          "google.com",
          "facebook.com",
          "instagram.com",
          "twitter.com",
          "",
        ])
      : "",
    utmSource,
    utmMedium: utmSource ? randomElement(UTM_MEDIUMS) : "",
    utmCampaign: utmSource ? randomElement(UTM_CAMPAIGNS) : "",
    ipCountry: randomElement(COUNTRIES),
    ipCity: randomElement(CITIES),
    hasConversion,
    conversionValue: hasConversion ? randomFloat(20, 500) : 0,
  };
}

function generateEvent(
  customerId: string,
  sessionId: string,
  clientId: string,
  anonymousId: string,
  timestamp: Date,
) {
  const page = randomElement(PAGES);
  const eventType = randomElement(EVENT_TYPES);
  const utmSource = randomElement(UTM_SOURCES);

  return {
    eventId: randomUUID(),
    clientId, // GA4-style persistent browser ID
    anonymousId, // Segment-style pre-auth ID
    customerId,
    sessionId,
    timestamp: timestamp.toISOString(),
    eventType,
    eventName: `${eventType}_${randomInt(1, 5)}`,
    pageUrl: `https://example.com${page.url}`,
    pageTitle: page.title,
    referrerUrl:
      randomBool(0.3) ?
        `https://${randomElement(["google.com", "facebook.com", "instagram.com"])}`
      : "",
    deviceType: randomElement(DEVICE_TYPES),
    browser: randomElement(BROWSERS),
    operatingSystem: randomElement(OPERATING_SYSTEMS),
    ipCountry: randomElement(COUNTRIES),
    ipCity: randomElement(CITIES),
    utmSource,
    utmMedium: utmSource ? randomElement(UTM_MEDIUMS) : "",
    utmCampaign: utmSource ? randomElement(UTM_CAMPAIGNS) : "",
    properties: JSON.stringify({
      buttonId: eventType === "click" ? `btn_${randomInt(1, 20)}` : undefined,
      searchQuery:
        eventType === "search" ?
          randomElement(["laptop", "shoes", "phone", "jacket"])
        : undefined,
      productId:
        eventType === "add_to_cart" ? `SKU-${randomInt(1, 50)}` : undefined,
    }),
  };
}

function generateTransaction(
  customerId: string,
  sessionId: string,
  isFirst: boolean,
  products: any[],
) {
  const timestamp = randomDate(new Date("2024-01-01"), new Date());
  const subtotal = randomFloat(20, 500);
  const discountAmount = randomBool(0.3) ? randomFloat(5, subtotal * 0.2) : 0;
  const taxAmount = (subtotal - discountAmount) * 0.08;
  const shippingAmount = subtotal > 100 ? 0 : randomFloat(5, 15);
  const tipAmount = randomBool(0.15) ? randomFloat(2, 20) : 0; // 15% have tips (food/hospitality)
  const source = randomElement(ORDER_SOURCES);

  // Order state correlates with status
  const status = randomElement(ORDER_STATUSES);
  let orderState: string;
  if (status === "completed") orderState = "COMPLETED";
  else if (status === "cancelled" || status === "refunded")
    orderState = "CANCELED";
  else if (status === "pending")
    orderState = randomBool(0.3) ? "DRAFT" : "OPEN";
  else orderState = "OPEN";

  return {
    transactionId: randomUUID(),
    customerId,
    sessionId,
    timestamp: timestamp.toISOString(),
    orderState, // Square-style lifecycle state
    status, // Payment/fulfillment status
    source, // Order source channel
    subtotal,
    discountAmount,
    taxAmount: parseFloat(taxAmount.toFixed(2)),
    shippingAmount,
    tipAmount,
    totalAmount: parseFloat(
      (
        subtotal -
        discountAmount +
        taxAmount +
        shippingAmount +
        tipAmount
      ).toFixed(2),
    ),
    currency: "USD",
    paymentMethod: randomElement(PAYMENT_METHODS),
    couponCode: randomBool(0.2) ? `SAVE${randomInt(10, 30)}` : "",
    itemCount: randomInt(1, 5),
    shippingCountry: randomElement(COUNTRIES),
    shippingCity: randomElement(CITIES),
    isFirstPurchase: isFirst,
    attributionChannel: randomElement(ACQUISITION_CHANNELS),
  };
}

function generateTransactionItem(
  transactionId: string,
  customerId: string,
  timestamp: string,
  products: any[],
) {
  const product = randomElement(products);
  const quantity = randomInt(1, 3);
  const unitPrice = product.price;
  const itemDiscount = randomBool(0.2) ? randomFloat(1, unitPrice * 0.1) : 0;

  return {
    itemId: randomUUID(),
    transactionId,
    customerId,
    productSku: product.productSku,
    productName: product.productName,
    productCategory: product.category,
    productSubcategory: product.subcategory,
    unitPrice,
    quantity,
    lineTotal: parseFloat((unitPrice * quantity).toFixed(2)),
    itemDiscount,
    timestamp,
  };
}

// API functions - batch ingestion for performance
const BATCH_SIZE = 100;

async function ingestData(endpoint: string, data: any[]): Promise<void> {
  const url = `${CONFIG.baseUrl}/ingest/${endpoint}`;
  let successCount = 0;
  let errorCount = 0;

  // Process in batches with concurrent requests
  for (let i = 0; i < data.length; i += BATCH_SIZE) {
    const batch = data.slice(i, i + BATCH_SIZE);

    // Send batch items concurrently
    const promises = batch.map((item) =>
      fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${CONFIG.apiKey}`,
        },
        body: JSON.stringify(item),
      })
        .then((response) => {
          if (response.ok) {
            successCount++;
          } else {
            errorCount++;
          }
        })
        .catch(() => {
          errorCount++;
        }),
    );

    await Promise.all(promises);

    // Progress indicator
    if ((i + BATCH_SIZE) % 1000 === 0 || i + BATCH_SIZE >= data.length) {
      process.stdout.write(
        `\r  ${endpoint}: ${Math.min(i + BATCH_SIZE, data.length)}/${data.length}`,
      );
    }
  }

  console.log(
    `\n  ✓ Ingested ${successCount} ${endpoint} records${errorCount > 0 ? ` (${errorCount} errors)` : ""}`,
  );
}

// Main execution
async function main() {
  console.log("Starting mock data generation...\n");

  // Generate products first
  console.log(`Generating ${CONFIG.counts.products} products...`);
  const products = Array.from({ length: CONFIG.counts.products }, (_, i) =>
    generateProduct(i + 1),
  );
  await ingestData("Product", products);

  // Generate customers
  console.log(`\nGenerating ${CONFIG.counts.customers} customers...`);
  const customers = Array.from({ length: CONFIG.counts.customers }, (_, i) =>
    generateCustomer(i + 1),
  );
  await ingestData("Customer", customers);

  // Generate sessions, events, and transactions for each customer
  const allSessions: any[] = [];
  const allEvents: any[] = [];
  const allTransactions: any[] = [];
  const allTransactionItems: any[] = [];

  for (const customer of customers) {
    // Generate a persistent clientId for this customer (simulates GA4 _ga cookie)
    const clientId = generateClientId();
    const customerCreatedAt = new Date(customer.createdAt);

    // Determine customer engagement tier based on realistic conversion rates
    const isEngaged = randomBool(CONFIG.conversionRates.engaged); // 45% have 2+ sessions
    const isActive =
      isEngaged &&
      randomBool(
        CONFIG.conversionRates.active / CONFIG.conversionRates.engaged,
      ); // 25% overall
    const willConvert =
      isActive &&
      randomBool(
        CONFIG.conversionRates.converted / CONFIG.conversionRates.active,
      ); // 8% overall

    // Session count based on engagement tier
    let sessionCount: number;
    if (!isEngaged) {
      sessionCount = 1; // Single session visitors
    } else if (!isActive) {
      sessionCount = randomInt(2, 3); // Engaged but not highly active
    } else {
      sessionCount = randomInt(4, CONFIG.counts.sessionsPerCustomer.max); // Active users
    }

    const customerSessions: any[] = [];
    for (let s = 0; s < sessionCount; s++) {
      const session = generateSession(
        customer.customerId,
        clientId,
        customerCreatedAt,
      );

      // Adjust session metrics based on engagement tier
      if (!isActive) {
        session.pageViewCount = randomInt(1, 5);
        session.eventCount = randomInt(2, 8);
      } else {
        session.pageViewCount = randomInt(5, 20);
        session.eventCount = randomInt(10, 50);
      }

      // Only mark conversion on sessions for customers who will convert
      if (willConvert && s === sessionCount - 1) {
        session.hasConversion = true;
        session.conversionValue = randomFloat(50, 500);
      } else {
        session.hasConversion = false;
        session.conversionValue = 0;
      }

      customerSessions.push(session);
      allSessions.push(session);

      // Events within session - fewer for less engaged users
      const eventCount =
        isActive ?
          randomInt(
            CONFIG.counts.eventsPerSession.min,
            CONFIG.counts.eventsPerSession.max,
          )
        : randomInt(2, 5);
      const sessionStart = new Date(session.startedAt);
      for (let e = 0; e < eventCount; e++) {
        const eventTime = new Date(
          sessionStart.getTime() +
            e * ((session.durationSeconds * 1000) / eventCount),
        );
        allEvents.push(
          generateEvent(
            customer.customerId,
            session.sessionId,
            clientId,
            session.anonymousId,
            eventTime,
          ),
        );
      }
    }

    // Transactions - only for customers who convert
    if (willConvert) {
      const transactionCount = randomInt(
        1,
        CONFIG.counts.transactionsPerCustomer.max,
      );
      for (let t = 0; t < transactionCount; t++) {
        const session = randomElement(customerSessions);
        const transaction = generateTransaction(
          customer.customerId,
          session.sessionId,
          t === 0,
          products,
        );
        allTransactions.push(transaction);

        // Transaction items
        const itemCount = randomInt(1, CONFIG.counts.itemsPerTransaction);
        for (let i = 0; i < itemCount; i++) {
          allTransactionItems.push(
            generateTransactionItem(
              transaction.transactionId,
              customer.customerId,
              transaction.timestamp,
              products,
            ),
          );
        }
      }
    }
  }

  console.log(`\nGenerating ${allSessions.length} sessions...`);
  await ingestData("Session", allSessions);

  console.log(`\nGenerating ${allEvents.length} events...`);
  await ingestData("Event", allEvents);

  console.log(`\nGenerating ${allTransactions.length} transactions...`);
  await ingestData("Transaction", allTransactions);

  console.log(
    `\nGenerating ${allTransactionItems.length} transaction items...`,
  );
  await ingestData("TransactionItem", allTransactionItems);

  console.log("\n✅ Mock data generation complete!");
  console.log("\nSummary:");
  console.log(`  - Products: ${products.length}`);
  console.log(`  - Customers: ${customers.length}`);
  console.log(`  - Sessions: ${allSessions.length}`);
  console.log(`  - Events: ${allEvents.length}`);
  console.log(`  - Transactions: ${allTransactions.length}`);
  console.log(`  - Transaction Items: ${allTransactionItems.length}`);
}

// Backfill materialized views
async function backfillMaterializedViews() {
  console.log("\nBackfilling materialized views...");

  const clickhouseUrl = process.env.CLICKHOUSE_URL || "http://localhost:18123";
  const clickhouseUser = process.env.CLICKHOUSE_USER || "panda";
  const clickhousePassword = process.env.CLICKHOUSE_PASSWORD || "pandapass";
  const database = "local";

  const authHeader =
    "Basic " +
    Buffer.from(`${clickhouseUser}:${clickhousePassword}`).toString("base64");

  // Backfill EmailFunnelMetrics
  const emailFunnelQuery = `
    INSERT INTO ${database}.EmailFunnelMetrics
    WITH email_customers AS (
      SELECT
        c.customerId,
        count(DISTINCT s.sessionId) as sessionCount,
        max(s.hasConversion) as hasConversion
      FROM ${database}.Customer c
      LEFT JOIN ${database}.Session s ON c.customerId = s.customerId
      WHERE c.acquisitionChannel = 'email'
      GROUP BY c.customerId
    )
    SELECT
      count(*) as emailAcquired,
      countIf(sessionCount >= 1) as firstVisit,
      countIf(sessionCount >= 2) as engaged,
      countIf(hasConversion = true) as converted
    FROM email_customers
  `;

  // Backfill CohortMetrics
  const cohortMetricsQuery = `
    INSERT INTO ${database}.CohortMetrics
    SELECT
      toStartOfWeek(c.createdAt) as cohortWeek,
      count(DISTINCT c.customerId) as cohortSize,
      countIf(sessionCount >= 2) as engagedUsers,
      countIf(totalPageViews >= 10) as activeUsers,
      countIf(hasConversion = true) as convertedUsers,
      sum(conversionValue) as totalRevenue
    FROM ${database}.Customer c
    LEFT JOIN (
      SELECT
        customerId,
        count(DISTINCT sessionId) as sessionCount,
        sum(pageViewCount) as totalPageViews,
        max(hasConversion) as hasConversion,
        sum(conversionValue) as conversionValue
      FROM ${database}.Session
      GROUP BY customerId
    ) s ON c.customerId = s.customerId
    GROUP BY cohortWeek
  `;

  const execQuery = async (query: string, label: string) => {
    const response = await fetch(`${clickhouseUrl}/?database=${database}`, {
      method: "POST",
      headers: { Authorization: authHeader },
      body: query,
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`${label} failed: ${error}`);
    }
  };

  try {
    // Clear existing MV data and reinsert
    await execQuery(
      `TRUNCATE TABLE ${database}.EmailFunnelMetrics`,
      "Truncate EmailFunnelMetrics",
    );
    await execQuery(emailFunnelQuery, "Insert EmailFunnelMetrics");
    console.log("  ✓ EmailFunnelMetrics backfilled");

    await execQuery(
      `TRUNCATE TABLE ${database}.CohortMetrics`,
      "Truncate CohortMetrics",
    );
    await execQuery(cohortMetricsQuery, "Insert CohortMetrics");
    console.log("  ✓ CohortMetrics backfilled");
  } catch (error) {
    console.error("  ⚠ MV backfill error:", error);
  }
}

main()
  .then(() => backfillMaterializedViews())
  .catch(console.error);
