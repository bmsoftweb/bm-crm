import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Usuario, ResourceDef, DashboardData, RegistroCrud, FiltroAvancado } from './types';
import { fetchContagemChamados,
  setTokenSessao,
  setAoExpirarSessao,
  fetchResources,
  fetchDashboard,
  invalidateOptions,
  validarSessao,
  fetchNaoVistas,
  fetchMinhasAtividades,
  atividadesGravadasAqui,
  fetchUltimaVisita,
} from './services/api';
import { destravarSom, tocarAviso } from './utils/som';
import { lerConfigLista, limparConfigListas, salvarConfigLista } from './utils/configListas';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { LoginView } from './components/LoginView';
import { Dashboard } from './components/Dashboard';
import { CrudView } from './components/CrudView';
import { Kanban } from './components/Kanban';
import { NegocioFicha } from './components/NegocioFicha';
import { DocumentoEditor } from './components/DocumentoEditor';
import { BotaoImportarBM } from './components/ImportarBMModal';
import { BotaoImportarArquivo } from './components/ImportarArquivoModal';
import { BotaoClonar } from './components/BotaoClonar';
import { BotaoReverter } from './components/BotaoReverter';
import { BotaoImprimir } from './components/BotaoImprimir';
import { AcaoCampanha, BotaoEnviarDisparo } from './components/AcoesCampanha';
import { BotaoEnviar } from './components/BotaoEnviar';
import { BotaoLinkAceite } from './components/BotaoLinkAceite';
import { BotaoNovaVersao } from './components/BotaoNovaVersao';
import { AcaoConversaBot, ConversaBot } from './components/ConversaBot';
import { AcaoConcluir, BotaoConcluirRapido } from './components/ConcluirAtividade';
import { BotaoAcao } from './components/MenuAcoes';
import { Headset, KeyRound, Printer } from 'lucide-react';
import { imprimirOS } from './utils/imprimirOS';
import { AcaoEncerrarOS } from './components/EncerrarOS';
import { AcaoGerarOS, ConfirmarGerarOS } from './components/GerarOS';
import { AcaoRetornoLigacao, PesquisasSatisfacao } from './components/PesquisasSatisfacao';
import { PainelSuporte } from './components/PainelSuporte';
import { Prospeccao } from './components/Prospeccao';
import { ContratoDocumentos } from './components/ContratoDocumentos';
import { BotaoGerarContrato } from './components/BotaoGerarContrato';
import { ConfiguracoesView } from './components/ConfiguracoesView';
import { ConversasView, PedidoConversa } from './components/ConversasView';
import { ChamadosAtivos, ChamadosFila, tempoEspera } from './components/Chamados';
import { BotaoWhatsApp } from './components/BotaoWhatsApp';
import { BotaoPermissoes } from './components/PermissoesUsuario';
import { gruposDoMenu, podeAcessar, type ItemMenu } from './utils/menu';
import { ThemeMode, getInitialTheme, applyTheme } from './utils/theme';
import { Sessao, lerSessao, salvarSessao, limparSessao, atualizarSessao } from './utils/session';

