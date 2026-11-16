import React from 'react';
import { createRoot } from 'react-dom/client';
import '../renderer/styles/index.css';
import { ThemeProvider } from '../renderer/lib/theme';
import { HostedDashboard } from './HostedDashboard';

const container = document.getElementById('root');
if (!container) throw new Error('Root element not found');

createRoot(container).render(
  <React.StrictMode>
    <ThemeProvider>
      <HostedDashboard />
    </ThemeProvider>
  </React.StrictMode>,
);
