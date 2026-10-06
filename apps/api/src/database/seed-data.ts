/** Datos de demostración RETROBURGER (definición declarativa; la carga está en seed.ts). */
export const INGREDIENTS = [
  { sku: 'CARNE', name: 'Carne de res molida', unit: 'g', avgCost: 0.12, perishable: true, min: 3000, max: 20000 },
  { sku: 'PAN', name: 'Pan de hamburguesa', unit: 'pza', avgCost: 4.5, perishable: true, min: 40, max: 250 },
  { sku: 'QUESO', name: 'Queso americano (rebanada)', unit: 'pza', avgCost: 3, perishable: true, min: 80, max: 400 },
  { sku: 'LECHUGA', name: 'Lechuga', unit: 'g', avgCost: 0.05, perishable: true, min: 1000, max: 5000 },
  { sku: 'TOMATE', name: 'Tomate', unit: 'g', avgCost: 0.04, perishable: true, min: 1000, max: 5000 },
  { sku: 'PEPINILLO', name: 'Pepinillos', unit: 'g', avgCost: 0.08, perishable: false, min: 500, max: 3000 },
  { sku: 'SALSA', name: 'Salsa especial', unit: 'g', avgCost: 0.1, perishable: false, min: 1000, max: 6000 },
  { sku: 'TOCINO', name: 'Tocino', unit: 'g', avgCost: 0.3, perishable: true, min: 1500, max: 8000 },
  { sku: 'CEBOLLA', name: 'Cebolla', unit: 'g', avgCost: 0.03, perishable: true, min: 1000, max: 4000 },
  { sku: 'JALAPENO', name: 'Jalapeños', unit: 'g', avgCost: 0.06, perishable: false, min: 300, max: 2000 },
  { sku: 'POLLO', name: 'Pechuga empanizada', unit: 'pza', avgCost: 22, perishable: true, min: 20, max: 120 },
  { sku: 'PAPAS', name: 'Papas a la francesa', unit: 'g', avgCost: 0.04, perishable: true, min: 5000, max: 30000 },
  { sku: 'CHEDDAR', name: 'Salsa de queso cheddar', unit: 'g', avgCost: 0.12, perishable: true, min: 1000, max: 6000 },
  { sku: 'LECHE', name: 'Leche', unit: 'ml', avgCost: 0.02, perishable: true, min: 5000, max: 30000 },
  { sku: 'HELADOV', name: 'Helado de vainilla', unit: 'g', avgCost: 0.08, perishable: true, min: 3000, max: 15000 },
  { sku: 'JARABECH', name: 'Jarabe de chocolate', unit: 'ml', avgCost: 0.07, perishable: false, min: 1000, max: 6000 },
  { sku: 'COLA', name: 'Refresco de cola (lata)', unit: 'pza', avgCost: 9, perishable: false, min: 48, max: 300 },
  { sku: 'LIMON', name: 'Limón', unit: 'pza', avgCost: 1.5, perishable: true, min: 60, max: 300 },
  { sku: 'AZUCAR', name: 'Azúcar', unit: 'g', avgCost: 0.03, perishable: false, min: 1000, max: 8000 },
  { sku: 'BROWNIE', name: 'Brownie', unit: 'pza', avgCost: 14, perishable: true, min: 12, max: 80 },
] as const;

