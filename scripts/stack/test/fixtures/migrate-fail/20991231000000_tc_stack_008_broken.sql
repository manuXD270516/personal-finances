-- Fixture de TC-PLATFORM-STACK-008: migración rota a propósito (error SQL).
-- migrate:up
CREATE TABLE platform.tc_stack_008_broken (id int,, oops);

-- migrate:down
DROP TABLE IF EXISTS platform.tc_stack_008_broken;
