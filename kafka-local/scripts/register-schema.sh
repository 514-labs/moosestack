#!/usr/bin/env sh
set -eu

SCHEMA_REGISTRY_URL="${SCHEMA_REGISTRY_URL:-http://schema-registry:8081}"
SUBJECT="${SUBJECT:-test-topic-json-value}"

echo "Waiting for Schema Registry at ${SCHEMA_REGISTRY_URL}..."
until curl -s "${SCHEMA_REGISTRY_URL}/subjects" >/dev/null 2>&1; do
  sleep 1
done

SCHEMA='{"$schema":"http://json-schema.org/draft-07/schema#","title":"User","type":"object","additionalProperties":false,"properties":{"id":{"type":"integer"},"name":{"type":"string"}},"required":["id","name"]}'
ESCAPED_SCHEMA=$(printf '%s' "$SCHEMA" | sed 's/"/\\"/g')
PAYLOAD=$(printf '{"schemaType":"JSON","schema":"%s"}' "$ESCAPED_SCHEMA")

echo "Registering schema for subject ${SUBJECT}..."
curl -s -X POST "${SCHEMA_REGISTRY_URL}/subjects/${SUBJECT}/versions" \
  -H "Content-Type: application/vnd.schemaregistry.v1+json" \
  -d "$PAYLOAD"
echo
echo "Schema registration complete."


