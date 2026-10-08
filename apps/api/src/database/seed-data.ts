/** Datos de demostración AMERIX BURGER (definición declarativa; la carga está en seed.ts). La carta reproduce la de la hamburguesería. */
export const INGREDIENTS = [
  { sku: 'CARNE', name: 'Carne de res molida', unit: 'g', avgCost: 0.12, perishable: true, min: 4000, max: 24000 },
  { sku: 'PAN', name: 'Pan de hamburguesa', unit: 'pza', avgCost: 4.5, perishable: true, min: 60, max: 300 },
  { sku: 'PANHD', name: 'Pan de hot dog', unit: 'pza', avgCost: 3.5, perishable: true, min: 30, max: 160 },
  { sku: 'CIABATTA', name: 'Pan ciabatta', unit: 'pza', avgCost: 9, perishable: true, min: 20, max: 100 },
  { sku: 'PANCAJA', name: 'Pan de caja (rebanada)', unit: 'pza', avgCost: 1.5, perishable: true, min: 100, max: 500 },
  { sku: 'TORTILLA', name: 'Tortilla de harina grande', unit: 'pza', avgCost: 2.5, perishable: true, min: 30, max: 150 },
  { sku: 'QUESO', name: 'Queso amarillo (rebanada)', unit: 'pza', avgCost: 3, perishable: true, min: 100, max: 500 },
  { sku: 'QUESOBL', name: 'Queso blanco (rebanada)', unit: 'pza', avgCost: 3.5, perishable: true, min: 60, max: 300 },
  { sku: 'LECHUGA', name: 'Lechuga orejona y romana', unit: 'g', avgCost: 0.05, perishable: true, min: 2000, max: 9000 },
  { sku: 'JITOMATE', name: 'Jitomate', unit: 'g', avgCost: 0.04, perishable: true, min: 1500, max: 7000 },
  { sku: 'CEBOLLA', name: 'Cebolla', unit: 'g', avgCost: 0.03, perishable: true, min: 1000, max: 5000 },
  { sku: 'ZANAHORIA', name: 'Zanahoria', unit: 'g', avgCost: 0.03, perishable: true, min: 800, max: 4000 },
  { sku: 'PEPINO', name: 'Pepino', unit: 'g', avgCost: 0.03, perishable: true, min: 800, max: 4000 },
  { sku: 'MORRON', name: 'Chile morrón y chile ancho', unit: 'g', avgCost: 0.06, perishable: true, min: 500, max: 3000 },
  { sku: 'ADEREZO', name: 'Aderezo de la casa', unit: 'g', avgCost: 0.1, perishable: false, min: 2000, max: 9000 },
  { sku: 'BBQ', name: 'Salsa BBQ', unit: 'g', avgCost: 0.08, perishable: false, min: 1500, max: 6000 },
  { sku: 'HOTSAUCE', name: 'Salsa Hot Sauce', unit: 'g', avgCost: 0.1, perishable: false, min: 1500, max: 6000 },
  { sku: 'CHIPOTLE', name: 'Salsa chipotle', unit: 'g', avgCost: 0.1, perishable: false, min: 1000, max: 4000 },
  { sku: 'TOCINO', name: 'Tocino', unit: 'g', avgCost: 0.3, perishable: true, min: 2000, max: 9000 },
  { sku: 'JAMON', name: 'Jamón', unit: 'g', avgCost: 0.15, perishable: true, min: 1500, max: 6000 },
  { sku: 'PINA', name: 'Piña en rodajas', unit: 'g', avgCost: 0.04, perishable: true, min: 1000, max: 5000 },
  { sku: 'CHAMPI', name: 'Champiñones', unit: 'g', avgCost: 0.08, perishable: true, min: 800, max: 4000 },
  { sku: 'ALFALFA', name: 'Germinado de alfalfa', unit: 'g', avgCost: 0.1, perishable: true, min: 300, max: 1500 },
  { sku: 'AGUACATE', name: 'Aguacate', unit: 'g', avgCost: 0.12, perishable: true, min: 1500, max: 6000 },
  { sku: 'SALCHICHA', name: 'Salchicha', unit: 'pza', avgCost: 6, perishable: true, min: 40, max: 200 },
  { sku: 'POLLO', name: 'Pechuga de pollo', unit: 'pza', avgCost: 22, perishable: true, min: 30, max: 160 },
  { sku: 'TIRAS', name: 'Tiras de pollo empanizadas', unit: 'g', avgCost: 0.2, perishable: true, min: 2000, max: 9000 },
  { sku: 'PESCADO', name: 'Filete de pescado empanizado', unit: 'pza', avgCost: 24, perishable: true, min: 15, max: 80 },
  { sku: 'CAMARON', name: 'Camarón', unit: 'g', avgCost: 0.45, perishable: true, min: 1500, max: 6000 },
  { sku: 'ARRACHERA', name: 'Arrachera', unit: 'g', avgCost: 0.45, perishable: true, min: 2000, max: 8000 },
  { sku: 'RIBEYE', name: 'Rib Eye', unit: 'g', avgCost: 0.55, perishable: true, min: 2000, max: 8000 },
  { sku: 'ATUN', name: 'Atún', unit: 'g', avgCost: 0.15, perishable: false, min: 1000, max: 5000 },
  { sku: 'ALITA', name: 'Alitas de pollo', unit: 'pza', avgCost: 7, perishable: true, min: 60, max: 400 },
  { sku: 'NUGGET', name: 'Nuggets de pollo', unit: 'pza', avgCost: 3.5, perishable: true, min: 80, max: 500 },
  { sku: 'PAPAS', name: 'Papas a la francesa', unit: 'g', avgCost: 0.04, perishable: true, min: 8000, max: 40000 },
  { sku: 'AROS', name: 'Aros de cebolla empanizados', unit: 'g', avgCost: 0.1, perishable: true, min: 1500, max: 7000 },
  { sku: 'ZUCCHINI', name: 'Zucchini empanizado', unit: 'g', avgCost: 0.08, perishable: true, min: 1500, max: 7000 },
  { sku: 'HONGOS', name: 'Hongos empanizados', unit: 'g', avgCost: 0.1, perishable: true, min: 1500, max: 7000 },
  { sku: 'LECHE', name: 'Leche', unit: 'ml', avgCost: 0.02, perishable: true, min: 8000, max: 40000 },
  { sku: 'HELADO', name: 'Helado (vainilla, fresa, chocolate)', unit: 'g', avgCost: 0.08, perishable: true, min: 5000, max: 20000 },
  { sku: 'JARABE', name: 'Jarabe y galleta para malteada', unit: 'ml', avgCost: 0.09, perishable: false, min: 2000, max: 9000 },
  { sku: 'REFRESCO', name: 'Refresco de lata', unit: 'pza', avgCost: 9, perishable: false, min: 72, max: 400 },
  { sku: 'REFRESCO600', name: 'Refresco 600 ml', unit: 'pza', avgCost: 12, perishable: false, min: 48, max: 300 },
  { sku: 'AGUAFRESCA', name: 'Agua fresca', unit: 'ml', avgCost: 0.015, perishable: true, min: 8000, max: 40000 },
] as const;

