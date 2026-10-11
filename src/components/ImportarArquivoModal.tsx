import React, { useEffect, useMemo, useState } from 'react';
import { SelectAuto } from './SelectAuto';
import { ArrowLeft, ArrowRight, CheckCircle2, FileSpreadsheet, FileText, FileUp, Loader2, Upload, X } from 'lucide-react';
import { fetchCamposPersonalizados, importarPessoasArquivo } from '../services/api';
import { CampoPersonalizado } from '../types';
import { INPUT_CLASS, LABEL_CLASS, FIELD_CLASS, HINT_CLASS } from '../utils/formStyles';
import {
  PastaExcel,
  TipoArquivo,
  Trecho,
  abrirExcel,
  acharCabecalhoPdf,
  decodificarTexto,
  detectarSeparador,
  lerCsv,
  lerLinhasPdf,
  sugerirDePara,
  tabelaDoPdf,
  tipoDoArquivo,
  valorEndereco,
  valorPersonalizado,
} from '../utils/importarArquivo';
import { NumberField } from './NumberField';
import { DateField } from './DateField';
import { Toggle } from './Toggle';
import { AvisoErro } from './AvisoErro';

interface CampoImportacao {
  campo: string;
  rotulo: string;
  obrigatorio?: boolean;
  dica?: string;
  /** Campo personalizado (campo = "p:<nome>") */
  personalizado?: CampoPersonalizado;
  /** Título do bloco no de → para (aparece antes do primeiro campo do grupo) */
  grupo?: string;
}

const END = 'Endereço principal';

/** Campos da tabela pessoas que podem vir do arquivo */
const CAMPOS: CampoImportacao[] = [
  { campo: 'nome', rotulo: 'Nome', obrigatorio: true },
  { campo: 'cod_integracao', rotulo: 'Cód.Integração', dica: 'Chave: grava "ARQ-<código>" e acha quem já foi importado' },
  { campo: 'email', rotulo: 'E-mail' },
  { campo: 'telefone', rotulo: 'Telefone' },
  { campo: 'cpf', rotulo: 'CPF/CNPJ', dica: 'Sem código, é pelo CPF/CNPJ que se acha quem já existe' },
  { campo: 'segmento', rotulo: 'Segmento', dica: 'Pelo nome do segmento cadastrado' },
  { campo: 'obs', rotulo: 'Observação' },
  { campo: 'end_cep', rotulo: 'CEP', grupo: END },
  { campo: 'end_logradouro', rotulo: 'Logradouro', grupo: END, dica: 'Rua, avenida…' },
  { campo: 'end_numero', rotulo: 'Número', grupo: END },
  { campo: 'end_complemento', rotulo: 'Complemento', grupo: END },
  { campo: 'end_bairro', rotulo: 'Bairro', grupo: END },
  { campo: 'end_cidade', rotulo: 'Cidade', grupo: END },
  { campo: 'end_uf', rotulo: 'UF', grupo: END, dica: 'Sigla ou nome do estado' },
];

/** Como o arquivo deve trazer cada tipo de campo personalizado */
const DICA_TIPO: Record<string, string> = {
  texto: 'Texto',
  textarea: 'Texto',
  numero: 'Número inteiro',
  decimal: 'Número (1.234,56)',
  data: 'Data dd/mm/aaaa',
  boolean: 'Sim/Não, S/N, 1/0 ou X',
  lista: 'Uma das opções da lista',
};

/** Exemplo do de → para: personalizado já convertido para o tipo do campo */
const exemplo = (c: CampoImportacao, original: string) =>
  c.personalizado
    ? exibir(valorPersonalizado(original, c.personalizado.tipo, c.personalizado.opcoes), original, c.personalizado.tipo)
    : exibir(valorEndereco(c.campo, original), original, 'texto');

/** Valor convertido como o usuário lê: Sim/Não, dd/mm/aaaa, 1.234,56; ⚠ quando não serve */
const exibir = (v: string | boolean | null | undefined, original: string, tipo: string) => {
  if (v === undefined) return '';
  if (v === null) return `⚠ ${original}`;
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
  if (tipo === 'data') return v.split('-').reverse().join('/');
  if (tipo === 'decimal') return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return v;
};

