import { useEffect } from 'react';
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { applyJsonLd, applyMeta, metaFor, restaurantJsonLd } from './seo';
import { useQuery } from '@tanstack/react-query';
import { RetroLogo } from '@retroburger/ui';
import { api } from './api';
import { MenuPage } from './pages/MenuPage';
import { TrackPage } from './pages/TrackPage';
import { ReservePage } from './pages/ReservePage';
import { LoyaltyPage } from './pages/LoyaltyPage';
import { QrPage } from './pages/QrPage';
import { InvoicePage } from './pages/InvoicePage';

export function App() {
  const info = useQuery({ queryKey: ['info'], queryFn: () => api('') });
  const { pathname } = useLocation();
  useEffect(() => { applyMeta(metaFor(pathname, info.data?.restaurant?.name), `${window.location.origin}${pathname === '/' ? '/' : pathname}`); }, [pathname, info.data]);
  useEffect(() => { applyJsonLd(restaurantJsonLd(info.data, window.location.origin)); }, [info.data]);
  const nav = ({ isActive }: { isActive: boolean }) => `rb-btn rb-btn--sm ${isActive ? '' : 'rb-btn--white'}`;
  return (
    <>
      <header style={{ background: 'var(--ink)', color: 'var(--cream)' }}>
        <div className="rb-row rb-wrap" style={{ maxWidth: 1100, margin: '0 auto', padding: '10px 16px' }}>
          <Link to="/" className="rb-sitelogo" aria-label="RetroBurger, inicio"><RetroLogo name="RETROBURGER" /></Link>
          <nav className="rb-row rb-wrap rb-end"><NavLink to="/" end className={nav}>Menú</NavLink><NavLink to="/reservar" className={nav}>Reservar</NavLink><NavLink to="/puntos" className={nav}>Mis puntos</NavLink><NavLink to="/factura" className={nav}>Facturar</NavLink></nav>
        </div>
        <div className="rb-checker" />
      </header>
      <main style={{ maxWidth: 1100, margin: '0 auto', padding: 16 }}>
        <Routes>
          <Route path="/" element={<MenuPage info={info.data} />} />
          <Route path="/pedido/:id" element={<TrackPage />} />
          <Route path="/reservar" element={<ReservePage info={info.data} />} />
          <Route path="/puntos" element={<LoyaltyPage info={info.data} />} />
          <Route path="/factura" element={<InvoicePage />} />
          <Route path="/m/:token" element={<QrPage />} />
        </Routes>
      </main>
      <footer className="rb-hint" style={{ textAlign: 'center', padding: 24 }}>© RETROBURGER · HAMBURGUESAS DE DINER</footer>
    </>
  );
}
