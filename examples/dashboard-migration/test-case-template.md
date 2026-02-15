# Test case: <TEST_CASE_NAME>

## Request (curl)

```bash
# Method: GET|POST
# Path: /api/<endpoint>
# Expected: HTTP 200
# Auth: Bearer token via $API_TOKEN (do not paste secrets)
# Notes: <timezone/order/pagination assumptions if relevant>

# Set once in your shell:
# export API_BASE_URL="http://localhost:4000"
# export API_TOKEN="..."

# GET (query params)
curl -sS -G "$API_BASE_URL/api/<endpoint>" \
  -H "Authorization: Bearer $API_TOKEN" \
  --data-urlencode "param1=value1" \
  --data-urlencode "param2=value2" \
  | jq .

# POST (JSON body)
curl -sS -X POST "$API_BASE_URL/api/<endpoint>" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"param1": "value1", "param2": "value2"}' \
  | jq .
```

## Expected response

```json
{
  "REPLACE_ME": "paste the full JSON response body here (verbatim from the running endpoint)"
}
```