const SEPARADORES = [
  { valor: ';', rotulo: 'Ponto e vírgula ( ; )' },
  { valor: ',', rotulo: 'Vírgula ( , )' },
  { valor: '\t', rotulo: 'Tabulação' },
  { valor: '|', rotulo: 'Barra vertical ( | )' },
];

const ETAPAS = [
  { id: 'arquivo', titulo: '1. Arquivo' },
  { id: 'formato', titulo: '2. Formato' },
  { id: 'depara', titulo: '3. De → para' },
  { id: 'revisao', titulo: '4. Importar' },
] as const;
type Etapa = (typeof ETAPAS)[number]['id'];

const LOTE = 1000;

interface Resultado {
  lidas: number;
  inseridos: number;
  atualizados: number;
  ignorados: number;
  semNome: number;
  enderecos: number;
  segmentosCriados: number;
  segmentosNaoEncontrados: string[];
}

/** Entrada do valor padrão conforme o tipo do campo; o valor sai no formato que o arquivo traria */
const CampoPadrao: React.FC<{ campo: CampoImportacao; value: string; onChange: (v: string) => void }> = ({
  campo,
  value,
  onChange,
}) => {
  const tipo = campo.personalizado?.tipo;
  if (tipo === 'lista' || tipo === 'boolean') {
    const opcoes = tipo === 'boolean' ? ['Sim', 'Não'] : campo.personalizado?.opcoes || [];
    return (
      <SelectAuto value={value} onChange={(e) => onChange(e.target.value)} className={INPUT_CLASS}>
        <option value="">—</option>
        {opcoes.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </SelectAuto>
    );
  }
  if (tipo === 'data') return <DateField value={value} onChange={onChange} className={INPUT_CLASS} />;
  if (tipo === 'numero' || tipo === 'decimal')
    return <NumberField value={value} onChange={onChange} scale={tipo === 'decimal' ? 2 : 0} className={INPUT_CLASS} />;
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onFocus={(e) => e.target.select()}
      className={`${INPUT_CLASS} min-w-0`}
    />
  );
};

