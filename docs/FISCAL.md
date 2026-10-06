# Facturación electrónica — México (CFDI 4.0)

Estado: **flujo completo implementado con un proveedor de timbrado SIMULADO**. Para facturar con validez fiscal falta conectar un PAC real (sección «Conectar un PAC»). Nada de lo que emite el modo simulado tiene validez ante el SAT; la UI, el XML y la API lo marcan explícitamente.

## Qué hace

| Capacidad | Dónde |
|---|---|
| Perfil fiscal del emisor (RFC, razón social, régimen, CP, serie) | Configuración → Facturación · `GET/PUT /fiscal/profile` |
| CP de expedición por sucursal | Configuración → Sucursales (`branches.postal_code`) |
| Claves SAT por producto (`ClaveProdServ`, `ClaveUnidad`) | Menú → producto → «Claves SAT» (por defecto `90101501` restaurantes, `H87` pieza) |
| Datos fiscales del cliente (reutilizables) | Clientes → «Datos fiscales» · `PUT /customers/:id/fiscal` |
| Factura por ticket (personal) | Pedidos → detalle → «🧾 Facturar» · `POST /invoices` |
| **Autofactura** del cliente | Sitio público `/factura` con el **código impreso en el ticket** · `POST /public/:slug/invoice` |
| Factura **global** del día a PÚBLICO EN GENERAL | Facturas → «🌐 Factura global» · `POST /invoices/global` |
| Cancelación con motivo SAT (01–04) | Facturas → detalle · `POST /invoices/:id/cancel` |
| Reintento de timbrado (timeout/error del PAC) | `POST /invoices/:id/retry` |
| Descarga de XML, vista imprimible | `GET /invoices/:id/xml`, botón Imprimir |

Permisos: `fiscal.profile.read|write`, `fiscal.invoice.read|issue|cancel`. ADMIN: todos. GERENTE: todos salvo `profile.write`. CAJERO: `invoice.read|issue` (factura en mostrador, **no cancela**). El alcance por sucursal aplica como en el resto del sistema.

## Reglas fiscales aplicadas (y por qué)

- **Cálculo en centavos y a prueba de redondeo del SAT.** Con precios con IVA incluido, no todo monto es representable como `base + round(base × 16%)`. Se arrastra el error acumulado y cada concepto elige la base que lo compensa: el **total del CFDI coincide con lo cobrado** (a lo más 1¢ por paridad) y **cada traslado cumple `round(Base × tasa)`**, que es lo que valida el SAT (prueba de propiedad con 400 órdenes aleatorias + todos los montos de 1¢ a $600).
- Por concepto: `Importe = Base + Descuento`; `Descuento` prorrateado igual que en la orden. `SubTotal = ΣImporte`, `Total = SubTotal − Descuento + ΣIVA`. Se verifica la aritmética antes de enviar al PAC (`assertConsistent`).
- **Propina: fuera del CFDI.** **Envío a domicilio:** concepto aparte (`78102203`, `E48`) con IVA a la tasa por defecto.
- **Nombre del receptor**: CFDI 4.0 exige el de la constancia fiscal, en mayúsculas y **sin régimen societario**; se normaliza (`S.A. de C.V.`, `S. de R.L.`, `SAPI`, `SAS`…) y se muestra la advertencia en la UI.
- **Validaciones previas**: formato de RFC (físicas 13 / morales 12), régimen ↔ tipo de persona (catálogo c_RegimenFiscal), uso de CFDI ↔ régimen (p. ej. `D*` sólo personas físicas; `616` sólo `S01`), CP de 5 dígitos. El PAC valida contra los catálogos completos; esto evita viajes y mensajes crípticos.
- **RFC genéricos** (`XAXX010101000`) sólo en factura global (CFDI 4.0: régimen 616, uso S01, CP = lugar de expedición, nodo `InformacionGlobal`, un concepto «Venta #NNNN» por ticket y tasa).
- **Forma de pago** = método predominante por monto (efectivo 01, tarjeta 04, transferencia 03, QR 31); `MetodoPago = PUE`.
- **Plazo de autofactura** configurable (`fiscal.invoiceWindowDays`, 31 por defecto). El personal puede facturar dentro del mismo año.
- **Una orden, a lo más una factura vigente** (índice único parcial en `invoice_orders`). Con factura vigente **no se anula ni se devuelve la cuenta** (`INVOICE_ACTIVE`): primero se cancela la factura.
- Un tick incluido en una factura global ya no se autofactura (`IN_GLOBAL`).
- **El CFDI timbrado es inmutable** (trigger `invoices_guard`: no cambian UUID, XML, importes, receptor, folio; no se borra). `invoice_items` es append-only. Cada emisión/cancelación queda en auditoría.
- **Código de autofactura**: 48 bits aleatorios por orden (`orders.invoice_code`), único por tenant. Las rutas públicas están limitadas por IP y no devuelven costos, meseros ni datos de clientes.

## Consistencia con el PAC

1. Transacción 1: bloquea la orden, valida, arma el borrador, **reserva el folio y registra la factura `PENDING`** (esto ya impide dobles facturas concurrentes).
2. Llamada al PAC **fuera de transacción**, con `reference = id de la factura` (el PAC debe ser idempotente por referencia).
3. Transacción 2: `STAMPED` con UUID/XML, o `ERROR` (libera la orden). `retry` reutiliza la misma referencia. Un folio puede quedar sin timbre (hueco interno); no afecta al SAT.

## Conectar un PAC

Implementa `FiscalProvider` (`apps/api/src/modules/fiscal/providers/provider.ts`):

```ts
stamp(draft: InvoiceDraft, xml: string, reference: string): Promise<StampResult>   // idempotente por reference
cancel({ uuid, issuerRfc, motive, replacementUuid? }): Promise<{ status: 'CANCELLED' | 'CANCEL_PENDING'; acuse? }>
```

- `draft` (estructurado) y `xml` (sin sello) llevan los mismos datos: usa el que tu PAC acepte (JSON o XML).
- El **sello con el CSD del emisor lo hace el PAC** (se carga el `.cer/.key` en su portal); este sistema no guarda llaves privadas.
- Registra el proveedor en `fiscal.module.ts` (hoy `FISCAL_PROVIDER=sandbox|none`; añade tu clave) y las credenciales por variables de entorno/secreto, nunca en el código.
- En producción `sandbox` está **prohibido** al arrancar y, sin PAC, la facturación responde `FISCAL_NOT_CONFIGURED`.
- Antes de salir: probar con el ambiente de pruebas del PAC y los RFC públicos del SAT (`EKU9003173C9` emisor, `URE180429TM6` receptor), validar el XML contra el XSD `cfdv40` y revisar la cancelación con receptor que debe aceptar (`CANCEL_PENDING`, que hoy no se sondea: falta un job de consulta de estatus).

## Fuera de alcance (pendiente)

- **Nota de crédito / CFDI de egreso** para devoluciones parciales (hoy: cancelar la factura y re-emitir).
- Complemento de pago (PPD), IEPS/retenciones, factura global semanal/quincenal/mensual (hoy `01` diaria), CFDI de nómina.
- Envío por correo del XML/PDF (no hay servicio de correo aún; se descarga) y PDF oficial (hay vista imprimible).
- Sondeo de estatus ante el SAT y de aceptación de cancelaciones.
- Validación XSD local del XML.
