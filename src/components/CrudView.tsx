import { createPortal } from 'react-dom';
import { SelectAuto } from './SelectAuto';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Grade, ModoLargura, TamanhoCampo, lerConfigLista, salvarConfigLista } from '../utils/configListas';
import {
  Search,
  Pencil,
  Trash2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  CornerDownRight,
  ArrowUp,
  ArrowDown,
  Loader2,
  Inbox,
  Plus,
  Minus,
  X,
  List,
  FilePlus2,
  FileText,
  SlidersHorizontal,
  Menu,
} from 'lucide-react';
import { FieldDef, FiltroAvancado, OpcaoRef, RegistroCrud, ResourceDef } from '../types';
import {
  listRecords,
  createRecord,
  updateRecord,
  deleteRecord,
  fetchOptions,
  invalidateOptions,
  fetchCamposPersonalizados,
  getRecord,
} from '../services/api';
import { RecordForm } from './RecordForm';
import { Toggle } from './Toggle';
import { CellValue } from './CellValue';
import { DetailPanel } from './DetailPanel';
import { FichaPanel } from './FichaPanel';
import { AgendaCalendario, VisaoCalendario } from './AgendaCalendario';
import { podeExcluirAtividade } from '../utils/crm';
import { AdvancedSearch } from './AdvancedSearch';
import { BotaoAcao, MenuAcoes, SeparadorAcoes } from './MenuAcoes';
import { ConfirmDialog } from './ConfirmDialog';
import { INPUT_CLASS } from '../utils/formStyles';
import { AvisoErro } from './AvisoErro';

interface CrudViewProps {
  resource: ResourceDef;
  /** Definições de todos os recursos, usadas pelas grades de detalhe */
  allResources: ResourceDef[];
  /** Incrementado pelo Header para forçar recarga */
  refreshToken: number;
  onToast: (msg: string) => void;
  onCountChange: (resourceName: string, total: number) => void;
  /** Navegação para outra tela, usada pelo atalho do painel de detalhe */
  onNavigate: (resourceName: string) => void;
  /**
   * Editor próprio aberto na aba do registro, no lugar do formulário genérico
   * (ficha do negócio, editor de proposta e de pedido). `record` null = inclusão.
   */
  renderEditor?: (record: RegistroCrud | null, fechar: () => void, aoGravar: () => void) => React.ReactNode | null;
  /** Botões próprios do recurso na barra de ferramentas, ao lado do "Novo" */
  acoesLista?: (recarregar: () => void) => React.ReactNode;
  /** Botões extras da coluna Ações de cada linha (ex.: Clonar proposta) */
  acoesLinha?: (row: RegistroCrud, ctx: { abrir: (row: RegistroCrud) => void; recarregar: () => void }) => React.ReactNode;
  /** Agenda (Atividades): "Gerar OS" no botão direito da atividade */
  onGerarOS?: (row: RegistroCrud) => void;
  /** Ações da linha (as de acoesLinha, Editar e Excluir) num menu "..." com descrição, em vez de ícones soltos */
  acoesEmMenu?: boolean;
  /** Coluna estreita logo depois do indicador, com um botão rápido por linha (ex.: Concluir atividade) */
  colunaInicial?: { titulo: string; render: (row: RegistroCrud, ctx: { recarregar: () => void }) => React.ReactNode };
  /** Duplo clique na linha: devolve true se tratou (ex.: atividade abre a conversa que a gerou); senão abre a edição */
  aoDuploClique?: (row: RegistroCrud) => boolean;
  /** Botões extras nas linhas do painel de detalhes (ex.: WhatsApp do contato), por recurso filho */
  acoesDetalhe?: (recurso: string, row: RegistroCrud, ctx: { recarregar: () => void }) => React.ReactNode;
  /** Usuário logado (regras por usuário, ex.: quem pode excluir a atividade) */
  usuario?: { id: string; tipo: string } | null;
  /** Busca avançada com que a tela abre quando outra tela leva até ela; `seq` novo = aplicar de novo */
  filtrosIniciais?: { filtros: FiltroAvancado[]; seq: number } | null;
  /** Registro que abre numa aba de edição quando outra tela leva até ele (ex.: atividade → contrato); `seq` novo = abrir de novo */
  registroInicial?: { id: string | number; seq: number } | null;
  /** Lista embutida num editor: só os registros deste pai (ex.: atendimentos de uma pesquisa); o usuário não tira o filtro */
  filtroPai?: { campo: string; valor: string | number };
}

/** Uma aba aberta sobre um registro (inclusão ou edição) */
interface AbaRegistro {
  /** 'novo' para inclusão, ou 'edit:<id>' para edição */
  key: string;
  /** `null` quando é uma inclusão */
  record: RegistroCrud | null;
  titulo: string;
  /** Inclusão: valores iniciais além dos padrões do metadado (ex.: o dia clicado no calendário) */
  padrao?: Record<string, unknown>;
}

const LIST_TAB = 'lista';

/** Tipo de exibição na grade para cada tipo de campo personalizado */
const TIPO_COLUNA: Record<string, FieldDef['type']> = {
  texto: 'text',
  textarea: 'text',
  numero: 'number',
  decimal: 'decimal',
  data: 'date',
  boolean: 'boolean',
  lista: 'text',
};

const WIDTH_CLASS: Record<string, string> = {
  xs: 'w-16',
  sm: 'w-32',
  md: 'w-48',
  lg: 'w-80',
};

