#!/usr/bin/env bash
files=(
  "brain_data_coding.csv"
  "brain_data_meditation.csv"
  "brain_data_exercise.csv"
  "brain_data_qigong.csv"
  # Add more filenames here as needed
)

for file in "${files[@]}"; do
  echo "Downloading $file..."
  curl -s "https://downloads.fiveonefour.com/moose/template-data/brainwaves/datasets/$file" -o "$file"
done

ls -lrt brain_data_*.csv
