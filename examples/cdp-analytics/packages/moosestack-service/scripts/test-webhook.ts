/**
 * Test Webhook Script
 *
 * Sends sample Segment-format events to the webhook receiver.
 *
 * Usage: npx ts-node scripts/test-webhook.ts
 */

const WEBHOOK_URL =
  process.env.WEBHOOK_URL || "http://localhost:4000/segment/webhook";

async function sendEvent(payload: object, description: string) {
  console.log(`\n${description}...`);
  try {
    const response = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    console.log(`  ✓ Response:`, result);
    return true;
  } catch (error) {
    console.log(`  ✗ Error:`, error);
    return false;
  }
}

async function main() {
  console.log("=== Segment Webhook Test ===");
  console.log(`Endpoint: ${WEBHOOK_URL}`);

  const timestamp = new Date().toISOString();
  const testId = Date.now();

  // Test 1: Track event - Page View
  await sendEvent(
    {
      type: "track",
      messageId: `test-pageview-${testId}`,
      anonymousId: `anon-${testId}`,
      event: "Page Viewed",
      properties: { page: "/products" },
      context: {
        page: { url: "https://example.com/products", title: "Products" },
      },
      timestamp,
    },
    "1. Sending Page View track event",
  );

  // Test 2: Track event - Button Click
  await sendEvent(
    {
      type: "track",
      messageId: `test-click-${testId}`,
      anonymousId: `anon-${testId}`,
      userId: `user-${testId}`,
      event: "Button Clicked",
      properties: { buttonId: "add-to-cart", productId: "SKU-123" },
      context: {
        page: {
          url: "https://example.com/products/123",
          title: "Product Detail",
        },
        campaign: { source: "facebook", medium: "social", name: "retargeting" },
      },
      timestamp,
    },
    "2. Sending Button Click track event",
  );

  // Test 3: Track event - Order Completed
  await sendEvent(
    {
      type: "track",
      messageId: `test-purchase-${testId}`,
      userId: `user-${testId}`,
      event: "Order Completed",
      properties: {
        orderId: `order-${testId}`,
        total: 149.99,
        products: [{ id: "SKU-123", quantity: 2 }],
      },
      context: {
        campaign: { source: "email", medium: "email", name: "welcome_series" },
      },
      timestamp,
    },
    "3. Sending Order Completed track event",
  );

  // Test 4: Identify event
  await sendEvent(
    {
      type: "identify",
      messageId: `test-identify-${testId}`,
      anonymousId: `anon-${testId}`,
      userId: `user-${testId}`,
      traits: {
        email: `test-${testId}@example.com`,
        firstName: "Test",
        lastName: "User",
        phone: "+14155551234",
        address: { country: "US", city: "San Francisco" },
      },
      timestamp,
    },
    "4. Sending Identify event",
  );

  console.log("\n=== Test Complete ===");
  console.log("Verify with:");
  console.log(
    `  moose query "SELECT * FROM Event WHERE eventId LIKE 'test-%-${testId}'"`,
  );
  console.log(
    `  moose query "SELECT * FROM Customer WHERE customerId = 'user-${testId}'"`,
  );
}

main().catch(console.error);
