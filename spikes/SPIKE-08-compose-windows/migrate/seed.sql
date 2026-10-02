INSERT INTO spike.persist_probe(note) SELECT 'seed row ' || g FROM generate_series(1, 10) g;
