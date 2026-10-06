import { Link, NavLink, Route, Routes } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { MenuPage } from './pages/MenuPage';
import { TrackPage } from './pages/TrackPage';
import { ReservePage } from './pages/ReservePage';
import { LoyaltyPage } from './pages/LoyaltyPage';
import { QrPage } from './pages/QrPage';
import { InvoicePage } from './pages/InvoicePage';

export function App() {
  const info = useQuery({ queryKey: ['info'], queryFn: () => api('') });
  const nav = ({ isActive }: { isActive: boolean }) => `rb-btn rb-btn--sm ${isActive ? '' : 'rb-btn--white'}`;
  return (
    <>
      <header style={{ background: 'var(--ink)', color: 'var(--cream)' }}>
        <div className="rb-row rb-wrap" style={{ maxWidth: 1100, margin: '0 auto', padding: '10px 16px' }}>
          <Link to="/" className="rb-display" style={{ color: 'var(--mustard)', fontSize: '1.5rem', textDecoration: 'none', textShadow: '0 0 10px rgba(246,184,0,.5)' }}>🍔 RETROBURGER</Link>
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
      <footer className="rb-hint" style={{ textAlign: 'center', padding: 24 }}>© RETROBURGER · THE 90s BURGER EXPERIENCE</footer>
    </>
  );
}
