#!/usr/bin/env bash
set -euo pipefail

BOOTSTRAP="${BOOTSTRAP:-kafka:29092}"
TOPIC="${TOPIC:-test-topic}"
PARTITIONS="${PARTITIONS:-1}"
REPLICATION="${REPLICATION:-1}"

echo "Waiting for Kafka at ${BOOTSTRAP}..."
until kafka-topics --bootstrap-server "${BOOTSTRAP}" --list >/dev/null 2>&1; do
  sleep 1
done

echo "Creating topic ${TOPIC} (if not exists)..."
kafka-topics \
  --bootstrap-server "${BOOTSTRAP}" \
  --create \
  --if-not-exists \
  --topic "${TOPIC}" \
  --partitions "${PARTITIONS}" \
  --replication-factor "${REPLICATION}"

echo "Topic setup complete."


