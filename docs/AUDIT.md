# Auditoría de seguridad e integridad

Auditoría de caja blanca previa a las pruebas reales. Cuatro revisiones independientes (dinero e integridad de datos · superficie pública y entradas no confiables · autorización y aislamiento multi-tenant · frontend, infraestructura y despliegue) que leyeron el código y razonaron escenarios de ataque/fallo. **Cada hallazgo se verificó contra el código antes de corregirse.** Resultado de las revisiones: **0 fugas entre tenants, 0 bypass de RLS**; los problemas estaban en el alcance por sucursal dentro de un tenant, en los controles de supervisor/dinero y en la superficie pública.

Estado: ✅ corregido y con prueba · 🟡 mitigado (riesgo reducido, ver nota) · ⏳ pendiente / riesgo residual aceptado para esta etapa.

## 1. Dinero e integridad de datos
| # | Sev. | Hallazgo | Estado |
|---|------|----------|--------|
| D1 | Crítica | Descuentos manuales acumulables eludían el umbral de supervisor (10 × 10 % = 100 %); un descuento fijo pesaba más al cancelar/dividir partidas | ✅ El umbral se evalúa sobre el **acumulado**; se revocan los descuentos autoaprobados que lo rebasan tras cambiar la cuenta; el umbral inválido (NaN) cae a 10 %; no se descuenta con pagos previos |
| D2 | Alta | PIN/código del supervisor guardados en claro en `sync_operations.payload` y visibles en `/sync/exceptions` | ✅ Se omite el PIN al persistir; el reintento pide el PIN de nuevo |
| D3 | Alta | CFDI: `retry` timbraba ventas ya devueltas/canceladas; `CANCEL_PENDING` no tenía salida y bloqueaba la venta para siempre | ✅ `retry` revalida la venta; nuevo `POST /invoices/:id/cancel/resolve` (aceptada/rechazada); 🟡 un timeout ambiguo del PAC sigue liberando el bloqueo (el PAC es idempotente por `reference`) |
| D4 | Alta | Devolución parcial dejaba la orden en PARTIAL: salía de reportes y se volvía cobrable | ✅ La venta sigue `PAID`, `refunded_total` se lleva aparte, reportes y dashboards restan lo devuelto, no se puede re-cobrar ni facturar |
| D5 | Alta | Reembolso sin idempotencia (doble clic = doble devolución) | ✅ `clientUuid` (la UI lo manda) + detección de duplicado idéntico en 5 s. ⏳ `cash/movements`, `loyalty/adjust` e `inventory/movements` aún sin llave de idempotencia |
| D6 | Alta | `sync/retry` reaplicaba cualquier operación; pagos offline sin `clientUuid` | ✅ `FOR UPDATE` + solo `NEEDS_REVIEW/FAILED`; `clientUuid` obligatorio por pago en el sync |
| D7 | Media | Cobro/devolución concurrente con el cierre de turno | ⏳ Ventana de milisegundos; el corte detecta la diferencia. Pendiente: `FOR SHARE` del turno + trigger |
| D8 | Media | Descuento sobre cuenta con pago parcial / total 0 deja la orden sin cerrar | ✅ Descuentos bloqueados con pagos. ⏳ Una cuenta de $0 (cortesía 100 %) no se cierra desde `pay` |
| D9 | Media | `offline:true` lo decidía el cliente (saltaba stock, disponibilidad y sucursal cerrada) | ✅ Se ignora en REST; solo `/sync/push` lo fija |
| D10 | Media | Pedido con `clientUuid` fusionado en una cuenta abierta perdía el uuid | ✅ Tabla de alias `order_client_aliases` |
| D11 | Media | `ORDER_PAY` offline fallaba por stock | ✅ Propaga `offline`. ⏳ El efectivo cae en el turno vigente al sincronizar, no en el de captura |
| D12 | Media | Cupones: tope de canjes solo al aplicar | ✅ Se revalida y bloquea al cobrar (si cambia el total, no se cobra y se avisa). ⏳ Sin límite por cliente |
| D13 | Media | Reembolso por un medio distinto al cobrado | ✅ Solo por el medio cobrado y hasta su neto. ⏳ Las propinas no se devuelven |
| D14 | Media | Conteo físico contra saldo actual; faltantes de transferencia “desaparecían”; bandera de revisión borrada a todos | ✅ Foto del saldo al capturar el conteo; faltante = merma en el kardex; solo se limpian los insumos contados. ⏳ Las transferencias no propagan caducidad de lote |
| D15 | Media | Costo promedio manipulable (entradas negativas, PUT que lo ponía en 0, carrera entre sucursales) | ✅ Entradas positivas, cotas, `avgCost` opcional al editar (la UI solo lo manda con permiso), `FOR UPDATE` del insumo |
| D16 | Media | Compras: tope +10 % evadible con renglones repetidos, costo libre, facturas sin proveedor/suma | ✅ Acumulado por insumo, costo ±10 % sin aprobación, proveedor y suma de facturas por OC. ⏳ `payInvoice` con bandera de variación sigue pagable por quien aprueba |
| D17 | Media | Gastos sin tope acumulado; depósitos sin control; conteo ciego derrotable | ✅ Tope acumulado por turno, todo depósito con supervisor, cierres rechazados auditados y a la 3.ª solo con supervisor |
| D18 | Media | Lealtad: canje con cliente ajeno, repetido, no reversible | ✅ Cliente = el de la orden, un canje por unidad, reversa al cancelar, no se quitan canjes a mano. ⏳ `lifetime_points` no baja con reversas; la expiración de puntos no está implementada |
| D19 | Baja | Reembolso repone inventario de partidas sin cocina ya entregadas | ⏳ |
| D20 | Baja | Esquemas Zod sin precisión/cotas | ✅ Montos de venta a centavos y finitos; movimientos con cotas. ⏳ El resto de los esquemas (`modifierIds` únicos, etc.) |

