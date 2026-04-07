-- EXAMPLE_APP_ONLY: Starter records for the seeded TenantKnowledge demo model.
-- Replace or remove this file when you swap out the example data model, then
-- search the repo for EXAMPLE_APP_ONLY to find the downstream demo wiring.
INSERT INTO tenant_knowledge
  (record_id, org_id, category, priority, headline, details, source, timestamp)
VALUES
  (
    generateUUIDv4(),
    'org_a',
    'fleet_health',
    'high',
    '1 brake alert opened this week',
    'Only 1 van reported a brake fault after maintenance in the north-east route.',
    'seed',
    now() - toIntervalHour(18)
  ),
  (
    generateUUIDv4(),
    'org_a',
    'support',
    'normal',
    '2 late-return tickets opened in Toronto',
    'Support logged 2 route-delay complaints tied to downtown traffic.',
    'seed',
    now() - toIntervalHour(8)
  ),
  (
    generateUUIDv4(),
    'org_b',
    'fleet_health',
    'normal',
    '50 cold-start battery incidents logged this month',
    'Battery replacements reduced repeats, but 50 incidents still hit the western region.',
    'seed',
    now() - toIntervalHour(11)
  ),
  (
    generateUUIDv4(),
    'org_b',
    'operations',
    'high',
    '1,024 packages stalled at the Seattle hub',
    'Dock turnover is steady, but 1,024 packages are waiting in overflow staging.',
    'seed',
    now() - toIntervalHour(3)
  );
