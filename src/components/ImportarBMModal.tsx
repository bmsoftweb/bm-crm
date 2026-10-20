import React, { useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, Code2, Download, FlaskConical, KeyRound, Loader2, RotateCcw, Save, X } from 'lucide-react';
import {
  conferirTokenBM,
  credencialBM,
  fetchSqlVendasBM,
  gravarMapaVendasBM,
  gravarSqlVendasBM,
  gravarTokenBM,
  importarBM,
  testarSqlVendasBM,
  type CredencialBM,
  type TesteSqlVendas,
} from '../services/api';
import { lerSessao } from '../utils/session';
import { INPUT_CLASS, LABEL_CLASS, FIELD_CLASS, HINT_CLASS } from '../utils/formStyles';
import { hojeIso } from '../utils/formatters';
import { DateField } from './DateField';
import { SelectBusca } from './SelectBusca';
import { AvisoErro } from './AvisoErro';

type Tipo = 'pessoas' | 'produtos' | 'vendas';

interface ImportarBMModalProps {
  tipo: Tipo;
  onFechar: () => void;
  /** Chamado ao fim de uma importação bem-sucedida, para recarregar a lista */
  onImportado: () => void;
}

/** O que muda entre as importações: tabela, de → para (coluna do bmsoft → campo do CRM) e regra */
const TIPOS: Record<Tipo, { titulo: string; tabela: string; nome: string; dePara: [string, string][]; regra: string }> = {
  pessoas: {
    titulo: 'Importar pessoas do bmsoft',
    tabela: 'PESSOAS',
    nome: 'pessoa(s)',
    dePara: [
      ['PESSOAS.ID', 'Cód.Integração: BM-<id> (chave)'],
      ['Nome', 'Nome'],
      ['Email', 'E-mail'],
      ['Fone1 / Celular / Fone2', 'Telefone'],
      ['CPFCNPJ', 'CPF'],
      ['Obs', 'Observação'],
      ['Ativo', 'Ativo'],
      ['ID_Vendedor → VENDEDORES.Nome', 'Revenda (campo personalizado, se existir)'],
      ['Endereco, Numero, Bairro, CEP, Cidade, UF', 'Endereço principal (marcado "Importado do bmsoft")'],
    ],
    regra: 'Entram ativas e inativas (a inativa fica marcada, mas continua nas listas para propostas). Quem já foi importado antes é atualizado; o resto é incluído.',
  },
  produtos: {
    titulo: 'Importar produtos do bmsoft',
    tabela: 'PRODUTOSPRINCIPAL',
    nome: 'produto(s)',
    dePara: [
      ['PRODUTOSPRINCIPAL.ID', 'Cód.Integração: BM-<id> (chave) e SKU'],
      ['Descricao', 'Nome'],
      ['Texto', 'Descrição'],
      ['PrecoVenda1', 'Preço de Tabela'],
      ['UNVenda', 'Unidade'],
      ['Ativo', 'Ativo'],
    ],
    regra: 'Entram os produtos ativos. Os já importados são atualizados, inclusive desativados quando ficam inativos no bmsoft.',
  },
  vendas: {
    titulo: 'Importar vendas do bmsoft',
    tabela: 'NFMESTRE e NFPRODUTOS',
    nome: 'produto(s) vendido(s)',
    dePara: [
      ['NFMESTRE.ID → cod_integracao', 'Cód.Integração da NF: BM-<id>'],
      ['Geracao_Data, Numero, CFOP, Total_Nota', 'nf_data, nf_numero, nf_cfop, nf_valor_total'],
      ['Cliente_Doc (ou PESSOAS.CPFCNPJ), Cliente_Nome', 'cli_cnpj, cli_nome'],
      ['PESSOAS Cidade, Bairro, UF', 'cli_cidade, cli_bairro, cli_uf'],
      ['NFPRODUTOS.ID_Produto', 'pro_cod_integracao: BM-<id>'],
      ['PRODUTOSPRINCIPAL Descricao, Marca, Classe', 'pro_descricao, pro_marca, pro_classe'],
      ['PRODUTOSCLASSE.Descricao', 'pro_classe_descricao'],
      ['Qtdade, Un, Preco_Venda', 'pro_qtdade, pro_un, pro_preco_venda'],
      ['Valor_Contabil, Custo_Total', 'pro_valor_total, pro_custo_unit'],
      ['Cancelado', 'cancelado (S/N)'],
    ],
    regra:
      'Entram as notas de venda do período (Tipo_Op 1, 2 ou 5), uma linha por produto; as canceladas vêm marcadas. Importar o mesmo período de novo substitui as vendas que vieram do BM nele; as incluídas à mão ficam.',
  },
};

