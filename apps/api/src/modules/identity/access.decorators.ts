import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@retroburger/shared';

export const PUBLIC_KEY = 'rb:public';
export const AUTHENTICATED_KEY = 'rb:authenticated';
export const REQUIRE_KEY = 'rb:require';

/** Endpoint sin autenticación (login, health, menú público). */
export const Public = () => SetMetadata(PUBLIC_KEY, true);
/** Endpoint que sólo exige sesión válida (me, logout...). */
export const Authenticated = () => SetMetadata(AUTHENTICATED_KEY, true);
/** Exige TODOS los permisos indicados (con alcance de sucursal si el request trae branchId). */
export const Require = (...perms: Permission[]) => SetMetadata(REQUIRE_KEY, perms);