export const CrudView: React.FC<CrudViewProps> = ({
  resource,
  allResources,
  refreshToken,
  onToast,
  onCountChange,
  onNavigate,
  renderEditor,
  acoesLista,
  acoesLinha,
  onGerarOS,
  acoesEmMenu,
  colunaInicial,
  aoDuploClique,
  acoesDetalhe,
  usuario,
  filtrosIniciais,
  registroInicial,
  filtroPai,
}) => {
  /**
   * Campos personalizados marcados como "na lista" viram colunas virtuais: o valor
   * mora dentro do campo JSON do registro (ver CellValue).
   */
  const campoJson = useMemo(() => resource.fields.find((f) => f.type === 'personalizados'), [resource]);
  const [camposExtras, setCamposExtras] = useState<FieldDef[]>([]);
  /** Todos os campos personalizados (listados ou não): podem entrar na busca avançada */
  const [camposPersonalizados, setCamposPersonalizados] = useState<FieldDef[]>([]);
  useEffect(() => {
    if (!campoJson) {
      setCamposExtras([]);
      setCamposPersonalizados([]);
      return;
    }
    let vivo = true;
    fetchCamposPersonalizados()
      .then((lista) => {
        if (!vivo) return;
        const defs = lista.map((c) => ({
          name: `${campoJson.name}.${c.nome}`,
          label: c.rotulo,
          type: TIPO_COLUNA[c.tipo] || 'text',
          listed: Boolean(c.listado),
          json: { campo: campoJson.name, chave: c.nome },
        })) as FieldDef[];
        setCamposExtras(defs.filter((d) => d.listed));
        // Na busca avançada, a lista vira combo com as opções (igualdade exata)
        setCamposPersonalizados(
          defs.map((d, i) =>
            lista[i].tipo === 'lista'
              ? { ...d, type: 'enum', options: (lista[i].opcoes || []).map((op) => ({ value: op, label: op })) }
              : d,
          ),
        );
      })
      .catch(() => {
        if (!vivo) return;
        setCamposExtras([]);
        setCamposPersonalizados([]);
      });
    return () => {
      vivo = false;
    };
  }, [campoJson, refreshToken]);

  /** Campos de coluna do recurso; o campo JSON em si nunca vira coluna */
  const camposProprios = useMemo(
    () => resource.fields.filter((f) => f.type !== 'personalizados'),
    [resource],
  );

  // Colunas visíveis: as escolhidas pelo usuário (config_listas) ou, sem escolha, as marcadas
  // como listed. As colunas dos campos personalizados vêm sempre das Configurações.
  const [visiveis, setVisiveis] = useState<string[] | null>(null);
  const listedFields = useMemo(
    () => [
      ...camposProprios.filter((f) =>
        f.type === 'password' ? false : visiveis ? visiveis.includes(f.name) : f.listed,
      ),
      ...camposExtras,
    ],
    [camposProprios, camposExtras, visiveis],
  );

  const alternarColuna = (nome: string) =>
    setVisiveis((atual) => {
      const base = atual ?? camposProprios.filter((f) => f.listed).map((f) => f.name);
      return base.includes(nome) ? base.filter((n) => n !== nome) : [...base, nome];
    });

  // Ordem das colunas depois de arrastadas pelo usuário (só nesta sessão)
  const [ordem, setOrdem] = useState<string[]>([]);
  const arrastando = useRef<string | null>(null);

  const colunas = useMemo(() => {
    if (!ordem.length) return listedFields;
    const posicao = (nome: string) => {
      const i = ordem.indexOf(nome);
      return i < 0 ? ordem.length : i;
    };
    return [...listedFields].sort((a, b) => posicao(a.name) - posicao(b.name));
  }, [listedFields, ordem]);

  const soltarColuna = (destino: string) => {
    const origem = arrastando.current;
    arrastando.current = null;
    if (!origem || origem === destino) return;
    const nomes = colunas.map((f) => f.name).filter((n) => n !== origem);
    nomes.splice(nomes.indexOf(destino), 0, origem);
    setOrdem(nomes);
  };
  const refFields = useMemo(() => resource.fields.filter((f) => f.ref), [resource]);
  const isSearchable = useMemo(() => resource.fields.some((f) => f.searchable), [resource]);
  // Campos da busca avançada: os escolhidos pelo usuário (config_listas) ou, sem escolha, os filterable
  const [camposBusca, setCamposBusca] = useState<string[] | null>(null);
  const [ordemForm, setOrdemForm] = useState<string[]>([]);
  const [tamanhosForm, setTamanhosForm] = useState<Record<string, TamanhoCampo>>({});
  const camposBuscaAtuais = useMemo(
    () => [
      ...resource.fields
        .filter((f) => f.type !== 'password' && f.type !== 'imagem' && f.type !== 'fotos')
        .filter((f) => (camposBusca ? camposBusca.includes(f.name) : f.filterable))
        .map((f) => f.name),
      // Campos personalizados só quando escolhidos (lupa no formulário)
      ...camposPersonalizados.filter((f) => camposBusca?.includes(f.name)).map((f) => f.name),
    ],
    [resource, camposBusca, camposPersonalizados],
  );
  const alternarCampoBusca = (nome: string) =>
    setCamposBusca(() =>
      camposBuscaAtuais.includes(nome)
        ? camposBuscaAtuais.filter((n) => n !== nome)
        : [...camposBuscaAtuais, nome],
    );
  const temBuscaAvancada = camposBuscaAtuais.length > 0;

  /**
   * Recursos que possuem a coluna "ativo" abrem listando somente os ativos.
   * O operador pode ver os inativos (ou todos) pela busca avançada.
   */
  const filtroPadrao = useMemo<FiltroAvancado[]>(() => {
    const temAtivo = resource.fields.some((f) => f.name === 'ativo' && f.type === 'boolean');
    return temAtivo ? [{ field: 'ativo', op: 'eq', value: '1' }] : [];
  }, [resource]);

  /** Indica que os filtros atuais são exatamente o padrão "somente ativos" */
  const ehFiltroPadrao = (lista: FiltroAvancado[]) =>
    lista.length === 1 && lista[0].field === 'ativo' && lista[0].op === 'eq' && lista[0].value === '1';

  const [rows, setRows] = useState<RegistroCrud[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [sort, setSort] = useState(resource.defaultSort.field);

  // Larguras ajustadas pelo usuário ao arrastar a divisa do cabeçalho (só nesta sessão)
  const [larguras, setLarguras] = useState<Record<string, number>>({});
  const [menuColunas, setMenuColunas] = useState(false);
  /** Posição do submenu Colunas (fixa na tela; null = fechado) */
  const [subColunas, setSubColunas] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  /** Fechar com uma pequena espera: levar o mouse na diagonal até o submenu não o fecha */
  const fecharSubColunasTimer = useRef<number | null>(null);
  const cancelarFechamentoSubColunas = () => {
    if (fecharSubColunasTimer.current) window.clearTimeout(fecharSubColunasTimer.current);
    fecharSubColunasTimer.current = null;
  };
  const abrirSubColunas = (el: HTMLElement) => {
    cancelarFechamentoSubColunas();
    const r = el.getBoundingClientRect();
    const LARGURA = 288; // tem que bater com o w-72 do submenu
    // À direita do item; sem espaço, à esquerda. Altura até o pé da tela (mínimo 240px, subindo se preciso)
    const left = r.right - 4 + LARGURA > window.innerWidth ? Math.max(8, r.left - LARGURA + 4) : r.right - 4;
    const top = Math.max(8, Math.min(r.top, window.innerHeight - 248));
    setSubColunas({ top, left, maxHeight: window.innerHeight - top - 8 });
  };
  const [grade, setGrade] = useState<Grade>('horizontais');
  const [comSobra, setComSobra] = useState(true);
  const [modoLargura, setModoLargura] = useState<ModoLargura>('manual');

  // A borda existe sempre (só fica transparente), senão a altura da linha muda junto com a grade
  const bordasCelula = `border-b border-r ${
    grade === 'ambas' || grade === 'horizontais'
      ? 'border-b-stone-100 dark:border-b-stone-800/60'
      : 'border-b-transparent'
  } ${
    grade === 'ambas' || grade === 'verticais'
      ? 'border-r-stone-100 dark:border-r-stone-800/60'
      : 'border-r-transparent'
  }`;

  /** Números/moeda à direita, datas e Sim/Não centralizados, o resto à esquerda */
  const alinhamento = (tipo: string) =>
    tipo === 'number' || tipo === 'decimal'
      ? 'text-right'
      : tipo === 'date' || tipo === 'datetime' || tipo === 'boolean'
      ? 'text-center'
      : 'text-left';

  // Larguras/ordem vêm de usuarios.config_listas e voltam para lá quando mudam
  const configCarregada = useRef(false);
  useEffect(() => {
    configCarregada.current = false;
    let vivo = true;
    lerConfigLista(resource.name).then((cfg) => {
      if (!vivo) return;
      setLarguras(cfg.larguras || {});
      setOrdem(cfg.ordem || []);
      // Coluna criada depois da configuração salva: entra se for das listadas por padrão. Configuração antiga,
      // sem "conhecidas": vale o que estava visível (uma coluna padrão escondida volta até salvar de novo)
      const conhecidas = new Set(cfg.conhecidas ?? cfg.visiveis ?? []);
      setVisiveis(
        cfg.visiveis
          ? [...cfg.visiveis, ...camposProprios.filter((f) => f.listed && !conhecidas.has(f.name)).map((f) => f.name)]
          : null,
      );
      setCamposBusca(cfg.busca || null);
      setOrdemForm(cfg.ordemForm || []);
      setTamanhosForm(cfg.tamanhosForm || {});
      setGrade(cfg.grade || 'horizontais');
      setComSobra(cfg.sobra !== false);
      setModoLargura(cfg.modo || 'manual');
      configCarregada.current = true;
    });
    return () => {
      vivo = false;
    };
  }, [resource.name]);

  const salvarConfiguracao = () => {
    setMenuColunas(false);
    // Nos modos automáticos a largura é recalculada ao abrir, então não vale guardá-la:
    // a mesma lista pode abrir em outro monitor, com outra largura de tela.
    salvarConfigLista(resource.name, {
      visiveis: listedFields.filter((f) => !f.json).map((f) => f.name),
      conhecidas: camposProprios.map((f) => f.name),
      busca: camposBuscaAtuais,
      ordemForm: ordemForm.length ? ordemForm : undefined,
      tamanhosForm: Object.keys(tamanhosForm).length ? tamanhosForm : undefined,
      larguras: modoLargura === 'manual' ? larguras : undefined,
      ordem,
      grade,
      sobra: comSobra,
      modo: modoLargura,
    });
    onToast('Configuração salva.');
  };

  const tabelaRef = useRef<HTMLTableElement>(null);
  /** Posição da 1ª coluna de dados no cabeçalho: depois do indicador (e da coluna inicial, se houver) */
  const inicioColunas = colunaInicial ? 2 : 1;

  /**
   * Mede a largura que cada coluna teria só pelo conteúdo, ignorando as larguras
   * já aplicadas e o esticamento do w-full. Devolve [fixaEsquerda, ...colunas, acoes].
   */
  const medirColunas = (): number[] | null => {
    const tabela = tabelaRef.current;
    if (!tabela) return null;
    const cabecalhos = Array.from(tabela.querySelectorAll('thead th')) as HTMLElement[];
    const celulas = Array.from(tabela.querySelectorAll('tbody tr:first-child > td')) as HTMLElement[];
    const anteriores = [...cabecalhos, ...celulas].map((c) => c.style.width);
    [...cabecalhos, ...celulas].forEach((c) => {
      c.style.width = '';
      c.style.maxWidth = '';
    });
    const larguraTabela = tabela.style.width;
    tabela.style.width = 'max-content';
    const medidas = cabecalhos.map((th) => th.offsetWidth);
    tabela.style.width = larguraTabela;
    [...cabecalhos, ...celulas].forEach((c, i) => {
      c.style.width = anteriores[i];
    });
    return medidas;
  };

  /** Cada coluna com a largura do seu conteúdo (a de Ações e a do indicador ficam como estão) */
  const aplicarMelhorLargura = () => {
    setComSobra(true);
    const medidas = medirColunas();
    if (!medidas) return;
    setLarguras(
      Object.fromEntries(colunas.map((f, i) => [f.name, Math.max(60, medidas[i + inicioColunas])])),
    );
  };

  /**
   * Divide todo o espaço livre entre as colunas, na proporção do que cada uma ocupa hoje:
   * lista com poucas colunas fica com colunas largas; com muitas, colunas estreitas (mín. 50px).
   * Mede como está na tela (e não o conteúdo), porque a sobra vive na coluna vazia do fim.
   */
  const aplicarAjustarLargura = () => {
    setComSobra(false);
    const tabela = tabelaRef.current;
    const area = tabela?.parentElement;
    if (!tabela || !area) return;
    const cabecalhos = Array.from(tabela.querySelectorAll('thead th')) as HTMLElement[];
    const atuais = cabecalhos.slice(inicioColunas, inicioColunas + colunas.length).map((th) => th.offsetWidth);
    const soma = atuais.reduce((a, b) => a + b, 0);
    const fixas = cabecalhos.slice(0, inicioColunas).reduce((a, th) => a + th.offsetWidth, 0) + cabecalhos[cabecalhos.length - 1].offsetWidth;
    const disponivel = area.clientWidth - fixas - 1;
    if (soma <= 0 || disponivel <= 0) return;
    const fator = disponivel / soma;
    const finais = atuais.map((largura) => Math.max(50, Math.floor(largura * fator)));
    const resto = disponivel - finais.reduce((a, b) => a + b, 0);
    if (resto > 0) finais[finais.length - 1] += resto;
    setLarguras(Object.fromEntries(colunas.map((f, i) => [f.name, finais[i]])));
  };

  // Nos modos automáticos a largura é recalculada: ao abrir a lista, quando as linhas
  // chegam e quando a janela muda de tamanho (outro monitor, por exemplo).
  useEffect(() => {
    if (modoLargura === 'manual') return;
    const aplicar = () =>
      modoLargura === 'ajustar' ? aplicarAjustarLargura() : aplicarMelhorLargura();
    const id = requestAnimationFrame(aplicar);
    window.addEventListener('resize', aplicar);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener('resize', aplicar);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modoLargura, colunas, rows]);

  const iniciarRedimensionamento = (e: React.PointerEvent, campo: string) => {
    e.preventDefault();
    e.stopPropagation();
    setModoLargura('manual');

    const tabela = tabelaRef.current;
    if (!tabela) return;
    const cabecalhos = Array.from(tabela.querySelectorAll('thead th')) as HTMLElement[];
    // Congela as larguras atuais: sem isso o navegador redistribui a sobra e o arraste "escorrega"
    const base = cabecalhos.slice(1, 1 + colunas.length).map((th) => th.offsetWidth);
    const indice = colunas.findIndex((f) => f.name === campo);
    const xInicial = e.clientX;

    const mover = (ev: PointerEvent) => {
      const finais = [...base];
      finais[indice] = Math.max(50, base[indice] + ev.clientX - xInicial);
      // Sem coluna de sobra, quem cede espaço é a coluna seguinte, para o total não mudar
      if (!comSobra && indice < finais.length - 1) {
        finais[indice + 1] = Math.max(50, base[indice + 1] - (finais[indice] - base[indice]));
      }
      setLarguras(Object.fromEntries(colunas.map((f, i) => [f.name, finais[i]])));
    };

    const soltar = () => {
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
      document.body.style.cursor = '';
    };
    document.body.style.cursor = 'col-resize';
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
  };
  const [dir, setDir] = useState<'asc' | 'desc'>(resource.defaultSort.dir);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Busca avançada: painel aberto e filtros aplicados
  const [buscaAvancadaAberta, setBuscaAvancadaAberta] = useState(false);
  const [filtros, setFiltros] = useState<FiltroAvancado[]>(filtroPadrao);
  /** Filtros rápidos (Só as minhas, Sim/Não, toggle "mostrar"): a última escolha fica lembrada neste navegador */
  const lerLocal = (chave: string, padrao: string): string => {
    try {
      return localStorage.getItem(`crmweb.${chave}.${resource.name}`) ?? padrao;
    } catch {
      return padrao;
    }
  };
  const gravarLocal = (chave: string, valor: string) => {
    try {
      localStorage.setItem(`crmweb.${chave}.${resource.name}`, valor);
    } catch {
      /* sem armazenamento: vale só nesta tela */
    }
  };
  /** Só as do usuário logado (recursos com o filtro "minhas", ex.: atividades) */
  const [minhas, setMinhas] = useState(() => lerLocal('minhas', '0') === '1');
  /** Filtro rápido Sim/Não do recurso ('' = todas, '1' = sim, '0' = não) */
  const [rapido, setRapido] = useState<string>(() => lerLocal('rapido', resource.filtroRapidoPadrao ?? ''));
  const campoRapido = resource.filtroRapido ? resource.fields.find((f) => f.name === resource.filtroRapido) : undefined;
  /** Toggle "mostrar" do recurso (ex.: atividades do bot) */
  const [mostrar, setMostrar] = useState(() => lerLocal('mostrar', '1') !== '0');

  /** Lista ou calendário (resource.calendario); a escolha fica lembrada neste navegador */
  const chaveVisao = `crmweb.visao.${resource.name}`;
  const lerVisao = (): 'lista' | VisaoCalendario => {
    if (!resource.calendario) return 'lista';
    try {
      const v = localStorage.getItem(chaveVisao);
      return v === 'semana' || v === 'mes' ? v : 'lista';
    } catch {
      return 'lista';
    }
  };
  const [visao, setVisao] = useState<'lista' | VisaoCalendario>(lerVisao);
  /** Ficha embaixo recolhida: entra recolhida ao trocar para Semana/Mês; abre de novo ao escolher outro registro */
  const [fichaRecolhida, setFichaRecolhida] = useState(false);
  const trocarVisao = (v: 'lista' | VisaoCalendario) => {
    setVisao(v);
    if (v !== 'lista') setFichaRecolhida(true);
    try {
      localStorage.setItem(chaveVisao, v);
    } catch {
      // sem armazenamento: vale só até recarregar
    }
  };

  const [refOptions, setRefOptions] = useState<Record<string, OpcaoRef[]>>({});

  // Abas abertas e aba ativa
  const [abas, setAbas] = useState<AbaRegistro[]>([]);
  const [abaAtiva, setAbaAtiva] = useState<string>(LIST_TAB);

  const [deleting, setDeleting] = useState<RegistroCrud | null>(null);

  // Linha selecionada que alimenta o painel mestre-detalhe
  const [selecionado, setSelecionado] = useState<RegistroCrud | null>(null);

  /** O mestre-detalhe exige detalhes declarados e chave primária simples */
  const temGrades = Boolean(resource.details?.length) && resource.pk.length === 1;
  /** Painel embaixo da lista: grades filhas ou a ficha do registro (resource.ficha) */
  const temDetalhe = temGrades || Boolean(resource.ficha);

  const recordId = useCallback(
    (row: RegistroCrud) => resource.pk.map((c) => row[c]).join('~'),
    [resource.pk],
  );

  /** Rótulo curto do registro, usado no título da aba */
  const recordLabel = useCallback(
    (row: RegistroCrud) => {
      const raw = row[resource.labelField];
      const texto = raw === null || raw === undefined || raw === '' ? `#${recordId(row)}` : String(raw);
      return texto.length > 28 ? `${texto.slice(0, 28)}…` : texto;
    },
    [resource.labelField, recordId],
  );

  // Ao trocar de recurso, reinicia a grade e fecha as abas do recurso anterior
  useEffect(() => {
    setPage(1);
    setSearch('');
    setSearchInput('');
    setSort(resource.defaultSort.field);
    setDir(resource.defaultSort.dir);
    setError(null);
    setAbas([]);
    setAbaAtiva(LIST_TAB);
    setSelecionado(null);
    setFiltros(filtroPadrao);
    setRapido(lerLocal('rapido', resource.filtroRapidoPadrao ?? ''));
    setMinhas(lerLocal('minhas', '0') === '1');
    setMostrar(lerLocal('mostrar', '1') !== '0');
    setBuscaAvancadaAberta(false);
    setVisao(lerVisao());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resource.name, resource.defaultSort.field, resource.defaultSort.dir, resource.filtroRapidoPadrao, filtroPadrao]);

  // Chegou de outra tela com filtro (depois do reinício acima, que zera os filtros): aplica e mostra no resumo
  useEffect(() => {
    if (!filtrosIniciais) return;
    setFiltros(filtrosIniciais.filtros);
    setPage(1);
    setBuscaAvancadaAberta(false);
  }, [filtrosIniciais?.seq]); // eslint-disable-line react-hooks/exhaustive-deps

  // A seleção do mestre-detalhe não sobrevive a uma troca de página ou de busca
  useEffect(() => {
    setSelecionado(null);
  }, [page, search, filtros]);

  // Lista com detalhe já abre com o painel: sem seleção, vale a primeira linha.
  // Fechado no X, o painel só volta quando o usuário escolhe uma linha.
  const painelFechado = useRef(false);
  // Outro registro escolhido: a ficha volta a abrir
  const idSelecionado = selecionado ? recordId(selecionado) : null;
  useEffect(() => setFichaRecolhida(false), [idSelecionado]);
  useEffect(() => {
    // No calendário, a ficha só abre quando o usuário escolhe uma atividade
    if (temDetalhe && visao === 'lista' && !selecionado && !painelFechado.current && rows.length) setSelecionado(rows[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, temDetalhe, visao]);

  /** Muda quando uma ação da lista (ex.: importação) pode ter criado registros referenciados */
  const [versaoCombos, setVersaoCombos] = useState(0);

  // Carrega os combos de chave estrangeira do recurso
  useEffect(() => {
    let alive = true;
    if (!refFields.length) {
      setRefOptions({});
      return;
    }

    (async () => {
      const map: Record<string, OpcaoRef[]> = {};
      for (const f of refFields) {
        try {
          map[f.name] = await fetchOptions(f.ref!.resource, f.ref!.labelField);
        } catch {
          map[f.name] = [];
        }
      }
      if (alive) setRefOptions(map);
    })();

    return () => {
      alive = false;
    };
  }, [refFields, refreshToken, versaoCombos]);

  // ----------------------------------------------------------
  // Lista em árvore (ex.: versões da proposta): só as raízes na página; os filhos de cada
  // raiz vêm ao expandir. Com busca ou filtro a lista volta a ser plana, para achar
  // qualquer registro direto.
  // ----------------------------------------------------------
  const modoArvore = Boolean(resource.arvore) && !search && filtros.length === 0;
  /** Filhos das raízes expandidas, pelo id da raiz */
  const [filhos, setFilhos] = useState<Record<string, RegistroCrud[]>>({});
  const filhosRef = useRef(filhos);
  filhosRef.current = filhos;

  const lerFilhos = useCallback(
    async (raiz: RegistroCrud) => {
      const { grupo, ordem } = resource.arvore!;
      const d = await listRecords(resource.name, {
        filterField: grupo,
        filterValue: String(raiz[grupo]),
        sort: ordem,
        dir: 'asc',
        limit: 200,
      });
      return d.data.filter((r) => String(r[resource.pk[0]]) !== String(raiz[resource.pk[0]]));
    },
    [resource],
  );

  const alternarFilhos = async (raiz: RegistroCrud) => {
    const id = String(raiz[resource.pk[0]]);
    if (filhos[id]) {
      setFilhos(({ [id]: _, ...resto }) => resto);
      return;
    }
    try {
      const lista = await lerFilhos(raiz);
      setFilhos((f) => ({ ...f, [id]: lista }));
    } catch (err: any) {
      setError(err.message || 'Falha ao carregar as versões.');
    }
  };

  /** Filtros da busca avançada + filtro rápido: a lista e o calendário usam os mesmos */
  const filtrosEfetivos = useMemo<FiltroAvancado[]>(
    () => [
      ...filtros,
      ...(campoRapido && rapido ? [{ field: campoRapido.name, op: 'eq', value: rapido } as FiltroAvancado] : []),
      ...(resource.toggleMostrar && !mostrar ? resource.toggleMostrar.ocultar : []),
    ],
    [filtros, campoRapido, rapido, resource.toggleMostrar, mostrar],
  );

  /** Número da carga mais recente: uma resposta atrasada (ex.: a de antes de um filtro mudar) não sobrescreve a nova */
  const ultimaCarga = useRef(0);

  const load = useCallback(async () => {
    const carga = ++ultimaCarga.current;
    const valeAinda = () => carga === ultimaCarga.current;
    setIsLoading(true);
    setError(null);
    try {
      const data = await listRecords(resource.name, {
        page,
        limit,
        search,
        sort,
        dir,
        filters: visao === 'lista' && resource.filtroLista ? [...filtrosEfetivos, resource.filtroLista] : filtrosEfetivos,
        filterField: filtroPai?.campo,
        filterValue: filtroPai == null ? undefined : String(filtroPai.valor),
        arvore: modoArvore ? 'raizes' : undefined,
        minhas,
      });
      if (!valeAinda()) return;
      setRows(data.data);
      // Raízes que continuam na página e estavam abertas: relê os filhos (podem ter mudado)
      if (modoArvore) {
        const abertas = data.data.filter((r) => filhosRef.current[String(r[resource.pk[0]])]);
        const novos: Record<string, RegistroCrud[]> = {};
        for (const r of abertas) novos[String(r[resource.pk[0]])] = await lerFilhos(r).catch(() => []);
        if (!valeAinda()) return;
        setFilhos(novos);
      } else setFilhos({});
      setTotal(data.total);
      setTotalPages(data.totalPages);
      onCountChange(resource.name, data.total);
    } catch (err: any) {
      if (!valeAinda()) return;
      setError(err.message || 'Falha ao carregar os registros.');
      setRows([]);
    } finally {
      if (valeAinda()) setIsLoading(false);
    }
  }, [resource.name, page, limit, search, sort, dir, filtrosEfetivos, minhas, onCountChange, modoArvore, lerFilhos, resource.pk, visao, resource.filtroLista]);

  useEffect(() => {
    load();
  }, [load, refreshToken]);

  /** Ação da linha (ex.: Gerar disparos) mudou algo: recarrega a lista e também o painel de detalhe */
  const [versaoDetalhe, setVersaoDetalhe] = useState(0);
  const recarregarComDetalhe = useCallback(() => {
    load();
    setVersaoDetalhe((v) => v + 1);
  }, [load]);

  // ----------------------------------------------------------
  // Gestão das abas
  // ----------------------------------------------------------
  /** Sem `padrao`, reaproveita a inclusão já aberta; com ele (ex.: outro dia no calendário), recomeça com os valores novos */
  const abrirAbaNovo = useCallback(
    (padrao?: Record<string, unknown>) => {
      setAbas((prev) =>
        prev.some((a) => a.key === 'novo')
          ? padrao
            ? prev.map((a) => (a.key === 'novo' ? { ...a, padrao } : a))
            : prev
          : [...prev, { key: 'novo', record: null, titulo: `Novo ${resource.labelSingular}`, padrao }],
      );
      setAbaAtiva('novo');
    },
    [resource.labelSingular],
  );

  const abrirAbaEdicao = useCallback(
    (row: RegistroCrud) => {
      const key = `edit:${recordId(row)}`;
      setAbas((prev) => {
        const existente = prev.find((a) => a.key === key);
        // Reabre com os dados mais recentes da grade
        if (existente) return prev.map((a) => (a.key === key ? { ...a, record: row } : a));
        return [...prev, { key, record: row, titulo: recordLabel(row) }];
      });
      setAbaAtiva(key);
    },
    [recordId, recordLabel],
  );

  const fecharAba = useCallback(
    (key: string) => {
      setAbas((prev) => {
        const idx = prev.findIndex((a) => a.key === key);
        const restantes = prev.filter((a) => a.key !== key);
        // Ao fechar a aba ativa, foca a vizinha à esquerda (ou a listagem)
        setAbaAtiva((atual) => {
          if (atual !== key) return atual;
          if (!restantes.length) return LIST_TAB;
          return restantes[Math.max(0, idx - 1)].key;
        });
        return restantes;
      });
    },
    [],
  );

  // Chegou de outra tela para um registro: busca e abre na aba de edição
  useEffect(() => {
    if (!registroInicial) return;
    getRecord(resource.name, registroInicial.id)
      .then(abrirAbaEdicao)
      .catch((err) => onToast(err.message || `${resource.labelSingular} não encontrado.`));
  }, [registroInicial?.seq]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSort = (fieldName: string) => {
    if (sort === fieldName) {
      setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSort(fieldName);
      setDir('asc');
    }
    setPage(1);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput.trim());
    setPage(1);
  };

  const handleSave = async (aba: AbaRegistro, payload: RegistroCrud) => {
    if (aba.record) {
      const r = await updateRecord(resource.name, recordId(aba.record), payload);
      onToast(`${resource.labelSingular} atualizado com sucesso.${r.aviso ? ` ${r.aviso}` : ''}`);
    } else {
      const r = await createRecord(resource.name, payload);
      onToast(`${resource.labelSingular} incluído com sucesso.${r.aviso ? ` ${r.aviso}` : ''}`);
    }
    invalidateOptions(resource.name);
    fecharAba(aba.key);
    await load();
  };

  const handleDelete = async () => {
    if (!deleting) return;
    const id = recordId(deleting);
    await deleteRecord(resource.name, id);
    invalidateOptions(resource.name);
    onToast(`${resource.labelSingular} excluído com sucesso.`);
    setDeleting(null);
    // Fecha a aba do registro excluído, se estiver aberta, e a ficha dele embaixo da lista
    fecharAba(`edit:${id}`);
    if (selecionado && recordId(selecionado) === id) setSelecionado(null);
    if (rows.length === 1 && page > 1) setPage((p) => p - 1);
    else await load();
  };

  // Largura do conteúdo (w-px + nowrap): cada tela tem uma quantidade de ícones de ação
  const larguraAcoes = 'w-px whitespace-nowrap';
  const firstRecord = (page - 1) * limit + 1;
  const lastRecord = Math.min(page * limit, total);
  const abaAtual = abas.find((a) => a.key === abaAtiva) || null;
  // Editor próprio da tela; null = usa o formulário genérico
  const editorProprio =
    abaAtual && renderEditor
      ? renderEditor(abaAtual.record, () => fecharAba(abaAtual.key), () => {
          invalidateOptions(resource.name);
          load();
        })
      : null;

  // ----------------------------------------------------------
  // Barra de abas — só aparece quando há algum registro aberto,
  // para a listagem não exibir uma "orelha" solitária.
  // ----------------------------------------------------------
  const tabBar = (
    <div className="flex items-stretch bg-stone-100 dark:bg-stone-950 border-b border-stone-200 dark:border-stone-800 overflow-x-auto overflow-y-hidden shrink-0">
      {/* Aba fixa da listagem */}
      <button
        onClick={() => setAbaAtiva(LIST_TAB)}
        className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold whitespace-nowrap border-r border-stone-200 dark:border-stone-800 border-b-2 transition-colors cursor-pointer ${
          abaAtiva === LIST_TAB
            ? 'bg-white dark:bg-stone-900 text-blue-700 dark:text-blue-400 border-b-blue-600'
            : 'border-b-transparent text-stone-600 dark:text-stone-400 hover:bg-stone-200/60 dark:hover:bg-stone-800/60'
        }`}
      >
        <List className="w-3.5 h-3.5" />
        <span>{resource.label}</span>
        <span className="text-[10px] font-mono text-stone-400">{total}</span>
      </button>

      {/* Abas de registro */}
      {abas.map((aba) => {
        const ativa = abaAtiva === aba.key;
        const isNovo = aba.record === null;
        return (
          <div
            key={aba.key}
            className={`flex items-center gap-1.5 pl-4 pr-2 border-r border-stone-200 dark:border-stone-800 border-b-2 transition-colors ${
              ativa
                ? 'bg-white dark:bg-stone-900 border-b-blue-600'
                : 'border-b-transparent hover:bg-stone-200/60 dark:hover:bg-stone-800/60'
            }`}
          >
            <button
              onClick={() => setAbaAtiva(aba.key)}
              className={`flex items-center gap-2 py-2.5 text-xs font-semibold whitespace-nowrap cursor-pointer ${
                ativa
                  ? 'text-blue-700 dark:text-blue-400'
                  : 'text-stone-600 dark:text-stone-400'
              }`}
            >
              {isNovo ? <FilePlus2 className="w-3.5 h-3.5" /> : <FileText className="w-3.5 h-3.5" />}
              <span>{aba.titulo}</span>
            </button>
            <button
              onClick={() => fecharAba(aba.key)}
              title="Fechar aba"
              className="p-1 rounded text-stone-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:text-rose-400 dark:hover:bg-rose-950/40 transition-colors cursor-pointer shrink-0"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        );
      })}
    </div>
  );

  // ----------------------------------------------------------
  // Painel de listagem
  // ----------------------------------------------------------
  /** Uma linha da grade; nivel 1 = filho de uma raiz da árvore */
  const linhaGrade = (row: RegistroCrud, nivel: 0 | 1) => {
                const id = recordId(row);
                const abertaEmAba = abas.some((a) => a.key === `edit:${id}`);
                const estaSelecionada = temDetalhe && selecionado !== null && recordId(selecionado) === id;
                return (
                  <tr
                    key={id}
                    onClick={
                      temDetalhe
                        ? () => {
                            painelFechado.current = false;
                            setSelecionado(row);
                          }
                        : undefined
                    }
                    onDoubleClick={() => !aoDuploClique?.(row) && resource.canUpdate && abrirAbaEdicao(row)}
                    className={`group transition-colors ${temDetalhe ? 'cursor-pointer' : ''} ${
                      estaSelecionada
                        ? 'bg-blue-100 dark:bg-blue-950'
                        : abertaEmAba
                        ? 'bg-blue-50 dark:bg-stone-800'
                        : nivel === 1
                        ? 'bg-stone-50 dark:bg-stone-900/60 hover:bg-stone-100 dark:hover:bg-stone-800'
                        : 'bg-white dark:bg-stone-900 hover:bg-stone-50 dark:hover:bg-stone-800'
                    }`}
                  >
                    <td className={`sticky left-0 z-[5] w-[30px] min-w-[30px] max-w-[30px] px-0 text-center align-middle bg-inherit border-r border-stone-200 dark:border-stone-800 ${bordasCelula}`}>
                      <ChevronRight
                        className={`w-3.5 h-3.5 mx-auto ${
                          estaSelecionada || abertaEmAba
                            ? 'text-blue-600 dark:text-blue-400'
                            : 'text-stone-300 opacity-0 group-hover:opacity-100 dark:text-stone-600'
                        }`}
                      />
                    </td>
                    {colunaInicial && (
                      <td
                        className={`w-[34px] min-w-[34px] max-w-[34px] px-0 text-center align-middle border-r border-stone-100 dark:border-stone-800/60 ${bordasCelula}`}
                        onClick={(e) => e.stopPropagation()}
                        onDoubleClick={(e) => e.stopPropagation()}
                      >
                        {colunaInicial.render(row, { recarregar: recarregarComDetalhe })}
                      </td>
                    )}
                    {colunas.map((f, iCol) => (
                      <td
                        key={f.name}
                        style={larguras[f.name] ? { width: larguras[f.name], maxWidth: larguras[f.name] } : undefined}
                        className={`px-3 py-[7.5px] ${
                          // Filhos da árvore (ex.: versões da proposta) com a letra um pouco mais clara;
                          // raiz com filhos (proposta com outras versões) em azul
                          nivel === 1
                            ? 'text-stone-500 dark:text-stone-400'
                            : modoArvore && Number(row.qtd_versoes) > 1
                            ? 'text-blue-700 dark:text-blue-400'
                            : 'text-stone-700 dark:text-stone-300'
                        } align-middle max-w-xs truncate ${bordasCelula} ${alinhamento(f.type)}`}
                      >
                        {modoArvore && iCol === 0 ? (
                          // Primeira coluna da árvore: seta para abrir os filhos, ou o recuo do filho
                          <div className="flex items-center gap-1.5">
                            {nivel === 1 ? (
                              <CornerDownRight className="w-3.5 h-3.5 ml-2 shrink-0 text-stone-300 dark:text-stone-600" />
                            ) : Number(row.qtd_versoes) > 1 ? (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  alternarFilhos(row);
                                }}
                                onDoubleClick={(e) => e.stopPropagation()}
                                title={filhos[String(id)] ? 'Esconder as outras versões' : `Mostrar as outras versões (${Number(row.qtd_versoes) - 1})`}
                                className="p-0.5 -ml-1 rounded shrink-0 text-stone-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 cursor-pointer"
                              >
                                {filhos[String(id)] ? <Minus className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                              </button>
                            ) : (
                              <span className="w-3.5 shrink-0" />
                            )}
                            <span className="flex-1 min-w-0 truncate">
                              <CellValue field={f} row={row} refOptions={refOptions} />
                            </span>
                          </div>
                        ) : (
                          <CellValue field={f} row={row} refOptions={refOptions} />
                        )}
                      </td>
                    ))}
                    {comSobra && <td className={`w-full ${bordasCelula}`} />}
                    <td className={`sticky right-0 z-[5] ${larguraAcoes} px-3 py-[7.5px] text-center whitespace-nowrap bg-inherit border-l border-stone-200 dark:border-stone-800 ${bordasCelula}`}>
                      {acoesEmMenu ? (
                        <MenuAcoes>
                          {acoesLinha?.(row, { abrir: abrirAbaEdicao, recarregar: recarregarComDetalhe })}
                          {(resource.canUpdate || resource.canDelete) && <SeparadorAcoes />}
                          {resource.canUpdate && (
                            <BotaoAcao icone={Pencil} titulo="Editar" descricao="Abre o registro numa aba de edição" onClick={() => abrirAbaEdicao(row)} />
                          )}
                          {resource.canDelete && (
                            <BotaoAcao icone={Trash2} titulo="Excluir" descricao="Apaga o registro (pede confirmação)" tom="perigo" onClick={() => setDeleting(row)} />
                          )}
                        </MenuAcoes>
                      ) : (
                      <div className="inline-flex items-center gap-1">
                        {acoesLinha?.(row, { abrir: abrirAbaEdicao, recarregar: recarregarComDetalhe })}
                        {resource.canUpdate && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              abrirAbaEdicao(row);
                            }}
                            title="Editar em nova aba"
                            className="p-1 rounded text-stone-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:text-blue-400 dark:hover:bg-blue-950/40 transition-colors cursor-pointer"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {resource.canDelete && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleting(row);
                            }}
                            title="Excluir registro"
                            className="p-1 rounded text-stone-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:text-rose-400 dark:hover:bg-rose-950/40 transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      )}
                    </td>
                  </tr>
                );
  };

  const listPanel = (
    <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-stone-900">
      {/* Barra de ferramentas, encostada na barra de abas */}
      <div className="px-4 py-2.5 border-b border-stone-200 dark:border-stone-800 flex items-center justify-between gap-3 shrink-0 bg-white dark:bg-stone-900 overflow-x-auto overflow-y-hidden">
        <div className="text-[11px] text-stone-500 dark:text-stone-400 truncate min-w-0">
          {isLoading
            ? 'Carregando registros…'
            : total === 0
            ? 'Nenhum registro encontrado'
            : `${firstRecord}–${lastRecord} de ${total} registro(s) • tabela ${resource.table}`}
          {visao === 'lista' && resource.filtroLista && ` • ${resource.filtroLista.aviso}`}
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {isSearchable && (
            <form onSubmit={handleSearchSubmit} className="relative w-52 sm:w-64 shrink-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 pointer-events-none" />
              <input
                id={`busca-${resource.name}`}
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Buscar…"
                className={`${INPUT_CLASS} w-full pl-9 pr-8`}
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchInput('');
                    setSearch('');
                    setPage(1);
                  }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </form>
          )}

          {temBuscaAvancada && (
            <button
              onClick={() => setBuscaAvancadaAberta((a) => !a)}
              title="Filtrar por categoria, situação, faixa de preço e outros campos"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer shrink-0 whitespace-nowrap ${
                buscaAvancadaAberta || filtros.length > 0
                  ? 'bg-blue-50 border-blue-300 text-blue-700 dark:bg-blue-950/40 dark:border-blue-800 dark:text-blue-300'
                  : 'border-stone-300 text-stone-600 hover:bg-stone-100 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>Busca avançada</span>
              {filtros.length > 0 && (
                <span className="bg-blue-600 text-white text-[10px] font-bold px-1.5 rounded-full">
                  {filtros.length}
                </span>
              )}
            </button>
          )}

          {campoRapido && (
            <label className="shrink-0 flex items-center gap-1.5 text-xs font-semibold text-stone-600 dark:text-stone-300">
              {campoRapido.label}
              <SelectAuto
                value={rapido}
                onChange={(e) => {
                  setRapido(e.target.value);
                  gravarLocal('rapido', e.target.value);
                  setPage(1);
                }}
                className={`${INPUT_CLASS} py-1 cursor-pointer`}
              >
                <option value="">Todas</option>
                <option value="1">Sim</option>
                <option value="0">Não</option>
              </SelectAuto>
            </label>
          )}

          {resource.minhas && (
            <span title="As atividades do seu usuário, as do seu departamento e as de qualquer pessoa" className="shrink-0 flex items-center pl-3 border-l border-stone-200 dark:border-stone-700">
              <Toggle
                size="sm"
                checked={minhas}
                onChange={(v) => {
                  setMinhas(v);
                  gravarLocal('minhas', v ? '1' : '0');
                  setPage(1);
                }}
                label="Só as minhas"
              />
            </span>
          )}

          {resource.toggleMostrar && (
            <span title={resource.toggleMostrar.dica} className="shrink-0 flex items-center pl-3 border-l border-stone-200 dark:border-stone-700">
              <Toggle
                size="sm"
                checked={mostrar}
                onChange={(v) => {
                  setMostrar(v);
                  setPage(1);
                  gravarLocal('mostrar', v ? '1' : '0');
                }}
                label={resource.toggleMostrar.label}
              />
            </span>
          )}

          {resource.calendario && (
            <div className="inline-flex gap-0.5 p-0.5 rounded-lg bg-stone-100 dark:bg-stone-800 shrink-0">
              {(
                [
                  ['lista', 'Lista'],
                  ['semana', 'Semana'],
                  ['mes', 'Mês'],
                ] as const
              ).map(([v, rotulo]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => trocarVisao(v)}
                  className={`px-3 py-1 rounded-md text-xs font-semibold cursor-pointer whitespace-nowrap ${
                    visao === v
                      ? 'bg-white dark:bg-stone-700 text-blue-700 dark:text-blue-300 shadow-xs'
                      : 'text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200'
                  }`}
                >
                  {rotulo}
                </button>
              ))}
            </div>
          )}

          {visao === 'lista' && (
            <SelectAuto
              value={limit}
              onChange={(e) => {
                setLimit(Number(e.target.value));
                setPage(1);
              }}
              title="Registros por página"
              className={`${INPUT_CLASS} shrink-0 cursor-pointer`}
            >
              {[10, 25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n} por página
                </option>
              ))}
            </SelectAuto>
          )}

          {acoesLista?.(() => {
            // A ação pode ter criado registros referenciados (a importação cria segmentos):
            // descarta o cache dos combos para a lista não mostrar "…" no lugar do nome
            invalidateOptions();
            setVersaoCombos((v) => v + 1);
            load();
          })}

          {resource.canCreate && (
            <button
              onClick={() => abrirAbaNovo()}
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shadow-xs cursor-pointer shrink-0 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Novo</span>
            </button>
          )}
        </div>
      </div>

      {/* Painel de busca avançada, logo abaixo da barra de ferramentas */}
      {temBuscaAvancada && buscaAvancadaAberta && (
        <AdvancedSearch
          resource={resource}
          camposVisiveis={camposBuscaAtuais}
          camposExtras={camposPersonalizados}
          refOptions={refOptions}
          aplicados={filtros}
          onAplicar={(novos, fechar) => {
            setFiltros(novos);
            setPage(1);
            // Aplicar: o painel fecha (com filtros, fica o resumo). Limpar mantém aberto para montar outro
            if (fechar) setBuscaAvancadaAberta(false);
          }}
          onFechar={() => setBuscaAvancadaAberta(false)}
        />
      )}

      {/* Resumo dos filtros quando o painel está recolhido */}
      {temBuscaAvancada && !buscaAvancadaAberta && filtros.length > 0 && (
        <div className="px-4 py-2 border-b border-stone-200 dark:border-stone-800 bg-blue-50/60 dark:bg-blue-950/20 flex items-center justify-between gap-3 shrink-0">
          <span className="text-[11px] text-blue-800 dark:text-blue-300 truncate">
            {ehFiltroPadrao(filtros) ? (
              <>
                Exibindo <strong>somente os registros ativos</strong> (padrão da tela)
              </>
            ) : (
              <>
                <strong>{filtros.length}</strong> filtro(s) de busca avançada aplicado(s)
              </>
            )}
          </span>
          <button
            onClick={() => setFiltros([])}
            className="text-[11px] font-semibold text-blue-700 dark:text-blue-400 hover:underline cursor-pointer shrink-0"
          >
            {ehFiltroPadrao(filtros) ? 'Ver todos' : 'Limpar'}
          </button>
        </div>
      )}

      {error && (
        <AvisoErro mensagem={error} onFechar={() => setError(null)} className="mx-4 mt-3 shrink-0" />
      )}

      {visao !== 'lista' ? (
        <AgendaCalendario
          resource={resource}
          visao={visao}
          filtros={filtrosEfetivos}
          search={search}
          minhas={minhas}
          gatilho={rows}
          selecionadoId={selecionado ? recordId(selecionado) : null}
          onSelecionar={(row) => {
            painelFechado.current = false;
            setSelecionado(row);
          }}
          onAbrir={(row) => !aoDuploClique?.(row) && resource.canUpdate && abrirAbaEdicao(row)}
          podeMover={resource.canUpdate}
          podeExcluir={(row) => resource.canDelete && podeExcluirAtividade(row, usuario)}
          onExcluir={setDeleting}
          onGerarOS={onGerarOS}
          onAlterado={recarregarComDetalhe}
          onNovo={resource.canCreate ? (data, hora) => abrirAbaNovo({ data_vencimento: data, ...(hora ? { hora_vencimento: hora } : {}) }) : undefined}
          onVisao={trocarVisao}
        />
      ) : (
      <>
      {/* Grade ocupando toda a altura restante */}
      <div className="flex-1 overflow-auto min-h-0">
        <table ref={tabelaRef} className="w-full text-xs border-separate border-spacing-0">
          <thead className="sticky top-0 z-10">
            <tr className="bg-stone-50 dark:bg-stone-950/90 backdrop-blur-xs">
              <th className="sticky left-0 z-20 w-[30px] min-w-[30px] max-w-[30px] px-0 text-center border-b border-r border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-950">
                <div className="relative">
                  <button
                    onClick={() => {
                      setMenuColunas((v) => !v);
                      setSubColunas(null);
                    }}
                    title="Opções das colunas"
                    className="p-1 mx-auto block text-stone-400 hover:text-blue-600 dark:text-stone-500 dark:hover:text-blue-400 cursor-pointer"
                  >
                    <Menu className="w-3.5 h-3.5" />
                  </button>
                  {menuColunas && (
                    <>
                      <div className="fixed inset-0 z-30" onClick={() => setMenuColunas(false)} />
                      <div className="absolute left-0 top-full z-40 mt-1 w-44 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 shadow-lg py-1 text-left font-normal">
                        <button
                          onClick={() => {
                            setMenuColunas(false);
                            setModoLargura('ajustar');
                            aplicarAjustarLargura();
                          }}
                          className="w-full px-3 py-2 text-xs text-stone-700 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer text-left"
                        >
                          Ajustar largura
                        </button>
                        <button
                          onClick={() => {
                            setMenuColunas(false);
                            setModoLargura('melhor');
                            aplicarMelhorLargura();
                          }}
                          className="w-full px-3 py-2 text-xs text-stone-700 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer text-left"
                        >
                          Melhor largura
                        </button>
                        <div className="my-1 border-t border-stone-200 dark:border-stone-700" />
                        {(
                          [
                            ['ambas', 'Mostrar linhas da grade'],
                            ['horizontais', 'Mostrar linhas horizontais'],
                            ['verticais', 'Mostrar linhas verticais'],
                            ['nenhuma', 'Não mostrar linhas da grade'],
                          ] as [Grade, string][]
                        ).map(([valor, rotulo]) => (
                          <button
                            key={valor}
                            onClick={() => {
                              setGrade(valor);
                              setMenuColunas(false);
                            }}
                            className={`w-full px-3 py-2 text-xs hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer text-left ${
                              grade === valor
                                ? 'text-blue-700 dark:text-blue-300 font-semibold'
                                : 'text-stone-700 dark:text-stone-200'
                            }`}
                          >
                            {rotulo}
                          </button>
                        ))}
                        <div className="my-1 border-t border-stone-200 dark:border-stone-700" />
                        {/* Submenu das colunas da lista (inclusive as que não estão no formulário, como Cidade/UF):
                            abre ao passar o mouse ou ao clicar (toque) */}
                        <div
                          className="relative"
                          onMouseEnter={(e) => (subColunas ? cancelarFechamentoSubColunas() : abrirSubColunas(e.currentTarget))}
                          onMouseLeave={() => {
                            cancelarFechamentoSubColunas();
                            fecharSubColunasTimer.current = window.setTimeout(() => setSubColunas(null), 350);
                          }}
                        >
                          <button
                            onClick={(e) => (subColunas ? setSubColunas(null) : abrirSubColunas(e.currentTarget))}
                            className={`w-full px-3 py-2 text-xs text-stone-700 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer text-left flex items-center justify-between ${
                              subColunas ? 'bg-stone-100 dark:bg-stone-800' : ''
                            }`}
                          >
                            Colunas
                            <ChevronRight className="w-3.5 h-3.5 text-stone-400" />
                          </button>
                          {subColunas &&
                            // Portal no body: dentro da grade (que rola e corta) o submenu ficava por trás e cortado.
                            // No React ele continua "dentro" deste item, então passar o mouse para ele não o fecha.
                            createPortal(
                            <div
                              onMouseEnter={cancelarFechamentoSubColunas}
                              style={{ top: subColunas.top, left: subColunas.left, maxHeight: subColunas.maxHeight }}
                              className="fixed z-[70] w-72 overflow-y-auto rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 shadow-lg py-1 text-left font-normal"
                            >
                              {camposProprios
                                .filter((f) => f.type !== 'password')
                                .map((f) => (
                                  <div key={f.name} className="px-3 py-1.5 hover:bg-stone-100 dark:hover:bg-stone-800">
                                    <Toggle
                                      checked={listedFields.some((l) => l.name === f.name)}
                                      onChange={() => alternarColuna(f.name)}
                                      size="sm"
                                      label={<span className="text-xs text-stone-700 dark:text-stone-200">{f.label}</span>}
                                    />
                                  </div>
                                ))}
                            </div>,
                            document.body,
                          )}
                        </div>
                        <div className="my-1 border-t border-stone-200 dark:border-stone-700" />
                        <button
                          onClick={salvarConfiguracao}
                          className="w-full px-3 py-2 text-xs text-stone-700 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer text-left"
                        >
                          Salvar Configuração
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </th>
              {colunaInicial && (
                <th
                  title={colunaInicial.titulo}
                  className="w-[34px] min-w-[34px] max-w-[34px] px-0 text-center border-b border-r border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-950"
                />
              )}
              {colunas.map((f) => {
                const isSorted = sort === f.name;
                return (
                  <th
                    key={f.name}
                    draggable
                    onDragStart={(e) => {
                      arrastando.current = f.name;
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      soltarColuna(f.name);
                    }}
                    onClick={() => !f.json && handleSort(f.name)}
                    style={larguras[f.name] ? { width: larguras[f.name] } : undefined}
                    className={`relative px-3 py-2.5 text-center font-semibold text-stone-600 dark:text-stone-300 whitespace-nowrap cursor-pointer select-none hover:bg-stone-100 dark:hover:bg-stone-800/60 transition-colors border-b border-r border-stone-200 dark:border-stone-800 ${
                      grade === 'ambas' || grade === 'verticais' ? '' : 'border-r-transparent'
                    } ${
                      larguras[f.name] ? '' : f.width ? WIDTH_CLASS[f.width] : ''
                    }`}
                    title={f.json ? `${f.label} (campo personalizado: não ordena)` : `Ordenar por ${f.label}`}
                  >
                    <span
                      draggable={false}
                      onDragStart={(e) => e.preventDefault()}
                      onPointerDown={(e) => iniciarRedimensionamento(e, f.name)}
                      onClick={(e) => e.stopPropagation()}
                      title={`Arrastar para redimensionar ${f.label}`}
                      className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-blue-400/60"
                    />
                    <span className="inline-flex items-center gap-1 justify-center">
                      {f.label}
                      {isSorted &&
                        (dir === 'asc' ? (
                          <ArrowUp className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                        ) : (
                          <ArrowDown className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                        ))}
                    </span>
                  </th>
                );
              })}
              {/* Coluna de sobra: fica com o espaço livre, para que arrastar uma coluna mude mesmo a largura */}
              {comSobra && <th className="w-full border-b border-stone-200 dark:border-stone-800" />}
              <th className={`sticky right-0 z-20 px-3 py-2.5 text-center font-semibold text-stone-600 dark:text-stone-300 ${larguraAcoes} border-b border-l border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-950`}>
                Ações
              </th>
            </tr>
          </thead>

          <tbody className={isLoading && rows.length > 0 ? 'opacity-60' : undefined}>
            {isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={colunas.length + 2 + inicioColunas} className="px-3 py-12 text-center">
                  <div className="flex items-center justify-center gap-2 text-stone-500 dark:text-stone-400">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Carregando registros…</span>
                  </div>
                </td>
              </tr>
            )}

            {!isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={colunas.length + 2 + inicioColunas} className="px-3 py-16 text-center">
                  <div className="flex flex-col items-center gap-2 text-stone-400">
                    <Inbox className="w-8 h-8" />
                    <span className="text-sm font-medium text-stone-600 dark:text-stone-300">
                      {search || filtros.length > 0
                        ? 'Nenhum registro corresponde aos filtros informados'
                        : `Nenhum registro em ${resource.label}`}
                    </span>
                    {filtros.length > 0 && (
                      <button
                        onClick={() => setFiltros([])}
                        className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                      >
                        {ehFiltroPadrao(filtros)
                          ? 'Ver também os inativos'
                          : 'Limpar a busca avançada'}
                      </button>
                    )}
                    {resource.canCreate && !search && filtros.length === 0 && (
                      <button
                        onClick={() => abrirAbaNovo()}
                        className="mt-1 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                      >
                        Incluir o primeiro {resource.labelSingular.toLowerCase()}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            )}

            {rows.flatMap((row) => [
              linhaGrade(row, 0),
              ...(modoArvore ? filhos[String(row[resource.pk[0]])] || [] : []).map((f) => linhaGrade(f, 1)),
            ])}
          </tbody>
        </table>
      </div>

      {/* Paginação fixa ao pé */}
      {totalPages > 1 && (
        <div className="px-4 py-2.5 border-t border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-950/40 flex items-center justify-between gap-3 shrink-0">
          <span className="text-[11px] text-stone-500 dark:text-stone-400">
            Página {page} de {totalPages} ({total.toLocaleString('pt-BR')} {total === 1 ? 'registro' : 'registros'})
          </span>
          <div className="flex items-center gap-1.5">
            {/* Primeira, anterior, próxima e última página */}
            {(
              [
                [ChevronsLeft, 'Primeira página', 1, page <= 1],
                [ChevronLeft, 'Página anterior', Math.max(1, page - 1), page <= 1],
                [ChevronRight, 'Próxima página', Math.min(totalPages, page + 1), page >= totalPages],
                [ChevronsRight, 'Última página', totalPages, page >= totalPages],
              ] as const
            ).map(([Icone, titulo, destino, desabilitado]) => (
              <button
                key={titulo}
                type="button"
                onClick={() => setPage(destino)}
                disabled={desabilitado}
                title={titulo}
                className="p-1.5 rounded-lg border border-stone-300 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
              >
                <Icone className="w-4 h-4" />
              </button>
            ))}
          </div>
        </div>
      )}
      </>
      )}

      {/* Mestre-detalhe: grades filhas do registro selecionado */}
      {/* Ficha: a linha recarregada (após editar/concluir), não a cópia do clique */}
      {!temGrades && resource.ficha && selecionado && (
        <FichaPanel
          resource={resource}
          row={rows.find((r) => recordId(r) === recordId(selecionado)) ?? selecionado}
          label={recordLabel(selecionado)}
          refOptions={refOptions}
          recolhido={fichaRecolhida}
          onRecolhidoChange={setFichaRecolhida}
          onClose={() => {
            painelFechado.current = true;
            setSelecionado(null);
          }}
        />
      )}

      {temGrades && selecionado && (
        <DetailPanel
          key={recordId(selecionado)}
          parent={resource}
          parentRow={selecionado}
          details={resource.details!}
          allResources={allResources}
          parentLabel={recordLabel(selecionado)}
          refreshToken={refreshToken + versaoDetalhe}
          onClose={() => {
            painelFechado.current = true;
            setSelecionado(null);
          }}
          onOpenResource={onNavigate}
          acoesLinha={acoesDetalhe}
        />
      )}

      {/* Dica exibida enquanto nenhuma linha foi selecionada */}
      {temDetalhe && !selecionado && rows.length > 0 && (
        <div className="px-4 py-2 border-t border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-950/40 text-[11px] text-stone-500 dark:text-stone-400 shrink-0">
          Clique em um {resource.labelSingular.toLowerCase()} para ver{' '}
          {temGrades ? resource.details!.map((d) => d.label.toLowerCase()).join(' e ') : 'os detalhes'} aqui embaixo. Duplo clique
          abre o registro para edição.
        </div>
      )}
    </div>
  );

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {abas.length > 0 && tabBar}

      {/* Somente o painel da aba ativa é montado */}
      {editorProprio ? (
        <div key={abaAtual!.key} className="flex-1 flex flex-col min-h-0 bg-white dark:bg-stone-900">
          {editorProprio}
        </div>
      ) : abaAtual ? (
        <RecordForm
          key={`${abaAtual.key}:${JSON.stringify(abaAtual.padrao ?? {})}`}
          resource={
            abaAtual.padrao
              ? { ...resource, fields: resource.fields.map((f) => (f.name in abaAtual.padrao! ? { ...f, default: abaAtual.padrao![f.name] as any } : f)) }
              : resource
          }
          record={abaAtual.record}
          refOptions={refOptions}
          onCancel={() => fecharAba(abaAtual.key)}
          onSave={(payload) => handleSave(abaAtual, payload)}
          colunasVisiveis={listedFields.map((f) => f.name)}
          onAlternarColuna={alternarColuna}
          camposBusca={camposBuscaAtuais}
          onAlternarBusca={alternarCampoBusca}
          ordemCampos={ordemForm}
          onReordenarCampos={setOrdemForm}
          tamanhosCampos={tamanhosForm}
          onRedimensionarCampo={(campo, tamanho) =>
            setTamanhosForm((atual) => ({ ...atual, [campo]: { ...atual[campo], ...tamanho } }))
          }
          onSalvarLayout={salvarConfiguracao}
          onRestaurarPadrao={() => {
            setTamanhosForm({});
            setOrdemForm([]);
          }}
        />
      ) : (
        listPanel
      )}

      {/* Confirmação de exclusão */}
      {deleting && (
        <ConfirmDialog
          titulo={`Excluir ${resource.labelSingular}?`}
          mensagem={
            <>
              <strong className="text-stone-700 dark:text-stone-200">{recordLabel(deleting)}</strong> será removido
              definitivamente. Esta ação não pode ser desfeita.
            </>
          }
          onConfirmar={handleDelete}
          onCancelar={() => setDeleting(null)}
        />
      )}
    </div>
  );
};
