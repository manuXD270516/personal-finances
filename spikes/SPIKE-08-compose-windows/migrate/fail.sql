-- Deliberately broken migration: must make `migrate` exit != 0 and block api/worker.
CREATE SCHEMA IF NOT EXISTS spike;
CREATE TABLE spike.broken (id int PRIMARY KEY, amount numeric(20,4) NOT NULL;
