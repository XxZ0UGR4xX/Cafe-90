import { Suspense, lazy, useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { RetroSpinner } from '@retroburger/ui';
import { useSession } from './app/auth';
import { Shell } from './app/Shell';
import { ROUTES, allowed } from './app/nav';
import { Login } from './pages/Login';

const pages = {
  '/': lazy(() => import('./pages/Dashboard')), '/branches': lazy(() => import('./pages/Branches')), '/pos': lazy(() => import('./pages/Pos')), '/tables': lazy(() => import('./pages/Tables')),
  '/orders': lazy(() => import('./pages/Orders')), '/kitchen': lazy(() => import('./pages/Kitchen')), '/delivery': lazy(() => import('./pages/Delivery')), '/inventory': lazy(() => import('./pages/Inventory')),
  '/purchasing': lazy(() => import('./pages/Purchasing')), '/suppliers': lazy(() => import('./pages/Suppliers')), '/menu': lazy(() => import('./pages/MenuAdmin')), '/customers': lazy(() => import('./pages/Customers')),
  '/staff': lazy(() => import('./pages/Staff')), '/reservations': lazy(() => import('./pages/Reservations')), '/promotions': lazy(() => import('./pages/Promotions')), '/loyalty': lazy(() => import('./pages/Loyalty')),
  '/reports': lazy(() => import('./pages/Reports')), '/cash': lazy(() => import('./pages/Cash')), '/audit': lazy(() => import('./pages/Audit')), '/settings': lazy(() => import('./pages/Settings')),
} as const;

export function App() {
  const { status, me, bootstrap, can } = useSession();
  useEffect(() => { void bootstrap(); }, [bootstrap]);
  if (status === 'loading') return <div className="rb-login"><RetroSpinner label="INSERT COIN…" /></div>;
  if (status === 'anon' || !me) return <Routes><Route path="*" element={<Login />} /></Routes>;
  return (
    <Routes>
      <Route element={<Shell />}>
        {ROUTES.filter((r) => allowed(r, can)).map((r) => {
          const Page = pages[r.path as keyof typeof pages];
          return <Route key={r.path} path={r.path === '/' ? '/' : `${r.path}/*`} element={<Suspense fallback={<RetroSpinner />}><Page /></Suspense>} />;
        })}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
