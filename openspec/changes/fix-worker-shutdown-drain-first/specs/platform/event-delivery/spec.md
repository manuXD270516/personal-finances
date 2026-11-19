## MODIFIED Requirements

### Requirement: Apagado ordenado de la entrega de eventos
Ante una señal de apagado, el proceso que publica y consume eventos DEBE (MUST) dejar de tomar eventos nuevos, permitir que terminen los que están en curso dentro del período de gracia y cerrar sus conexiones; un evento interrumpido NO DEBE (MUST NOT) perderse ni aplicarse dos veces.
Trace: NFR-REL-009 · Priority: Must

#### Scenario: Apagado con un evento en proceso
- **CUANDO** el worker recibe la señal de apagado mientras un consumidor procesa un evento que tarda 1 segundo
- **ENTONCES** el consumidor termina y confirma el efecto antes de que el proceso se detenga
- **Y** no se toman eventos nuevos después de la señal
- **Y** al reiniciar el worker el evento no se vuelve a aplicar

#### Scenario: El relay tarda en terminar su lote y la cola ya no toma jobs
- **CUANDO** el worker recibe la señal de apagado mientras el relay del outbox tiene un lote en curso que todavía no termina
- **Y** se encola un job después de la señal
- **ENTONCES** el worker no toma ese job (sigue en cola sin efecto) ni antes ni después de que el relay termine su lote
