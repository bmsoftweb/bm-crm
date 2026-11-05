import 'dotenv/config';
import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { createApp } from './server/app.js';
import { iniciarEnvioWhatsApp } from './server/whatsapp.js';
import { iniciarRotinaContratos } from './server/contratos.js';
import { apagarGravacoesAntigas } from './server/chamados.js';
import { iniciarAutomaticas } from './server/automaticas.js';
import { iniciarJornadas } from './server/jornada.js';
import { iniciarInatividade } from './server/inatividade.js';
import { iniciarEmailsCampanha } from './server/campanhas.js';
import { iniciarBotAtividades } from './server/atividadeBot.js';
import { iniciarRespostasPesquisa } from './server/pesquisasSatisfacao.js';
import { iniciarAgendaGoogle } from './server/agendaGoogle.js';

/** Entrada para execução local (npm run dev / start). Na Vercel quem serve as rotas é api/index.ts */
const PORT = Number(process.env.PORT) || 3000;

async function startServer() {
  const app = createApp();

  // ==========================================================
  // VITE / SPA
  // ==========================================================
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`CRM Web rodando em http://0.0.0.0:${PORT}`);
    console.log(`MySQL: ${process.env.MYSQL_HOST} / ${process.env.MYSQL_DATABASE || 'crmweb'}`);
    iniciarEnvioWhatsApp();
    iniciarAutomaticas();
    iniciarJornadas();
    iniciarInatividade();
    iniciarEmailsCampanha();
    iniciarBotAtividades();
    iniciarRespostasPesquisa();
    iniciarRotinaContratos();
    iniciarAgendaGoogle();
    // Gravações de ligação com mais de 30 dias, 2x por dia (na Vercel: cron /api/cron/contratos)
    setInterval(() => apagarGravacoesAntigas().catch((err) => console.error('Gravações: falha ao apagar as antigas:', err.message)), 12 * 60 * 60_000);
  });
}

startServer().catch((err) => {
  console.error('Falha crítica ao iniciar o servidor:', err);
  process.exit(1);
});