## 2. Superficie pública y entradas no confiables
| # | Sev. | Hallazgo | Estado |
|---|------|----------|--------|
| P1 | Alta | Rate-limit global evadible con `Authorization: Bearer <cualquier cosa>` | ✅ El cubo por sesión solo se usa si la **firma del JWT** es válida; si no, por IP. Prueba incluida |
| P2 | Alta | QR de mesa estático: agregaba consumos a la cuenta del mesero, desde cualquier lugar | ✅ El pedido QR va en **su propia orden**; tope de 6 pedidos/10 min por mesa; cantidades acotadas. ⏳ El token no rota por sesión de mesa |
| P3 | Alta | La config de impresora dictaba ruta de archivo y host/puerto arbitrarios al agente | ✅ Esquema discriminado (solo red o `/dev/…`), y **política local del agente** (solo `/dev/`, IP privadas, lista blanca por entorno) |
| P4 | Media | Código de autofactura de 48 bits, XML enumerable | 🟡 Límite estricto 10/min/IP en lookup/XML. ⏳ Segundo factor (total/fecha) y código más largo |
| P5 | Media | GET públicos sensibles sin límite; loyalty con PII en la URL | ✅ Cubos por IP (escritura / sensibles / lectura), IPv6 por /64, `loyalty` por POST, `Cache-Control: no-store` |
| P6 | Media | Reservaciones públicas: bloqueo masivo de mesas | ✅ Horizonte 60 días, duración ≤ 3 h, máx. 3 por confirmar por teléfono, caducan a las 24 h. ⏳ Sin OTP/CAPTCHA |
| P7 | Media | Pedidos en línea/QR en masa sin caducidad | 🟡 Topes y límites por IP/mesa. ⏳ Los PENDING públicos no caducan solos |
| P8 | Media | Cupones: existencia enumerable | ⏳ Mitigado por el límite de 30 POST/min/IP |
| P9 | Media | `receipt.txt` sin alcance de sucursal/propietario y con código de autofactura | ✅ Mismo alcance que ver la orden; el código solo para quien cobra |
| P10 | Media | Pedido público confirma correos registrados (409 con nombre de constraint) y permite apropiarse de un correo | ✅ El correo solo se guarda si nadie lo tiene; los 409 ya no exponen constraints |
| P11 | Baja | Bloqueo de cuenta usable como DoS y 423 enumera cuentas | ✅ Solo quien presenta la credencial correcta ve 423; un intento fallido no prolonga el bloqueo; clave de límite normalizada |
| P12 | Baja | Entradas inválidas → 500 (ZodError, `\u0000`, uuid) | ✅ → 400. Además: los errores en rutas `text/plain`/XML ya no fallan al serializarse |
| P13 | Baja | Correo de autofactura a destino arbitrario; XML con caracteres ilegales; error crudo del PAC | ⏳ |
| P14 | Baja | `trustProxy: true` | ✅ `TRUST_PROXY` (redes privadas por defecto, configurable) |
| P15 | Baja | Socket.IO con `origin: true` | ✅ Lista de `CORS_ORIGINS`; sockets revalidados cada minuto |
| P16 | Baja | `POST /mail/test` a cualquier destinatario | ⏳ |
| P17 | Baja | `PUT /printers/:id` sin validar la sucursal actual | ✅ |
| P18 | Baja | Higiene de despliegue (seed en la imagen, contraseña en `-e`, `COOKIE_SECURE`) | ✅ Seed se niega en producción; la API no arranca en producción con cookie insegura / CORS localhost / secreto trivial; docs de provisión sin contraseña en la línea de comandos |