type R = Record<string, number>;
interface P {
  sku: string; name: string; cat: string; price: number; station: string | null; prep: number; recipe: R; desc: string; groups?: string[];
  variants?: { name: string; priceDelta: number; qtyFactor?: number }[];
}
const sum = (...rs: R[]): R => { const o: R = {}; for (const r of rs) for (const [k, v] of Object.entries(r)) o[k] = (o[k] ?? 0) + v; return o; };

// ── bloques de receta ──
const VERDURA: R = { LECHUGA: 15, JITOMATE: 25, CEBOLLA: 10, ADEREZO: 20 };
const BASE: R = sum({ PAN: 1, CARNE: 100, QUESO: 1 }, VERDURA);
const POLLOHB: R = sum({ PAN: 1, POLLO: 1, LECHUGA: 15, JITOMATE: 25, ADEREZO: 20 });
const ENS: R = { LECHUGA: 120, JITOMATE: 40, ZANAHORIA: 25, PEPINO: 25 };   // base de ensalada: lechuga orejona y romana, col morada, zanahoria

const BURGER_GROUPS = ['Ingrediente extra', 'Quitar', 'Agrega papas o ensalada'];
/** Hamburguesa con precio sencilla/doble carne. */
const burger = (sku: string, name: string, price: number, dbl: number | null, desc: string, recipe: R): P => ({
  sku, name, cat: 'Hamburguesas', price, station: 'PARRILLA', prep: 480, desc, recipe, groups: BURGER_GROUPS,
  variants: dbl ? [{ name: 'Sencilla', priceDelta: 0 }, { name: 'Doble Carne', priceDelta: dbl - price, qtyFactor: 1.5 }] : undefined,
});
const salad = (sku: string, name: string, price: number, med: number | null, desc: string, extra: R): P => ({
  sku, name, cat: 'Ensaladas', price, station: 'ENSALADAS', prep: 360, desc, recipe: sum(ENS, extra),
  variants: med ? [{ name: 'Grande', priceDelta: 0 }, { name: 'Mediana', priceDelta: med - price, qtyFactor: 0.75 }] : undefined,
});
const PQ = ['Bebida del paquete'];
const pack = (n: number, sku: string, name: string, price: number, desc: string, recipe: R, groups: string[] = PQ): P => ({
  sku, name: `${n}. ${name}`, cat: 'Paquetes', price, station: 'PARRILLA', prep: 600, desc: `${desc} Incluye refresco de lata o agua fresca y papas a la francesa.`, recipe: sum(recipe, { PAPAS: 150 }), groups,
});
const side = (sku: string, name: string, price: number, half: number | null, desc: string, recipe: R): P => ({
  sku, name, cat: 'Extras', price, station: 'FREIDORA', prep: 300, desc, recipe,
  variants: half ? [{ name: 'Orden', priceDelta: 0 }, { name: '1/2 Orden', priceDelta: half - price, qtyFactor: 0.5 }] : undefined,
});

