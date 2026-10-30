# Crear y probar reglas de clasificación

> Change `add-rule-engine` · capability `rules/rule-engine` · FR-RULES-001..010. Para quien clasifica sus transacciones
> importadas con reglas y quiere medir el criterio de salida de Phase 6 (≥ 70 % clasificado por reglas).

Una regla dice **CUANDO** se cumplen sus condiciones **ENTONCES** se aplican sus acciones. Nunca cambia montos, monedas,
cuentas, fechas, tipo ni estado de una transacción, y nunca genera asientos: solo clasifica (categoría, etiquetas,
contraparte, campos personalizados, descripción visible, notas y marca de revisión).

## 1. Crear una regla

1. **Reglas → Nueva regla.** Elige un nombre (único entre las no archivadas, sin distinguir mayúsculas) y una prioridad: el
   número menor se evalúa primero.
2. **Cuándo se aplica.** Por defecto: al importar y sobre el historial. Activa «Al crear a mano» solo si quieres que la regla
   complete categorías vacías cuando registras una transacción a mano (nunca reemplaza lo que elijas).
3. **Condiciones.** Texto (sin acentos ni mayúsculas), monto (con su moneda; compara exacto y solo transacciones de esa
   moneda), fecha, día de la semana o del mes, tipo, cuenta, categoría actual, etiqueta, contraparte, fuente y campos
   personalizados. `Todas` o `Alguna`; hasta 20 condiciones y grupos de un nivel. La expresión regular usa un motor de
   tiempo lineal (hasta 200 caracteres, sin referencias hacia atrás ni lookaround): ninguna regla puede bloquear la
   evaluación.
4. **Acciones.** Hasta 10. En cada campo gana la **primera** regla que lo fija (por prioridad); las siguientes solo suman lo
   que otra no tocó. «Detener» corta la cadena para esa transacción.
5. **Vista previa.** Escribe la descripción de un ejemplo: ves cada condición cumplida o no (con el valor actual) y las
   acciones que resultarían, sin guardar nada. Pruébala con filas reales de tu extracto antes de guardar.
6. **Guardar regla.** Cada cambio de las condiciones, acciones, disparadores o de «detener» crea una **versión** nueva e
   inmutable; las transacciones ya clasificadas conservan la versión con que se clasificaron. Cambiar el nombre, la
   descripción o la prioridad se audita sin versión.

## 2. Probarla sobre lo que ya tienes (sin riesgo)

Pestaña **Ejecutar sobre el historial**:

1. Elige el rango (hasta 366 días) y el modo. **Completar** solo llena lo vacío; **Reemplazar** también cambia lo ya
   clasificado (revísalo con cuidado).
2. **Ejecutar (sin cambiar nada)** devuelve el diff por transacción: campo, valor actual → propuesto, regla y versión. Un
   rango de más de 5 000 transacciones se marca como truncado.
3. Desmarca lo que no quieras y **Aplicar**: es una edición masiva atómica y auditada, de a 500 por página. Las
   transacciones en un periodo cerrado, conciliadas o administradas por otro módulo se informan como no aplicables y no
   impiden el resto.
4. Si entre la ejecución y la aplicación cambió una regla o una transacción, la aplicación se rechaza completa
   (`RULE_DRY_RUN_STALE`) y no cambia nada: vuelve a ejecutar.

## 3. Medir la cobertura (criterio de salida de Phase 6)

1. Importa tus extractos (ver [importar-extracto-csv.md](importar-extracto-csv.md)); la clasificación aprobada en la vista
   previa viaja con su origen a cada transacción.
2. Pestaña **Cobertura** (o `GET /api/v1/workspaces/{id}/rules/coverage?from=AAAA-MM-DD&to=AAAA-MM-DD`): cuenta las
   transacciones importadas (ingresos, gastos y reembolsos no anulados; sin transferencias ni conversiones) cuya categoría
   fijó **hoy** una regla ÷ el total, con 4 decimales, junto a la meta `0.7000`. Una categoría de regla que corregiste a
   mano después **no** cuenta: la cifra mide reglas útiles. El desglose muestra las que clasificó la contraparte por
   defecto, las manuales y las que siguen sin categoría.
3. Para registrar la evidencia del owner (tarea 7.5 de `add-rule-engine`) anota solo la fecha, el rango y `ruleCoverage`;
   nunca montos ni descripciones.

## 4. Mantenimiento

- **Requiere atención:** un destino de la regla (categoría, etiqueta, contraparte o campo) se archivó. La acción se omite
  con su motivo y una regla posterior puede fijar el campo; edita la regla para apuntar a un destino activo.
- **Sin aplicaciones en 90 días:** una regla activa que no clasificó nada en ese tiempo; revísala o archívala.
- **Archivar** deja de evaluar la regla y libera su nombre; las transacciones que clasificó siguen mostrando su nombre y
  versión («v1, archivada»). Las reglas nunca se eliminan.
- **Pendientes de revisión:** la acción «marcar para revisión» deja la transacción con una marca (sin efecto en el saldo).
  Transacciones → filtro «Pendientes de revisión»; se quita desde el detalle y queda auditado.
