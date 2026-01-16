# Query Helpers Test Project

This is a test Moose project demonstrating the **query-helpers_v2** pattern - a 3-layer architecture for building type-safe query APIs.

## Project Structure

```
examples/query-helpers/
├── app/
│   ├── index.ts              # Re-exports all tables
│   ├── ingest/
│   │   └── models.ts         # Orders, Products, Customers tables
│   └── apis/
│       └── ordersWebApp.ts   # Express WebApp using query-helpers_v2
├── src/
│   ├── query-helpers.ts      # v1 helpers (original)
│   └── query-helpers_v2.ts   # v2 helpers (3-layer pattern)
├── moose.config.toml
├── package.json
├── tsconfig.json
├── USAGE.md                  # v1 documentation
└── USAGE_v2.md               # v2 documentation
```

## Data Models

Three related tables for an e-commerce scenario:

- **Orders**: Order transactions with `order_id`, `customer_id`, `amount`, `status`, etc.
- **Products**: Product catalog with `product_id`, `name`, `category`, `price`, etc.
- **Customers**: Customer records with `customer_id`, `name`, `email`, `tier`, etc.

## Query Helpers v2 Pattern

The WebApp in `app/apis/ordersWebApp.ts` demonstrates all 3 layers:

### Layer 1: Validation (Typia)

```typescript
interface OrderFilters {
  orderId?: string;
  status?: "pending" | "completed" | "cancelled";  // Enum validated by Typia
  minAmount?: number & tags.Minimum<0>;
}

const validateParams = createParamValidatorSafe<OrderQueryParams>();
```

### Layer 2: Mapping

```typescript
const orderParamMap = createParamMap<OrderFilters, Order>(OrdersTable, {
  filters: {
    orderId: { column: "order_id" },
    minAmount: { column: "amount", operator: "gte" },
  },
  defaultSelect: ["order_id", "customer_id", "amount", "status", "created_at"],
  defaultOrderBy: [{ column: "created_at", direction: "DESC" }],
});
```

### Layer 3: SQL Generation

```typescript
const intent = orderParamMap.toIntent({ filters, pagination });
const query = toQuerySql(OrdersTable, intent);
const result = await client.query.execute(query);
```

## Running the Project

```bash
# Install dependencies
npm install

# Start Moose dev server
npm run dev
```

## Example Requests

```bash
# List orders with filters
curl -X POST http://localhost:4000/orders \
  -H "Content-Type: application/json" \
  -d '{
    "filters": {
      "status": "pending",
      "minAmount": 100
    },
    "pagination": {
      "limit": 20,
      "offset": 0
    }
  }'

# Get summary report
curl -X POST http://localhost:4000/orders \
  -H "Content-Type: application/json" \
  -d '{ "reportType": "summary" }'

# Get orders grouped by status
curl -X POST http://localhost:4000/orders \
  -H "Content-Type: application/json" \
  -d '{ "reportType": "by-status" }'
```

## Documentation

- [USAGE.md](USAGE.md) - v1 query helpers documentation
- [USAGE_v2.md](USAGE_v2.md) - v2 query helpers documentation (3-layer pattern)