export const PRODUCTS: P[] = [
  // ── Hamburguesas (Sencilla / Doble Carne) ──
  burger('REGULAR', 'Regular', 40, 52, 'Carne, queso amarillo y verdura.', BASE),
  burger('MOY', 'Moy', 51, 65, 'Regular con piña, germinado de alfalfa y champiñones.', sum(BASE, { PINA: 40, ALFALFA: 15, CHAMPI: 30 })),
  burger('ALESSANDRO', 'Alessandro', 66, null, 'Regular con doble carne, tocino y tres tipos de queso.', sum(BASE, { CARNE: 100, TOCINO: 30, QUESO: 1, QUESOBL: 1 })),
  burger('JR', 'Jr.', 38, 50, 'Regular pero de menor tamaño.', { PAN: 1, CARNE: 60, QUESO: 1, LECHUGA: 10, JITOMATE: 15, ADEREZO: 15 }),
  burger('BETTY', 'Betty', 46, 59, 'Regular con tocino.', sum(BASE, { TOCINO: 30 })),
  burger('WEST', 'West', 52, 66, 'Regular con tocino, salsa BBQ y aros de cebolla empanizados.', sum(BASE, { TOCINO: 30, BBQ: 25, AROS: 40 })),
  burger('JAMON', 'Jamón', 45, 57, 'Regular con jamón.', sum(BASE, { JAMON: 40 })),
  burger('PECHUGA', 'Pechuga', 52, 65, 'Pechuga de pollo, tocino y queso blanco.', sum(POLLOHB, { TOCINO: 30, QUESOBL: 1 })),
  burger('COMBINADA', 'Combinada', 99, null, '2 ingredientes a tu gusto.', sum(BASE, { JAMON: 30, TOCINO: 30 })),
  burger('PESCADO', 'Pescado', 58, 72, 'Empanizado o a la plancha.', { PAN: 1, PESCADO: 1, LECHUGA: 15, JITOMATE: 25, ADEREZO: 25 }),
  burger('CAMARON', 'Camarón', 65, 81, 'Con tocino o empanizado a la plancha.', { PAN: 1, CAMARON: 80, TOCINO: 20, LECHUGA: 15, JITOMATE: 25, ADEREZO: 25 }),
  burger('VEGETARIANA', 'Vegetariana', 70, null, 'Champiñones, germinado, aguacate y queso blanco.', { PAN: 1, CHAMPI: 60, ALFALFA: 20, AGUACATE: 40, QUESOBL: 1, LECHUGA: 15, JITOMATE: 25, ADEREZO: 20 }),
  burger('ARRACHERA', 'Arrachera', 78, 99, 'Arrachera a la plancha con queso blanco.', { PAN: 1, ARRACHERA: 100, QUESOBL: 1, LECHUGA: 15, JITOMATE: 25, CEBOLLA: 10, ADEREZO: 20 }),
  burger('HAWAIIANA', 'Hawaiiana', 45, 69, 'Regular y piña.', sum(BASE, { PINA: 40 })),
  burger('PECHEMP', 'Pechuga Empanizada', 52, 65, 'Pechuga de pollo empanizada.', POLLOHB),
  burger('PECHHS', 'Pechuga Hot Sauce', 55, 68, 'Pechuga bañada en salsa Hot Sauce.', sum(POLLOHB, { HOTSAUCE: 30 })),
  burger('COLOSAL', 'Colosal', 70, 84, 'Tiras de pollo empanizado con aros, tocino y BBQ.', { PAN: 1, TIRAS: 150, AROS: 40, TOCINO: 30, BBQ: 30 }),
  burger('RIBEYE', 'Rib Eye Steak', 80, 106, 'Rib Eye a la plancha con queso blanco.', { PAN: 1, RIBEYE: 120, QUESOBL: 1, LECHUGA: 15, JITOMATE: 25, CEBOLLA: 10, ADEREZO: 20 }),
  burger('MARTIERRA', 'Mar y Tierra', 99, null, 'Arrachera y camarón.', { PAN: 1, ARRACHERA: 70, CAMARON: 60, QUESOBL: 1, LECHUGA: 15, JITOMATE: 25, ADEREZO: 20 }),

  // ── Ensaladas (Grande / Mediana) ──
  salad('ENS-JARDIN', 'Ensalada Jardín', 65, 55, 'Base con lechuga orejona, lechuga romana, col morada y zanahoria.', {}),
  salad('ENS-AGUACATE', 'Ensalada de Aguacate', 78, 68, 'Con aguacate fresco.', { AGUACATE: 80 }),
  salad('ENS-ALAMBRE', 'Ensalada de Alambre', 105, 90, 'Especias, chile morrón, chile ancho, cebolla y carne de res, cerdo y tocino.', { CARNE: 80, TOCINO: 25, MORRON: 20, CEBOLLA: 15 }),
  salad('ENS-CALIFORNIANO', 'Ensalada Californiano', 90, null, 'Burrito de alambre + ensalada.', { TORTILLA: 1, CARNE: 70, TOCINO: 20, MORRON: 15 }),
  salad('ENS-CHEF', 'Ensalada del Chef', 99, 88, 'Pollo, jamón, queso blanco y amarillo.', { POLLO: 1, JAMON: 30, QUESOBL: 1, QUESO: 1 }),
  salad('ENS-POLLO', 'Ensalada de Pollo', 95, 85, 'Pechuga de pollo.', { POLLO: 1 }),
  salad('ENS-POLLO-CHIPOTLE', 'Ensalada de Pollo al Chipotle', 99, 85, 'Pollo bañado en salsa chipotle.', { POLLO: 1, CHIPOTLE: 30 }),
  salad('ENS-POLLO-HOT', 'Ensalada de Pollo Hot Sauce', 99, 85, 'Pollo bañado en Hot Sauce.', { POLLO: 1, HOTSAUCE: 30 }),
  salad('ENS-POLLO-SIERRA', 'Ensalada de Pollo con Queso Sierra', 99, 85, 'Pollo con queso Sierra.', { POLLO: 1, QUESOBL: 2 }),
  salad('ENS-POLLO-ORIENTAL', 'Ensalada de Pollo Oriental', 99, 85, 'Pollo estilo oriental.', { POLLO: 1, ADEREZO: 30 }),
  salad('ENS-CLUB', 'Ensalada Club', 95, 83, 'Tocino, jamón, queso blanco y amarillo.', { TOCINO: 25, JAMON: 30, QUESOBL: 1, QUESO: 1 }),
  salad('ENS-HAWAIIANA', 'Ensalada Hawaiiana', 99, 88, 'Pollo, piña y BBQ.', { POLLO: 1, PINA: 40, BBQ: 20 }),
  salad('ENS-ITALIANA', 'Ensalada Italiana', 96, 85, 'Pollo sazonado con hierbas italianas.', { POLLO: 1, ADEREZO: 25 }),
  salad('ENS-PESCADO', 'Ensalada de Pescado', 99, 80, 'Empanizado o a la plancha.', { PESCADO: 1 }),
  salad('ENS-RIBEYE', 'Ensalada Rib Eye Steak', 145, 115, 'Rib Eye a la plancha.', { RIBEYE: 120 }),
  salad('ENS-CAMARON', 'Ensalada de Camarón', 120, 99, 'Empanizado, a la plancha o con tocino.', { CAMARON: 90, TOCINO: 20 }),
  salad('ENS-ATUN', 'Ensalada de Atún', 85, 70, 'Con atún.', { ATUN: 100 }),
  salad('ENS-ARRACHERA', 'Ensalada de Arrachera', 140, 110, 'Arrachera a la plancha.', { ARRACHERA: 120 }),
  salad('ENS-MARTIERRA', 'Ensalada Mar y Tierra', 145, 125, 'Arrachera y camarón.', { ARRACHERA: 70, CAMARON: 60 }),
  salad('ENS-COMBINADA', 'Ensalada Combinada', 145, null, '2 ingredientes a tu gusto.', { POLLO: 1, JAMON: 30, TOCINO: 25 }),

  // ── Paquetes 1–12 (incluyen refresco de lata o agua fresca y papas a la francesa) ──
  pack(1, 'PAQ1', 'Hamburguesa con Piña', 83, 'Hamburguesa con piña.', sum(BASE, { PINA: 40 })),
  pack(2, 'PAQ2', 'Club Sandwich', 85, 'Club Sandwich.', { PANCAJA: 3, JAMON: 30, TOCINO: 25, QUESOBL: 1, POLLO: 1, LECHUGA: 15, JITOMATE: 25, ADEREZO: 20 }),
  pack(3, 'PAQ3', 'Sandwich de Doble Carne', 98, 'Doble carne de res y 3 tipos de queso (blanco, amarillo y parmesano).', { CIABATTA: 1, CARNE: 200, QUESO: 1, QUESOBL: 2, LECHUGA: 15, JITOMATE: 25, ADEREZO: 20 }),
  pack(4, 'PAQ4', 'Sandwich de Pechuga de Pollo', 90, 'Queso blanco y parmesano.', { CIABATTA: 1, POLLO: 1, QUESOBL: 2, LECHUGA: 15, JITOMATE: 25, ADEREZO: 20 }),
  pack(5, 'PAQ5', 'Amerix Burger', 75, 'Especial: hamburguesa regular.', BASE),
  pack(6, 'PAQ6', 'Hamburguesa de Pechuga de Pollo', 88, 'Pechuga empanizada, a la plancha o bañada en salsa Hot Sauce.', POLLOHB),
  pack(7, 'PAQ7', 'Burrito de Alambre', 98, 'Burrito de alambre.', { TORTILLA: 2, CARNE: 100, TOCINO: 30, MORRON: 20, CEBOLLA: 15, QUESOBL: 1 }),
  pack(8, 'PAQ8', 'Junior', 75, 'Tiras de pollo.', { TIRAS: 150 }),
  pack(9, 'PAQ9', 'Betty', 85, 'Regular con tocino.', sum(BASE, { TOCINO: 30 })),
  pack(10, 'PAQ10', 'Alitas', 85, '6 piezas, Hot Sauce o salsa BBQ.', { ALITA: 6 }, ['Salsa de alitas', 'Bebida del paquete']),
  pack(12, 'PAQ12', 'Colosal', 104, 'Tiras de pechuga empanizada, aros de cebolla empanizados, tocino, BBQ y queso blanco.', { PAN: 1, TIRAS: 150, AROS: 40, TOCINO: 30, BBQ: 30, QUESOBL: 1 }),

  // ── Sándwiches y hot dog ──
  { sku: 'SAND-JAMON', name: 'Sándwich de Jamón', cat: 'Sándwiches', price: 35, station: 'PARRILLA', prep: 300, desc: 'Jamón, queso y verdura.', recipe: { PANCAJA: 2, JAMON: 40, QUESO: 1, LECHUGA: 10, JITOMATE: 15, ADEREZO: 15 } },
  { sku: 'SAND-POLLO-E', name: 'Sándwich de Pollo (Empanizado)', cat: 'Sándwiches', price: 47, station: 'PARRILLA', prep: 360, desc: 'Pechuga empanizada.', recipe: { PANCAJA: 2, POLLO: 1, LECHUGA: 10, JITOMATE: 15, ADEREZO: 15 } },
  { sku: 'SAND-POLLO-P', name: 'Sándwich de Pollo (a la Plancha)', cat: 'Sándwiches', price: 52, station: 'PARRILLA', prep: 360, desc: 'Pechuga a la plancha.', recipe: { PANCAJA: 2, POLLO: 1, LECHUGA: 10, JITOMATE: 15, ADEREZO: 15 } },
  { sku: 'SAND-ARRACHERA', name: 'Sándwich de Arrachera', cat: 'Sándwiches', price: 80, station: 'PARRILLA', prep: 420, desc: 'Preparado con pan ciabatta.', recipe: { CIABATTA: 1, ARRACHERA: 100, QUESOBL: 1, LECHUGA: 10, JITOMATE: 15, ADEREZO: 15 } },
  { sku: 'SAND-RIBEYE', name: 'Sándwich de Rib Eye', cat: 'Sándwiches', price: 80, station: 'PARRILLA', prep: 420, desc: 'Preparado con pan ciabatta.', recipe: { CIABATTA: 1, RIBEYE: 100, QUESOBL: 1, LECHUGA: 10, JITOMATE: 15, ADEREZO: 15 } },
  { sku: 'SAND-CLUB', name: 'Club Sandwich', cat: 'Sándwiches', price: 55, station: 'PARRILLA', prep: 420, desc: 'Triple piso con jamón, tocino y queso.', recipe: { PANCAJA: 3, JAMON: 30, TOCINO: 25, QUESOBL: 1, LECHUGA: 15, JITOMATE: 25, ADEREZO: 20 } },
  { sku: 'HOTDOG', name: 'Hot Dog', cat: 'Hot Dogs', price: 25, station: 'PARRILLA', prep: 240, desc: 'Salchicha en pan de hot dog.', recipe: { PANHD: 1, SALCHICHA: 1, ADEREZO: 15, CEBOLLA: 10 } },

  // ── Extras (Orden / 1/2 Orden) ──
  side('X-ZUCCHINI', 'Zucchini', 60, 40, 'Zucchini empanizado.', { ZUCCHINI: 150 }),
  side('X-PAPAS', 'Papas a la Francesa', 55, 40, 'Doradas y crujientes.', { PAPAS: 200 }),
  side('X-AROS', 'Aros de Cebolla Empanizados', 60, 40, 'Crujientes.', { AROS: 150 }),
  side('X-HONGOS', 'Hongos Empanizados', 60, 40, 'Hongos empanizados.', { HONGOS: 150 }),
  { sku: 'X-TIRAS', name: 'Tiras de Pollo Empanizadas', cat: 'Extras', price: 45, station: 'FREIDORA', prep: 360, desc: 'Solas o con papas.', recipe: { TIRAS: 150 },
    variants: [{ name: 'Solas', priceDelta: 0 }, { name: 'Con papas', priceDelta: 23, qtyFactor: 1 }] },
  side('X-AMERIX-POTATOES', 'Amerix Potatoes', 65, 45, 'Papas con gajo sazonadas y queso.', { PAPAS: 200, QUESO: 2, TOCINO: 25 }),
  { sku: 'X-BANDERILLAS', name: 'Banderillas', cat: 'Extras', price: 30, station: 'FREIDORA', prep: 240, desc: 'Salchicha empanizada en palito.', recipe: { SALCHICHA: 1, ADEREZO: 10 } },
  { sku: 'X-NUGGETS', name: 'Nuggets', cat: 'Extras', price: 45, station: 'FREIDORA', prep: 300, desc: 'Solos o con papas.', recipe: { NUGGET: 8 },
    variants: [{ name: 'Solos', priceDelta: 0 }, { name: 'Con papas', priceDelta: 23 }] },
  { sku: 'X-WINGS', name: 'Hot Amerix Wings', cat: 'Extras', price: 75, station: 'FREIDORA', prep: 480, desc: '6 piezas. Incluye papas a la francesa.', recipe: { ALITA: 6, PAPAS: 100, HOTSAUCE: 40 } },

  // ── Bebidas ──
  { sku: 'MALTEADA', name: 'Malteada', cat: 'Bebidas', price: 50, station: 'POSTRES', prep: 240, desc: 'Elaborada con helado de fresa, chocolate, galleta Oreo, vainilla o napolitano.', recipe: { LECHE: 250, HELADO: 120, JARABE: 30 },
    variants: ['Fresa', 'Chocolate', 'Galleta Oreo', 'Vainilla', 'Napolitano'].map((name) => ({ name, priceDelta: 0 })) },
  { sku: 'REFRESCO', name: 'Refresco de Lata', cat: 'Bebidas', price: 19, station: 'BEBIDAS', prep: 30, desc: 'Refresco de lata bien frío.', recipe: { REFRESCO: 1 } },
  { sku: 'REFRESCO600', name: 'Refresco 600 ml', cat: 'Bebidas', price: 22, station: 'BEBIDAS', prep: 30, desc: 'Refresco de 600 ml.', recipe: { REFRESCO600: 1 } },
];

