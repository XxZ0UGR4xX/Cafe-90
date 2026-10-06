/** Catálogo de códigos de error con mensaje humano (§57). Nunca se muestra "500". */
export const ERROR_MESSAGES: Record<string, string> = {
  VALIDATION_ERROR: '⚠️ Algunos datos no son válidos. Revísalos e inténtalo nuevamente.',
  UNAUTHENTICATED: '🔒 Tu sesión expiró. Inicia sesión nuevamente.',
  INVALID_CREDENTIALS: '🔒 Correo, PIN o contraseña incorrectos.',
  MFA_INVALID: '🔒 Código de verificación incorrecto o vencido.',
  MFA_REQUIRED: '🔐 Esta cuenta requiere verificación en dos pasos. Inicia sesión con correo y contraseña.',
  ACCOUNT_LOCKED: '🔒 Cuenta bloqueada temporalmente por demasiados intentos. Inténtalo más tarde.',
  FORBIDDEN: '⛔ No tienes permiso para realizar esta acción.',
  NOT_FOUND: '🔍 No encontramos lo que buscas.',
  CONFLICT: '⚠️ Esta información ya existe o fue modificada por alguien más.',
  RATE_LIMITED: '⏳ Demasiados intentos. Espera un momento.',
  INTERNAL: '⚠️ No pudimos completar la operación. La información permanece guardada y puedes intentarlo nuevamente.',
  ORDER_ALREADY_PAID: '🧾 Esta cuenta ya fue pagada.',
  ORDER_INVALID_TRANSITION: '⚠️ Esta acción no es posible en el estado actual del pedido.',
  PAYMENT_AMOUNT_MISMATCH: '💰 El monto recibido no coincide con el total de la cuenta.',
  SHIFT_NOT_OPEN: '💰 Debes abrir caja antes de cobrar.',
  SHIFT_ALREADY_OPEN: '💰 Ya tienes una caja abierta.',
  PRODUCT_UNAVAILABLE: '🍔 Este producto no está disponible por ahora.',
  INSUFFICIENT_STOCK: '📦 No hay existencias suficientes.',
  SUPERVISOR_REQUIRED: '🛡️ Esta acción requiere autorización de un gerente.',
};
export const errorMessage = (code: string): string => ERROR_MESSAGES[code] ?? ERROR_MESSAGES.INTERNAL!;
