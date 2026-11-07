import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/poppins/400.css';
import '@fontsource/poppins/600.css';
import '@fontsource/raleway/400.css';
import '@fontsource/raleway/700.css';
import './theme/tokens.css';
import dayjs from 'dayjs';
import 'dayjs/locale/fr';
import { App } from './App';

dayjs.locale('fr');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
