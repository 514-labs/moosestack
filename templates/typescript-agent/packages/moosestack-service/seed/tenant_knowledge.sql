INSERT INTO tenant_knowledge
  (record_id, org_id, category, priority, headline, details, source, timestamp)
VALUES
  (
    generateUUIDv4(),
    'org_a',
    'fleet_health',
    'high',
    'Brake alerts increased by 14% this week',
    'North-east delivery vans show higher fault counts after the last maintenance cycle.',
    'seed',
    now() - toIntervalHour(18)
  ),
  (
    generateUUIDv4(),
    'org_a',
    'support',
    'normal',
    'Late-return tickets cluster around Toronto',
    'Customer messages reference route congestion and delivery-window overflow.',
    'seed',
    now() - toIntervalHour(8)
  ),
  (
    generateUUIDv4(),
    'org_b',
    'fleet_health',
    'normal',
    'Cold-start battery incidents trending down',
    'Battery replacement rollout reduced incidents across the western region.',
    'seed',
    now() - toIntervalHour(11)
  ),
  (
    generateUUIDv4(),
    'org_b',
    'operations',
    'high',
    'Seattle hub utilization breached 92%',
    'Dock turnover remains healthy, but staging delays are increasing during peak hours.',
    'seed',
    now() - toIntervalHour(3)
  );
