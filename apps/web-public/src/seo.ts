/** SEO del sitio público: títulos/descripciones por página, páginas privadas fuera de buscadores y datos estructurados de Restaurante. */
export interface PageMeta { title: string; description: string; noindex: boolean }

const BASE = 'RETROBURGER · The 90s Burger Experience';
const PAGES: { test: RegExp; meta: PageMeta }[] = [
  { test: /^\/reservar\/?$/, meta: { title: 'Reservar mesa · RETROBURGER', description: 'Reserva tu mesa en RETROBURGER: elige sucursal, fecha, hora y número de personas. Confirmación inmediata.', noindex: false } },
  { test: /^\/puntos\/?$/, meta: { title: 'Mis puntos · RETROBURGER', description: 'Consulta tus puntos y recompensas del programa de lealtad de RETROBURGER.', noindex: false } },
  // páginas con datos de una persona o de una mesa: nunca en buscadores
  { test: /^\/factura\/?$/, meta: { title: 'Factura tu consumo · RETROBURGER', description: 'Genera tu factura electrónica (CFDI) con el código de tu ticket.', noindex: true } },
  { test: /^\/pedido\//, meta: { title: 'Seguimiento de tu pedido · RETROBURGER', description: 'Sigue el estado de tu pedido en tiempo real.', noindex: true } },
  { test: /^\/m\//, meta: { title: 'Pide desde tu mesa · RETROBURGER', description: 'Pide y paga desde tu mesa.', noindex: true } },
];

export function metaFor(pathname: string, restaurant?: string | null): PageMeta {
  const hit = PAGES.find((p) => p.test.test(pathname));
  if (hit) return hit.meta;
  const name = restaurant ? restaurant.toUpperCase() : 'RETROBURGER';
  return { title: restaurant ? `${name} · hamburguesas estilo años 90` : BASE, description: `${name} — hamburguesas estilo años 90. Pide para recoger o a domicilio, reserva tu mesa y acumula puntos.`, noindex: false };
}

interface InfoLike { restaurant?: { name?: string } | null; branches?: { name: string; address?: string | null; phone?: string | null; status?: string }[] }

/** Datos estructurados schema.org (Restaurant). Sólo se publican datos ya públicos del sitio: nombre, sucursales abiertas, dirección y teléfono. */
export function restaurantJsonLd(info: InfoLike | undefined, origin: string): object | null {
  if (!info?.restaurant?.name) return null;
  const branches = (info.branches ?? []).filter((b) => b.status !== 'CLOSED');
  const toNode = (b: { name: string; address?: string | null; phone?: string | null }) => ({
    '@type': 'Restaurant', name: b.name, servesCuisine: 'Hamburguesas', url: origin, hasMenu: origin,
    ...(b.address ? { address: { '@type': 'PostalAddress', streetAddress: b.address, addressCountry: 'MX' } } : {}),
    ...(b.phone ? { telephone: b.phone } : {}),
  });
  if (!branches.length) return { '@context': 'https://schema.org', '@type': 'Restaurant', name: info.restaurant.name, servesCuisine: 'Hamburguesas', url: origin };
  return { '@context': 'https://schema.org', '@type': 'Restaurant', name: info.restaurant.name, servesCuisine: 'Hamburguesas', url: origin, department: branches.map(toNode) };
}

/** Aplica la metainformación al documento (sin dependencias; idempotente). */
export function applyMeta(m: PageMeta, url: string, doc: Document = document) {
  doc.title = m.title;
  const set = (sel: string, attr: string, val: string, create: () => HTMLElement) => { let el = doc.head.querySelector<HTMLElement>(sel); if (!el) { el = create(); doc.head.appendChild(el); } el.setAttribute(attr, val); };
  const meta = (key: 'name' | 'property', name: string, content: string) => set(`meta[${key}="${name}"]`, 'content', content, () => { const e = doc.createElement('meta'); e.setAttribute(key, name); return e; });
  meta('name', 'description', m.description);
  meta('name', 'robots', m.noindex ? 'noindex, nofollow' : 'index, follow');
  meta('property', 'og:title', m.title); meta('property', 'og:description', m.description); meta('property', 'og:url', url); meta('property', 'og:type', 'website'); meta('property', 'og:locale', 'es_MX');
  if (m.noindex) doc.head.querySelector('link[rel="canonical"]')?.remove(); else set('link[rel="canonical"]', 'href', url, () => { const e = doc.createElement('link'); e.setAttribute('rel', 'canonical'); return e; });
}

export function applyJsonLd(data: object | null, doc: Document = document) {
  const id = 'ld-restaurant'; const prev = doc.getElementById(id);
  if (!data) { prev?.remove(); return; }
  const el = prev ?? Object.assign(doc.createElement('script'), { id, type: 'application/ld+json' });
  // `<` escapado: el JSON va dentro de un <script> y nunca debe poder cerrarlo (un nombre de sucursal con «</script>»)
  el.textContent = JSON.stringify(data).replace(/</g, '\\u003c');
  if (!prev) doc.head.appendChild(el);
}
