import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { installFonts } from './fonts';
import './styles.css';

installFonts();
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
