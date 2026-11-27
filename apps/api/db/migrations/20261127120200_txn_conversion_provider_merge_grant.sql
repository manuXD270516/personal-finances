-- TRANSACTIONS: la fusión de contrapartes reasigna el proveedor descriptivo de las conversiones (openspec
-- add-category-and-counterparty-merge, tarea 4.1; design.md decisión 4). `txn.conversion_detail` era solo de lectura e
-- inserción para `pf_app`; se abre UNA columna (`provider_counterparty_id`, dato descriptivo que no entra en ningún
-- asiento ni monto, INV-021). Expand, no destructiva. Se ejecuta con `pf_migrator`.

-- migrate:up
GRANT UPDATE (provider_counterparty_id) ON txn.conversion_detail TO pf_app;

-- migrate:down
REVOKE UPDATE (provider_counterparty_id) ON txn.conversion_detail FROM pf_app;
