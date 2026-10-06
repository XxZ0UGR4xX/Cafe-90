import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, NavLink as RouterNavLink } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@retroburger/ui/src/fonts';
import { LinkContext, RetroToastProvider } from '@retroburger/ui';
import { App } from './App';
import { ErrorBoundary } from './app/ErrorBoundary';
import { ApiError, onSessionLost } from './app/api';
import { useSession } from './app/auth';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: (n, e) => !(e instanceof ApiError && e.status > 0 && e.status < 500) && n < 2, staleTime: 15_000, refetchOnWindowFocus: false } },
});
onSessionLost(() => useSession.getState().reset());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RetroToastProvider>
        <BrowserRouter>
          <LinkContext.Provider value={({ to, className, children, title }) => <RouterNavLink to={to} end={to === '/'} className={({ isActive }) => [className, isActive ? 'active' : ''].filter(Boolean).join(' ')} title={title}>{children}</RouterNavLink>}>
            <ErrorBoundary><App /></ErrorBoundary>
          </LinkContext.Provider>
        </BrowserRouter>
      </RetroToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