/** Combos: el paquete familiar son 4 paquetes #5 (Amerix Burger) a elegir. */
export const COMBOS = [
  { sku: 'PAQ11', name: '11. Amerix Familiar', price: 275, desc: '4 paquetes #5 (hamburguesa regular, papas y refresco). Elige cada paquete.', slots: [1, 2, 3, 4].map((n) => (
    { name: `Paquete ${n}`, default: 'PAQ5', options: [['PAQ9', 10], ['PAQ1', 8], ['PAQ6', 13], ['PAQ12', 29]] as [string, number][] })) },
] as const;

export const MODIFIER_GROUPS = [
  { name: 'Ingrediente extra', type: 'EXTRA', min: 0, max: 5, modifiers: [
    { name: 'Queso amarillo', priceDelta: 10, ing: 'QUESO', qty: 1 }, { name: 'Queso blanco', priceDelta: 10, ing: 'QUESOBL', qty: 1 },
    { name: 'Piña', priceDelta: 10, ing: 'PINA', qty: 30 }, { name: 'Jamón', priceDelta: 10, ing: 'JAMON', qty: 30 },
    { name: 'Champiñones', priceDelta: 10, ing: 'CHAMPI', qty: 30 }, { name: 'Tocino', priceDelta: 10, ing: 'TOCINO', qty: 25 },
    { name: 'Cebolla caramelizada', priceDelta: 10, ing: 'CEBOLLA', qty: 30 }, { name: 'Jitomate', priceDelta: 10, ing: 'JITOMATE', qty: 25 },
    { name: 'Aguacate', priceDelta: 10, ing: 'AGUACATE', qty: 30 }, { name: 'Salchicha', priceDelta: 10, ing: 'SALCHICHA', qty: 1 },
    { name: 'BBQ', priceDelta: 10, ing: 'BBQ', qty: 20 }, { name: 'Aderezo adicional', priceDelta: 10, ing: 'ADEREZO', qty: 20 }] },
  { name: 'Quitar', type: 'REMOVE', min: 0, max: 4, modifiers: [
    { name: 'Cebolla', priceDelta: 0, ing: 'CEBOLLA', qty: -10 }, { name: 'Jitomate', priceDelta: 0, ing: 'JITOMATE', qty: -25 },
    { name: 'Lechuga', priceDelta: 0, ing: 'LECHUGA', qty: -15 }, { name: 'Aderezo', priceDelta: 0, ing: 'ADEREZO', qty: -20 }] },
  { name: 'Agrega papas o ensalada', type: 'EXTRA', min: 0, max: 1, modifiers: [
    { name: 'Papas a la francesa', priceDelta: 35, ing: 'PAPAS', qty: 150 }, { name: 'Ensalada', priceDelta: 35, ing: 'LECHUGA', qty: 80 }] },
  { name: 'Bebida del paquete', type: 'CHOICE', min: 1, max: 1, modifiers: [
    { name: 'Refresco de lata', priceDelta: 0, ing: 'REFRESCO', qty: 1 }, { name: 'Agua fresca', priceDelta: 0, ing: 'AGUAFRESCA', qty: 400 }] },
  { name: 'Salsa de alitas', type: 'CHOICE', min: 1, max: 1, modifiers: [
    { name: 'Hot Sauce', priceDelta: 0, ing: 'HOTSAUCE', qty: 40 }, { name: 'Salsa BBQ', priceDelta: 0, ing: 'BBQ', qty: 40 }] },
] as const;