## 3. Autorización y aislamiento
Causa raíz común: el guard evaluaba **un solo** `branchId` (ruta > query > cabecera > cuerpo). Ahora valida **todos** los presentes y los servicios revalidan sobre la fila cargada.

| # | Sev. | Hallazgo | Estado |
|---|------|----------|--------|
| A1 | Alta | `PUT /settings` global/cross-sucursal y claves libres | ✅ Whitelist con validación de tipo y rango; global solo con alcance corporativo; sucursal solo la propia |
| A2 | Alta | Umbrales de supervisor acumulables | ✅ Ver D1/D17 |
| A3 | Alta | PIN-login (4-6 dígitos) sin límite por IP | 🟡 Límite por IP+tenant independiente del identificador. ⏳ Política de PIN ≥ 6 dígitos y restricción a dispositivos |
| A4 | Media | Bloqueo de supervisor usable para dejar fuera a un gerente | ✅ |
| A5 | Media | Empleados: crear/editar/borrar sin validar sucursal | ✅ |
| A6–A7 | Media | `receipt.txt` e impresoras de otra sucursal | ✅ |
| A8 | Media | Cancelar pedido a domicilio sin PIN de supervisor | ✅ |
| A9 | Media | PIN en bandeja de sync | ✅ |
| A10 | Media | Access token no revocable; tenant suspendido seguía operando | ✅ El `sid` y el estado del restaurante se validan en cada petición; logout funciona aun con el access token vencido |
| A11 | Media | Bearer falso evade el límite global | ✅ |
| A12 | Media | Escalada de alcance al asignar roles | ✅ Permisos exigidos en cada sucursal destino; corporativo solo con permiso corporativo |
| A13 | Media | IDOR de lectura (conteos, transferencias, OC, entregas, usuarios, cotizaciones) | ✅ |
| A14 | Media | Token QR estático | 🟡 Ver P2 |
| A15 | Media | WebSocket autorizado solo al conectar | ✅ Revalidación cada minuto. ⏳ Todos los roles de una sucursal reciben todos los eventos de su sala |
| A16 | Media | Recursos de toda la cadena editables con permiso de una sucursal | ✅ Menú, recetas, promociones y reglas de lealtad exigen alcance corporativo (el precio por sucursal sigue siendo del gerente). ⏳ Facturas de proveedor |
| A17 | Baja | Costos visibles a roles sin permiso de costos (kardex, valuación) | ⏳ |
| A18 | Baja | Auditor por sucursal ve eventos globales | ✅ |
| A19 | Baja | Reservaciones a mesa de otra sucursal; canje de puntos | ✅ |
| A20 | Baja | Lecturas amplias (cupones, mapa con `qrToken`), códigos de recuperación 2FA con SHA-256 | ⏳ |

## 4. Infraestructura y frontend
✅ Compose de producción inválido (YAML) corregido y **validado en CI**; HSTS en Caddy; `permissions: contents: read` en CI; `.dockerignore` ampliado; el logout limpia la caché local y las operaciones offline pendientes solo las sincroniza quien las capturó; hosts obligatorios en compose.

## 5. Cómo se verificó
- Cada corrección tiene prueba automatizada (`apps/api/test/audit.test.ts`, `sales.test.ts`, `rate-limit-global.test.ts`, `identity.test.ts`, `reports.test.ts`, `agent.test.ts`, `env.test.ts`).
- Suites completas, typecheck y e2e (13 pruebas, con accesibilidad axe) contra el **stack Docker de demostración** reconstruido (ver `docs/TESTING.md`).

## 6. Riesgos residuales (decisión para la siguiente etapa)
1. **PAC real**: el timbrado es simulado (`sandbox`); un timeout real del PAC requiere consultar por `reference` antes de liberar.
2. **PIN de 4-6 dígitos**: recomendar 6; el límite por IP lo mitiga, no lo elimina.
3. **Idempotencia** en movimientos de caja/inventario/puntos y **cortes concurrentes** (D5, D7).
4. **QR/online**: rotación del token por sesión de mesa, caducidad de pedidos PENDING públicos, OTP/CAPTCHA.
5. **Autofactura**: código más largo + segundo factor.
6. **Eventos en tiempo real** sin filtro por permiso dentro de una sucursal.
7. **Pasarela de pagos** inexistente: tarjeta/transferencia/QR se capturan manualmente (sin conciliación bancaria).
