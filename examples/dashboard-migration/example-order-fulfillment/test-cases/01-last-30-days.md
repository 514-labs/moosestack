# Test case: last-30-days

## Request (curl)

```bash
# Method: POST
# Expected: HTTP 200
# Auth: Bearer token via $API_TOKEN (do not paste secrets)

curl -sS -X POST "$API_BASE_URL/api/order-fulfillment" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d @- << 'JSON' \
  | jq .
{
  "merchantId": "123",
  "startDate": "2024-01-01",
  "endDate": "2024-01-31"
}
JSON
```

## Expected response

```json
{
  "rows": [
    { "day": "2024-01-01", "fulfilled": 10, "total": 12 }
  ],
  "totals": { "fulfilled": 10, "total": 12 }
}
```
