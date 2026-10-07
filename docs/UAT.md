# Guía de pruebas reales (UAT)

Para que el equipo del restaurante use el sistema **como en un día de operación** antes de ponerlo en producción.

## 1. Levantar el entorno
Requisitos: Docker + Docker Compose v2.
```bash
./scripts/demo.sh up          # construye, migra, carga datos de demostración y espera a que esté listo (~2-4 min la 1.ª vez)
./scripts/demo.sh up --mail   # igual, con un buzón falso (Mailpit) en http://localhost:8025 para ver los correos
./scripts/demo.sh status | logs | down | reset   # reset BORRA los datos y empieza de cero
```
| Qué | URL |
|---|---|
| Admin / POS / KDS / Caja | http://localhost:8080 (restaurante: `retroburger`) |
| Sitio del cliente (pedir, reservar, puntos, facturar) | http://localhost:8081 |
| API + Swagger | http://localhost:3000/docs |

**Usuarios** (contraseña de dueño `Retro90!Burger`; de personal `Retro90!Staff`, PIN `1990`):
| Rol | Usuario | Sirve para |
|---|---|---|
| Dueño (ADMIN, todas las sucursales) | `admin@retroburger.test` | configuración, reportes corporativos, fiscal, usuarios |
| Gerente | `gerente-centro@retroburger.test` | operación de la sucursal, autoriza con PIN |
| Cajero | `cajero-centro@retroburger.test` | abrir/cerrar caja, cobrar, devoluciones |
| Mesero | `mesero1-centro@retroburger.test`, `mesero2-centro@…` | mesas, órdenes |
| Cocina | `cocinero-centro@retroburger.test` | KDS |
| Almacén | `almacen-centro@retroburger.test` | inventario, compras, transferencias |
| Repartidor | `repartidor-centro@retroburger.test` | entregas propias |
Hay datos de **Centro, Norte y Sur** y 21 días de ventas históricas. Cambia de sucursal arriba a la izquierda. En «PIN rápido» el código es la parte del correo antes de `@` (p. ej. `cajero-centro`) y el PIN `1990`; ese PIN también es el de supervisor.

> ⚠️ Es un entorno de **demostración**: contraseñas conocidas, timbrado fiscal **simulado**, sin pasarela de pagos, sin impresora física. No lo expongas a Internet.

## 2. Recorridos sugeridos (marca ✅/❌ y anota)
### Un turno completo (mesero → cocina → cajero)
1. **Cajero**: abrir caja con fondo (p. ej. $500).
2. **Mesero**: abrir una mesa, agregar hamburguesa con modificadores (queso extra, sin cebolla) y papas → *Enviar a cocina*. Verifica que la mesa pasa a «ocupada».
3. **Cocina (KDS)**: la comanda llega por estación; avanzar *Preparando → Listo*. Revisa colores/tiempos.
4. **Cajero**: cobrar mixto (efectivo + tarjeta), con propina. Ticket en pantalla. La mesa se libera.
5. **Inventario** (almacén/gerente): el consumo de insumos aparece en el kardex con la receta correcta.
6. **Cajero**: cerrar caja con **conteo ciego**. Provoca una diferencia > tolerancia y comprueba que pide comentario y PIN de gerente.

### Controles que deben funcionar (intenta romperlos)
- **Descuento**: 10 % lo aplica el cajero; otro 10 % encima ya pide PIN; 30 % pide PIN. Cancela una partida: un descuento fijo grande se revoca solo.
- **Cancelar** una orden ya enviada a cocina pide PIN de gerente.
- **Devolución** parcial y total (con PIN): la venta sigue en reportes por el neto; no se puede cobrar de nuevo; doble clic no devuelve dos veces; solo por el medio con el que se cobró.
- **Gastos** de caja: varios gastos pequeños acaban pidiendo PIN; todo depósito pide PIN.
- **Sin conexión**: corta la red del navegador (DevTools → Offline), vende y cobra en el POS; al reconectar se sincroniza. Lo irreparable aparece en *Configuración → Bandeja de excepciones*.
- **Permisos**: con el mesero intenta entrar a Reportes, Caja o Configuración; con un gerente de Centro intenta ver/editar Norte.

### Cliente (sitio público, http://localhost:8081)
- Pedir para recoger / a domicilio (con cupón), seguimiento del pedido; el pedido aparece en el POS como «por confirmar».
- Reservar mesa. Consultar puntos (teléfono + correo de un cliente del seed, p. ej. `555-1001` / `marty@example.com`).
- **QR de mesa**: en *Mesas* abre el QR de una mesa y pide desde el celular; llama al mesero / pide la cuenta.
- **Autofactura**: con el código del ticket de una venta cobrada (se imprime/ve en el ticket) → datos fiscales → CFDI (simulado, marcado «SIN VALIDEZ FISCAL»).

### Administración
- Menú: crear producto con receta y modificadores; ver el costo y el margen. Promociones (2×1, happy hour, cupón). Lealtad.
- Compras: sugerencia de compra → orden → recepción parcial → factura de proveedor (cotejo). Transferencia entre sucursales con faltante.
- Conteo físico de inventario (conteo ciego) y aplicación de diferencias.
- Reportes y dashboards (ventas, productos, utilidad, empleados) y exportación. Auditoría (quién hizo qué).
- Seguridad: activar 2FA (Seguridad), cerrar sesión y entrar con código; usuarios y roles; bloqueo tras 5 intentos fallidos.
- Fiscal: perfil del emisor, facturar un ticket, factura global de un día cerrado, cancelar CFDI (motivos SAT).
- Correo: *Configuración → Integraciones → Enviar prueba* (con `--mail`, míralo en Mailpit).

## 3. Qué es simulado o falta (para no confundirse)
| Tema | Estado en la demo |
|---|---|
| Timbrado CFDI | **Simulado** (`FISCAL_PROVIDER=sandbox`); en producción hay que conectar un PAC real |
| Cobros con tarjeta/transferencia/QR | Se **capturan a mano**; no hay terminal ni pasarela |
| Impresión | Sin hardware: se genera el ESC/POS y se puede ver con una impresora de red falsa (`nc -l 9100 \| xxd`); ver `apps/print-agent/README.md` |
| Correos | Sin SMTP solo se registran en el log; con `--mail` van a Mailpit (no verificado en todos los entornos) |
| Datos | 3 sucursales, ~1 800 pedidos históricos generados |
| Ver `docs/AUDIT.md` §6 | Riesgos residuales conocidos |

## 4. Cómo reportar un problema
Anota: **rol/usuario · sucursal · pantalla · qué hiciste · qué esperabas · qué pasó** y, si hay mensaje de error, el **código de solicitud** (`requestId`) que muestra; con él se encuentra el registro exacto (`./scripts/demo.sh logs`).

## 5. Checklist de salida a producción
Ver `docs/DEPLOY.md`: dominios y TLS, `.env.prod` completo (secretos únicos), `MFA_ENFORCE=true`, respaldos **probados** (`deploy/verify-backup.sh`), PAC real, SMTP real, monitoreo (`--profile monitoring`), prueba de restauración y prueba de carga (`scripts/loadtest.mjs`).
