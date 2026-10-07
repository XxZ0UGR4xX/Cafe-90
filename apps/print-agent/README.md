# Agente de impresión local (ESC/POS)

Pequeño servicio que corre **dentro del restaurante** (PC/mini-PC/Raspberry con acceso a las impresoras). Consulta la cola de impresión de la API, convierte el texto a ESC/POS (CP858: ñ, á, €…), lo envía a la impresora y confirma. Así las comandas y tickets salen aunque el navegador no esté abierto, y la API nunca necesita ver la red local.

## Instalar
1. En la app: **Staff → Usuarios → + Usuario** con rol **Agente de impresión**, correo y contraseña largos, **sin PIN**, asignado a la sucursal. (Rol con un solo permiso: gestionar la cola de impresión; no ve ventas.)
2. **Configuración → Impresoras**: crea cada impresora (función, columnas, estaciones) y su conexión:
   - **Red**: IP y puerto (9100 en casi todas las térmicas Ethernet/Wi-Fi).
   - **USB/dispositivo**: ruta (`/dev/usb/lp0` en Linux). Opciones: página de códigos (19 = Epson; otra si salen símbolos raros), zumbador (cocina) y abrir cajón (caja).
3. Variables de entorno y arranque:

```bash
export AGENT_API_URL=https://api.tu-dominio.com
export AGENT_TENANT=retroburger
export AGENT_EMAIL=impresion-centro@tu-dominio.com
export AGENT_PASSWORD='…'
export AGENT_BRANCH_ID=<uuid de la sucursal>
export AGENT_POLL_MS=2000          # opcional
pnpm --filter @retroburger/print-agent build && pnpm --filter @retroburger/print-agent start
```
Úsalo como servicio (`systemd`, `pm2`, NSSM en Windows) con reinicio automático.

## Garantías
- **Orden**: los trabajos de cada impresora salen en el orden en que se crearon.
- **Impresora apagada / sin red**: el trabajo queda `PENDING` (no se pierde ni gasta intentos); el agente reintenta con espera creciente (2 s → 60 s) y al volver imprime todo en orden.
- **Fallo no recuperable** (impresora sin conexión configurada): cuenta un intento; al 3.º queda `FAILED`.
- **Entrega al menos una vez**: si el agente se cae entre imprimir y confirmar, ese trabajo puede imprimirse otra vez.
- Seguridad: el agente sólo puede leer/confirmar trabajos de **su** sucursal; la cuenta no admite 2FA (es de servicio) y no tiene otros permisos.

## Probar sin impresora
Conexión tipo *dispositivo* con una ruta a un archivo (`/tmp/ticket.bin`) y revisa los bytes; o `nc -l 9100 | xxd` como impresora de red falsa.
