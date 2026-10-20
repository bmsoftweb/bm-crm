import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { SelectAuto } from './SelectAuto';
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useUpdateNodeInternals,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { AlertTriangle, Download, ImagePlus, Loader2, Plus, Save, Upload, X } from 'lucide-react';
import { enviarArquivoJornada, fetchArquivoJornada, fetchConfig, fetchFunis, fetchOptions, salvarConfig } from '../services/api';
import { Funil, OpcaoRef } from '../types';
import { INPUT_CLASS, LABEL_CLASS, FIELD_CLASS, HINT_CLASS } from '../utils/formStyles';
import {
  CORES,
  GRUPOS_NO,
  OPERADORES,
  TIPOS_NO,
  avisosJornada,
  dadosPadrao,
  novoId,
  resumoNo,
  saidasDoNo,
  variaveisDisponiveis,
  type Jornada,
  type NoJornada,
  type TipoNo,
} from '../utils/jornada';
import { NumberField } from './NumberField';
import { Toggle } from './Toggle';
import { AvisoErro } from './AvisoErro';
import { ConfirmDialog } from './ConfirmDialog';

type DadosNo = { tipo: TipoNo; dados: Record<string, any> };
type NoRF = Node<DadosNo, 'no'>;

interface Props {
  somenteLeitura: boolean;
  onToast: (msg: string) => void;
  /** jornada = atendimento (número padrão); jornada_campanhas = quem responde no WhatsApp das campanhas */
  chave?: 'jornada' | 'jornada_campanhas';
}

/** Departamentos (para o resumo dos nós Departamento), sem passar pelos dados de cada nó */
const DepartamentosCtx = createContext<OpcaoRef[]>([]);

const campo = `${INPUT_CLASS} w-full`;
const selecionar = (e: React.FocusEvent<HTMLInputElement>) => e.target.select();

/** Tema escuro do app (classe "dark" no <html>), acompanhando a troca pelo botão do cabeçalho */
function useTemaEscuro() {
  const [escuro, setEscuro] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    const o = new MutationObserver(() => setEscuro(document.documentElement.classList.contains('dark')));
    o.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => o.disconnect();
  }, []);
  return escuro;
}

// ------------------------------------------------------------
// Nó no quadro
// ------------------------------------------------------------

