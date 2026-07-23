import React from 'react';
import { createRoot } from 'react-dom/client';
import '@seed-design/css/base.css';
import './index.css';
import ChurchApp from './App.jsx';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ChurchApp />
  </React.StrictMode>,
);