type R = Record<string, number>;
/** receta por producto: SKU ingrediente → cantidad */
export const PRODUCTS: {
  sku: string; name: string; cat: string; price: number; station: string | null; prep: number; recipe: R; desc: string; groups?: string[]; variants?: { name: string; priceDelta: number; qtyFactor?: number }[];
}[] = [
  { sku: 'RETRO', name: 'Retro Burger', cat: 'Hamburguesas', price: 129, station: 'PARRILLA', prep: 420, desc: 'La clásica: carne, queso, lechuga, tomate, pepinillos y salsa especial.',
    recipe: { CARNE: 150, PAN: 1, QUESO: 2, LECHUGA: 20, TOMATE: 30, PEPINILLO: 15, SALSA: 25 }, groups: ['Extras', 'Remover'] },
  { sku: 'DOUBLE', name: 'Double Retro', cat: 'Hamburguesas', price: 169, station: 'PARRILLA', prep: 540, desc: 'Doble carne, doble queso, doble sabor.',
    recipe: { CARNE: 300, PAN: 1, QUESO: 4, LECHUGA: 20, TOMATE: 30, PEPINILLO: 15, SALSA: 30 }, groups: ['Extras', 'Remover'] },
  { sku: 'BACON', name: 'Bacon Blast', cat: 'Hamburguesas', price: 159, station: 'PARRILLA', prep: 480, desc: 'Tocino crujiente, queso y cebolla.',
    recipe: { CARNE: 150, PAN: 1, QUESO: 2, TOCINO: 40, CEBOLLA: 20, SALSA: 25 }, groups: ['Extras', 'Remover'] },
  { sku: 'CHEESE', name: 'Cheese Melt', cat: 'Hamburguesas', price: 149, station: 'PARRILLA', prep: 480, desc: 'Triple queso derretido.',
    recipe: { CARNE: 150, PAN: 1, QUESO: 3, CEBOLLA: 15, SALSA: 20 }, groups: ['Extras', 'Remover'] },
  { sku: 'CHICKEN', name: 'Chicken 90s', cat: 'Hamburguesas', price: 139, station: 'PARRILLA', prep: 480, desc: 'Pechuga empanizada, lechuga y salsa.',
    recipe: { POLLO: 1, PAN: 1, LECHUGA: 20, TOMATE: 20, SALSA: 25 }, groups: ['Extras', 'Remover'] },
  { sku: 'PAPAS', name: 'Papas Clásicas', cat: 'Papas', price: 49, station: 'FREIDORA', prep: 300, desc: 'Doradas y crujientes.', recipe: { PAPAS: 200 } },
  { sku: 'PAPASCH', name: 'Papas Cheddar', cat: 'Papas', price: 69, station: 'FREIDORA', prep: 300, desc: 'Con salsa de queso cheddar.', recipe: { PAPAS: 200, CHEDDAR: 50 } },
  { sku: 'MALTEV', name: 'Malteada Vainilla', cat: 'Bebidas', price: 79, station: 'BEBIDAS', prep: 240, desc: 'Cremosa, estilo diner.', recipe: { LECHE: 250, HELADOV: 120, AZUCAR: 15 } },
  { sku: 'MALTECH', name: 'Malteada Chocolate', cat: 'Bebidas', price: 79, station: 'BEBIDAS', prep: 240, desc: 'Chocolate intenso.', recipe: { LECHE: 250, HELADOV: 100, JARABECH: 40 } },
  { sku: 'COLA', name: 'Cola Retro', cat: 'Bebidas', price: 35, station: 'BEBIDAS', prep: 60, desc: 'Refresco de cola bien frío.', recipe: { COLA: 1 },
    variants: [{ name: 'Chica', priceDelta: -5 }, { name: 'Regular', priceDelta: 0 }, { name: 'Grande', priceDelta: 10 }] },
  { sku: 'LIMONADA', name: 'Limonada', cat: 'Bebidas', price: 39, station: 'BEBIDAS', prep: 120, desc: 'Limonada natural.', recipe: { LIMON: 2, AZUCAR: 20 } },
  { sku: 'BROWNIE', name: 'Brownie', cat: 'Postres', price: 59, station: 'POSTRES', prep: 120, desc: 'Brownie tibio de chocolate.', recipe: { BROWNIE: 1 } },
];