/** 1º dia do mês atual (aaaa-mm-dd), início padrão do período das vendas */
const inicioDoMes = () => `${hojeIso().slice(0, 8)}01`;

interface Resultado {
  servidor: string;
  lidos: number;
  inseridos: number;
  atualizados: number;
  inalterados: number;
  /** Produtos: inativos no bmsoft que nunca vieram (não entram) */
  inativos?: number;
  /** Pessoas: quantas vieram inativas do bmsoft */
  inativas?: number;
  /** Pessoas: endereços do bmsoft incluídos e atualizados */
  enderecos?: { incluidos: number; atualizados: number };
  /** Vendas: notas lidas e linhas do período substituídas */
  notas?: number;
  substituidas?: number;
}

/** Importa as pessoas do bmsoft pela bmAPI, casando por PESSOAS.ID = cod_integracao */
export const ImportarBMModal: React.FC<ImportarBMModalProps> = ({ tipo, onFechar, onImportado }) => {
  const t = TIPOS[tipo];
  /** Token gravado da empresa (null = carregando) */
  const [cred, setCred] = useState<CredencialBM | null>(null);
  const [trocando, setTrocando] = useState(false);
  const [token, setToken] = useState('');
  const [importando, setImportando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  /** Vendas: período das notas */
  const [de, setDe] = useState(inicioDoMes);
  const [ate, setAte] = useState(hojeIso);
  /** Vendas: SQL no BM (config sql-vendas). Aberto = editando; gravado = o que está no banco */
  /** Vendas: aba da janela (a do SQL não polui a importação) */
  const [aba, setAba] = useState<'importar' | 'sql'>('importar');
  const [sql, setSql] = useState('');
  const [sqlGravado, setSqlGravado] = useState<{ sql: string; padrao: boolean; colunas: string[] } | null>(null);
  /** Vendas: de onde vem cada campo (Campos importados): o da tela e o gravado */
  const [mapa, setMapa] = useState<Record<string, string>>({});
  const [mapaGravado, setMapaGravado] = useState<{ mapa: Record<string, string>; padrao: boolean } | null>(null);
  const [destinos, setDestinos] = useState<{ campo: string; rotulo: string }[]>([]);
  const [mapaOriginal, setMapaOriginal] = useState<Record<string, string>>({});
  const [gravandoMapa, setGravandoMapa] = useState(false);
  const [sqlOcupado, setSqlOcupado] = useState<'testar' | 'gravar' | null>(null);
  const [teste, setTeste] = useState<TesteSqlVendas | null>(null);
  const admin = lerSessao()?.usuario.tipo === 'admin';
  useEffect(() => {
    if (tipo !== 'vendas') return;
    fetchSqlVendasBM()
      .then((r) => {
        setSqlGravado(r);
        setSql(r.sql);
        setMapa(r.mapa);
        setMapaGravado({ mapa: r.mapa, padrao: r.mapaPadrao });
        setDestinos(r.destinos);
        setMapaOriginal(r.mapaOriginal);
      })
      .catch((err) => setErro(err.message));
  }, [tipo]);
  const testarSql = async () => {
    setSqlOcupado('testar');
    setErro(null);
    setTeste(null);
    try {
      setTeste(await testarSqlVendasBM(sql, de, ate, mapa));
    } catch (err: any) {
      setErro(err.message);
    } finally {
      setSqlOcupado(null);
    }
  };
  const gravarSql = async (texto: string) => {
    setSqlOcupado('gravar');
    setErro(null);
    try {
      const r = await gravarSqlVendasBM(texto);
      setSqlGravado((g) => ({ ...r, colunas: g?.colunas ?? [] }));
      setSql(r.sql);
    } catch (err: any) {
      setErro(err.message);
    } finally {
      setSqlOcupado(null);
    }
  };
  /** SQL da tela diferente do gravado: a importação usa o gravado */
  const sqlAlterado = Boolean(sqlGravado) && sql.trim() !== sqlGravado!.sql.trim();
  /** Grade do Testar: todos os campos de vendas_produtos (datas centralizadas, números à direita) */
  const NUMEROS = ['nf_valor_total', 'pro_qtdade', 'pro_preco_venda', 'pro_valor_total', 'pro_custo_unit'];
  const alinhar = (campo: string) => (campo === 'nf_data' || campo === 'cancelado' || campo === 'cli_uf' ? 'text-center' : NUMEROS.includes(campo) ? 'text-right' : 'text-left');
  const mostrar = (campo: string, valor: unknown) => {
    if (valor === null || valor === undefined || valor === '') return '—';
    if (campo === 'nf_data') return String(valor).split('-').reverse().join('/');
    if (campo === 'pro_qtdade') return Number(valor).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
    if (NUMEROS.includes(campo)) return Number(valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return String(valor);
  };
  /** Colunas para escolher em cada campo: as esperadas, as do último Testar e as combinações já usadas no mapa */
  const opcoesColunas = [
    ...new Set([...(sqlGravado?.colunas ?? []), ...(teste?.colunas ?? []), ...Object.values(mapaOriginal), ...Object.values(mapa)].map((c) => String(c ?? '').trim()).filter(Boolean)),
  ].map((c) => ({ value: c, label: c }));
  /** Campos importados alterados e não gravados */
  const normal = (t: string | undefined) => String(t ?? '').toLowerCase().split(',').map((c) => c.trim()).filter(Boolean).join(', ');
  const mapaAlterado = Boolean(mapaGravado) && destinos.some((d) => normal(mapa[d.campo]) !== normal(mapaGravado!.mapa[d.campo]));
  const gravarMapa = async (novo: Record<string, string> | null) => {
    setGravandoMapa(true);
    setErro(null);
    try {
      const r = await gravarMapaVendasBM(novo);
      setMapa(r.mapa);
      setMapaGravado({ mapa: r.mapa, padrao: r.mapaPadrao });
    } catch (err: any) {
      setErro(err.message);
    } finally {
      setGravandoMapa(false);
    }
  };

  useEffect(() => {
    credencialBM()
      .then(setCred)
      .catch((err) => {
        setCred({ definido: false });
        setErro(err.message);
      });
  }, []);

  /** Pede o token: nenhum gravado, o gravado não vale mais, ou o usuário quer trocar */
  const pedeToken = Boolean(cred) && (!cred!.definido || Boolean(cred!.erro) || trocando);

  /** Servidor do token digitado: texto, "procurando" ou o motivo de não achar */
  const [identificacao, setIdentificacao] = useState<{ texto: string; ok: boolean } | null>(null);
  // Cada token digitado busca a identificação do servidor (com uma pausa, para não consultar a cada tecla)
  useEffect(() => {
    const t = token.trim();
    if (!t) {
      setIdentificacao(null);
      return;
    }
    let vivo = true;
    setIdentificacao({ texto: 'procurando…', ok: true });
    const espera = setTimeout(async () => {
      try {
        const r = await conferirTokenBM(t);
        if (vivo) setIdentificacao({ texto: r.servidor, ok: true });
      } catch (err: any) {
        if (vivo) setIdentificacao({ texto: err.message || 'Token não encontrado.', ok: false });
      }
    }, 400);
    return () => {
      vivo = false;
      clearTimeout(espera);
    };
  }, [token]);

  const importar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pedeToken && !token.trim()) return setErro('Informe o token da bmAPI.');
    if (pedeToken && identificacao && !identificacao.ok) return setErro(identificacao.texto);
    if (tipo === 'vendas' && (!de || !ate)) return setErro('Informe o período das notas.');
    if (tipo === 'vendas' && de > ate) return setErro('A data inicial é depois da final.');
    if (tipo === 'vendas' && sqlAlterado) return setErro('O SQL foi alterado e não foi gravado: grave (ou desfaça) antes de importar.');
    if (tipo === 'vendas' && mapaAlterado) return setErro('Os campos importados foram alterados e não foram gravados: grave (ou desfaça) antes de importar.');
    setImportando(true);
    setErro(null);
    try {
      // Token novo: grava primeiro (o servidor confere na bmAPI de qual servidor ele é)
      if (pedeToken) {
        setCred(await gravarTokenBM(token.trim()));
        setTrocando(false);
        setToken('');
      }
      setResultado(await importarBM(tipo, tipo === 'vendas' ? { de, ate } : undefined));
      onImportado();
    } catch (err: any) {
      setErro(err.message || `Não foi possível importar ${tipo === 'pessoas' ? 'as pessoas' : tipo === 'vendas' ? 'as vendas' : 'os produtos'}.`);
    } finally {
      setImportando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-stone-950/70 backdrop-blur-xs" onClick={importando ? undefined : onFechar} aria-hidden="true" />
      <form
        onSubmit={importar}
        role="dialog"
        aria-modal="true"
        className={`relative w-full ${tipo === 'vendas' && aba === 'sql' ? 'max-w-4xl' : 'max-w-lg'} max-h-[92vh] flex flex-col bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl shadow-2xl z-10`}
      >
        <div className="px-5 py-4 border-b border-stone-200 dark:border-stone-800 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-stone-900 dark:text-stone-100">{t.titulo}</h3>
            <p className="text-[11px] text-stone-500 dark:text-stone-400">Leitura direta da tabela {t.tabela} pela bmAPI</p>
          </div>
          <button
            type="button"
            onClick={onFechar}
            title="Fechar"
            className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {tipo === 'vendas' && (
          <div role="tablist" className="px-5 pt-2 flex gap-1 border-b border-stone-200 dark:border-stone-800">
            {(
              [
                ['importar', 'Importar'],
                ['sql', 'SQL do BM'],
              ] as const
            ).map(([id, nome]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={aba === id}
                onClick={() => setAba(id)}
                className={`flex items-center gap-1.5 px-3 py-2 -mb-px border-b-2 text-xs font-semibold cursor-pointer ${
                  aba === id
                    ? 'border-blue-600 text-blue-700 dark:text-blue-300'
                    : 'border-transparent text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200'
                }`}
              >
                {id === 'sql' && <Code2 className="w-3.5 h-3.5" />}
                {nome}
                {id === 'sql' && sqlAlterado && <span className="w-1.5 h-1.5 rounded-full bg-amber-500" title="SQL alterado e não gravado" />}
              </button>
            ))}
          </div>
        )}

        <div className="p-5 space-y-4 overflow-y-auto min-h-0">
          {aba === 'importar' && (!cred ? (
            <Loader2 className="w-4 h-4 animate-spin text-stone-400" />
          ) : pedeToken ? (
            <div className={FIELD_CLASS}>
              <label htmlFor="imp-token" className={LABEL_CLASS}>
                Token da bmAPI<span className="text-rose-500 ml-1">*</span>
              </label>
              <div className="flex items-center gap-3">
                <input
                  id="imp-token"
                  type="password"
                  autoFocus
                  autoComplete="off"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  onFocus={(e) => e.target.select()}
                  maxLength={64}
                  disabled={importando || !!resultado}
                  className={`${INPUT_CLASS} w-44 shrink-0`}
                />
                {identificacao && (
                  <span
                    className={`text-xs font-semibold truncate min-w-0 flex-1 ${
                      identificacao.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                    }`}
                    title={identificacao.texto}
                  >
                    {identificacao.texto}
                  </span>
                )}
                {trocando && (
                  <button type="button" onClick={() => setTrocando(false)} className="text-xs font-semibold text-stone-500 hover:underline cursor-pointer">
                    Cancelar
                  </button>
                )}
              </div>
              {cred.erro && <p className="text-xs font-semibold text-rose-600 dark:text-rose-400">Token gravado não vale mais: {cred.erro}</p>}
              <p className={HINT_CLASS}>
                O token (X-API-Key) do servidor da bmAPI. Ele identifica o servidor e fica gravado, cifrado, para as próximas importações.
              </p>
            </div>
          ) : (
            <div className={FIELD_CLASS}>
              <span className={LABEL_CLASS}>Servidor da bmAPI</span>
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5" /> {cred.servidor}
                </span>
                {!resultado && (
                  <button type="button" onClick={() => setTrocando(true)} disabled={importando} className="text-xs font-semibold text-blue-600 hover:underline cursor-pointer disabled:opacity-40">
                    Trocar token
                  </button>
                )}
              </div>
              <p className={HINT_CLASS}>Token gravado: o servidor vem dele.</p>
            </div>
          ))}

          {tipo === 'vendas' && (
            <div className="grid grid-cols-2 gap-3">
              <div className={FIELD_CLASS}>
                <label htmlFor="imp-de" className={LABEL_CLASS}>Notas de</label>
                <DateField id="imp-de" value={de} onChange={setDe} required className={`${INPUT_CLASS} w-full`} />
              </div>
              <div className={FIELD_CLASS}>
                <label htmlFor="imp-ate" className={LABEL_CLASS}>Até</label>
                <DateField id="imp-ate" value={ate} onChange={setAte} required className={`${INPUT_CLASS} w-full`} />
              </div>
            </div>
          )}

          {aba === 'sql' && sqlGravado && (
            <div>
                <div className="flex flex-col gap-2">
                  <p className="text-xs font-semibold text-stone-700 dark:text-stone-200">
                    SQL das vendas no BM <span className="font-normal text-stone-400">{sqlGravado.padrao ? '(padrão do CRM)' : '(personalizado)'}</span>
                    {sqlAlterado && <span className="text-amber-600 dark:text-amber-400"> • alterado, não gravado</span>}
                  </p>
                  <textarea
                    value={sql}
                    onChange={(e) => {
                      setSql(e.target.value);
                      setTeste(null);
                    }}
                    readOnly={!admin}
                    rows={10}
                    spellCheck={false}
                    aria-label="SQL das vendas no BM"
                    className={`${INPUT_CLASS} w-full font-mono text-[11px] leading-snug resize-y`}
                  />
                  <p className={HINT_CLASS}>
                    Use <b>:data_de</b> e <b>:data_ate</b> (o período acima) e <b>:ultimo</b> com <b>ORDER BY …ID TOP …</b> (a leitura é em páginas pelo
                    ID). Colunas esperadas: {sqlGravado.colunas.join(', ')}. {admin ? '' : 'Só um administrador pode alterar.'}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={testarSql}
                      disabled={!!sqlOcupado || !cred?.definido}
                      title="Roda a primeira página no BM com o período acima; nada é gravado no CRM"
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-stone-300 dark:border-stone-700 text-stone-700 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer disabled:opacity-40"
                    >
                      {sqlOcupado === 'testar' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FlaskConical className="w-3.5 h-3.5" />} Testar
                    </button>
                    {admin && (
                      <>
                        <button
                          type="button"
                          onClick={() => gravarSql(sql)}
                          disabled={!!sqlOcupado || !sqlAlterado}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white cursor-pointer disabled:opacity-40"
                        >
                          {sqlOcupado === 'gravar' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Gravar SQL
                        </button>
                        <button
                          type="button"
                          onClick={() => gravarSql('')}
                          disabled={!!sqlOcupado || sqlGravado.padrao}
                          title="Volta ao SQL padrão do CRM"
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-stone-300 dark:border-stone-700 text-stone-700 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer disabled:opacity-40"
                        >
                          <RotateCcw className="w-3.5 h-3.5" /> Restaurar padrão
                        </button>
                      </>
                    )}
                  </div>
                  {teste && (
                    <div className="rounded-lg bg-stone-50 dark:bg-stone-800/60 p-2.5 text-[11px] text-stone-700 dark:text-stone-200 flex flex-col gap-1.5">
                      <p>
                        <b>{teste.quantidade}</b> linha(s) na primeira página (máx. {teste.pagina}) em {teste.segundos.toLocaleString('pt-BR')} s — servidor{' '}
                        {teste.servidor}.{teste.quantidade === 0 && ' Nenhuma venda no período (ou o filtro não achou nada).'}
                      </p>
                      {teste.obrigatoriasFaltando.length > 0 && (
                        <p className="font-semibold text-rose-600">Faltam colunas obrigatórias: {teste.obrigatoriasFaltando.join(', ')}.</p>
                      )}
                      {teste.faltando.length > 0 && (
                        <p className="text-amber-700 dark:text-amber-400">Colunas não encontradas (o campo fica vazio): {teste.faltando.join(', ')}.</p>
                      )}
                      {teste.exemplos.length > 0 && (
                        <div className="overflow-auto max-h-48">
                          <table className="w-full whitespace-nowrap">
                            <thead className="text-stone-400">
                              <tr>
                                {destinos.map((d) => (
                                  <th key={d.campo} title={d.campo} className={`pr-3 ${alinhar(d.campo)}`}>
                                    {d.rotulo}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {teste.exemplos.map((v, i) => (
                                <tr key={i} className="border-t border-stone-200 dark:border-stone-700">
                                  {destinos.map((d) => (
                                    <td key={d.campo} className={`pr-3 ${alinhar(d.campo)} ${d.campo === 'pro_descricao' ? 'max-w-48 truncate' : ''}`}>
                                      {mostrar(d.campo, v[d.campo])}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
            </div>
          )}

          {aba === 'importar' && (
          <>
          <div>
            <p className={`${LABEL_CLASS} mb-1.5`}>
              Campos importados
              {tipo === 'vendas' && mapaGravado && (
                <span className="font-normal text-stone-400"> {mapaGravado.padrao ? '(padrão)' : '(personalizado)'}</span>
              )}
              {tipo === 'vendas' && mapaAlterado && <span className="font-normal text-amber-600 dark:text-amber-400"> • alterado, não gravado</span>}
            </p>
            {tipo === 'vendas' && destinos.length > 0 ? (
              <>
                <div className="rounded-lg border border-stone-200 dark:border-stone-800 divide-y divide-stone-100 dark:divide-stone-800">
                  <div className="flex items-center gap-2 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-stone-400 bg-stone-50 dark:bg-stone-800/60 rounded-t-lg">
                    <span className="flex-1">Coluna do SQL do BM</span>
                    <span className="w-3" />
                    <span className="w-40 shrink-0">Campo em vendas_produtos</span>
                  </div>
                  {destinos.map((d) => (
                    <div key={d.campo} className="flex items-center gap-2 px-3 py-1 text-[11px]">
                      <div className="flex-1 min-w-0" title={mapaOriginal[d.campo] ? `Padrão: ${mapaOriginal[d.campo]}` : 'Padrão: vazio'}>
                        <SelectBusca
                          value={mapa[d.campo] ?? ''}
                          options={opcoesColunas}
                          onChange={(c) => setMapa({ ...mapa, [d.campo]: c })}
                          disabled={!admin || importando}
                          vazioLabel="(vazio)"
                          className={`${INPUT_CLASS} w-full font-mono py-1`}
                        />
                      </div>
                      <ArrowRight className="w-3 h-3 text-stone-300 dark:text-stone-600 shrink-0" />
                      <span className="w-40 shrink-0 font-semibold text-stone-700 dark:text-stone-200 truncate" title={d.campo}>
                        {d.rotulo}
                      </span>
                    </div>
                  ))}
                </div>
                {admin && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    <button
                      type="button"
                      onClick={() => gravarMapa(mapa)}
                      disabled={gravandoMapa || importando || !mapaAlterado}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white cursor-pointer disabled:opacity-40"
                    >
                      {gravandoMapa ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Gravar campos
                    </button>
                    <button
                      type="button"
                      onClick={() => gravarMapa(null)}
                      disabled={gravandoMapa || importando || Boolean(mapaGravado?.padrao)}
                      title="Volta de onde vem cada campo ao padrão do CRM"
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-stone-300 dark:border-stone-700 text-stone-700 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer disabled:opacity-40"
                    >
                      <RotateCcw className="w-3.5 h-3.5" /> Restaurar padrão
                    </button>
                  </div>
                )}
                <p className={`${HINT_CLASS} mt-1.5`}>
                  Escolha a coluna do SQL do BM (aba "SQL do BM") que vai para cada campo; coluna nova do SQL aparece na lista depois do Testar. Com
                  duas colunas (ex.: "cliente_doc, cpfcnpj") vale a primeira preenchida. A conversão
                  segue o campo: data, número, CNPJ só com dígitos, S/N no Cancelado e "BM-" na frente dos códigos.{' '}
                  {admin ? '' : 'Só um administrador pode alterar.'}
                </p>
              </>
            ) : (
            <div className="rounded-lg border border-stone-200 dark:border-stone-800 divide-y divide-stone-100 dark:divide-stone-800 overflow-hidden">
              {t.dePara.map(([de, para]) => (
                <div key={de} className="flex items-center gap-2 px-3 py-1.5 text-[11px]">
                  <span className="font-mono text-stone-500 dark:text-stone-400 w-44 shrink-0 truncate">{de}</span>
                  <ArrowRight className="w-3 h-3 text-stone-300 dark:text-stone-600 shrink-0" />
                  <span className="font-semibold text-stone-700 dark:text-stone-200 truncate">{para}</span>
                </div>
              ))}
            </div>
            )}
            <p className={`${HINT_CLASS} mt-1.5`}>
              {t.regra}
            </p>
          </div>

          {resultado && (
            <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 flex items-start gap-2.5 text-xs text-emerald-800 dark:text-emerald-200">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
              <div>
                <p className="font-semibold">Importação concluída — servidor {resultado.servidor}</p>
                <p className="mt-0.5">
                  {tipo === 'vendas'
                    ? `${resultado.notas ?? 0} nota(s), ${resultado.lidos} ${t.nome} gravado(s)${resultado.substituidas ? `; ${resultado.substituidas} linha(s) do período substituída(s)` : ''}.`
                    : `${resultado.lidos} ${t.nome} lido(s): ${resultado.inseridos} incluído(s), ${resultado.atualizados} atualizado(s), ${resultado.inalterados} sem alteração.`}
                  {resultado.inativos ? ` ${resultado.inativos} inativo(s) no bmsoft ficaram de fora.` : ''}
                  {resultado.inativas ? ` ${resultado.inativas} inativa(s) no bmsoft (marcadas como inativas).` : ''}
                  {resultado.enderecos && ` Endereços: ${resultado.enderecos.incluidos} incluído(s), ${resultado.enderecos.atualizados} atualizado(s).`}
                </p>
              </div>
            </div>
          )}
          </>
          )}

          {erro && (
            <AvisoErro mensagem={erro} onFechar={() => setErro(null)} />
          )}
        </div>

        <div className="px-5 py-3 border-t border-stone-200 dark:border-stone-800 flex justify-end gap-2.5 bg-stone-50 dark:bg-stone-950/40 rounded-b-2xl">
          <button
            type="button"
            onClick={onFechar}
            disabled={importando}
            className="px-4 py-2.5 rounded-lg text-xs font-semibold text-stone-600 dark:text-stone-300 border border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer disabled:opacity-40"
          >
            {resultado ? 'Fechar' : 'Cancelar'}
          </button>
          {!resultado && aba === 'importar' && (
            <button
              type="submit"
              disabled={importando || !cred}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-xs cursor-pointer disabled:opacity-50"
            >
              {importando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              <span>{importando ? 'Importando…' : 'Importar'}</span>
            </button>
          )}
        </div>
      </form>
    </div>
  );
};

/** Botão da barra de ferramentas da lista de pessoas, ao lado do "Novo" */
export const BotaoImportarBM: React.FC<{ tipo: Tipo; onImportado: () => void }> = ({ tipo, onImportado }) => {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <button
        onClick={() => setAberto(true)}
        title={`Importar ${tipo === 'pessoas' ? 'as pessoas' : tipo === 'vendas' ? 'as vendas (notas do período)' : 'os produtos'} do bmsoft pela bmAPI`}
        className="flex items-center gap-1.5 border border-stone-300 dark:border-stone-700 text-stone-700 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer shrink-0 whitespace-nowrap"
      >
        <Download className="w-3.5 h-3.5" />
        <span>Importar BM</span>
      </button>
      {aberto && <ImportarBMModal tipo={tipo} onFechar={() => setAberto(false)} onImportado={onImportado} />}
    </>
  );
};