export const CATEGORIES = [
  { name: 'Hamburguesas', icon: '🍔', color: '#C8102E' }, { name: 'Ensaladas', icon: '🥗', color: '#2E9E4F' }, { name: 'Paquetes', icon: '🎁', color: '#FF2E93' },
  { name: 'Sándwiches', icon: '🥪', color: '#F6B800' }, { name: 'Hot Dogs', icon: '🌭', color: '#F77F00' }, { name: 'Extras', icon: '🍟', color: '#F6B800' },
  { name: 'Bebidas', icon: '🥤', color: '#1E6BFF' },
] as const;

export const SUPPLIERS = [
  { name: 'Carnes y Pollo del Bajío', contact: 'Ricardo Peña', phone: '449-555-0101', items: { CARNE: 0.12, TOCINO: 0.3, JAMON: 0.15, POLLO: 22, TIRAS: 0.2, ALITA: 7, NUGGET: 3.5, SALCHICHA: 6, ARRACHERA: 0.45, RIBEYE: 0.55, CAMARON: 0.45, PESCADO: 24, ATUN: 0.15 } },
  { name: 'Panificadora La Espiga', contact: 'Marta Soto', phone: '449-555-0102', items: { PAN: 4.5, PANHD: 3.5, CIABATTA: 9, PANCAJA: 1.5, TORTILLA: 2.5 } },
  { name: 'Lácteos del Valle', contact: 'Hugo Ríos', phone: '449-555-0103', items: { QUESO: 3, QUESOBL: 3.5, LECHE: 0.02, HELADO: 0.08, JARABE: 0.09 } },
  { name: 'Bebidas del Norte', contact: 'Ana Lozano', phone: '449-555-0104', items: { REFRESCO: 9, REFRESCO600: 12, AGUAFRESCA: 0.015 } },
  { name: 'Verduras Frescas SA', contact: 'Luis Mora', phone: '449-555-0105', items: { LECHUGA: 0.05, JITOMATE: 0.04, CEBOLLA: 0.03, ZANAHORIA: 0.03, PEPINO: 0.03, MORRON: 0.06, PINA: 0.04, CHAMPI: 0.08, ALFALFA: 0.1, AGUACATE: 0.12, PAPAS: 0.04, AROS: 0.1, ZUCCHINI: 0.08, HONGOS: 0.1, ADEREZO: 0.1, BBQ: 0.08, HOTSAUCE: 0.1, CHIPOTLE: 0.1 } },
] as const;