/** Amostra de uma tabela lida do arquivo */
const Previa: React.FC<{ cabecalho: string[]; linhas: string[][]; destaque?: Set<number> }> = ({ cabecalho, linhas, destaque }) => (
  <div className="border border-stone-200 dark:border-stone-800 overflow-auto max-h-64">
    <table className="w-full text-[11px]">
      <thead className="sticky top-0 bg-stone-100 dark:bg-stone-800">
        <tr>
          {cabecalho.map((c, i) => (
            <th
              key={i}
              className={`px-2 py-1.5 text-left font-bold whitespace-nowrap ${
                destaque?.has(i) ? 'text-blue-700 dark:text-blue-300' : 'text-stone-600 dark:text-stone-300'
              }`}
            >
              {c || `Coluna ${i + 1}`}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
        {linhas.map((l, r) => (
          <tr key={r}>
            {cabecalho.map((_, i) => (
              <td key={i} className="px-2 py-1 whitespace-nowrap text-stone-700 dark:text-stone-200 max-w-56 truncate">
                {l[i]}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

interface Props {
  onFechar: () => void;
  onImportado: () => void;
}

/**
 * Importação de pessoas de um arquivo, em etapas: escolher o arquivo, ajustar o
 * formato conforme o tipo (CSV, Excel ou relatório PDF), ligar as colunas aos campos
 * do CRM e importar.
 */
export const ImportarArquivoModal: React.FC<Props> = ({ onFechar, onImportado }) => {
  const [etapa, setEtapa] = useState<Etapa>('arquivo');
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  const [arquivo, setArquivo] = useState<{ nome: string; tipo: TipoArquivo; buf: ArrayBuffer } | null>(null);
  // CSV
  const [codificacao, setCodificacao] = useState<'auto' | 'utf-8' | 'windows-1252'>('auto');
  const [separador, setSeparador] = useState(';');
  const [aspas, setAspas] = useState(true);
  // Excel
  const [pasta, setPasta] = useState<PastaExcel | null>(null);
  const [aba, setAba] = useState('');
  // PDF
  const [linhasPdf, setLinhasPdf] = useState<Trecho[][]>([]);
  const [distancia, setDistancia] = useState('6');
  const [minPreenchidas, setMinPreenchidas] = useState('2');
  // Comum
  const [ignorar, setIgnorar] = useState('0');
  const [temCabecalho, setTemCabecalho] = useState(true);

  const [dePara, setDePara] = useState<Record<string, number>>({});
  /** Valor padrão por campo: vale quando não há coluna ou a célula está vazia */
  const [padrao, setPadrao] = useState<Record<string, string>>({});
  const [atualizar, setAtualizar] = useState(true);
  const [criarSegmentos, setCriarSegmentos] = useState(true);
  const [personalizados, setPersonalizados] = useState<CampoPersonalizado[]>([]);

  useEffect(() => {
    fetchCamposPersonalizados()
      .then(setPersonalizados)
      .catch(() => setPersonalizados([]));
  }, []);

  /** Campos fixos + os personalizados definidos em Configurações */
  const campos = useMemo<CampoImportacao[]>(
    () => [
      ...CAMPOS,
      ...personalizados.map((c) => ({
        campo: `p:${c.nome}`,
        rotulo: c.rotulo,
        dica: c.tipo === 'lista' ? `Uma de: ${(c.opcoes || []).join(', ')}` : DICA_TIPO[c.tipo],
        personalizado: c,
        grupo: 'Campos personalizados',
      })),
    ],
    [personalizados],
  );
  const ligados = useMemo(
    () => campos.filter((c) => dePara[c.campo] >= 0 || padrao[c.campo]?.trim()),
    [campos, dePara, padrao],
  );
  /** Célula do arquivo ou, vazia/sem coluna, o valor padrão do campo */
  const valorDe = (c: CampoImportacao, linha: string[] | undefined) =>
    (dePara[c.campo] >= 0 ? (linha?.[dePara[c.campo]] ?? '') : '').trim() || (padrao[c.campo] ?? '').trim();
  const [importando, setImportando] = useState(false);
  const [progresso, setProgresso] = useState('');
  const [resultado, setResultado] = useState<Resultado | null>(null);

  const escolher = async (f: File | undefined) => {
    if (!f) return;
    const tipo = tipoDoArquivo(f.name);
    if (!tipo) return setErro('Tipo de arquivo não suportado. Use .csv, .txt, .xls, .xlsx, .ods ou .pdf.');
    setErro(null);
    setCarregando(true);
    try {
      const buf = await f.arrayBuffer();
      setIgnorar('0');
      setTemCabecalho(true);
      setDePara({});
      if (tipo === 'csv') {
        setCodificacao('auto');
        setSeparador(detectarSeparador(decodificarTexto(buf)));
      } else if (tipo === 'excel') {
        const p = await abrirExcel(buf);
        setPasta(p);
        setAba(p.abas[0] || '');
      } else {
        const linhas = await lerLinhasPdf(buf);
        if (!linhas.length) throw new Error('Não há texto neste PDF (pode ser uma imagem digitalizada).');
        setLinhasPdf(linhas);
        setIgnorar(String(Math.max(0, acharCabecalhoPdf(linhas, Number(distancia) || 0))));
      }
      setArquivo({ nome: f.name, tipo, buf });
    } catch (err: any) {
      setArquivo(null);
      setErro(`Não foi possível ler o arquivo: ${err.message || err}`);
    } finally {
      setCarregando(false);
    }
  };

  /** Arquivo inteiro como tabela de textos, conforme o formato escolhido */
  const bruta = useMemo<string[][]>(() => {
    if (!arquivo) return [];
    const inicio = Number(ignorar) || 0;
    if (arquivo.tipo === 'csv') return lerCsv(decodificarTexto(arquivo.buf, codificacao), separador, aspas ? '"' : '').slice(inicio);
    if (arquivo.tipo === 'excel') return pasta && aba ? pasta.ler(aba).slice(inicio) : [];
    return tabelaDoPdf(linhasPdf.slice(inicio), 0, Number(distancia) || 0);
  }, [arquivo, codificacao, separador, aspas, pasta, aba, linhasPdf, distancia, ignorar]);

  /** Cabeçalho e linhas de dados; no PDF o cabeçalho é obrigatório (ele define as colunas) */
  const { cabecalho, dados } = useMemo(() => {
    const comCab = temCabecalho || arquivo?.tipo === 'pdf';
    const colunas = Math.max(0, ...bruta.map((l) => l.length));
    const cab = comCab ? Array.from({ length: colunas }, (_, i) => (bruta[0]?.[i] || '').trim()) : [];
    let linhas = comCab ? bruta.slice(1) : bruta;
    if (arquivo?.tipo === 'pdf') {
      // Tira o cabeçalho repetido em cada página, rodapés e linhas soltas
      const chave = cab.join('|');
      const min = Number(minPreenchidas) || 1;
      linhas = linhas.filter((l) => l.join('|') !== chave && l.filter((c) => c.trim()).length >= min);
    }
    return {
      cabecalho: comCab ? cab.map((c, i) => c || `Coluna ${i + 1}`) : Array.from({ length: colunas }, (_, i) => `Coluna ${i + 1}`),
      dados: linhas,
    };
  }, [bruta, temCabecalho, arquivo, minPreenchidas]);

  /**
   * Linhas prontas para o servidor, só com os valores do arquivo; os padrões vão à
   * parte (`padraoEnvio`), porque só completam as pessoas novas. Os personalizados já
   * vão convertidos para o formato do cadastro; valor que não serve para o tipo do
   * campo fica de fora (e é contado em `invalidos`). A prévia mostra como fica uma
   * pessoa nova: arquivo + padrão.
   */
  const { mapeadas, previa, invalidos, padraoEnvio, semNome } = useMemo(() => {
    let invalidos = 0;
    const montar = (valor: (c: CampoImportacao) => string) => {
      const o: Record<string, any> = {};
      const extras: Record<string, string | boolean> = {};
      const exibicao: string[] = [];
      for (const c of ligados) {
        const original = valor(c);
        if (!c.personalizado) {
          if (original) o[c.campo] = original;
          const v = valorEndereco(c.campo, original);
          if (v === null) invalidos++;
          exibicao.push(v === null ? `⚠ ${original}` : (v ?? ''));
          continue;
        }
        const v = valorPersonalizado(original, c.personalizado.tipo, c.personalizado.opcoes);
        if (v === null) invalidos++;
        else if (v !== undefined) extras[c.personalizado.nome] = v;
        exibicao.push(exibir(v, original, c.personalizado.tipo));
      }
      if (Object.keys(extras).length) o.personalizados = extras;
      return { o, exibicao };
    };
    const doArquivo = (c: CampoImportacao, l: string[]) => (dePara[c.campo] >= 0 ? (l[dePara[c.campo]] ?? '') : '').trim();
    const mapeadas = dados.map((l) => montar((c) => doArquivo(c, l)).o);
    const padraoEnvio = montar((c) => (padrao[c.campo] ?? '').trim()).o;
    // Inválidos contados uma vez, como fica a pessoa nova (arquivo + padrão)
    invalidos = 0;
    const previa = dados.map((l) => montar((c) => valorDe(c, l)).exibicao).slice(0, 10);
    const semNome = padraoEnvio.nome ? 0 : mapeadas.filter((l) => !l.nome).length;
    return { mapeadas, previa, invalidos, padraoEnvio, semNome };
  }, [dados, dePara, padrao, ligados]);

  const avancar = () => {
    setErro(null);
    if (etapa === 'arquivo') {
      if (!arquivo) return setErro('Escolha o arquivo a importar.');
      return setEtapa('formato');
    }
    if (etapa === 'formato') {
      if (!dados.length) return setErro('Nenhuma linha de dados com esse formato. Revise as opções.');
      // Sugere o de → para pelos nomes das colunas; mantém o que o usuário já escolheu
      const sugestao = sugerirDePara(cabecalho, campos);
      setDePara((atual) => {
        const valido = Object.values(atual).every((i) => i < cabecalho.length);
        return Object.keys(atual).length && valido ? { ...sugestao, ...atual } : sugestao;
      });
      return setEtapa('depara');
    }
    if (etapa === 'depara') {
      if (!(dePara.nome >= 0) && !padrao.nome?.trim()) return setErro('Escolha a coluna do Nome ou informe um padrão.');
      return setEtapa('revisao');
    }
  };

  const voltar = () => {
    setErro(null);
    const i = ETAPAS.findIndex((e) => e.id === etapa);
    if (i > 0) setEtapa(ETAPAS[i - 1].id);
  };

  const importar = async () => {
    setImportando(true);
    setErro(null);
    const total: Resultado = {
      lidas: mapeadas.length,
      inseridos: 0,
      atualizados: 0,
      ignorados: 0,
      semNome: 0,
      enderecos: 0,
      segmentosCriados: 0,
      segmentosNaoEncontrados: [],
    };
    try {
      for (let i = 0; i < mapeadas.length; i += LOTE) {
        setProgresso(`${Math.min(i + LOTE, mapeadas.length)} de ${mapeadas.length}`);
        const r = await importarPessoasArquivo(mapeadas.slice(i, i + LOTE), { atualizar, criarSegmentos, padrao: padraoEnvio });
        total.inseridos += r.inseridos;
        total.atualizados += r.atualizados;
        total.ignorados += r.ignorados;
        total.semNome += r.semNome;
        total.enderecos += r.enderecos;
        total.segmentosCriados += r.segmentosCriados;
        total.segmentosNaoEncontrados = [...new Set([...total.segmentosNaoEncontrados, ...r.segmentosNaoEncontrados])];
      }
      setResultado(total);
      onImportado();
    } catch (err: any) {
      // Os lotes anteriores já foram gravados: mostra o que entrou até a falha
      if (total.inseridos || total.atualizados) setResultado(total);
      setErro(err.message || 'Não foi possível importar as pessoas.');
    } finally {
      setImportando(false);
      setProgresso('');
    }
  };

  const idxEtapa = ETAPAS.findIndex((e) => e.id === etapa);

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-stone-950/70 backdrop-blur-xs" onClick={importando ? undefined : onFechar} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-5xl max-h-[90vh] flex flex-col bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 shadow-2xl z-10"
      >
        <div className="px-5 py-4 border-b border-stone-200 dark:border-stone-800 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-stone-900 dark:text-stone-100">Importar pessoas de arquivo</h3>
            <p className="text-[11px] text-stone-500 dark:text-stone-400 truncate">
              {arquivo ? arquivo.nome : 'Planilha Excel, arquivo CSV/TXT ou relatório em PDF'}
            </p>
          </div>
          <button
            type="button"
            onClick={onFechar}
            disabled={importando}
            title="Fechar"
            className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Etapas: só volta para as já vistas */}
        <div className="bg-stone-50 dark:bg-stone-950/60 border-b border-stone-200 dark:border-stone-800 flex overflow-x-auto shrink-0">
          {ETAPAS.map((e, i) => (
            <button
              key={e.id}
              type="button"
              disabled={i > idxEtapa || importando || !!resultado}
              onClick={() => setEtapa(e.id)}
              className={`px-4 py-2.5 text-xs font-bold shrink-0 border-b-2 transition-all enabled:cursor-pointer ${
                etapa === e.id
                  ? 'border-blue-600 text-blue-600 bg-white dark:bg-stone-900 dark:text-blue-400'
                  : i < idxEtapa
                    ? 'border-transparent text-stone-500 hover:text-stone-700 dark:hover:text-stone-200'
                    : 'border-transparent text-stone-300 dark:text-stone-600'
              }`}
            >
              {e.titulo}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto min-h-0 p-5 space-y-4">
          {etapa === 'arquivo' && (
            <>
              <label
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  escolher(e.dataTransfer.files[0]);
                }}
                className="flex flex-col items-center justify-center gap-2 py-10 border-2 border-dashed border-stone-300 dark:border-stone-700 hover:border-blue-500 hover:bg-blue-50/50 dark:hover:bg-blue-950/20 cursor-pointer text-center"
              >
                {carregando ? (
                  <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
                ) : (
                  <FileUp className="w-8 h-8 text-stone-400" />
                )}
                <span className="text-sm font-semibold text-stone-700 dark:text-stone-200">
                  {carregando ? 'Lendo o arquivo…' : 'Clique para escolher ou arraste o arquivo aqui'}
                </span>
                <span className={HINT_CLASS}>.xls, .xlsx, .ods, .csv, .txt ou .pdf</span>
                <input
                  type="file"
                  accept=".csv,.txt,.xls,.xlsx,.ods,.pdf"
                  className="hidden"
                  disabled={carregando}
                  onChange={(e) => {
                    escolher(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </label>
              {arquivo && (
                <div className="flex items-center gap-2.5 p-3 bg-stone-50 dark:bg-stone-800/60 text-xs">
                  {arquivo.tipo === 'pdf' ? (
                    <FileText className="w-4 h-4 text-rose-600" />
                  ) : (
                    <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                  )}
                  <span className="font-semibold text-stone-800 dark:text-stone-100 truncate">{arquivo.nome}</span>
                  <span className="text-stone-500 dark:text-stone-400 shrink-0">
                    {arquivo.tipo === 'csv' ? 'Texto separado' : arquivo.tipo === 'excel' ? 'Planilha' : `Relatório PDF · ${linhasPdf.length} linhas de texto`}
                  </span>
                </div>
              )}
            </>
          )}

          {etapa === 'formato' && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {arquivo?.tipo === 'csv' && (
                  <>
                    <div className={FIELD_CLASS}>
                      <label htmlFor="imp-sep" className={LABEL_CLASS}>Separador de campos</label>
                      <SelectAuto id="imp-sep" value={separador} onChange={(e) => setSeparador(e.target.value)} className={INPUT_CLASS}>
                        {SEPARADORES.map((s) => (
                          <option key={s.rotulo} value={s.valor}>{s.rotulo}</option>
                        ))}
                      </SelectAuto>
                    </div>
                    <div className={FIELD_CLASS}>
                      <label htmlFor="imp-cod" className={LABEL_CLASS}>Codificação</label>
                      <SelectAuto id="imp-cod" value={codificacao} onChange={(e) => setCodificacao(e.target.value as any)} className={INPUT_CLASS}>
                        <option value="auto">Automática</option>
                        <option value="utf-8">UTF-8</option>
                        <option value="windows-1252">Windows (ANSI)</option>
                      </SelectAuto>
                    </div>
                    <div className={FIELD_CLASS}>
                      <span className={LABEL_CLASS}>Textos entre aspas</span>
                      <div className="h-[34px] flex items-center">
                        <Toggle checked={aspas} onChange={setAspas} size="sm" title='Campos entre aspas ("...") podem conter o separador' />
                      </div>
                    </div>
                  </>
                )}
                {arquivo?.tipo === 'excel' && pasta && (
                  <div className={`${FIELD_CLASS} col-span-2`}>
                    <label htmlFor="imp-aba" className={LABEL_CLASS}>Planilha (aba)</label>
                    <SelectAuto id="imp-aba" value={aba} onChange={(e) => setAba(e.target.value)} className={INPUT_CLASS}>
                      {pasta.abas.map((a) => (
                        <option key={a} value={a}>{a}</option>
                      ))}
                    </SelectAuto>
                  </div>
                )}
                {arquivo?.tipo === 'pdf' && (
                  <>
                    <div className={FIELD_CLASS}>
                      <label htmlFor="imp-dist" className={LABEL_CLASS}>Espaço entre colunas (pt)</label>
                      <NumberField id="imp-dist" value={distancia} onChange={setDistancia} className={INPUT_CLASS} />
                    </div>
                    <div className={FIELD_CLASS}>
                      <label htmlFor="imp-min" className={LABEL_CLASS}>Mínimo de colunas preenchidas</label>
                      <NumberField id="imp-min" value={minPreenchidas} onChange={setMinPreenchidas} className={INPUT_CLASS} />
                    </div>
                  </>
                )}
                <div className={FIELD_CLASS}>
                  <label htmlFor="imp-ign" className={LABEL_CLASS}>Linhas a ignorar no início</label>
                  <NumberField id="imp-ign" value={ignorar} onChange={setIgnorar} className={INPUT_CLASS} />
                </div>
                {arquivo?.tipo !== 'pdf' && (
                  <div className={FIELD_CLASS}>
                    <span className={LABEL_CLASS}>1ª linha é cabeçalho</span>
                    <div className="h-[34px] flex items-center">
                      <Toggle checked={temCabecalho} onChange={setTemCabecalho} size="sm" />
                    </div>
                  </div>
                )}
              </div>
              <p className={HINT_CLASS}>
                {arquivo?.tipo === 'pdf'
                  ? 'As colunas vêm da linha de cabeçalho do relatório: ignore as linhas acima dela (título, empresa, data). Cabeçalhos repetidos em cada página e linhas com poucas colunas (rodapé, totais) ficam de fora. Se colunas vizinhas se juntarem, diminua o espaço entre colunas; se uma coluna se partir, aumente.'
                  : 'Confira na prévia se as colunas saíram separadas corretamente.'}
              </p>
              <div>
                <p className={`${LABEL_CLASS} mb-1.5`}>
                  Prévia — {dados.length} linha(s) de dados, {cabecalho.length} coluna(s)
                </p>
                <Previa cabecalho={cabecalho} linhas={dados.slice(0, 15)} />
              </div>
            </>
          )}

          {etapa === 'depara' && (
            <>
              <div className="border border-stone-200 dark:border-stone-800 divide-y divide-stone-100 dark:divide-stone-800">
                <div className="grid grid-cols-[1.2fr_16px_1fr_1fr_1fr] items-center gap-3 px-3 py-2 bg-stone-50 dark:bg-stone-800/60 text-[11px] font-bold text-stone-500 dark:text-stone-400">
                  <span>Campo do CRM</span>
                  <span />
                  <span>Coluna do arquivo</span>
                  <span title="Gravado quando não há coluna ou a célula do arquivo está vazia">Padrão</span>
                  <span>Exemplo (1ª linha)</span>
                </div>
                {campos.map((c, i) => (
                  <React.Fragment key={c.campo}>
                  {c.grupo && c.grupo !== campos[i - 1]?.grupo && (
                    <div className="px-3 py-1.5 bg-stone-50 dark:bg-stone-800/60 text-[11px] font-bold text-stone-500 dark:text-stone-400">
                      {c.grupo}
                    </div>
                  )}
                  <div className="grid grid-cols-[1.2fr_16px_1fr_1fr_1fr] items-center gap-3 px-3 py-1.5">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-stone-800 dark:text-stone-100">
                        {c.rotulo}
                        {c.obrigatorio && <span className="text-rose-500 ml-1">*</span>}
                      </p>
                      {c.dica && <p className={`${HINT_CLASS} truncate`} title={c.dica}>{c.dica}</p>}
                    </div>
                    <ArrowLeft className="w-3.5 h-3.5 text-stone-300 dark:text-stone-600" />
                    <SelectAuto
                      value={dePara[c.campo] ?? -1}
                      required={c.obrigatorio}
                      onChange={(e) => setDePara((d) => ({ ...d, [c.campo]: Number(e.target.value) }))}
                      className={INPUT_CLASS}
                    >
                      <option value={-1}>— sem coluna —</option>
                      {cabecalho.map((h, i) => (
                        <option key={i} value={i}>{h}</option>
                      ))}
                    </SelectAuto>
                    <CampoPadrao
                      campo={c}
                      value={padrao[c.campo] ?? ''}
                      onChange={(v) => setPadrao((p) => ({ ...p, [c.campo]: v }))}
                    />
                    <span className="text-xs text-stone-500 dark:text-stone-400 truncate">{exemplo(c, valorDe(c, dados[0]))}</span>
                  </div>
                  </React.Fragment>
                ))}
              </div>
              <p className={HINT_CLASS}>
                O padrão completa as pessoas novas quando o campo não tem coluna ou a célula do arquivo está vazia; quem
                já existe não é alterado pelo padrão. As pessoas importadas entram como "Cliente".
              </p>
            </>
          )}

          {etapa === 'revisao' && (
            <>
              <div className="grid grid-cols-3 gap-3">
                {[
                  ['Linhas no arquivo', dados.length],
                  ['Com nome', dados.length - semNome],
                  ['Sem nome', semNome],
                ].map(([r, v]) => (
                  <div key={r} className="p-3 bg-stone-50 dark:bg-stone-800/60">
                    <p className={LABEL_CLASS}>{r}</p>
                    <p className="text-lg font-bold text-stone-900 dark:text-stone-100 tabular-nums">{v}</p>
                  </div>
                ))}
              </div>
              <Toggle
                checked={atualizar}
                onChange={setAtualizar}
                size="sm"
                disabled={importando || !!resultado}
                label="Atualizar quem já existe no CRM"
                title="Acha pelo Cód.Integração ou, sem ele, pelo CPF/CNPJ. Célula vazia no arquivo não apaga o que já está no CRM."
              />
              <p className={HINT_CLASS}>
                {dePara.cod_integracao >= 0
                  ? 'Quem já existe é achado pelo Cód.Integração (ARQ-<código>).'
                  : dePara.cpf >= 0
                    ? 'Sem Cód.Integração: quem já existe é achado pelo CPF/CNPJ.'
                    : 'Sem Cód.Integração nem CPF/CNPJ: todas as linhas serão incluídas como pessoas novas.'}{' '}
                Linhas sem nome só servem para atualizar quem já existe.
              </p>
              {ligados.some((c) => c.campo === 'segmento') && (
                <Toggle
                  checked={criarSegmentos}
                  onChange={setCriarSegmentos}
                  size="sm"
                  disabled={importando || !!resultado}
                  label="Criar os segmentos que ainda não existem"
                  title="Desligado, o segmento que não estiver cadastrado fica em branco na pessoa."
                />
              )}
              {invalidos > 0 && (
                <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                  {invalidos} valor(es) não servem para o campo (marcados com ⚠: CEP, UF ou campo personalizado) e ficam em
                  branco.
                </p>
              )}
              <div>
                <p className={`${LABEL_CLASS} mb-1.5`}>Como os dados vão entrar</p>
                <Previa
                  cabecalho={ligados.map((c) => c.rotulo)}
                  linhas={previa}
                />
              </div>
              {resultado && (
                <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 flex items-start gap-2.5 text-xs text-emerald-800 dark:text-emerald-200">
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
                  <div>
                    <p className="font-semibold">Importação concluída</p>
                    <p className="mt-0.5">
                      {resultado.lidas} linha(s): {resultado.inseridos} incluída(s), {resultado.atualizados} atualizada(s)
                      {resultado.ignorados ? `, ${resultado.ignorados} já existia(m) e não foi(ram) alterada(s)` : ''}
                      {resultado.semNome ? `, ${resultado.semNome} sem nome ignorada(s)` : ''}.
                    </p>
                    {resultado.enderecos > 0 && <p className="mt-0.5">{resultado.enderecos} endereço(s) gravado(s).</p>}
                    {resultado.segmentosCriados > 0 && <p className="mt-0.5">{resultado.segmentosCriados} segmento(s) criado(s).</p>}
                    {resultado.segmentosNaoEncontrados.length > 0 && (
                      <p className="mt-0.5 text-amber-700 dark:text-amber-400">
                        Segmento(s) não cadastrado(s), deixado(s) em branco: {resultado.segmentosNaoEncontrados.join(', ')}.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} />}
        </div>

        <div className="px-5 py-3 border-t border-stone-200 dark:border-stone-800 flex items-center gap-2.5 bg-stone-50 dark:bg-stone-950/40">
          {idxEtapa > 0 && !resultado && (
            <button
              type="button"
              onClick={voltar}
              disabled={importando}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-xs font-semibold text-stone-600 dark:text-stone-300 border border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer disabled:opacity-40"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Voltar</span>
            </button>
          )}
          <div className="flex-1" />
          <button
            type="button"
            onClick={onFechar}
            disabled={importando}
            className="px-4 py-2.5 rounded-lg text-xs font-semibold text-stone-600 dark:text-stone-300 border border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer disabled:opacity-40"
          >
            {resultado ? 'Fechar' : 'Cancelar'}
          </button>
          {etapa !== 'revisao' ? (
            <button
              type="button"
              onClick={avancar}
              disabled={carregando}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white cursor-pointer disabled:opacity-50"
            >
              <span>Avançar</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            !resultado && (
              <button
                type="button"
                onClick={importar}
                disabled={importando}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white cursor-pointer disabled:opacity-50"
              >
                {importando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                <span>{importando ? `Importando… ${progresso}` : `Importar ${dados.length} linha(s)`}</span>
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
};

/** Botão da barra de ferramentas da lista de pessoas */
export const BotaoImportarArquivo: React.FC<{ onImportado: () => void }> = ({ onImportado }) => {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <button
        onClick={() => setAberto(true)}
        title="Importar pessoas de planilha Excel, CSV ou relatório PDF"
        className="flex items-center gap-1.5 border border-stone-300 dark:border-stone-700 text-stone-700 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer shrink-0 whitespace-nowrap"
      >
        <FileUp className="w-3.5 h-3.5" />
        <span>Importar</span>
      </button>
      {aberto && <ImportarArquivoModal onFechar={() => setAberto(false)} onImportado={onImportado} />}
    </>
  );
};
