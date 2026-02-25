-- Seed data for multi-tenant demo (Tier 3)
-- Run against ClickHouse after the DataEvent table is created:
--   clickhouse-client --port 9000 --multiquery < seed-data.sql
--
-- Two organizations: org_3AAaPqJ6m4thtqYUbePud3EtQNE and org_3AAaS98jZ1sujxREsKs3hR4C97c
-- Each has different event types and data to make isolation visually obvious.

INSERT INTO DataEvent (eventId, timestamp, eventType, data, org_id) VALUES
  ('acme-001', now() - INTERVAL 7 DAY, 'page_view',   '{"page": "/dashboard", "user": "alice@acme.com"}',           'org_3AAaPqJ6m4thtqYUbePud3EtQNE'),
  ('acme-002', now() - INTERVAL 6 DAY, 'page_view',   '{"page": "/settings", "user": "bob@acme.com"}',              'org_3AAaPqJ6m4thtqYUbePud3EtQNE'),
  ('acme-003', now() - INTERVAL 5 DAY, 'signup',       '{"plan": "enterprise", "user": "charlie@acme.com"}',         'org_3AAaPqJ6m4thtqYUbePud3EtQNE'),
  ('acme-004', now() - INTERVAL 4 DAY, 'purchase',     '{"amount": 299, "product": "Pro Plan", "user": "alice@acme.com"}', 'org_3AAaPqJ6m4thtqYUbePud3EtQNE'),
  ('acme-005', now() - INTERVAL 3 DAY, 'page_view',   '{"page": "/reports", "user": "alice@acme.com"}',             'org_3AAaPqJ6m4thtqYUbePud3EtQNE'),
  ('acme-006', now() - INTERVAL 2 DAY, 'api_call',    '{"endpoint": "/api/export", "status": 200}',                 'org_3AAaPqJ6m4thtqYUbePud3EtQNE'),
  ('acme-007', now() - INTERVAL 1 DAY, 'page_view',   '{"page": "/billing", "user": "bob@acme.com"}',               'org_3AAaPqJ6m4thtqYUbePud3EtQNE'),
  ('acme-008', now(),                   'support_ticket', '{"subject": "Billing question", "priority": "low"}',      'org_3AAaPqJ6m4thtqYUbePud3EtQNE');

INSERT INTO DataEvent (eventId, timestamp, eventType, data, org_id) VALUES
  ('glob-001', now() - INTERVAL 7 DAY, 'page_view',   '{"page": "/home", "user": "dana@globex.com"}',               'org_3AAaS98jZ1sujxREsKs3hR4C97c'),
  ('glob-002', now() - INTERVAL 6 DAY, 'signup',       '{"plan": "starter", "user": "eve@globex.com"}',              'org_3AAaS98jZ1sujxREsKs3hR4C97c'),
  ('glob-003', now() - INTERVAL 5 DAY, 'page_view',   '{"page": "/analytics", "user": "dana@globex.com"}',          'org_3AAaS98jZ1sujxREsKs3hR4C97c'),
  ('glob-004', now() - INTERVAL 4 DAY, 'experiment',   '{"variant": "B", "feature": "new_onboarding"}',              'org_3AAaS98jZ1sujxREsKs3hR4C97c'),
  ('glob-005', now() - INTERVAL 3 DAY, 'purchase',     '{"amount": 49, "product": "Starter Plan", "user": "eve@globex.com"}', 'org_3AAaS98jZ1sujxREsKs3hR4C97c'),
  ('glob-006', now() - INTERVAL 2 DAY, 'error',        '{"code": 500, "endpoint": "/api/webhook"}',                  'org_3AAaS98jZ1sujxREsKs3hR4C97c'),
  ('glob-007', now() - INTERVAL 1 DAY, 'page_view',   '{"page": "/integrations", "user": "dana@globex.com"}',       'org_3AAaS98jZ1sujxREsKs3hR4C97c'),
  ('glob-008', now(),                   'deployment',   '{"version": "2.1.0", "environment": "production"}',          'org_3AAaS98jZ1sujxREsKs3hR4C97c');
