import {StrictMode, Suspense, lazy} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { AceiteProposta } from './components/AceiteProposta';
import { SuportePublico } from './components/SuportePublico';
import { TelaRemota } from './components/TelaRemota';
import './index.css';

// App do técnico (PWA das Ordens de Serviço): carregado à parte, o CRM não baixa o Dexie
const AppTecnico = lazy(() => import('./tecnico/AppTecnico'));
import { instalarSelecaoAoFocar } from './utils/selecaoAoFocar';

instalarSelecaoAoFocar();

// Link público de aceite da proposta (/p/<token>): tela própria, sem login
const aceite = /^\/p\/([A-Za-z0-9_-]+)\/?$/.exec(window.location.pathname);
// Suporte pelo site (painel do widget.js): /suporte?e=<empresa>&cnpj=<opcional>
const suporte = /^\/suporte\/?$/.test(window.location.pathname) ? new URLSearchParams(window.location.search) : null;
// Tela remota do cliente numa aba própria, aberta pelo "Acessar computador" do chamado
const telaRemota = /^\/tela-remota\/?$/.test(window.location.pathname);
const tecnico = /^\/tecnico\/?$/.test(window.location.pathname);

// CRM como PWA (instalável): manifesto e service worker só no CRM em si (não no link de aceite, no widget de suporte,
// na tela remota nem no app do técnico, que tem os seus). No modo dev o service worker atrapalharia o Vite
if (!aceite && !suporte && !telaRemota && !tecnico) {
  document.head.appendChild(Object.assign(document.createElement('link'), { rel: 'manifest', href: '/manifest.webmanifest' }));
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((e) => console.warn('Service worker:', e));
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {aceite ? (
      <AceiteProposta token={aceite[1]} />
    ) : suporte ? (
      <SuportePublico empresa={suporte.get('e') || '1'} cnpj={suporte.get('cnpj') || ''} />
    ) : telaRemota ? (
      <TelaRemota />
    ) : tecnico ? (
      <Suspense fallback={null}>
        <AppTecnico />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);
