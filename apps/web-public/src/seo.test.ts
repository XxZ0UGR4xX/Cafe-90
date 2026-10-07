import { beforeEach, describe, expect, it } from 'vitest';
import { applyJsonLd, applyMeta, metaFor, restaurantJsonLd } from './seo';

describe('SEO del sitio público', () => {
  beforeEach(() => { document.head.innerHTML = ''; document.title = ''; });

  it('páginas públicas con título y descripción propios; privadas (factura, pedido, QR de mesa) no se indexan', () => {
    expect(metaFor('/', 'Retroburger').title).toContain('RETROBURGER');
    expect(metaFor('/reservar').title).toMatch(/Reservar/); expect(metaFor('/reservar').noindex).toBe(false);
    for (const p of ['/factura', '/pedido/0192-abc', '/m/token123']) expect(metaFor(p).noindex, p).toBe(true);
    expect(metaFor('/').description.length).toBeGreaterThan(50);
  });

  it('applyMeta: título, descripción, robots, OG y canónica; es idempotente y quita la canónica en páginas privadas', () => {
    applyMeta(metaFor('/reservar'), 'https://app.x.com/reservar'); applyMeta(metaFor('/reservar'), 'https://app.x.com/reservar');
    expect(document.title).toMatch(/Reservar/);
    expect(document.head.querySelectorAll('meta[name="description"]').length).toBe(1);
    expect(document.head.querySelector('meta[name="robots"]')!.getAttribute('content')).toBe('index, follow');
    expect(document.head.querySelector('link[rel="canonical"]')!.getAttribute('href')).toBe('https://app.x.com/reservar');
    expect(document.head.querySelector('meta[property="og:url"]')!.getAttribute('content')).toBe('https://app.x.com/reservar');
    applyMeta(metaFor('/factura'), 'https://app.x.com/factura');
    expect(document.head.querySelector('meta[name="robots"]')!.getAttribute('content')).toBe('noindex, nofollow');
    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull();
  });

  it('JSON-LD de Restaurante: sucursales abiertas con dirección/teléfono; sin datos → null; nunca puede cerrar el <script>', () => {
    expect(restaurantJsonLd(undefined, 'https://x')).toBeNull();
    const ld = restaurantJsonLd({ restaurant: { name: 'Retroburger' }, branches: [
      { name: 'Centro', address: 'Av. 1 #2', phone: '555-1', status: 'OPEN' }, { name: 'Cerrada', status: 'CLOSED' }, { name: '</script><b>x', status: 'OPEN' }] }, 'https://app.x.com') as any;
    expect(ld['@type']).toBe('Restaurant'); expect(ld.department).toHaveLength(2);
    expect(ld.department[0]).toMatchObject({ name: 'Centro', telephone: '555-1', address: { streetAddress: 'Av. 1 #2', addressCountry: 'MX' } });
    applyJsonLd(ld);
    const s = document.getElementById('ld-restaurant')!;
    expect(s.getAttribute('type')).toBe('application/ld+json'); expect(s.textContent).not.toContain('</script>'); expect(JSON.parse(s.textContent!).name).toBe('Retroburger');
    applyJsonLd(ld); expect(document.querySelectorAll('#ld-restaurant').length).toBe(1);
    applyJsonLd(null); expect(document.getElementById('ld-restaurant')).toBeNull();
  });
});
