import React, { useEffect, useRef, useState } from 'react';
import { BarChart3, Code2, LineChart, Loader2, Printer, MessageSquarePlus, MessagesSquare, PieChart, Send, Sparkles, Table2, UserRound } from 'lucide-react';
import { GraficoConsulta, perguntarConsulta, ResultadoConsulta } from '../services/api';
import { formatarSql } from '../utils/formatters';
import { INPUT_CLASS } from '../utils/formStyles';
import { ConfirmDialog } from './ConfirmDialog';

interface Mensagem {
  id: number;
  de: 'pessoa' | 'ia';
  texto: string;
  sql?: string;
  resultado?: ResultadoConsulta | null;
  grafico?: GraficoConsulta | null;
  /** Pergunta que gerou a resposta (título da impressão) */
  pergunta?: string;
  /** Dúvida da IA: opções para o usuário escolher (uma ou várias) */
  opcoes?: { lista: string[]; multipla: boolean } | null;
  erro?: boolean;
}

const EXEMPLOS = [
  'Quantos clientes eu tenho em Rio do Sul?',
  'Mostre os clientes de Ituporanga',
  'Quais clientes não compram há mais de 90 dias?',
  'Gráfico das vendas por mês nos últimos 12 meses',
  'Gráfico de pizza dos clientes por cidade (10 maiores)',
];

/** Colunas de código (id, CPF, telefone...): o número aparece como veio, sem ponto de milhar */
const COLUNA_CODIGO = /(^id$|_id$|^c[oó]d|codigo|c[oó]digo|n[uú]mero|^n[ºo°]|cpf|cnpj|telefone|celular|whatsapp|cep|ano)/i;