export default function App() {
  // ----------------------------------------------------------
  // Tema claro / escuro
  // ----------------------------------------------------------
  const [theme, setTheme] = useState<ThemeMode>(() => getInitialTheme());
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  const handleToggleTheme = useCallback(() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark')), []);

  // ----------------------------------------------------------
  // Sessão (token assinado pelo servidor, guardado no navegador)
  // ----------------------------------------------------------
  const [sessao, setSessao] = useState<Sessao | null>(() => {
    const s = lerSessao();
    // O token precisa estar no cliente HTTP antes da primeira chamada
    setTokenSessao(s?.token ?? null);
    return s;
  });
  const usuario: Usuario | null = sessao?.usuario ?? null;

  // ----------------------------------------------------------
  // Navegação e estado geral
  // ----------------------------------------------------------
  const [activeTab, setActiveTab] = useState<string>('kanban');
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [resources, setResources] = useState<ResourceDef[]>([]);
  const [recordCounts, setRecordCounts] = useState<Record<string, number>>({});
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [isDashboardLoading, setIsDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState<string | null>(null);

  const [refreshToken, setRefreshToken] = useState(0);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  }, []);

  /** Mensagens do WhatsApp recebidas e ainda não vistas (etiqueta do menu Conversas) */
  const [naoVistas, setNaoVistas] = useState(0);
  /** Chamados aguardando na fila (etiqueta do menu) e o chamado a abrir em Chamados Ativos */
  const [filaChamados, setFilaChamados] = useState(0);
  const [chamadoAbrir, setChamadoAbrir] = useState<number | null>(null);
  /** Botão direito na atividade da agenda: confirmação do "Gerar OS" */
  const [gerarOSDe, setGerarOSDe] = useState<RegistroCrud | null>(null);
  /** Conversas passadas ao meu departamento que já tocaram o aviso (telefone + quando) */
  const avisadasRef = useRef(new Set<string>());
  /** Última conversa transferida para mim já avisada (null = ainda não carregou: sem campainha na abertura) */
  const ultimaTransferidaWa = useRef<number | null>(null);
  /** Mensagens de cliente esperando a minha resposta que já tocaram a campainha */
  const esperandoAvisadas = useRef(new Set<number>());
  const atualizarNaoVistas = useCallback(() => {
    fetchNaoVistas()
      .then((r) => {
        setNaoVistas(r.total);
        // Cliente encaminhado ao meu departamento: aviso sonoro em qualquer tela, uma vez por encaminhamento
        const novas = (r.encaminhadas ?? []).filter((e) => !avisadasRef.current.has(`${e.telefone}|${e.desde}`));
        novas.forEach((e) => avisadasRef.current.add(`${e.telefone}|${e.desde}`));
        if (novas.length) {
          tocarAviso('campainha');
          const e = novas[0];
          showToast(`${e.nome || `+${e.telefone}`} aguardando atendimento no ${e.departamento}${novas.length > 1 ? ` (e mais ${novas.length - 1})` : ''}. Veja em Conversas.`);
        }
        // Conversa transferida para mim: a mesma campainha dos chamados
        const tr = r.transferida;
        if (tr && ultimaTransferidaWa.current !== null && tr.id > ultimaTransferidaWa.current) {
          tocarAviso('campainha');
          showToast(`Conversa de ${tr.nome || `+${tr.telefone}`} transferida para você${tr.de ? ` por ${tr.de}` : ''}. Veja no Whatsapp.`);
          setRefreshToken((t) => t + 1);
        }
        ultimaTransferidaWa.current = Math.max(ultimaTransferidaWa.current ?? 0, tr?.id ?? 0);
        // Cliente esperando a minha resposta há X minutos: campainha, uma vez por mensagem
        const esp = (r.esperando ?? []).filter((e) => !esperandoAvisadas.current.has(e.id));
        esp.forEach((e) => esperandoAvisadas.current.add(e.id));
        if (esp.length) {
          tocarAviso('campainha');
          showToast(`${esp[0].nome || `+${esp[0].telefone}`} está esperando a sua resposta${esp.length > 1 ? ` (e mais ${esp.length - 1})` : ''}. Veja no Whatsapp.`);
        }
      })
      .catch(() => {}); // sem a tabela ou sem conexão: fica sem etiqueta
  }, [showToast]);
  useEffect(() => destravarSom(), []);
  // Sem permissão para Conversas: sem etiqueta de não vistas nem aviso sonoro
  const veConversas = podeAcessar(sessao?.usuario ?? null, 'conversas');
  useEffect(() => {
    if (!sessao || !veConversas) return;
    atualizarNaoVistas();
    // Também com a aba em segundo plano: o aviso sonoro não pode esperar a pessoa voltar
    const i = setInterval(atualizarNaoVistas, 15_000);
    return () => clearInterval(i);
  }, [sessao, veConversas, atualizarNaoVistas]);

  // Etiqueta da Fila de Chamados, para quem trabalha os chamados
  const veChamados = podeAcessar(sessao?.usuario ?? null, 'chamados_fila') || podeAcessar(sessao?.usuario ?? null, 'chamados_ativos');
  /** Última mensagem de cliente já vista nos meus chamados (null = ainda não carregou: sem som na abertura) */
  const ultimaMsgChamado = useRef<number | null>(null);
  const ultimoChamadoFila = useRef<number | null>(null);
  /** Última transferência de chamado para mim já avisada (null = ainda não carregou: sem campainha na abertura) */
  const ultimaTransferencia = useRef<number | null>(null);
  /** Idem, para chamado transferido para o meu departamento */
  const ultimaTransferenciaDep = useRef<number | null>(null);
  /** Quando tocou a buzina do chamado atrasado na fila (repete a cada minuto enquanto houver) */
  const ultimaBuzina = useRef(0);
  /** Acabou de entrar (login ou sessão guardada): quem é do Suporte começa na Fila de Chamados */
  const recemEntrou = useRef(true);
  const atualizarFilaChamados = useCallback(() => {
    fetchContagemChamados()
      .then((r) => {
        setFilaChamados(r.fila);
        if (recemEntrou.current) {
          recemEntrou.current = false;
          // Só se ainda está na tela inicial (não tira o usuário de onde ele já foi)
          if (r.suporte) setActiveTab((t) => (t === 'kanban' ? 'chamados_fila' : t));
        }
        const m = r.mensagem;
        // Cliente escreveu num chamado meu: aviso sonoro, aviso na tela e a conversa aberta se atualiza
        if (m && ultimaMsgChamado.current !== null && m.id > ultimaMsgChamado.current) {
          tocarAviso('suporte');
          showToast(`Nova mensagem de ${m.nome || 'cliente'} no chamado nº ${m.numero}.`);
          setRefreshToken((t) => t + 1);
        }
        ultimaMsgChamado.current = Math.max(ultimaMsgChamado.current ?? 0, m?.id ?? 0);
        // Chamado novo na fila: aviso com som próprio para quem é do departamento Suporte
        const n = r.novo;
        if (r.suporte && n && ultimoChamadoFila.current !== null && n.id > ultimoChamadoFila.current) {
          tocarAviso('chamado');
          showToast(`Novo chamado nº ${n.numero} na fila${n.nome ? ` (${n.nome})` : ''}.`);
        }
        ultimoChamadoFila.current = Math.max(ultimoChamadoFila.current ?? 0, n?.id ?? 0);
        // Chamado esperando há mais de 10 minutos na fila: buzina alta, a cada minuto até alguém assumir
        const at = r.atrasado;
        if (r.suporte && at && Date.now() - ultimaBuzina.current >= 60_000) {
          ultimaBuzina.current = Date.now();
          tocarAviso('buzina');
          showToast(`Chamado nº ${at.numero}${at.nome ? ` (${at.nome})` : ''} esperando há ${tempoEspera(at.espera_min)} na fila.`);
        }
        // Chamado transferido para mim: campainha, aviso na tela e as listas se atualizam
        const tr = r.transferido;
        if (tr && ultimaTransferencia.current !== null && tr.id > ultimaTransferencia.current) {
          tocarAviso('campainha');
          showToast(`Chamado nº ${tr.numero}${tr.nome ? ` (${tr.nome})` : ''} transferido para você${tr.de ? ` por ${tr.de}` : ''}.`);
          setRefreshToken((t) => t + 1);
        }
        ultimaTransferencia.current = Math.max(ultimaTransferencia.current ?? 0, tr?.id ?? 0);
        // Chamado transferido para o meu departamento (voltou para a fila): a mesma campainha
        const td = r.transferido_departamento;
        if (td && ultimaTransferenciaDep.current !== null && td.id > ultimaTransferenciaDep.current) {
          tocarAviso('campainha');
          showToast(`Chamado nº ${td.numero}${td.nome ? ` (${td.nome})` : ''} transferido para o ${td.departamento}${td.de ? ` por ${td.de}` : ''}. Veja na Fila de Chamados.`);
          setRefreshToken((t) => t + 1);
        }
        ultimaTransferenciaDep.current = Math.max(ultimaTransferenciaDep.current ?? 0, td?.id ?? 0);
      })
      .catch(() => {}); // sem as tabelas ou sem conexão: fica sem etiqueta
  }, [showToast]);
  useEffect(() => {
    if (!sessao || !veChamados) return;
    atualizarFilaChamados();
    // A cada 5 s: o aviso de mensagem do cliente não pode demorar (é uma consulta pequena)
    const i = setInterval(atualizarFilaChamados, 5_000);
    return () => clearInterval(i);
  }, [sessao, veChamados, atualizarFilaChamados]);

  /** Atividades pendentes que executo ou do meu departamento, já conhecidas (null = ainda não carregou: sem aviso na abertura) */
  const minhasAtividades = useRef<Set<number> | null>(null);
  const atualizarMinhasAtividades = useCallback(() => {
    fetchMinhasAtividades()
      .then((lista) => {
        const conhecidas = minhasAtividades.current;
        minhasAtividades.current = new Set(lista.map((a) => a.id));
        // Nova para mim (criada por outra pessoa ou passada para mim); as que eu mesmo gravei não avisam
        const novas = conhecidas ? lista.filter((a) => !conhecidas.has(a.id) && !atividadesGravadasAqui.has(a.id)) : [];
        if (!novas.length) return;
        const a = novas[0];
        const quando = a.vencimento ? ` para ${a.vencimento}${a.hora ? ` às ${a.hora}` : ''}` : '';
        const texto = `${a.assunto}${quando}${novas.length > 1 ? ` (e mais ${novas.length - 1})` : ''}`;
        const titulo = a.departamento ? `Nova atividade para o ${a.departamento}` : 'Nova atividade para você';
        tocarAviso('campainha');
        showToast(`${titulo}: ${texto}. Veja em Atividades.`);
        setRefreshToken((t) => t + 1);
        // Navegador em outra janela ou aba: notificação do sistema; o clique traz o CRM para a frente em Atividades
        if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
          const n = new Notification(titulo, { body: texto, tag: `atividade-${a.id}` });
          n.onclick = () => {
            window.focus();
            setActiveTab('atividades');
            n.close();
          };
        }
      })
      .catch(() => {}); // sem conexão: tenta na próxima
  }, [showToast]);
  useEffect(() => {
    if (!sessao) return;
    if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission();
    atualizarMinhasAtividades();
    // Também com a aba em segundo plano: é justamente quando a pessoa está em outra tela
    const i = setInterval(atualizarMinhasAtividades, 15_000);
    return () => clearInterval(i);
  }, [sessao, atualizarMinhasAtividades]);

  // Sino do topo: pisca quando alguém entrou no site depois da última visita vista. A vista fica no navegador,
  // por usuário (sem ela, a primeira consulta só marca como vista, sem piscar pelas antigas)
  const veVisitas = podeAcessar(sessao?.usuario ?? null, 'site_visitas');
  const chaveVisita = `crmwebVisitaVista:${sessao?.usuario.id ?? ''}`;
  const [ultimaVisita, setUltimaVisita] = useState(0);
  const [visitaVista, setVisitaVista] = useState(0);
  const marcarVisitaVista = useCallback(
    (id: number) => {
      setVisitaVista(id);
      try {
        localStorage.setItem(chaveVisita, String(id));
      } catch {
        // sem localStorage: vale só nesta aba
      }
    },
    [chaveVisita],
  );
  useEffect(() => {
    if (!sessao || !veVisitas) return;
    let vista: number | null = null;
    try {
      vista = Number(localStorage.getItem(chaveVisita)) || null;
    } catch {
      // sem localStorage
    }
    if (vista) setVisitaVista(vista);
    const atualizar = () =>
      fetchUltimaVisita()
        .then((v) => {
          const id = v?.id ?? 0;
          setUltimaVisita(id);
          if (vista === null) marcarVisitaVista((vista = id));
        })
        .catch(() => {}); // sem a tabela ou sem conexão: sino parado
    atualizar();
    const i = setInterval(atualizar, 15_000);
    return () => clearInterval(i);
  }, [sessao, veVisitas, chaveVisita, marcarVisitaVista]);
  // Abrir a tela (pelo sino ou pelo menu) dá as visitas como vistas
  useEffect(() => {
    if (activeTab === 'site_visitas' && ultimaVisita > visitaVista) marcarVisitaVista(ultimaVisita);
  }, [activeTab, ultimaVisita, visitaVista, marcarVisitaVista]);

  // Tela sem permissão (ex.: o Funil, que abre primeiro): vai para a primeira opção do menu que o usuário acessa
  useEffect(() => {
    const u = sessao?.usuario ?? null;
    if (!u || !resources.length) return;
    const ids = gruposDoMenu(resources).flatMap((g) => g.itens.map((i) => i.id));
    if ((ids.includes(activeTab) || activeTab === 'usuarios') && !podeAcessar(u, activeTab)) {
      const primeira = ids.find((id) => podeAcessar(u, id));
      if (primeira) setActiveTab(primeira);
    }
  }, [sessao, resources, activeTab]);

  /** Atividade WhatsApp clicada na ficha do negócio: a tela Conversas abre o número do cliente */
  const [pedidoConversa, setPedidoConversa] = useState<PedidoConversa | null>(null);

  /** Motivo exibido na tela de login quando a sessão é recusada */
  const [avisoLogin, setAvisoLogin] = useState<string | null>(null);

  /** Troca de tela; o gatilho do botão "Novo" zera para a tela nova não abrir uma inclusão sozinha */
  /** Filtros com que um cadastro abre quando outra tela leva até ele (ex.: Painel de Suporte › técnico → Consulta de Chamados) */
  const [filtroInicial, setFiltroInicial] = useState<{ tela: string; filtros: FiltroAvancado[]; seq: number } | null>(null);

  // Navegação normal (menu etc.) abre sem filtro herdado
  const navegar = useCallback((tab: string) => {
    setFiltroInicial(null);
    setRegistroInicial(null);
    setActiveTab(tab);
  }, []);

  const navegarFiltrado = useCallback(
    (tab: string, filtros: FiltroAvancado[]) => {
      navegar(tab);
      setFiltroInicial({ tela: tab, filtros, seq: Date.now() });
    },
    [navegar],
  );

  /** Registro que um cadastro abre em edição quando outra tela leva até ele (ex.: atividade → contrato ou negócio) */
  const [registroInicial, setRegistroInicial] = useState<{ tela: string; id: string | number; seq: number } | null>(null);
  const navegarRegistro = useCallback(
    (tab: string, id: string | number) => {
      navegar(tab);
      setRegistroInicial({ tela: tab, id, seq: Date.now() });
    },
    [navegar],
  );
  /** Conversa do Bot aberta pelo duplo clique na atividade */
  const [conversaBotId, setConversaBotId] = useState<string | null>(null);

  /** Abre a tela Conversas no número de uma atividade WhatsApp, de uma pessoa ou de um contato */
  const pedirConversa = useCallback(
    (de: Omit<PedidoConversa, 'seq'>) => {
      setPedidoConversa({ ...de, seq: Date.now() });
      navegar('conversas');
    },
    [navegar],
  );

  const handleLogout = useCallback(() => {
    setSessao(null);
    setResources([]);
    setDashboard(null);
    setRecordCounts({});
    setActiveTab('kanban');
    invalidateOptions();
    setTokenSessao(null);
    limparConfigListas();
    limparSessao();
  }, []);

  // Qualquer 401 da API (token expirado, usuário desativado) volta para o login
  useEffect(() => {
    setAoExpirarSessao((msg) => {
      handleLogout();
      setAvisoLogin(msg);
    });
    return () => setAoExpirarSessao(null);
  }, [handleLogout]);

  // Sessão guardada no navegador é conferida ao abrir e ao voltar para a aba: o usuário pode ter
  // sido desativado ou ter as permissões alteradas (o menu esconde o que ele não acessa)
  useEffect(() => {
    if (!sessao) return;
    const conferir = () =>
      validarSessao().then(({ valida, error, usuario: atual }) => {
        if (valida === false) {
          handleLogout();
          setAvisoLogin(error || 'Sua sessão expirou. Entre novamente.');
        } else if (atual) {
          setSessao((s) => {
            if (!s || JSON.stringify(s.usuario) === JSON.stringify(atual)) return s;
            const nova = { ...s, usuario: atual };
            atualizarSessao(nova);
            return nova;
          });
        }
      });
    conferir();
    window.addEventListener('focus', conferir);
    return () => window.removeEventListener('focus', conferir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessao?.token]);

  // Metadados dos recursos
  useEffect(() => {
    if (!sessao) return;
    let alive = true;
    fetchResources()
      .then((list) => alive && setResources(list))
      .catch((err) => console.warn('Falha ao carregar os metadados dos recursos:', err));
    return () => {
      alive = false;
    };
  }, [sessao?.token]);

  const loadDashboard = useCallback(async () => {
    if (!sessao) return;
    setIsDashboardLoading(true);
    setDashboardError(null);
    try {
      setDashboard(await fetchDashboard());
    } catch (err: any) {
      setDashboardError(err.message || 'Falha ao carregar os indicadores.');
    } finally {
      setIsDashboardLoading(false);
    }
  }, [sessao?.token]);

  useEffect(() => {
    if (activeTab === 'dashboard') {
      loadDashboard();
    }
  }, [activeTab, loadDashboard, refreshToken]);

  const handleCountChange = useCallback((resourceName: string, total: number) => {
    setRecordCounts((prev) => (prev[resourceName] === total ? prev : { ...prev, [resourceName]: total }));
  }, []);

  /** Opções favoritas do menu (até 3), por usuário em usuarios.config_listas: estrela no menu, atalho no topo */
  const [favoritos, setFavoritos] = useState<string[]>([]);
  useEffect(() => {
    if (sessao) lerConfigLista('_menu').then((c) => setFavoritos(c.favoritos ?? []));
  }, [sessao?.token]);
  const alternarFavorito = (id: string) => {
    if (!favoritos.includes(id) && favoritos.length >= 3) return showToast('Já há 3 favoritas: tire a estrela de uma antes.');
    const novos = favoritos.includes(id) ? favoritos.filter((f) => f !== id) : [...favoritos, id];
    setFavoritos(novos);
    salvarConfigLista('_menu', { favoritos: novos });
  };
  const itensFavoritos = useMemo(() => {
    const itens: ItemMenu[] = gruposDoMenu(resources).flatMap((g) => g.itens);
    const u = resources.find((r) => r.name === 'usuarios');
    if (u) itens.push({ id: u.name, label: u.label, descricao: u.description, icone: KeyRound });
    return favoritos.map((id) => itens.find((i) => i.id === id)).filter((i): i is ItemMenu => Boolean(i) && podeAcessar(sessao?.usuario ?? null, i!.id));
  }, [favoritos, resources, sessao]);

  const activeResource = useMemo(() => resources.find((r) => r.name === activeTab) || null, [resources, activeTab]);
  const resourceNegocios = useMemo(() => resources.find((r) => r.name === 'negocios'), [resources]);

  /** Telas cujo registro abre num editor próprio, no lugar do formulário genérico */
  const renderEditor = useCallback(
    (nome: string) => (record: RegistroCrud | null, fechar: () => void, aoGravar: () => void) => {
      if (nome === 'negocios') {
        // Inclusão usa o formulário genérico; um negócio existente abre a ficha completa
        return record ? (
          <NegocioFicha
            negocioId={record.id}
            resource={resourceNegocios}
            onFechar={fechar}
            onAlterado={aoGravar}
            onToast={showToast}
            onConversar={pedirConversa}
          />
        ) : null;
      }
      if (nome === 'propostas' || nome === 'pedidos') {
        return <DocumentoEditor tipo={nome} id={record?.id ?? null} onFechar={fechar} onGravado={aoGravar} onToast={showToast} />;
      }
      return null;
    },
    [resourceNegocios, showToast, pedirConversa],
  );

  // ----------------------------------------------------------
  // 1. Tela de login
  // ----------------------------------------------------------
  if (!sessao || !usuario) {
    return (
      <LoginView
        avisoInicial={avisoLogin}
        theme={theme}
        onToggleTheme={handleToggleTheme}
        onLoginSuccess={(novoUsuario, empresa, token, lembrar) => {
          const nova = { usuario: novoUsuario, empresa, token };
          setTokenSessao(token);
          setSessao(nova);
          setActiveTab('kanban');
          recemEntrou.current = true;
          salvarSessao(nova, lembrar);
          setAvisoLogin(null);
          showToast(`Bem-vindo, ${novoUsuario.nome}!`);
        }}
      />
    );
  }

  // ----------------------------------------------------------
  // 2. Aplicação
  // ----------------------------------------------------------
  const TITULOS: Record<string, [string, string]> = {
    dashboard: ['Painel de Vendas', 'Indicadores do funil, follow-ups, propostas e pedidos'],
    kanban: ['Funil de Vendas', 'Arraste os negócios entre as etapas; solte em Ganho ou Perdido para encerrar'],
    configuracoes: ['Configurações', 'Preferências da empresa, por grupo'],
    conversas: ['Whatsapp', 'Mensagens do WhatsApp da empresa'],
    painel_suporte: ['Painel de Suporte', 'Chamados, WhatsApp e satisfação no período, comparados com o período anterior'],
    chamados_fila: ['Fila de Chamados', 'Chamados aguardando atendimento, em ordem de chegada'],
    chamados_ativos: ['Chamados Ativos', 'Atendimento dos chamados de suporte'],
    pesquisas_satisfacao: ['Pesquisa de Satisfação', 'Sorteie atendimentos e pergunte aos clientes como foi'],
    prospeccao: ['Prospecção', 'Busque empresas no Google Maps por segmento e região e inclua as qualificadas como leads'],
  };
  const [headerTitle, headerSubtitle] = activeResource
    ? [activeResource.label, activeResource.description]
    : TITULOS[activeTab] || ['CRM Web', ''];

  // Chamados Ativos tem o "Novo" ao lado da pesquisa, não no cabeçalho

  return (
    <div className="h-screen overflow-hidden bg-stone-100/70 dark:bg-stone-950 text-stone-900 dark:text-stone-100 flex font-sans antialiased selection:bg-blue-600 selection:text-white">
      {conversaBotId && <ConversaBot atividadeId={conversaBotId} onFechar={() => setConversaBotId(null)} />}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-[70] bg-stone-900 text-white text-xs font-semibold py-3 px-4 rounded-xl shadow-2xl border border-stone-800 flex items-center gap-2.5">
          <span className="w-2 h-2 rounded-full bg-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      <Sidebar
        activeTab={activeTab}
        setActiveTab={navegar}
        resources={resources}
        recordCounts={recordCounts}
        naoVistas={naoVistas}
        filaChamados={filaChamados}
        usuario={usuario}
        onLogout={handleLogout}
        isOpenMobile={isMobileSidebarOpen}
        onCloseMobile={() => setIsMobileSidebarOpen(false)}
        favoritos={favoritos}
        onAlternarFavorito={alternarFavorito}
      />

      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <Header
          empresaNome={sessao.empresa.nome}
          title={headerTitle}
          subtitle={headerSubtitle}
          onOpenMobileSidebar={() => setIsMobileSidebarOpen(true)}
          onRefresh={() => setRefreshToken((t) => t + 1)}
          onAbrirVisitas={veVisitas ? () => navegar('site_visitas') : undefined}
          visitaNova={ultimaVisita > visitaVista}
          favoritos={itensFavoritos}
          onAbrirFavorito={navegar}
          activeTab={activeTab}
        />

        {activeTab === 'kanban' ? (
          <main className="flex-1 flex flex-col min-h-0 w-full">
            <Kanban
              resourceNegocios={resourceNegocios}
              refreshToken={refreshToken}
              onToast={showToast}
              onConversar={pedirConversa}
            />
          </main>
        ) : activeTab === 'conversas' ? (
          <main className="flex-1 flex flex-col min-h-0 w-full">
            <ConversasView refreshToken={refreshToken} onVisto={atualizarNaoVistas} pedido={pedidoConversa} onToast={showToast} onVoltarFila={() => navegar('chamados_fila')} />
          </main>
        ) : activeTab === 'chamados_fila' ? (
          <main className="flex-1 flex flex-col min-h-0 w-full">
            <ChamadosFila
              refreshToken={refreshToken}
              onMudou={atualizarFilaChamados}
              onAbrir={(id) => {
                setChamadoAbrir(id);
                navegar('chamados_ativos');
              }}
              onToast={showToast}
              onConversa={(telefone) => {
                atualizarNaoVistas();
                pedirConversa({ telefone });
              }}
            />
          </main>
        ) : activeTab === 'chamados_ativos' ? (
          <main className="flex-1 flex flex-col min-h-0 w-full">
            <ChamadosAtivos
              refreshToken={refreshToken}
              abrir={chamadoAbrir}
              onMudou={atualizarFilaChamados}
              onConversar={(pessoaId) => pedirConversa({ pessoaId })}
              onToast={showToast}
              onVoltarFila={() => {
                setChamadoAbrir(null);
                navegar('chamados_fila');
              }}
            />
          </main>
        ) : activeTab === 'painel_suporte' ? (
          <main className="flex-1 overflow-y-auto min-h-0 w-full">
            <div className="px-4 sm:px-6 lg:px-8 py-6">
              <PainelSuporte refreshToken={refreshToken} onNavigate={navegar} onNavigateFiltrado={navegarFiltrado} />
            </div>
          </main>
        ) : activeTab === 'pesquisas_satisfacao' ? (
          <main className="flex-1 flex flex-col min-h-0 w-full">
            <PesquisasSatisfacao refreshToken={refreshToken} onToast={showToast} />
          </main>
        ) : activeTab === 'prospeccao' ? (
          <main className="flex-1 flex flex-col min-h-0 w-full">
            <Prospeccao onToast={showToast} onVerLeads={(id) => navegarFiltrado('pessoas', [{ field: 'prospeccao_busca_id', op: 'eq', value: id }])} />
          </main>
        ) : activeTab === 'configuracoes' ? (
          <main className="flex-1 flex flex-col min-h-0 w-full">
            <ConfiguracoesView usuario={usuario} onToast={showToast} />
          </main>
        ) : activeResource ? (
          <main className="flex-1 flex flex-col min-h-0 w-full">
            <CrudView
              key={activeResource.name}
              resource={activeResource}
              allResources={resources}
              refreshToken={refreshToken}
              onToast={showToast}
              onCountChange={handleCountChange}
              onNavigate={navegar}
              usuario={usuario}
              filtrosIniciais={filtroInicial?.tela === activeResource.name ? filtroInicial : null}
              registroInicial={registroInicial?.tela === activeResource.name ? registroInicial : null}
              renderEditor={renderEditor(activeResource.name)}
              acoesLista={
                activeResource.name === 'pessoas'
                  ? (recarregar) => (
                      <>
                        <BotaoImportarArquivo onImportado={recarregar} />
                        <BotaoImportarBM tipo="pessoas" onImportado={recarregar} />
                      </>
                    )
                  : activeResource.name === 'produtos'
                    ? (recarregar) => <BotaoImportarBM tipo="produtos" onImportado={recarregar} />
                    : undefined
              }
              acoesEmMenu={['propostas', 'pedidos', 'campanhas', 'atividades', 'ordens_servico'].includes(activeResource.name)}
              onGerarOS={activeResource.name === 'atividades' && podeAcessar(usuario, 'ordens_servico') ? setGerarOSDe : undefined}
              aoDuploClique={
                activeResource.name === 'atividades'
                  ? (row) => {
                      // Abre a rotina que gerou a atividade: chamado, conversa do Bot, conversa do WhatsApp, contrato
                      // ou negócio (Retorno Envio e as manuais); sem nenhum deles, abre a edição
                      if (row.chamado_id && podeAcessar(usuario, 'chamados_ativos')) {
                        setChamadoAbrir(Number(row.chamado_id));
                        navegar('chamados_ativos');
                        return true;
                      }
                      if (Number(row.executor_bot) === 1) {
                        setConversaBotId(String(row.id));
                        return true;
                      }
                      if ((row.tipo === 'whatsapp' || row.origem === 'pendencia') && podeAcessar(usuario, 'conversas')) {
                        pedirConversa({ atividadeId: row.id as string });
                        return true;
                      }
                      if (row.contrato_id && podeAcessar(usuario, 'contratos')) {
                        navegarRegistro('contratos', row.contrato_id as string);
                        return true;
                      }
                      if (row.negocio_id && podeAcessar(usuario, 'negocios')) {
                        navegarRegistro('negocios', row.negocio_id as string);
                        return true;
                      }
                      return false;
                    }
                  : undefined
              }
              colunaInicial={
                activeResource.name === 'atividades'
                  ? {
                      titulo: 'Concluir',
                      render: (row, { recarregar }) => (
                        <BotaoConcluirRapido registro={row} onFeito={() => (showToast('Atividade concluída.'), recarregar())} />
                      ),
                    }
                  : undefined
              }
              acoesLinha={
                activeResource.name === 'propostas' || activeResource.name === 'pedidos'
                  ? (row, { abrir, recarregar }) => (
                      <>
                        <BotaoImprimir
                          tipo={activeResource.name as 'propostas' | 'pedidos'}
                          registro={row}
                          onToast={showToast}
                        />
                        <BotaoEnviar
                          tipo={activeResource.name as 'propostas' | 'pedidos'}
                          registro={row}
                          onRecarregar={recarregar}
                          onToast={showToast}
                        />
                        {activeResource.name === 'propostas' && <BotaoLinkAceite registro={row} onToast={showToast} />}
                        {activeResource.name === 'propostas' && (
                          <BotaoNovaVersao registro={row} onAbrir={abrir} onRecarregar={recarregar} onToast={showToast} />
                        )}
                        {activeResource.name === 'propostas' && row.status === 'aceita' && (
                          <BotaoGerarContrato registro={row} onAbrirContratos={() => navegar('contratos')} onToast={showToast} />
                        )}
                        {/* TEMPORÁRIO (testes): Reverter, só para o administrador */}
                        {activeResource.name === 'propostas' && usuario?.tipo === 'admin' && (row.status === 'aceita' || row.status === 'recusada') && (
                          <BotaoReverter registro={row} onRecarregar={recarregar} onToast={showToast} />
                        )}
                        <BotaoClonar
                          tipo={activeResource.name as 'propostas' | 'pedidos'}
                          registro={row}
                          onAbrir={abrir}
                          onRecarregar={recarregar}
                          onToast={showToast}
                        />
                      </>
                    )
                  : activeResource.name === 'produtos'
                    ? (row, { abrir, recarregar }) => <BotaoClonar tipo="produtos" registro={row} onAbrir={abrir} onRecarregar={recarregar} onToast={showToast} />
                  : activeResource.name === 'contratos'
                    ? (row, { recarregar }) => <ContratoDocumentos registro={row} onRecarregar={recarregar} onToast={showToast} />
                  : activeResource.name === 'campanhas'
                    ? (row, { recarregar }) => <AcaoCampanha registro={row} onRecarregar={recarregar} onToast={showToast} />
                    : activeResource.name === 'pessoas'
                      ? (row) => <BotaoWhatsApp temNumero={Boolean(row.whatsapp || row.telefone)} onAbrir={() => pedirConversa({ pessoaId: row.id as string })} />
                      : activeResource.name === 'usuarios'
                        ? (row, { recarregar }) => <BotaoPermissoes usuario={row} resources={resources} onRecarregar={recarregar} onToast={showToast} />
                        : activeResource.name === 'chamados'
                          ? (row) => (
                              // Consulta de Chamados: abre o chamado em Chamados Ativos (onde ele é atendido)
                              <BotaoAcao
                                icone={Headset}
                                titulo="Abrir"
                                descricao="Abre o chamado em Chamados Ativos"
                                onClick={() => {
                                  setChamadoAbrir(Number(row.id));
                                  navegar('chamados_ativos');
                                }}
                              />
                            )
                        : activeResource.name === 'atividades'
                          ? (row, { recarregar }) => {
                              const pendente = !Number(row.concluida);
                              // Menu "...": Concluir (pendente), Conversa do Bot, Registrar retorno (ligação da pesquisa), Gerar OS; Editar e Excluir vêm depois
                              return (
                                <>
                                  {pendente && <AcaoConcluir registro={row} onFeito={() => (showToast('Atividade concluída.'), recarregar())} />}
                                  {Number(row.executor_bot) === 1 && <AcaoConversaBot atividadeId={row.id as string} />}
                                  {pendente && row.origem === 'pesquisa' && row.tipo === 'ligacao' && (
                                    <AcaoRetornoLigacao atividadeId={row.id as string} onGravado={() => (showToast('Retorno registrado.'), recarregar())} />
                                  )}
                                  {podeAcessar(usuario, 'ordens_servico') && (
                                    <AcaoGerarOS
                                      registro={row}
                                      onGerada={(os) => {
                                        showToast(`OS nº ${os.numero} gerada.`);
                                        navegarRegistro('ordens_servico', os.id);
                                      }}
                                    />
                                  )}
                                </>
                              );
                            }
                          : activeResource.name === 'ordens_servico'
                            ? (row, { recarregar }) => (
                                <>
                                  <BotaoAcao
                                    icone={Printer}
                                    titulo="Imprimir"
                                    descricao="Abre a OS numa aba para imprimir: o técnico leva, anota o que fez e o cliente assina"
                                    onClick={() => imprimirOS(row.id as string, showToast)}
                                  />
                                  <AcaoEncerrarOS registro={row} onFeito={() => (showToast('OS encerrada.'), recarregar())} />
                                </>
                              )
                          : undefined
              }
              acoesDetalhe={(recurso, row, { recarregar }) =>
                recurso === 'pessoas_contatos' ? (
                  <BotaoWhatsApp temNumero={Boolean(row.whatsapp || row.celular || row.telefone)} onAbrir={() => pedirConversa({ contatoId: row.id as string })} />
                ) : recurso === 'campanha_disparos' ? (
                  <>
                    <BotaoEnviarDisparo registro={row} onEnviado={recarregar} onToast={showToast} />
                    {row.canal === 'whatsapp' && (
                      <BotaoWhatsApp temNumero={Boolean(row.destino)} titulo="Ver conversa" onAbrir={() => pedirConversa({ telefone: row.destino as string })} />
                    )}
                  </>
                ) : null
              }
            />
            {gerarOSDe && (
              <ConfirmarGerarOS
                registro={gerarOSDe}
                onFechar={() => setGerarOSDe(null)}
                onGerada={(os) => {
                  showToast(`OS nº ${os.numero} gerada.`);
                  navegarRegistro('ordens_servico', os.id);
                }}
              />
            )}
          </main>
        ) : (
          <main className="flex-1 overflow-y-auto min-h-0 w-full">
            <div className="px-4 sm:px-6 lg:px-8 py-6">
              {activeTab === 'dashboard' ? (
                <Dashboard data={dashboard} isLoading={isDashboardLoading} error={dashboardError} onNavigate={navegar} />
              ) : (
                <div className="py-24 text-center text-sm text-stone-500 dark:text-stone-400">Carregando a estrutura da tela…</div>
              )}
            </div>
          </main>
        )}
      </div>
    </div>
  );
}
