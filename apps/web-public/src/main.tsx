import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@retroburger/ui/src/fonts';
import { RetroToastProvider } from '@retroburger/ui';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } })}><RetroToastProvider><BrowserRouter><App /></BrowserRouter></RetroToastProvider></QueryClientProvider></StrictMode>,
);
