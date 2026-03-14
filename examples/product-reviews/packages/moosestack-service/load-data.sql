INSERT INTO `local`.AmazonReview
SELECT * FROM s3(
  'https://datasets-documentation.s3.eu-west-3.amazonaws.com/amazon_reviews/amazon_reviews_2015.snappy.parquet',
  'Parquet'
);
