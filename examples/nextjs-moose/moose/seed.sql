INSERT INTO events (id, amount, event_time, status)
SELECT
    generateUUIDv4() as id,
    toInt32(rand() % 1000 + 1) as amount,
    toDate(now()) - toIntervalDay(rand() % 30) as event_time,
    CASE (rand() % 3)
        WHEN 0 THEN 'completed'
        WHEN 1 THEN 'active'
        WHEN 2 THEN 'inactive'
    END as status
FROM numbers(1000);