function formatarCelula(v: unknown, tipo: ResultadoConsulta['colunas'][number]['tipo'], coluna: string): string {
  if (v === null || v === undefined || v === '') return '';
  if (tipo === 'numero') {
    const n = Number(v);
    if (!Number.isFinite(n) || COLUNA_CODIGO.test(coluna)) return String(v);
    const casas = Math.min(String(v).split('.')[1]?.length ?? 0, 4);
    return n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
  }
  if (tipo === 'data' || tipo === 'datahora') {
    const [d, h] = String(v).split(' ');
    const data = d.split('-').reverse().join('/');
    return tipo === 'datahora' && h ? `${data} ${h.slice(0, 5)}` : data;
  }
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

/** Resultado em grade, no visual das listas do sistema: datas centralizadas, números à direita */
const Grade: React.FC<{ r: ResultadoConsulta }> = ({ r }) => (
  <div className="max-h-[60vh] overflow-auto rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900">
    <table className="w-full text-xs border-separate border-spacing-0">
      <thead className="sticky top-0 z-10">
        <tr className="bg-stone-50 dark:bg-stone-950">
          {r.colunas.map((c, i) => (
            <th
              key={i}
              className={`px-3 py-2.5 font-semibold text-stone-600 dark:text-stone-300 whitespace-nowrap border-b border-stone-200 dark:border-stone-800 ${
                c.tipo === 'numero' ? 'text-right' : c.tipo === 'texto' ? 'text-left' : 'text-center'
              }`}
            >
              {c.nome}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {r.linhas.map((l, i) => (
          <tr key={i} className="hover:bg-blue-50/60 dark:hover:bg-blue-950/30 even:bg-stone-50/50 dark:even:bg-stone-950/30">
            {r.colunas.map((c, j) => (
              <td
                key={j}
                className={`px-3 py-[7.5px] text-stone-700 dark:text-stone-200 border-b border-stone-100 dark:border-stone-800/60 max-w-[28rem] truncate ${
                  c.tipo === 'numero' ? 'text-right tabular-nums' : c.tipo === 'texto' ? 'text-left' : 'text-center'
                }`}
                title={formatarCelula(l[j], c.tipo, c.nome)}
              >
                {formatarCelula(l[j], c.tipo, c.nome)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);


const CORES = ['#2563eb', '#16a34a', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#ea580c', '#64748b'];
const compacto = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
const cheio = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

/** Passo "redondo" do eixo (1, 2 ou 5 × 10ⁿ) */
function passoEixo(faixa: number): number {
  const bruto = faixa / 5 || 1;
  const pot = 10 ** Math.floor(Math.log10(bruto));
  return [1, 2, 5, 10].map((m) => m * pot).find((p) => p >= bruto) ?? bruto;
}

const html = (t: unknown) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Imprime a tabela do resultado (com a pergunta e a resposta no topo), por um iframe escondido */
function imprimirResultado(m: Mensagem) {
  const r = m.resultado;
  if (!r) return;
  const alinhar = (t: string) => (t === 'numero' ? 'right' : t === 'texto' ? 'left' : 'center');
  const agora = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const doc = `<!doctype html><html><head><meta charset="utf-8"><title>Consulta</title><style>
    body { font-family: Arial, sans-serif; font-size: 11px; color: #111; margin: 16px; }
    h1 { font-size: 15px; margin: 0 0 4px; } p { margin: 0 0 4px; } .rodape { color: #666; margin-bottom: 10px; }
    table { width: 100%; border-collapse: collapse; } th, td { border: 1px solid #ccc; padding: 4px 6px; }
    th { background: #f2f2f2; } tr { page-break-inside: avoid; } thead { display: table-header-group; }
  </style></head><body>
    <h1>${html(m.pergunta)}</h1><p>${html(m.texto)}</p>
    <p class="rodape">${r.linhas.length.toLocaleString('pt-BR')} registro(s)${r.truncado ? ' (só os primeiros)' : ''} • ${agora}</p>
    <table><thead><tr>${r.colunas.map((c) => `<th style="text-align:${alinhar(c.tipo)}">${html(c.nome)}</th>`).join('')}</tr></thead>
    <tbody>${r.linhas
      .map((l) => `<tr>${r.colunas.map((c, j) => `<td style="text-align:${alinhar(c.tipo)}">${html(formatarCelula(l[j], c.tipo, c.nome))}</td>`).join('')}</tr>`)
      .join('')}</tbody></table></body></html>`;
  const quadro = document.createElement('iframe');
  quadro.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
  document.body.appendChild(quadro);
  const w = quadro.contentWindow!;
  w.document.open();
  w.document.write(doc);
  w.document.close();
  w.focus();
  w.print();
  setTimeout(() => quadro.remove(), 1000);
}

/** Gráfico em SVG (barras, linha ou pizza) do resultado da consulta; o valor exato fica na dica do mouse */
const Grafico: React.FC<{ r: ResultadoConsulta; g: GraficoConsulta }> = ({ r, g }) => {
  const ix = r.colunas.findIndex((c) => c.nome === g.x);
  const series = g.y.map((nome) => r.colunas.findIndex((c) => c.nome === nome)).filter((i) => i >= 0);
  let pontos = r.linhas.map((l) => ({ rotulo: formatarCelula(l[ix], r.colunas[ix].tipo, r.colunas[ix].nome) || '(vazio)', valores: series.map((i) => Number(l[i]) || 0) }));

  if (g.tipo === 'pizza') {
    // Até 9 fatias; o resto vira "Outros"
    pontos = [...pontos].sort((a, b) => b.valores[0] - a.valores[0]);
    if (pontos.length > 10) pontos = [...pontos.slice(0, 9), { rotulo: 'Outros', valores: [pontos.slice(9).reduce((s, p) => s + p.valores[0], 0)] }];
    const total = pontos.reduce((s, p) => s + Math.max(p.valores[0], 0), 0) || 1;
    let angulo = -Math.PI / 2;
    return (
      <div className="flex flex-col sm:flex-row items-center gap-6 p-4">
        <svg viewBox="0 0 240 240" className="w-56 h-56 shrink-0">
          {pontos.map((p, i) => {
            const fatia = (Math.max(p.valores[0], 0) / total) * Math.PI * 2;
            const a0 = angulo;
            angulo += fatia;
            const [x0, y0, x1, y1] = [120 + 110 * Math.cos(a0), 120 + 110 * Math.sin(a0), 120 + 110 * Math.cos(angulo), 120 + 110 * Math.sin(angulo)];
            const d = fatia >= Math.PI * 2 - 1e-6 ? 'M120,10 A110,110 0 1,1 119.99,10 Z' : `M120,120 L${x0},${y0} A110,110 0 ${fatia > Math.PI ? 1 : 0},1 ${x1},${y1} Z`;
            return (
              <path key={i} d={d} fill={CORES[i % CORES.length]} stroke="white" strokeWidth={1.5}>
                <title>{`${p.rotulo}: ${cheio(p.valores[0])} (${((p.valores[0] / total) * 100).toFixed(1)}%)`}</title>
              </path>
            );
          })}
        </svg>
        <ul className="flex flex-col gap-1.5 text-xs text-stone-700 dark:text-stone-200 min-w-0">
          {pontos.map((p, i) => (
            <li key={i} className="flex items-center gap-2 min-w-0">
              <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: CORES[i % CORES.length] }} />
              <span className="truncate">{p.rotulo}</span>
              <span className="ml-auto pl-3 tabular-nums text-stone-500">{((Math.max(p.valores[0], 0) / total) * 100).toFixed(1)}%</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  pontos = pontos.slice(0, 60); // ponytail: mais que 60 pontos não cabe legível; a tabela mostra tudo
  const W = 800;
  const H = 320;
  const inclinar = pontos.length > 8;
  const M = { l: 64, r: 16, t: 14, b: inclinar ? 86 : 34 };
  const todos = pontos.flatMap((p) => p.valores);
  const passo = passoEixo(Math.max(...todos, 0) - Math.min(...todos, 0));
  const max = Math.ceil(Math.max(...todos, 0) / passo) * passo || passo;
  const min = Math.floor(Math.min(...todos, 0) / passo) * passo;
  const [pw, ph] = [W - M.l - M.r, H - M.t - M.b];
  const y = (v: number) => M.t + (1 - (v - min) / (max - min)) * ph;
  const larg = pw / pontos.length;
  const cx = (i: number) => M.l + larg * (i + 0.5);
  const ticks = Array.from({ length: Math.round((max - min) / passo) + 1 }, (_, i) => min + i * passo);
  const cadaRotulo = Math.ceil(pontos.length / 30);

  return (
    <div className="p-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto text-stone-500 dark:text-stone-400">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} stroke="currentColor" strokeOpacity={t === 0 ? 0.5 : 0.15} />
            <text x={M.l - 8} y={y(t)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill="currentColor">
              {compacto.format(t)}
            </text>
          </g>
        ))}
        {pontos.map((p, i) =>
          i % cadaRotulo ? null : (
            <text
              key={i}
              x={cx(i)}
              y={H - M.b + 14}
              fontSize={11}
              fill="currentColor"
              textAnchor={inclinar ? 'end' : 'middle'}
              transform={inclinar ? `rotate(-40 ${cx(i)} ${H - M.b + 14})` : undefined}
            >
              {p.rotulo.length > 16 ? `${p.rotulo.slice(0, 15)}…` : p.rotulo}
            </text>
          ),
        )}
        {g.tipo === 'barras'
          ? pontos.map((p, i) =>
              p.valores.map((v, s) => {
                const bw = (larg * 0.75) / p.valores.length;
                const x = M.l + larg * i + larg * 0.125 + bw * s;
                return (
                  <rect key={`${i}-${s}`} x={x} width={Math.max(bw - 1, 1)} y={Math.min(y(v), y(0))} height={Math.abs(y(v) - y(0))} rx={2} fill={CORES[s % CORES.length]}>
                    <title>{`${p.rotulo} — ${g.y[s]}: ${cheio(v)}`}</title>
                  </rect>
                );
              }),
            )
          : series.map((_, s) => (
              <g key={s}>
                <polyline points={pontos.map((p, i) => `${cx(i)},${y(p.valores[s])}`).join(' ')} fill="none" stroke={CORES[s % CORES.length]} strokeWidth={2.5} />
                {pontos.map((p, i) => (
                  <circle key={i} cx={cx(i)} cy={y(p.valores[s])} r={3.5} fill={CORES[s % CORES.length]}>
                    <title>{`${p.rotulo} — ${g.y[s]}: ${cheio(p.valores[s])}`}</title>
                  </circle>
                ))}
              </g>
            ))}
      </svg>
      {g.y.length > 1 && (
        <div className="flex flex-wrap justify-center gap-4 text-xs text-stone-600 dark:text-stone-300">
          {g.y.map((nome, s) => (
            <span key={nome} className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm" style={{ background: CORES[s % CORES.length] }} />
              {nome}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

const TIPOS_GRAFICO = [
  { tipo: 'barras', nome: 'Barras', icone: BarChart3 },
  { tipo: 'linha', nome: 'Linha', icone: LineChart },
  { tipo: 'pizza', nome: 'Pizza', icone: PieChart },
] as const;

/** Resposta da IA: a frase, o gráfico (quando pedido), a grade (quando há mais que um número) e o SQL sob demanda */
/** Opções da pergunta de volta da IA: um clique responde; na múltipla escolha, marca e envia. Só a última vale */
const Opcoes: React.FC<{ o: { lista: string[]; multipla: boolean }; ativa: boolean; onEscolher: (texto: string) => void }> = ({ o, ativa, onEscolher }) => {
  const [marcadas, setMarcadas] = useState<string[]>([]);
  const marcar = (t: string) => setMarcadas((l) => (l.includes(t) ? l.filter((x) => x !== t) : [...l, t]));
  const juntar = (l: string[]) => (l.length > 1 ? `${l.slice(0, -1).join(', ')} e ${l[l.length - 1]}` : l[0]);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {o.lista.map((t) => {
          const marcada = marcadas.includes(t);
          return (
            <button
              key={t}
              type="button"
              disabled={!ativa}
              onClick={() => (o.multipla ? marcar(t) : onEscolher(t))}
              aria-pressed={o.multipla ? marcada : undefined}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border cursor-pointer disabled:cursor-default disabled:opacity-50 ${
                marcada
                  ? 'border-blue-500 bg-blue-600 text-white'
                  : 'border-blue-200 dark:border-blue-900 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/40'
              }`}
            >
              {o.multipla && <span className={`w-3 h-3 rounded-sm border ${marcada ? 'bg-white border-white' : 'border-current'}`} />}
              {t}
            </button>
          );
        })}
        {o.multipla && (
          <button
            type="button"
            disabled={!ativa || !marcadas.length}
            onClick={() => onEscolher(juntar(o.lista.filter((t) => marcadas.includes(t))))}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white cursor-pointer disabled:opacity-40 disabled:cursor-default"
          >
            <Send className="w-3 h-3" /> Enviar {marcadas.length > 0 ? `(${marcadas.length})` : ''}
          </button>
        )}
      </div>
      {ativa && <p className="text-[11px] text-stone-500 dark:text-stone-400">{o.multipla ? 'Marque uma ou mais e envie' : 'Escolha uma'}, ou escreva outra resposta abaixo.</p>}
    </div>
  );
};

const RespostaIa: React.FC<{ m: Mensagem; admin: boolean; ativa: boolean; onEscolher: (texto: string) => void }> = ({ m, admin, ativa, onEscolher }) => {
  const [verSql, setVerSql] = useState(false);
  const r = m.resultado;
  const soUmValor = r && r.linhas.length === 1 && r.colunas.length === 1;
  // Gráfico só quando a pergunta pediu (o padrão é tabela); os botões trocam o tipo dele
  const possivel = m.grafico ?? null;
  const [grafico, setGrafico] = useState<GraficoConsulta | null>(m.grafico ?? null);
  const [verTabela, setVerTabela] = useState(!m.grafico);
  const botao = (ativo: boolean) =>
    `inline-flex items-center gap-1 px-2 py-1 rounded-md border cursor-pointer ${
      ativo ? 'border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300' : 'border-stone-200 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800'
    }`;
  return (
    <div className="flex flex-col gap-2 min-w-0 w-full">
      <p className={`text-sm whitespace-pre-wrap ${m.erro ? 'text-rose-600' : 'text-stone-800 dark:text-stone-100'}`}>{m.texto}</p>
      {m.opcoes && <Opcoes o={m.opcoes} ativa={ativa} onEscolher={onEscolher} />}
      {r && grafico && (
        <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 max-w-4xl">
          <Grafico r={r} g={grafico} />
        </div>
      )}
      {r && !soUmValor && (!grafico || verTabela) && (r.linhas.length ? <Grade r={r} /> : <p className="text-xs text-stone-500">Nenhum registro encontrado.</p>)}
      {r && (
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-stone-500 dark:text-stone-400">
          {!soUmValor && (
            <span>
              {r.linhas.length.toLocaleString('pt-BR')} registro(s){r.truncado ? ` (só os primeiros ${r.linhas.length}; refine a pergunta para ver o resto)` : ''}
            </span>
          )}
          {possivel && !soUmValor && (
            <span className="inline-flex items-center gap-1">
              {TIPOS_GRAFICO.map(({ tipo, nome, icone: Icone }) => (
                <button
                  key={tipo}
                  type="button"
                  onClick={() => setGrafico(grafico?.tipo === tipo ? null : { ...possivel, tipo, y: tipo === 'pizza' ? possivel.y.slice(0, 1) : possivel.y })}
                  title={grafico?.tipo === tipo ? 'Esconder o gráfico' : `Gráfico de ${nome.toLowerCase()}`}
                  className={botao(grafico?.tipo === tipo)}
                >
                  <Icone className="w-3 h-3" /> {nome}
                </button>
              ))}
              {grafico && (
                <button type="button" onClick={() => setVerTabela(!verTabela)} title="Mostrar ou esconder a tabela com os dados" className={botao(verTabela)}>
                  <Table2 className="w-3 h-3" /> Tabela
                </button>
              )}
            </span>
          )}
          {!soUmValor && r.linhas.length > 0 && (
            <button type="button" onClick={() => imprimirResultado(m)} title="Imprimir a tabela com o resultado" className={botao(false)}>
              <Printer className="w-3 h-3" /> Imprimir
            </button>
          )}
          {/* O SQL só para o administrador */}
          {admin && m.sql && (
            <button type="button" onClick={() => setVerSql(!verSql)} className="inline-flex items-center gap-1 font-semibold text-blue-600 hover:underline cursor-pointer">
              <Code2 className="w-3 h-3" /> {verSql ? 'Esconder o SQL' : 'Ver o SQL'}
            </button>
          )}
        </div>
      )}
      {admin && verSql && m.sql && (
        <pre className="max-h-80 overflow-auto rounded-lg bg-stone-50 dark:bg-stone-900 border border-stone-200 dark:border-stone-700 p-2.5 font-mono text-[11px] leading-relaxed whitespace-pre select-all">
          {formatarSql(m.sql)}
        </pre>
      )}
    </div>
  );
};

/**
 * Marketing › Consultas: chat com os dados. Cada pergunta vai com as últimas falas (para "e em Ituporanga?" funcionar);
 * a IA monta o SELECT, o servidor roda isolado na empresa e a resposta volta com o resultado em grade.
 */
export const ConsultasView: React.FC<{ admin: boolean }> = ({ admin }) => {
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [limpando, setLimpando] = useState(false);
  const fim = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fim.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [mensagens, enviando]);

  const enviar = async (pergunta: string) => {
    pergunta = pergunta.trim();
    if (!pergunta || enviando) return;
    const historico = mensagens
      .filter((m) => !m.erro)
      .map((m) => ({ de: m.de, texto: m.de === 'ia' ? JSON.stringify({ sql: m.sql ?? '', resposta: m.texto, grafico: m.grafico ?? null, opcoes: m.opcoes ?? null }) : m.texto }));
    // Resposta a uma dúvida da IA: o título (impressão) é a pergunta original com a escolha
    const ultima = mensagens[mensagens.length - 1];
    const original = ultima?.opcoes ? (ultima.pergunta ?? [...mensagens].reverse().find((m) => m.de === 'pessoa')?.texto) : undefined;
    const titulo = original ? `${original} (${pergunta})` : pergunta;
    setMensagens((l) => [...l, { id: Date.now(), de: 'pessoa', texto: pergunta }]);
    setTexto('');
    setEnviando(true);
    try {
      const r = await perguntarConsulta(pergunta, historico);
      setMensagens((l) => [...l, { id: Date.now(), de: 'ia', texto: r.resposta, sql: r.sql, resultado: r.resultado, grafico: r.grafico, opcoes: r.opcoes, pergunta: titulo }]);
    } catch (e: any) {
      setMensagens((l) => [...l, { id: Date.now(), de: 'ia', texto: e.message, erro: true }]);
    } finally {
      setEnviando(false);
      campo.current?.focus();
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="max-w-6xl mx-auto flex flex-col gap-5">
          {!mensagens.length && (
            <div className="py-16 text-center flex flex-col items-center gap-3">
              <MessagesSquare className="w-10 h-10 text-blue-600/70" />
              <p className="text-sm font-semibold text-stone-700 dark:text-stone-200">Pergunte sobre os seus dados</p>
              <p className="text-xs text-stone-500 dark:text-stone-400 max-w-md">
                Clientes, vendas, negócios, chamados, campanhas… A IA monta a consulta e mostra o resultado em tabela. Exemplos:
              </p>
              <div className="flex flex-wrap justify-center gap-2 mt-1">
                {EXEMPLOS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => enviar(e)}
                    className="px-3 py-1.5 rounded-full text-xs border border-stone-300 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:bg-blue-50 hover:border-blue-300 dark:hover:bg-blue-950/40 cursor-pointer"
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
          )}
          {mensagens.map((m, i) =>
            m.de === 'pessoa' ? (
              <div key={m.id} className="flex justify-end gap-2.5">
                <p className="max-w-[80%] rounded-2xl rounded-tr-sm bg-blue-600 text-white px-3.5 py-2 text-sm whitespace-pre-wrap">{m.texto}</p>
                <UserRound className="w-6 h-6 shrink-0 p-1 rounded-full bg-stone-200 dark:bg-stone-800 text-stone-500" />
              </div>
            ) : (
              <div key={m.id} className="flex gap-2.5 min-w-0">
                <Sparkles className="w-6 h-6 shrink-0 p-1 rounded-full bg-blue-100 dark:bg-blue-950 text-blue-600" />
                <RespostaIa m={m} admin={admin} ativa={i === mensagens.length - 1 && !enviando} onEscolher={enviar} />
              </div>
            ),
          )}
          {enviando && (
            <div className="flex gap-2.5 items-center text-xs text-stone-500">
              <Sparkles className="w-6 h-6 shrink-0 p-1 rounded-full bg-blue-100 dark:bg-blue-950 text-blue-600" />
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Consultando…
            </div>
          )}
          <div ref={fim} />
        </div>
      </div>

      <div className="shrink-0 border-t border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 px-4 sm:px-6 lg:px-8 py-3">
        <form
          className="max-w-6xl mx-auto flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            enviar(texto);
          }}
        >
          <button
            type="button"
            onClick={() => setLimpando(true)}
            disabled={!mensagens.length || enviando}
            title="Nova conversa"
            className="h-10 px-3 rounded-lg border border-stone-300 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer disabled:opacity-40"
          >
            <MessageSquarePlus className="w-4 h-4" />
          </button>
          <textarea
            ref={campo}
            autoFocus
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                enviar(texto);
              }
            }}
            rows={1}
            maxLength={2000}
            placeholder="Pergunte… (Enter envia, Shift+Enter quebra a linha)"
            aria-label="Pergunta"
            className={`${INPUT_CLASS} flex-1 min-h-10 max-h-40 resize-y`}
          />
          <button
            type="submit"
            disabled={!texto.trim() || enviando}
            className="h-10 flex items-center gap-1.5 px-4 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white cursor-pointer disabled:opacity-40"
          >
            {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Enviar
          </button>
        </form>
      </div>

      {limpando && (
        <ConfirmDialog
          titulo="Começar uma nova conversa?"
          mensagem="As perguntas e respostas desta conversa saem da tela."
          confirmar="Nova conversa"
          onConfirmar={() => {
            setMensagens([]);
            setLimpando(false);
            campo.current?.focus();
          }}
          onCancelar={() => setLimpando(false)}
        />
      )}
    </div>
  );
};
