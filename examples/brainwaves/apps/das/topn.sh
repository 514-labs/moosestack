#!/bin/bash

# Usage: ./topn.sh source.csv n output.csv

if [ "$#" -ne 3 ]; then
  echo "Usage: $0 source.csv n output.csv"
  exit 1
fi

src="$1"
n="$2"
out="$3"

head -n "$n" "$src" > "$out"
