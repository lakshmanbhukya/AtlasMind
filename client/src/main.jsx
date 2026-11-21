import { StrictMode, Suspense } from 'react'
import { lazyWithReload } from './lib/lazyWithReload.js'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App.jsx'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,     // 5 minutes — schema rarely changes mid-session
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

import ErrorBoundary from './components/ErrorBoundary.jsx'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
const SharedDashboardPage = lazyWithReload(() => import('./pages/SharedDashboardPage.jsx'))

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary label="AtlasMind Application">
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<App />} />
            <Route
              path="/shared/:id"
              element={
                <Suspense fallback={<div className="min-h-[100dvh] bg-vg-bg" />}>
                  <SharedDashboardPage />
                </Suspense>
              }
            />
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
)