export const COMBOS = [
  { sku: 'ARCADE', name: 'Arcade Combo', price: 179, desc: 'Retro Burger + Papas + Refresco.', slots: [
    { name: 'Hamburguesa', default: 'RETRO', options: [['DOUBLE', 30], ['BACON', 15], ['CHEESE', 10], ['CHICKEN', 5]] },
    { name: 'Papas', default: 'PAPAS', options: [['PAPASCH', 15]] },
    { name: 'Bebida', default: 'COLA', options: [['LIMONADA', 0], ['MALTEV', 25]] }] },
  { sku: 'MEGA', name: 'Mega Combo', price: 249, desc: 'Double Retro + Papas Cheddar + Malteada.', slots: [
    { name: 'Hamburguesa', default: 'DOUBLE', options: [['BACON', 0], ['CHEESE', -10]] },
    { name: 'Papas', default: 'PAPASCH', options: [['PAPAS', -10]] },
    { name: 'Bebida', default: 'MALTEV', options: [['MALTECH', 0], ['COLA', -30]] }] },
] as const;

export const MODIFIER_GROUPS = [
  { name: 'Extras', type: 'EXTRA', min: 0, max: 5, modifiers: [
    { name: 'Queso extra', priceDelta: 15, ing: 'QUESO', qty: 1 }, { name: 'Tocino', priceDelta: 25, ing: 'TOCINO', qty: 30 },
    { name: 'Carne extra', priceDelta: 45, ing: 'CARNE', qty: 150 }, { name: 'Jalapeños', priceDelta: 10, ing: 'JALAPENO', qty: 15 },
    { name: 'Salsa especial extra', priceDelta: 10, ing: 'SALSA', qty: 20 }] },
  { name: 'Remover', type: 'REMOVE', min: 0, max: 5, modifiers: [
    { name: 'Cebolla', priceDelta: 0, ing: 'CEBOLLA', qty: -20 }, { name: 'Pepinillos', priceDelta: 0, ing: 'PEPINILLO', qty: -15 },
    { name: 'Tomate', priceDelta: 0, ing: 'TOMATE', qty: -30 }, { name: 'Lechuga', priceDelta: 0, ing: 'LECHUGA', qty: -20 }] },
] as const;

export const CATEGORIES = [
  { name: 'Hamburguesas', icon: '🍔', color: '#D62828' }, { name: 'Papas', icon: '🍟', color: '#F6B800' }, { name: 'Hot Dogs', icon: '🌭', color: '#F77F00' },
  { name: 'Otros', icon: '🌮', color: '#39FF14' }, { name: 'Bebidas', icon: '🥤', color: '#1E6BFF' }, { name: 'Postres', icon: '🍦', color: '#F77F00' },
  { name: 'Combos', icon: '🔥', color: '#D62828' }, { name: 'Promociones', icon: '⭐', color: '#F6B800' },
] as const;

export const SUPPLIERS = [
  { name: 'Distribuidora XYZ', contact: 'Ricardo Peña', phone: '555-0101', items: { CARNE: 0.12, TOCINO: 0.3, POLLO: 22 } },
  { name: 'Panificadora La Espiga', contact: 'Marta Soto', phone: '555-0102', items: { PAN: 4.5, BROWNIE: 14 } },
  { name: 'Lácteos del Valle', contact: 'Hugo Ríos', phone: '555-0103', items: { QUESO: 3, LECHE: 0.02, HELADOV: 0.08, CHEDDAR: 0.12 } },
  { name: 'Bebidas del Norte', contact: 'Ana Lozano', phone: '555-0104', items: { COLA: 9, LIMON: 1.5, AZUCAR: 0.03, JARABECH: 0.07 } },
  { name: 'Verduras Frescas SA', contact: 'Luis Mora', phone: '555-0105', items: { LECHUGA: 0.05, TOMATE: 0.04, CEBOLLA: 0.03, PEPINILLO: 0.08, JALAPENO: 0.06, PAPAS: 0.04, SALSA: 0.1 } },
] as const;

export const BRANCHES = [
  { name: 'RETROBURGER CENTRO', code: 'CENTRO', address: 'Av. Juárez 90, Centro', phone: '555-9000' },
  { name: 'RETROBURGER NORTE', code: 'NORTE', address: 'Blvd. Norte 1990, Col. Vista', phone: '555-9001' },
  { name: 'RETROBURGER SUR', code: 'SUR', address: 'Calz. del Sur 45, Col. Arcade', phone: '555-9002' },
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