export const BRANCHES = [
  { name: 'AMERIX BURGER JESÚS MARÍA', code: 'CENTRO', address: 'Av. Independencia No. 3004, Plaza Independencia, Local 8, Trojes de Alonso, Jesús María, Ags.', phone: '361-69-21' },
  { name: 'AMERIX BURGER NORTE (demo)', code: 'NORTE', address: 'Sucursal de demostración', phone: '361-69-22' },
  { name: 'AMERIX BURGER SUR (demo)', code: 'SUR', address: 'Sucursal de demostración', phone: '361-69-22' },
] as const;

export const STAFF = [
  { role: 'GERENTE', name: 'Mónica Reyes', tag: 'gerente' }, { role: 'CAJERO', name: 'Carlos Duarte', tag: 'cajero' },
  { role: 'MESERO', name: 'Lucía Fernández', tag: 'mesero1' }, { role: 'MESERO', name: 'Pedro Salas', tag: 'mesero2' },
  { role: 'COCINERO', name: 'Chef Tony Rossi', tag: 'cocinero' }, { role: 'ALMACEN', name: 'Beatriz Cano', tag: 'almacen' },
  { role: 'REPARTIDOR', name: 'Jorge Mena', tag: 'repartidor' },
] as const;

export const CUSTOMERS = [
  ['Marty McFly', '555-1001', 'marty@example.com'], ['Jessie Spano', '555-1002', 'jessie@example.com'], ['Zack Morris', '555-1003', 'zack@example.com'],
  ['Kelly Kapowski', '555-1004', 'kelly@example.com'], ['Will Smith', '555-1005', 'will@example.com'], ['Dylan McKay', '555-1006', 'dylan@example.com'],
  ['Brenda Walsh', '555-1007', 'brenda@example.com'], ['Steve Urkel', '555-1008', 'urkel@example.com'], ['Winnie Cooper', '555-1009', 'winnie@example.com'],
  ['Kevin Arnold', '555-1010', 'kevin@example.com'], ['Buffy Summers', '555-1011', 'buffy@example.com'], ['Elaine Benes', '555-1012', 'elaine@example.com'],
] as const;