const NoCard: React.FC<NodeProps<NoRF>> = ({ id, data, selected }) => {
  const departamentos = useContext(DepartamentosCtx);
  const tipo = TIPOS_NO[data.tipo];
  const cor = CORES[tipo.cor];
  const saidas = saidasDoNo(data);
  const atualizarInternos = useUpdateNodeInternals();
  const chaveSaidas = saidas.map((s) => s.id).join('|');
  useEffect(() => atualizarInternos(id), [id, chaveSaidas, atualizarInternos]);
  const Icone = tipo.icone;
  const resumo = resumoNo({ id, tipo: data.tipo, x: 0, y: 0, dados: data.dados }, departamentos);
  return (
    <div
      className={`w-60 rounded-xl border-2 bg-white dark:bg-stone-900 shadow-sm ${selected ? 'border-blue-500 ring-2 ring-blue-200 dark:ring-blue-900' : cor.borda}`}
    >
      {data.tipo !== 'inicio' && <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-stone-400" />}
      {/* Sem resumo nem saídas (Fim vazio), o cabeçalho é o card inteiro: arredonda embaixo também */}
      <div className={`flex items-center gap-2 px-3 py-2 ${resumo || saidas.length ? 'rounded-t-[10px]' : 'rounded-[10px]'} ${cor.fundo}`}>
        <Icone className={`w-4 h-4 shrink-0 ${cor.texto}`} />
        <span className={`text-xs font-bold truncate ${cor.texto}`}>{data.dados.titulo || tipo.nome}</span>
      </div>
      {resumo && <p className="px-3 py-2 text-[11px] leading-snug text-stone-600 dark:text-stone-300 line-clamp-3 whitespace-pre-wrap break-words">{resumo}</p>}
      {saidas.length > 0 && (
        <div className="relative flex border-t border-stone-100 dark:border-stone-800 min-h-6">
          {saidas.map((s, i) => (
            <div key={s.id} className="flex-1 min-w-0 px-1 pt-1 pb-2 text-center">
              <span className="block text-[9px] leading-tight text-stone-500 dark:text-stone-400 truncate" title={s.rotulo}>
                {s.rotulo}
              </span>
              <Handle
                type="source"
                position={Position.Bottom}
                id={s.id}
                style={{ left: `${((i + 0.5) / saidas.length) * 100}%` }}
                className="!w-3 !h-3 !bg-blue-500"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const TIPOS_RF = { no: NoCard };

// ------------------------------------------------------------
// Conversões jornada ↔ quadro
// ------------------------------------------------------------

const paraNos = (j: Jornada): NoRF[] =>
  j.nos.map((n) => ({ id: n.id, type: 'no', position: { x: n.x, y: n.y }, deletable: n.tipo !== 'inicio', data: { tipo: n.tipo, dados: n.dados } }));
const paraLigacoes = (j: Jornada): Edge[] =>
  j.ligacoes.map((l) => ({ id: `${l.de}:${l.saida}`, source: l.de, sourceHandle: l.saida, target: l.para, animated: false }));
const doQuadro = (nodes: NoRF[], edges: Edge[]) => ({
  nos: nodes.map((n): NoJornada => ({ id: n.id, tipo: n.data.tipo, x: Math.round(n.position.x), y: Math.round(n.position.y), dados: n.data.dados })),
  ligacoes: edges.map((e) => ({ de: e.source, saida: String(e.sourceHandle ?? ''), para: e.target })),
});

// ------------------------------------------------------------
// Exportar / importar (arquivo JSON para levar a automação a outra empresa)
// ------------------------------------------------------------

/** Marca do arquivo: a importação recusa JSON que não seja uma automação exportada */
const FORMATO_ARQUIVO = 'crmweb-automacao';

const base64DoBlob = (b: Blob) =>
  new Promise<string>((ok, erro) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(',')[1] ?? '');
    r.onerror = () => erro(r.error);
    r.readAsDataURL(b);
  });

/**
 * Quadro → arquivo: as imagens enviadas vão junto (base64), o departamento vai pelo nome (o id muda de uma
 * empresa para outra) e os cabeçalhos secretos das chamadas de API vão sem valor
 */
async function paraArquivo(j: ReturnType<typeof doQuadro>, departamentos: OpcaoRef[]) {
  const nos = await Promise.all(
    j.nos.map(async (n) => {
      const dados: Record<string, any> = { ...n.dados };
      if (n.tipo === 'imagem' && dados.arquivo_id) {
        const url = await fetchArquivoJornada(dados.arquivo_id);
        const blob = await (await fetch(url)).blob();
        URL.revokeObjectURL(url);
        dados.arquivo_mimetype = blob.type;
        dados.arquivo_base64 = await base64DoBlob(blob);
        delete dados.arquivo_id;
      }
      if (n.tipo === 'departamento' || n.tipo === 'tarefa') dados.departamento_nome = departamentos.find((d) => d.value === String(dados.departamento_id))?.label ?? '';
      if (n.tipo === 'api') dados.cabecalhos = (dados.cabecalhos ?? []).map((h: any) => (h.secreto ? { nome: h.nome, valor: '', secreto: true } : h));
      return { ...n, dados };
    }),
  );
  return { formato: FORMATO_ARQUIVO, versao: 1, exportado_em: new Date().toLocaleString('pt-BR'), nos, ligacoes: j.ligacoes };
}

/** Arquivo → quadro: reenvia as imagens e acha o departamento pelo nome; devolve o que precisa ser revisto */
async function doArquivo(arq: any, departamentos: OpcaoRef[]): Promise<{ nos: NoJornada[]; ligacoes: Jornada['ligacoes']; revisar: string[] }> {
  const revisar: string[] = [];
  const nos: NoJornada[] = [];
  for (const n of arq.nos) {
    const dados: Record<string, any> = { ...(n.dados ?? {}) };
    if (n.tipo === 'imagem' && dados.arquivo_base64) {
      const r = await enviarArquivoJornada(dados.arquivo_nome || 'imagem', dados.arquivo_mimetype || 'image/png', dados.arquivo_base64);
      dados.arquivo_id = r.id;
      dados.arquivo_nome = r.nome;
    }
    delete dados.arquivo_base64;
    delete dados.arquivo_mimetype;
    if (n.tipo === 'departamento' || (n.tipo === 'tarefa' && dados.departamento_nome)) {
      const nome = String(dados.departamento_nome ?? '').trim();
      const dep = departamentos.find((d) => d.label.replace(/ \(inativo\)$/, '').trim().toLowerCase() === nome.toLowerCase());
      dados.departamento_id = dep ? Number(dep.value) : null;
      if (!dep) revisar.push(`escolher o departamento${nome ? ` (no arquivo: ${nome})` : ''}`);
      delete dados.departamento_nome;
    }
    // Funil e etapa são da outra empresa: volta para o primeiro funil até escolher
    if (n.tipo === 'prospeccao' && dados.funil_id) {
      dados.funil_id = null;
      dados.etapa_id = null;
      revisar.push(`escolher o funil e a etapa de "${dados.titulo || 'Registrar Prospecção'}"`);
    }
    if (n.tipo === 'api' && (dados.cabecalhos ?? []).some((h: any) => h.secreto)) revisar.push(`informar os cabeçalhos secretos de "${dados.titulo || 'Chamar API'}"`);
    nos.push({ id: String(n.id), tipo: n.tipo, x: Number(n.x) || 0, y: Number(n.y) || 0, dados });
  }
  return { nos, ligacoes: arq.ligacoes, revisar };
}

// ------------------------------------------------------------
// Editor
// ------------------------------------------------------------

interface Confirmacao {
  titulo: string;
  mensagem: string;
  confirmar: string;
  tom?: 'perigo' | 'normal';
  acao: () => void;
  cancelar?: () => void;
}

const Editor: React.FC<Props> = ({ somenteLeitura, onToast, chave = 'jornada' }) => {
  const [carregado, setCarregado] = useState(false);
  const [ativo, setAtivo] = useState(false);
  const [modo, setModo] = useState<'teste' | 'todos'>('teste');
  const [numeros, setNumeros] = useState('');
  const [nodes, setNodes, onNodesChange] = useNodesState<NoRF>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [departamentos, setDepartamentos] = useState<OpcaoRef[]>([]);
  const [confirmacao, setConfirmacao] = useState<Confirmacao | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [transferindo, setTransferindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const quadroRef = useRef<HTMLDivElement>(null);
  const importarRef = useRef<HTMLInputElement>(null);
  const rf = useReactFlow();
  const escuro = useTemaEscuro();

  useEffect(() => {
    fetchConfig<Jornada>('whatsapp', chave)
      .then(({ valor }) => {
        if (!valor) return;
        setAtivo(valor.ativo);
        setModo(valor.modo);
        setNumeros(valor.numeros_teste.join(', '));
        setNodes(paraNos(valor));
        setEdges(paraLigacoes(valor));
        setCarregado(true);
        setTimeout(() => rf.fitView({ padding: 0.2, maxZoom: 1 }), 50);
      })
      .catch((e) => setErro(e.message));
    fetchOptions('departamentos', 'nome')
      .then(setDepartamentos)
      .catch(() => {});
  }, [rf, setEdges, setNodes]);

  const atual = nodes.find((n) => n.id === selecionado) ?? null;
  const jornadaAtual = useMemo(() => doQuadro(nodes, edges), [nodes, edges]);
  const avisos = useMemo(() => avisosJornada(jornadaAtual), [jornadaAtual]);
  const variaveis = useMemo(() => variaveisDisponiveis(jornadaAtual.nos), [jornadaAtual.nos]);

  /** Novos dados do nó; ligações de saídas que deixaram de existir saem junto */
  const alterarNo = useCallback(
    (id: string, tipo: TipoNo, dados: Record<string, any>) => {
      const saidas = saidasDoNo({ tipo, dados }).map((s) => s.id);
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, dados } } : n)));
      setEdges((es) => es.filter((e) => e.source !== id || saidas.includes(String(e.sourceHandle))));
    },
    [setEdges, setNodes],
  );

  /** Nó novo: onde foi solto (arrastar da barra) ou no centro do quadro (clique) */
  const adicionar = (tipo: TipoNo, solto?: { x: number; y: number }) => {
    const r = quadroRef.current?.getBoundingClientRect();
    const posicao = solto
      ? { x: solto.x - 120, y: solto.y - 20 }
      : (() => {
          const centro = r ? rf.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) : { x: 0, y: 0 };
          return { x: centro.x - 120 + Math.random() * 40, y: centro.y - 40 + Math.random() * 40 };
        })();
    const id = novoId();
    setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), { id, type: 'no', position: posicao, selected: true, data: { tipo, dados: dadosPadrao(tipo) } }]);
    setSelecionado(id);
  };

  const onConnect = useCallback(
    (c: Connection) => {
      // Cada saída liga em um nó só: a ligação nova substitui a anterior
      setEdges((es) => [
        ...es.filter((e) => !(e.source === c.source && e.sourceHandle === c.sourceHandle)),
        { id: `${c.source}:${c.sourceHandle}`, source: c.source, sourceHandle: c.sourceHandle, target: c.target },
      ]);
    },
    [setEdges],
  );
  const ligacaoValida = useCallback(
    (c: Connection | Edge) => c.source !== c.target && nodes.find((n) => n.id === c.target)?.data.tipo !== 'inicio',
    [nodes],
  );

  // Excluir (tecla Delete ou botão do painel) sempre pergunta antes
  const antesDeExcluir = useCallback(
    ({ nodes: ns, edges: es }: { nodes: NoRF[]; edges: Edge[] }) =>
      new Promise<boolean>((ok) => {
        const qtdNos = ns.length;
        setConfirmacao({
          titulo: qtdNos ? `Excluir ${qtdNos === 1 ? 'o nó' : `${qtdNos} nós`}?` : `Remover ${es.length === 1 ? 'a ligação' : `${es.length} ligações`}?`,
          mensagem: qtdNos ? 'O nó e as ligações dele saem da automação (só vale depois de Salvar).' : 'A saída fica sem destino (só vale depois de Salvar).',
          confirmar: qtdNos ? 'Excluir' : 'Remover',
          acao: () => ok(true),
          cancelar: () => ok(false),
        });
      }),
    [],
  );

  const salvar = async () => {
    setSalvando(true);
    setErro(null);
    try {
      const numeros_teste = numeros.split(/[,;\n]/).map((t) => t.trim()).filter(Boolean);
      await salvarConfig('whatsapp', chave, { ativo, modo, numeros_teste, ...jornadaAtual });
      onToast(ativo ? `Automação gravada e ligada (${modo === 'teste' ? 'só números de teste' : 'todos os clientes'}).` : 'Automação gravada (desligada).');
    } catch (err: any) {
      setErro(err.message);
    } finally {
      setSalvando(false);
    }
  };

  /** Baixa o quadro atual (como está na tela, mesmo sem salvar) num arquivo JSON */
  const exportar = async () => {
    setTransferindo(true);
    setErro(null);
    try {
      const arquivo = await paraArquivo(jornadaAtual, departamentos);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(arquivo, null, 2)], { type: 'application/json' }));
      a.download = `automacao-${chave === 'jornada_campanhas' ? 'campanhas' : 'atendimento'}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      onToast('Automação exportada.');
    } catch (err: any) {
      setErro(`Não foi possível exportar: ${err.message}`);
    } finally {
      setTransferindo(false);
    }
  };

  /** Lê o arquivo escolhido e, confirmado, troca o quadro pelo dele (só grava no Salvar) */
  const importar = async (f: File | undefined) => {
    if (importarRef.current) importarRef.current.value = '';
    if (!f) return;
    setErro(null);
    let arq: any;
    try {
      arq = JSON.parse(await f.text());
    } catch {
      return setErro('Arquivo inválido: não é um JSON.');
    }
    const valido =
      arq?.formato === FORMATO_ARQUIVO &&
      Array.isArray(arq.nos) &&
      Array.isArray(arq.ligacoes) &&
      arq.nos.every((n: any) => n && TIPOS_NO[n.tipo as TipoNo]) &&
      arq.nos.filter((n: any) => n.tipo === 'inicio').length === 1;
    if (!valido) return setErro('Este arquivo não é uma automação exportada pelo CRM.');
    setConfirmacao({
      titulo: 'Importar a automação?',
      mensagem: `O quadro atual é substituído pelo do arquivo (${arq.nos.length} nós). Nada muda no WhatsApp até você clicar em Salvar automação.`,
      confirmar: 'Importar',
      acao: async () => {
        setTransferindo(true);
        try {
          const { nos, ligacoes, revisar } = await doArquivo(arq, departamentos);
          const j = { ativo, modo, numeros_teste: [], nos, ligacoes } as Jornada;
          setNodes(paraNos(j));
          setEdges(paraLigacoes(j));
          setSelecionado(null);
          setTimeout(() => rf.fitView({ padding: 0.2, maxZoom: 1 }), 50);
          onToast(revisar.length ? `Automação importada. Antes de salvar: ${revisar.join('; ')}.` : 'Automação importada: confira e clique em Salvar automação.');
        } catch (err: any) {
          setErro(`Não foi possível importar: ${err.message}`);
        } finally {
          setTransferindo(false);
        }
      },
    });
  };

  if (!carregado) return erro ? <AvisoErro mensagem={erro} onFechar={() => setErro(null)} /> : <Loader2 className="w-4 h-4 animate-spin text-stone-400" />;

  return (
    <DepartamentosCtx.Provider value={departamentos}>
      <div className="flex flex-col gap-3">
        {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} />}

        <fieldset disabled={somenteLeitura} className="flex flex-wrap items-end gap-4">
          <Toggle checked={ativo} onChange={setAtivo} label={<span className="text-xs font-semibold text-stone-700 dark:text-stone-200">Automação ligada</span>} />
          <div className={FIELD_CLASS}>
            <label htmlFor="jor-modo" className={LABEL_CLASS}>Atende</label>
            <SelectAuto id="jor-modo" value={modo} onChange={(e) => setModo(e.target.value as 'teste' | 'todos')} className={`${INPUT_CLASS} cursor-pointer`}>
              <option value="teste">Só os números de teste</option>
              <option value="todos">Todos os clientes</option>
            </SelectAuto>
          </div>
          {modo === 'teste' && (
            <div className={`${FIELD_CLASS} flex-1 min-w-60`}>
              <label htmlFor="jor-numeros" className={LABEL_CLASS}>Números de teste</label>
              <input id="jor-numeros" value={numeros} onChange={(e) => setNumeros(e.target.value)} onFocus={selecionar} placeholder="(47) 99999-9999, (47) 98888-8888" className={campo} />
            </div>
          )}
          {!somenteLeitura && (
            <div className="flex gap-2 ml-auto">
              <button
                type="button"
                onClick={exportar}
                disabled={transferindo}
                title="Baixa a automação do quadro num arquivo, para importar em outra empresa"
                className="flex items-center gap-2 border border-stone-300 dark:border-stone-700 text-stone-700 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 px-4 py-2.5 rounded-lg text-xs font-semibold cursor-pointer disabled:opacity-50"
              >
                <Upload className="w-4 h-4" /> Exportar
              </button>
              <button
                type="button"
                onClick={() => importarRef.current?.click()}
                disabled={transferindo}
                title="Carrega no quadro uma automação exportada (só grava ao Salvar)"
                className="flex items-center gap-2 border border-stone-300 dark:border-stone-700 text-stone-700 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 px-4 py-2.5 rounded-lg text-xs font-semibold cursor-pointer disabled:opacity-50"
              >
                {transferindo ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Importar
              </button>
              <input ref={importarRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => importar(e.target.files?.[0])} />
              <button
                type="button"
                onClick={salvar}
                disabled={salvando}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-lg text-xs font-semibold shadow-xs cursor-pointer disabled:opacity-50"
              >
                {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Salvar automação
              </button>
            </div>
          )}
        </fieldset>

        <div className="flex gap-3 h-[70vh] min-h-[480px]">
          {!somenteLeitura && (
            <nav aria-label="Tipos de nó" className="w-44 shrink-0 overflow-y-auto rounded-xl border border-stone-200 dark:border-stone-800 py-2">
              {GRUPOS_NO.map((g) => (
                <div key={g.titulo} className="mb-2">
                  <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-stone-400">{g.titulo}</div>
                  {g.tipos.map((t) => {
                    const Icone = TIPOS_NO[t].icone;
                    return (
                      <button
                        key={t}
                        type="button"
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('application/x-jornada-no', t);
                          e.dataTransfer.effectAllowed = 'move';
                        }}
                        onClick={() => adicionar(t)}
                        title={`${TIPOS_NO[t].ajuda} Clique para incluir no centro ou arraste até o quadro.`}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-stone-700 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-grab"
                      >
                        <span className={`flex items-center justify-center w-6 h-6 rounded-md ${CORES[TIPOS_NO[t].cor].fundo}`}>
                          <Icone className={`w-3.5 h-3.5 ${CORES[TIPOS_NO[t].cor].texto}`} />
                        </span>
                        <span className="truncate">{TIPOS_NO[t].nome}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </nav>
          )}
          <div ref={quadroRef} className="flex-1 min-w-0 rounded-xl border border-stone-200 dark:border-stone-800 overflow-hidden">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={TIPOS_RF}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              isValidConnection={ligacaoValida}
              onBeforeDelete={antesDeExcluir}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes('application/x-jornada-no')) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
              }}
              onDrop={(e) => {
                const tipo = e.dataTransfer.getData('application/x-jornada-no') as TipoNo;
                if (!tipo || !TIPOS_NO[tipo]) return;
                e.preventDefault();
                adicionar(tipo, rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
              }}
              onSelectionChange={({ nodes: ns }) => setSelecionado(ns.length === 1 ? ns[0].id : null)}
              nodesDraggable={!somenteLeitura}
              nodesConnectable={!somenteLeitura}
              elementsSelectable
              deleteKeyCode={somenteLeitura ? null : ['Delete', 'Backspace']}
              colorMode={escuro ? 'dark' : 'light'}
              defaultEdgeOptions={{ style: { strokeWidth: 2 } }}
              minZoom={0.2}
              fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={20} />
              <Controls showInteractive={false} />
              <MiniMap pannable zoomable className="!hidden md:!block" />
            </ReactFlow>
          </div>

          {atual && (
            <aside className="w-80 shrink-0 overflow-y-auto rounded-xl border border-stone-200 dark:border-stone-800 p-4">
              <PainelNo
                key={atual.id}
                no={atual}
                somenteLeitura={somenteLeitura}
                departamentos={departamentos}
                variaveis={variaveis}
                onAlterar={(dados) => alterarNo(atual.id, atual.data.tipo, dados)}
                onExcluir={() => rf.deleteElements({ nodes: [{ id: atual.id }] })}
                // Tira a seleção no quadro também: só limpar o estado não basta, o React Flow avisaria de novo o nó selecionado
                onFechar={() => {
                  setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)));
                  setSelecionado(null);
                }}
                pedirConfirmacao={setConfirmacao}
                onErro={setErro}
              />
            </aside>
          )}
        </div>

        {avisos.length > 0 && (
          <div className="flex flex-col gap-1 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 text-[11px] text-amber-800 dark:text-amber-300">
            {avisos.map((a) => (
              <span key={a} className="flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                {a}
              </span>
            ))}
          </div>
        )}
        <p className={HINT_CLASS}>
          Arraste da bolinha azul embaixo de um nó até outro nó para ligar. Clique num nó para editar; Delete exclui o que estiver selecionado. Nada muda no WhatsApp
          até Salvar.
        </p>

        {confirmacao && (
          <ConfirmDialog
            titulo={confirmacao.titulo}
            mensagem={confirmacao.mensagem}
            confirmar={confirmacao.confirmar}
            tom={confirmacao.tom}
            onConfirmar={() => {
              confirmacao.acao();
              setConfirmacao(null);
            }}
            onCancelar={() => {
              confirmacao.cancelar?.();
              setConfirmacao(null);
            }}
          />
        )}
      </div>
    </DepartamentosCtx.Provider>
  );
};

// ------------------------------------------------------------
// Painel do nó selecionado
// ------------------------------------------------------------

interface PainelProps {
  no: NoRF;
  somenteLeitura: boolean;
  departamentos: OpcaoRef[];
  variaveis: string[];
  onAlterar: (dados: Record<string, any>) => void;
  onExcluir: () => void;
  onFechar: () => void;
  pedirConfirmacao: (c: Confirmacao) => void;
  onErro: (msg: string) => void;
}

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/** Funil e etapa do nó Registrar Prospecção (vazios: o primeiro funil e a primeira etapa) */
const FunilEtapa: React.FC<{ funilId: number | null; etapaId: number | null; idCampo: (c: string) => string; onChange: (m: Record<string, any>) => void }> = ({
  funilId,
  etapaId,
  idCampo,
  onChange,
}) => {
  const [funis, setFunis] = useState<Funil[]>([]);
  useEffect(() => {
    fetchFunis()
      .then(setFunis)
      .catch(() => {});
  }, []);
  const etapas = funis.find((f) => f.id === funilId)?.etapas ?? [];
  return (
    <>
      <div className={FIELD_CLASS}>
        <label htmlFor={idCampo('funil')} className={LABEL_CLASS}>Funil</label>
        <SelectAuto id={idCampo('funil')} value={funilId ?? ''} onChange={(e) => onChange({ funil_id: Number(e.target.value) || null, etapa_id: null })} className={`${campo} cursor-pointer`}>
          <option value="">O primeiro funil</option>
          {funis.map((f) => (
            <option key={f.id} value={f.id}>
              {f.nome}
            </option>
          ))}
        </SelectAuto>
      </div>
      <div className={FIELD_CLASS}>
        <label htmlFor={idCampo('etapa')} className={LABEL_CLASS}>Etapa</label>
        <SelectAuto id={idCampo('etapa')} value={etapaId ?? ''} onChange={(e) => onChange({ etapa_id: Number(e.target.value) || null })} disabled={!funilId} className={`${campo} cursor-pointer`}>
          <option value="">A primeira etapa</option>
          {etapas.map((e) => (
            <option key={e.id} value={e.id}>
              {e.nome}
            </option>
          ))}
        </SelectAuto>
      </div>
    </>
  );
};

const PainelNo: React.FC<PainelProps> = ({ no, somenteLeitura, departamentos, variaveis, onAlterar, onExcluir, onFechar, pedirConfirmacao, onErro }) => {
  const { tipo, dados: d } = no.data;
  const info = TIPOS_NO[tipo];
  const set = (m: Record<string, any>) => onAlterar({ ...d, ...m });
  /** Item de lista (opção, caso, cabeçalho...) */
  const setItem = (lista: string, i: number, m: Record<string, any>) => set({ [lista]: d[lista].map((x: any, j: number) => (j === i ? { ...x, ...m } : x)) });
  const removerItem = (lista: string, i: number, nome: string) =>
    pedirConfirmacao({
      titulo: `Remover ${nome}?`,
      mensagem: 'A ligação que sai dela também sai (só vale depois de Salvar).',
      confirmar: 'Remover',
      acao: () => set({ [lista]: d[lista].filter((_: any, j: number) => j !== i) }),
    });
  const id = (c: string) => `jor-${no.id}-${c}`;
  const textoCom = (chave: string, rotulo: string, linhas = 4, placeholder = '') => (
    <div className={FIELD_CLASS}>
      <label htmlFor={id(chave)} className={LABEL_CLASS}>{rotulo}</label>
      <textarea id={id(chave)} value={d[chave] ?? ''} onChange={(e) => set({ [chave]: e.target.value })} rows={linhas} placeholder={placeholder} className={`${campo} resize-y`} />
    </div>
  );
  const linha = (chave: string, rotulo: string, placeholder = '') => (
    <div className={FIELD_CLASS}>
      <label htmlFor={id(chave)} className={LABEL_CLASS}>{rotulo}</label>
      <input id={id(chave)} value={d[chave] ?? ''} onChange={(e) => set({ [chave]: e.target.value })} onFocus={selecionar} placeholder={placeholder} className={campo} />
    </div>
  );
  const operador = (valor: string, onChange: (v: string) => void, idCampo: string) => (
    <SelectAuto id={idCampo} value={valor} onChange={(e) => onChange(e.target.value)} className={`${campo} cursor-pointer`}>
      {OPERADORES.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </SelectAuto>
  );
  const botaoRemover = (onClick: () => void, titulo: string) => (
    <button type="button" onClick={onClick} title={titulo} className="p-1 text-stone-400 hover:text-red-600 cursor-pointer shrink-0">
      <X className="w-4 h-4" />
    </button>
  );
  const botaoIncluir = (onClick: () => void, texto: string, disabled = false) => (
    <button type="button" onClick={onClick} disabled={disabled} className="self-start flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline cursor-pointer disabled:opacity-40">
      <Plus className="w-3.5 h-3.5" /> {texto}
    </button>
  );

  return (
    <fieldset disabled={somenteLeitura} className="flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <h3 className={`text-sm font-bold ${CORES[info.cor].texto}`}>{info.nome}</h3>
          <p className="text-[11px] text-stone-500 dark:text-stone-400">{info.ajuda}</p>
        </div>
        {botaoRemover(onFechar, 'Fechar o painel')}
      </div>

      {tipo !== 'inicio' && linha('titulo', 'Nome no quadro (opcional)', info.nome)}

      {(tipo === 'mensagem' || tipo === 'fim') && textoCom('texto', tipo === 'fim' ? 'Mensagem de despedida (opcional)' : 'Mensagem', 5)}

      {tipo === 'imagem' && <CamposImagem d={d} set={set} onErro={onErro} idBase={id('img')} />}

      {tipo === 'menu' && (
        <>
          {textoCom('texto', 'Texto antes das opções', 3)}
          <span className={LABEL_CLASS}>Opções (cada uma é uma saída)</span>
          {(d.opcoes ?? []).map((o: any, i: number) => (
            <div key={o.id} className="flex items-center gap-2">
              <span className="w-4 text-xs font-bold text-stone-500">{i + 1}</span>
              <input aria-label={`Opção ${i + 1}`} value={o.rotulo} onChange={(e) => setItem('opcoes', i, { rotulo: e.target.value })} onFocus={selecionar} className={campo} />
              {botaoRemover(() => removerItem('opcoes', i, `a opção ${i + 1}`), 'Remover a opção')}
            </div>
          ))}
          {botaoIncluir(() => set({ opcoes: [...(d.opcoes ?? []), { id: novoId('o'), rotulo: `Opção ${(d.opcoes?.length ?? 0) + 1}` }] }), 'Opção', (d.opcoes?.length ?? 0) >= 9)}
          {textoCom('invalida', 'Quando não entender (sem ligação em "não entendeu")', 2, 'Desculpe, não entendi. Responda com o número de uma das opções:')}
        </>
      )}

      {tipo === 'pergunta' && (
        <>
          {textoCom('texto', 'Pergunta', 3)}
          {linha('variavel', 'Guardar a resposta na variável', 'nome')}
        </>
      )}

      {tipo === 'condicao' && (
        <>
          <div className={FIELD_CLASS}>
            <label htmlFor={id('tipo')} className={LABEL_CLASS}>Verificar</label>
            <SelectAuto id={id('tipo')} value={d.tipo} onChange={(e) => set({ tipo: e.target.value })} className={`${campo} cursor-pointer`}>
              <option value="horario">Horário de atendimento</option>
              <option value="cadastrado">Cliente cadastrado no CRM</option>
              <option value="negocio">Cliente com negócio aberto</option>
              <option value="variavel">Valor de uma variável</option>
            </SelectAuto>
          </div>
          {d.tipo === 'horario' && (
            <>
              <div className="flex flex-wrap gap-x-3 gap-y-1.5">
                {DIAS.map((nome, dia) => (
                  <Toggle
                    key={dia}
                    size="sm"
                    checked={(d.dias ?? []).includes(dia)}
                    onChange={(sim) => set({ dias: sim ? [...(d.dias ?? []), dia].sort() : (d.dias ?? []).filter((x: number) => x !== dia) })}
                    label={nome}
                  />
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className={FIELD_CLASS}>
                  <label htmlFor={id('das')} className={LABEL_CLASS}>Das</label>
                  <input id={id('das')} type="time" value={d.das} onChange={(e) => set({ das: e.target.value })} className={campo} />
                </div>
                <div className={FIELD_CLASS}>
                  <label htmlFor={id('ate')} className={LABEL_CLASS}>Até</label>
                  <input id={id('ate')} type="time" value={d.ate} onChange={(e) => set({ ate: e.target.value })} className={campo} />
                </div>
              </div>
              <span className={HINT_CLASS}>Horário de Brasília. Sim = dentro do horário. Depois deste nó, {'{{horario}}'} traz o horário por extenso (ex.: seg a sex, das 08:00 às 18:00).</span>
            </>
          )}
          {d.tipo === 'variavel' && (
            <>
              {linha('variavel', 'Variável', 'mensagem')}
              {operador(d.operador, (v) => set({ operador: v }), id('op'))}
              {!['vazio', 'preenchido'].includes(d.operador) && linha('valor', 'Valor')}
            </>
          )}
        </>
      )}

      {tipo === 'case' && (
        <>
          {linha('variavel', 'Variável comparada', 'mensagem')}
          <span className={LABEL_CLASS}>Casos, na ordem (o primeiro que bater decide a saída)</span>
          {(d.casos ?? []).map((c: any, i: number) => (
            <div key={c.id} className="flex flex-col gap-1.5 p-2 rounded-lg bg-stone-50 dark:bg-stone-800/60">
              <div className="flex items-center gap-2">
                <input aria-label={`Nome do caso ${i + 1}`} value={c.rotulo} onChange={(e) => setItem('casos', i, { rotulo: e.target.value })} onFocus={selecionar} placeholder={`caso ${i + 1}`} className={campo} />
                {botaoRemover(() => removerItem('casos', i, `o caso ${i + 1}`), 'Remover o caso')}
              </div>
              {operador(c.operador, (v) => setItem('casos', i, { operador: v }), id(`op${i}`))}
              {!['vazio', 'preenchido'].includes(c.operador) && (
                <input aria-label={`Valor do caso ${i + 1}`} value={c.valor} onChange={(e) => setItem('casos', i, { valor: e.target.value })} onFocus={selecionar} placeholder="valor" className={campo} />
              )}
            </div>
          ))}
          {botaoIncluir(() => set({ casos: [...(d.casos ?? []), { id: novoId('c'), operador: 'contem', valor: '', rotulo: '' }] }), 'Caso', (d.casos?.length ?? 0) >= 20)}
        </>
      )}

      {tipo === 'esperar' && (
        <>
          <div className={FIELD_CLASS}>
            <label htmlFor={id('min')} className={LABEL_CLASS}>Minutos</label>
            <NumberField id={id('min')} value={String(d.minutos ?? '')} onChange={(t) => set({ minutos: Number(t) || 0 })} scale={0} className={campo} />
          </div>
          <Toggle checked={Boolean(d.interromper)} onChange={(v) => set({ interromper: v })} size="sm" label="Se o cliente escrever, segue na hora" />
          <span className={HINT_CLASS}>Quem continua é a rotina que roda a cada minuto: pode sair até 1 minuto depois.</span>
        </>
      )}

      {tipo === 'api' && <CamposApi d={d} set={set} setItem={setItem} removerItem={removerItem} idBase={id('api')} botaoIncluir={botaoIncluir} botaoRemover={botaoRemover} />}

      {tipo === 'ia' && (
        <>
          {textoCom(
            'texto',
            'Texto-base (o que a IA sabe e pode responder)',
            10,
            'O que a empresa faz, produtos e serviços, preços que podem ser informados, horário de atendimento, endereço, formas de pagamento, prazos, políticas, perguntas frequentes...',
          )}
          <span className={HINT_CLASS}>
            Usa a chave e o modelo de Configurações › IA. A IA responde só com o texto-base e os dados do cliente no CRM; a conversa fica com ela até passar para
            humano: aí segue a saída "passou p/ humano" (sem ligação, a conversa fica com a equipe).
          </span>
        </>
      )}

      {tipo === 'iaex' && (
        <>
          {textoCom('texto', 'Texto-base (o que a IA deve fazer nesta etapa)', 5, 'Pergunte ao cliente, de forma cordial, sobre o que ele deseja.')}
          <span className={LABEL_CLASS}>Saídas: quando o cliente quiser...</span>
          {(d.opcoes ?? []).map((o: any, i: number) => (
            <div key={o.id} className="flex items-center gap-2">
              <span className="w-4 text-xs font-bold text-stone-500">{i + 1}</span>
              <input aria-label={`Saída ${i + 1}`} value={o.rotulo} onChange={(e) => setItem('opcoes', i, { rotulo: e.target.value })} onFocus={selecionar} placeholder="Ex.: falar com o suporte" className={campo} />
              {botaoRemover(() => removerItem('opcoes', i, `a saída ${i + 1}`), 'Remover a saída')}
            </div>
          ))}
          {botaoIncluir(() => set({ opcoes: [...(d.opcoes ?? []), { id: novoId('o'), rotulo: '' }] }), 'Saída', (d.opcoes?.length ?? 0) >= 9)}
          <div className={FIELD_CLASS}>
            <label htmlFor={id('tent')} className={LABEL_CLASS}>Respostas sem entender, antes de "não identificou"</label>
            <NumberField id={id('tent')} value={String(d.tentativas ?? 3)} onChange={(t) => set({ tentativas: Number(t) || 0 })} scale={0} className={campo} />
          </div>
          <span className={HINT_CLASS}>
            Usa a chave e o modelo de Configurações › IA. A IA faz a pergunta, entende a resposta (número ou palavras) e segue pela saída certa; a escolha fica em {'{{ia_opcao}}'}.
            Se o cliente já disser o que quer na primeira mensagem, vai direto.
          </span>
        </>
      )}

      {tipo === 'lead' && (
        <>
          {linha('nome', 'Nome', '{{nome}}')}
          {linha('empresa', 'Empresa', '{{empresa}}')}
          {linha('email', 'E-mail', '{{email}}')}
          {linha('interesse', 'Interesse', '{{interesse}}')}
          <span className={HINT_CLASS}>Cliente já cadastrado: só abre o negócio (se não houver um aberto) e a atividade para o vendedor do revezamento.</span>
        </>
      )}

      {tipo === 'prospeccao' && (
        <>
          <FunilEtapa funilId={d.funil_id} etapaId={d.etapa_id} idCampo={id} onChange={set} />
          {linha('negocio', 'Título do negócio', 'Prospecção')}
          {linha('nome', 'Nome', '{{nome}}')}
          {linha('empresa', 'Empresa', '{{empresa}}')}
          {linha('email', 'E-mail', '{{email}}')}
          {textoCom('observacao', 'Observação da atividade (opcional)', 3)}
          <span className={HINT_CLASS}>
            Sem cadastro, a pessoa entra como lead. Já tendo negócio aberto nesse funil, usa ele; senão abre um novo para o vendedor do revezamento, com a atividade
            "Prospecção pelo WhatsApp". Vindo de uma campanha, o negócio fica ligado a ela.
          </span>
        </>
      )}

      {tipo === 'tarefa' && (
        <>
          <div className={FIELD_CLASS}>
            <label htmlFor={id('dep')} className={LABEL_CLASS}>Departamento (opcional)</label>
            <SelectAuto id={id('dep')} value={d.departamento_id ?? ''} onChange={(e) => set({ departamento_id: Number(e.target.value) || null })} className={`${campo} cursor-pointer`}>
              <option value="">Toda a equipe</option>
              {departamentos.map((x) => (
                <option key={x.value} value={x.value}>
                  {x.label}
                </option>
              ))}
            </SelectAuto>
          </div>
          {linha('assunto', 'Assunto', 'Retornar contato: {{nome}}')}
          {textoCom('observacao', 'Observação (opcional)', 3)}
          <span className={HINT_CLASS}>Tarefa com vencimento agora, ligada ao cliente se ele for cadastrado; o telefone do WhatsApp vai junto na observação. A conversa continua no próximo nó.</span>
        </>
      )}

      {tipo === 'departamento' && (
        <>
          <div className={FIELD_CLASS}>
            <label htmlFor={id('dep')} className={LABEL_CLASS}>Departamento</label>
            <SelectAuto id={id('dep')} value={d.departamento_id ?? ''} onChange={(e) => set({ departamento_id: Number(e.target.value) || null })} className={`${campo} cursor-pointer`}>
              <option value="">{departamentos.length ? 'Escolha...' : 'Cadastre em Cadastros › Departamentos'}</option>
              {departamentos.map((x) => (
                <option key={x.value} value={x.value}>
                  {x.label}
                </option>
              ))}
            </SelectAuto>
          </div>
          {textoCom('texto', 'Mensagem ao cliente (opcional)', 3)}
        </>
      )}

      {!['inicio', 'esperar', 'ia'].includes(tipo) && (
        <div className="flex flex-col gap-1">
          <span className={HINT_CLASS}>Variáveis que dá para usar nos textos:</span>
          <div className="flex flex-wrap gap-1">
            {variaveis.map((v) => (
              <code key={v} className="text-[10px] px-1.5 py-0.5 rounded bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300">{`{{${v}}}`}</code>
            ))}
          </div>
        </div>
      )}

      {tipo !== 'inicio' && !somenteLeitura && (
        <button type="button" onClick={onExcluir} className="self-start mt-2 text-xs font-semibold text-red-600 hover:underline cursor-pointer">
          Excluir este nó
        </button>
      )}
    </fieldset>
  );
};

/** Imagem do nó: enviada aqui (fica no CRM) ou por link https */
const CamposImagem: React.FC<{ d: Record<string, any>; set: (m: Record<string, any>) => void; onErro: (m: string) => void; idBase: string }> = ({ d, set, onErro, idBase }) => {
  const [previa, setPrevia] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const arquivoRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!d.arquivo_id) return setPrevia(null);
    let url: string | null = null;
    fetchArquivoJornada(d.arquivo_id)
      .then((u) => setPrevia((url = u)))
      .catch(() => setPrevia(null));
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [d.arquivo_id]);
  const escolher = async (f: File | undefined) => {
    if (arquivoRef.current) arquivoRef.current.value = '';
    if (!f) return;
    if (f.size > 3 * 1024 * 1024) return onErro('Imagem maior que 3 MB.');
    setEnviando(true);
    try {
      const base64 = await new Promise<string>((ok, erro) => {
        const r = new FileReader();
        r.onload = () => ok(String(r.result).split(',')[1] || '');
        r.onerror = () => erro(r.error);
        r.readAsDataURL(f);
      });
      const r = await enviarArquivoJornada(f.name, f.type, base64);
      set({ arquivo_id: r.id, arquivo_nome: r.nome, url: '' });
    } catch (err: any) {
      onErro(err.message);
    } finally {
      setEnviando(false);
    }
  };
  return (
    <>
      <input ref={arquivoRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={(e) => escolher(e.target.files?.[0])} className="hidden" />
      {previa && <img src={previa} alt={d.arquivo_nome || 'Imagem'} className="max-h-40 rounded-lg self-start" />}
      <button
        type="button"
        onClick={() => arquivoRef.current?.click()}
        disabled={enviando}
        className="self-start flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold border border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer disabled:opacity-50"
      >
        {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
        {d.arquivo_id ? 'Trocar imagem' : 'Enviar imagem (até 3 MB)'}
      </button>
      {!d.arquivo_id && (
        <div className={FIELD_CLASS}>
          <label htmlFor={`${idBase}-url`} className={LABEL_CLASS}>ou link da imagem (https)</label>
          <input id={`${idBase}-url`} value={d.url ?? ''} onChange={(e) => set({ url: e.target.value })} onFocus={selecionar} placeholder="https://..." className={campo} />
        </div>
      )}
      {d.arquivo_id && (
        <button type="button" onClick={() => set({ arquivo_id: null, arquivo_nome: '' })} className="self-start text-xs text-stone-500 hover:underline cursor-pointer">
          Usar um link no lugar
        </button>
      )}
      <div className={FIELD_CLASS}>
        <label htmlFor={`${idBase}-legenda`} className={LABEL_CLASS}>Legenda (opcional)</label>
        <textarea id={`${idBase}-legenda`} value={d.legenda ?? ''} onChange={(e) => set({ legenda: e.target.value })} rows={2} className={`${campo} resize-y`} />
      </div>
    </>
  );
};

/** Chamada de API: método, URL, cabeçalhos (secretos gravados cifrados), corpo e campos da resposta */
const CamposApi: React.FC<{
  d: Record<string, any>;
  set: (m: Record<string, any>) => void;
  setItem: (lista: string, i: number, m: Record<string, any>) => void;
  removerItem: (lista: string, i: number, nome: string) => void;
  idBase: string;
  botaoIncluir: (onClick: () => void, texto: string, disabled?: boolean) => React.ReactNode;
  botaoRemover: (onClick: () => void, titulo: string) => React.ReactNode;
}> = ({ d, set, setItem, removerItem, idBase, botaoIncluir, botaoRemover }) => (
  <>
    <div className="grid grid-cols-[6rem_1fr] gap-2">
      <SelectAuto aria-label="Método" value={d.metodo} onChange={(e) => set({ metodo: e.target.value })} className={`${campo} cursor-pointer`}>
        {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => (
          <option key={m}>{m}</option>
        ))}
      </SelectAuto>
      <input aria-label="URL" value={d.url ?? ''} onChange={(e) => set({ url: e.target.value })} onFocus={selecionar} placeholder="https://api.exemplo.com/clientes/{{numero}}" className={campo} />
    </div>
    <span className={LABEL_CLASS}>Cabeçalhos</span>
    {(d.cabecalhos ?? []).map((h: any, i: number) => (
      <div key={i} className="flex flex-col gap-1.5 p-2 rounded-lg bg-stone-50 dark:bg-stone-800/60">
        <div className="flex items-center gap-2">
          <input aria-label="Nome do cabeçalho" value={h.nome} onChange={(e) => setItem('cabecalhos', i, { nome: e.target.value })} onFocus={selecionar} placeholder="Authorization" className={campo} />
          {botaoRemover(() => removerItem('cabecalhos', i, 'o cabeçalho'), 'Remover o cabeçalho')}
        </div>
        <input
          aria-label="Valor do cabeçalho"
          type={h.secreto ? 'password' : 'text'}
          value={h.valor ?? ''}
          onChange={(e) => setItem('cabecalhos', i, { valor: e.target.value })}
          autoComplete="new-password"
          placeholder={h.secreto && h.definido ? 'Gravado — em branco mantém' : 'valor'}
          className={campo}
        />
        <Toggle size="sm" checked={Boolean(h.secreto)} onChange={(v) => setItem('cabecalhos', i, { secreto: v })} label="Secreto (gravado cifrado)" />
      </div>
    ))}
    {botaoIncluir(() => set({ cabecalhos: [...(d.cabecalhos ?? []), { nome: '', valor: '', secreto: false }] }), 'Cabeçalho')}
    {d.metodo !== 'GET' && (
      <div className={FIELD_CLASS}>
        <label htmlFor={`${idBase}-corpo`} className={LABEL_CLASS}>Corpo (JSON)</label>
        <textarea
          id={`${idBase}-corpo`}
          value={d.corpo ?? ''}
          onChange={(e) => set({ corpo: e.target.value })}
          rows={5}
          placeholder={'{ "telefone": "{{numero}}", "nome": "{{nome}}" }'}
          className={`${campo} resize-y font-mono text-[11px]`}
        />
      </div>
    )}
    <span className={LABEL_CLASS}>Guardar da resposta</span>
    {(d.extrair ?? []).map((e: any, i: number) => (
      <div key={i} className="flex items-center gap-2">
        <input aria-label="Caminho na resposta" value={e.caminho} onChange={(ev) => setItem('extrair', i, { caminho: ev.target.value })} onFocus={selecionar} placeholder="cliente.status" className={campo} />
        <span className="text-stone-400">→</span>
        <input aria-label="Variável" value={e.variavel} onChange={(ev) => setItem('extrair', i, { variavel: ev.target.value })} onFocus={selecionar} placeholder="status" className={campo} />
        {botaoRemover(() => removerItem('extrair', i, 'o campo'), 'Remover o campo')}
      </div>
    ))}
    {botaoIncluir(() => set({ extrair: [...(d.extrair ?? []), { caminho: '', variavel: '' }] }), 'Campo da resposta')}
    <span className={HINT_CLASS}>
      Só https; espera até 10 s; endereços internos são recusados. Sucesso = resposta 2xx. O código HTTP fica em {'{{api_status}}'}.
    </span>
  </>
);

/** Configurações › Jornada: editor gráfico da jornada de atendimento do WhatsApp */
export const ConfigJornada: React.FC<Props> = (props) => (
  <ReactFlowProvider>
    <Editor {...props} />
  </ReactFlowProvider>
);
