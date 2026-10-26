import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown, ArrowUp, ChevronRight, Inbox, Loader2, Menu } from 'lucide-react';
import { Grade, ModoLargura, lerConfigLista, salvarConfigLista } from '../utils/configListas';
import { Toggle } from './Toggle';

/**
 * Grade no padrão das listas do app (CrudView) para telas com dados próprios (fora do CRUD genérico):
 * indicador com o menu (Ajustar/Melhor largura, linhas da grade, Colunas, Salvar Configuração), redimensionar e
 * arrastar colunas, ordenar pelo cabeçalho, coluna de sobra e Ações fixa à direita. Preferências em
 * usuarios.config_listas, na chave `recurso`, só ao "Salvar Configuração".
 */

export interface ColunaGrade<T> {
  nome: string;
  rotulo: string;
  /** numero = à direita; data/centro = centralizado; texto (padrão) = à esquerda */
  tipo?: 'texto' | 'numero' | 'data' | 'centro';
  render: (row: T) => React.ReactNode;
  /** Valor para ordenar pelo cabeçalho; sem ele a coluna não ordena */
  valor?: (row: T) => string | number | null | undefined;
  /** Começa escondida (o usuário liga em Colunas) */
  oculta?: boolean;
  /** Classe extra das células (ex.: largura mínima de texto longo) */
  classe?: string;
}

interface Props<T> {
  recurso: string;
  colunas: ColunaGrade<T>[];
  linhas: T[] | null;
  chave: (row: T) => string | number;
  acoes?: (row: T) => React.ReactNode;
  onClick?: (row: T) => void;
  onDoubleClick?: (row: T) => void;
  /** Linha marcada com o indicador azul */
  selecionadoId?: string | number | null;
  /** Classe extra da linha (ex.: opacity-50) */
  classeLinha?: (row: T) => string;
  vazio: string;
  onToast: (msg: string) => void;
}

const alinhamento = (tipo?: string) => (tipo === 'numero' ? 'text-right' : tipo === 'data' || tipo === 'centro' ? 'text-center' : 'text-left');
const itemMenu = 'w-full px-3 py-2 text-xs hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer text-left';

export function GradeLista<T>({ recurso, colunas: todas, linhas, chave, acoes, onClick, onDoubleClick, selecionadoId, classeLinha, vazio, onToast }: Props<T>) {
  const [visiveis, setVisiveis] = useState<string[] | null>(null);
  const [ordem, setOrdem] = useState<string[]>([]);
  const [larguras, setLarguras] = useState<Record<string, number>>({});
  const [grade, setGrade] = useState<Grade>('horizontais');
  const [comSobra, setComSobra] = useState(true);
  const [modoLargura, setModoLargura] = useState<ModoLargura>('manual');
  const [sort, setSort] = useState<{ nome: string; dir: 'asc' | 'desc' } | null>(null);
  const [menu, setMenu] = useState(false);
  const [subColunas, setSubColunas] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const fecharSubTimer = useRef<number | null>(null);
  const arrastando = useRef<string | null>(null);
  const tabelaRef = useRef<HTMLTableElement>(null);

  useEffect(() => {
    let vivo = true;
    lerConfigLista(recurso).then((cfg) => {
      if (!vivo) return;
      setLarguras(cfg.larguras || {});
      setOrdem(cfg.ordem || []);
      const conhecidas = new Set(cfg.conhecidas ?? cfg.visiveis ?? []);
      setVisiveis(cfg.visiveis ? [...cfg.visiveis, ...todas.filter((c) => !c.oculta && !conhecidas.has(c.nome)).map((c) => c.nome)] : null);
      setGrade(cfg.grade || 'horizontais');
      setComSobra(cfg.sobra !== false);
      setModoLargura(cfg.modo || 'manual');
    });
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recurso]);

  const colunas = useMemo(() => {
    const vis = todas.filter((c) => (visiveis ? visiveis.includes(c.nome) : !c.oculta));
    if (!ordem.length) return vis;
    const pos = (n: string) => (ordem.indexOf(n) < 0 ? ordem.length : ordem.indexOf(n));
    return [...vis].sort((a, b) => pos(a.nome) - pos(b.nome));
  }, [todas, visiveis, ordem]);

  const alternarColuna = (nome: string) =>
    setVisiveis((atual) => {
      const base = atual ?? todas.filter((c) => !c.oculta).map((c) => c.nome);
      return base.includes(nome) ? base.filter((n) => n !== nome) : [...base, nome];
    });

  const ordenadas = useMemo(() => {
    const col = sort && todas.find((c) => c.nome === sort.nome);
    if (!linhas || !col?.valor) return linhas;
    const f = col.valor;
    const sinal = sort!.dir === 'asc' ? 1 : -1;
    return [...linhas].sort((a, b) => {
      const x = f(a);
      const y = f(b);
      if (x == null || x === '') return 1;
      if (y == null || y === '') return -1;
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'pt-BR', { numeric: true })) * sinal;
    });
  }, [linhas, sort, todas]);

  const ordenar = (c: ColunaGrade<T>) => {
    if (!c.valor) return;
    setSort((s) => (s?.nome === c.nome ? { nome: c.nome, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { nome: c.nome, dir: 'asc' }));
  };

  const soltarColuna = (destino: string) => {
    const origem = arrastando.current;
    arrastando.current = null;
    if (!origem || origem === destino) return;
    const nomes = colunas.map((c) => c.nome).filter((n) => n !== origem);
    nomes.splice(nomes.indexOf(destino), 0, origem);
    setOrdem(nomes);
  };

  /** Largura de cada coluna só pelo conteúdo (tabela em max-content, sem as larguras aplicadas) */
  const medirColunas = (): number[] | null => {
    const tabela = tabelaRef.current;
    if (!tabela) return null;
    const celulas = [...tabela.querySelectorAll('thead th'), ...tabela.querySelectorAll('tbody tr:first-child > td')] as HTMLElement[];
    const anteriores = celulas.map((c) => c.style.width);
    celulas.forEach((c) => {
      c.style.width = '';
      c.style.maxWidth = '';
    });
    const larguraTabela = tabela.style.width;
    tabela.style.width = 'max-content';
    const medidas = (Array.from(tabela.querySelectorAll('thead th')) as HTMLElement[]).map((th) => th.offsetWidth);
    tabela.style.width = larguraTabela;
    celulas.forEach((c, i) => (c.style.width = anteriores[i]));
    return medidas;
  };

  const aplicarMelhorLargura = () => {
    setComSobra(true);
    const medidas = medirColunas();
    if (medidas) setLarguras(Object.fromEntries(colunas.map((c, i) => [c.nome, Math.max(60, medidas[i + 1])])));
  };

  /** Reparte o espaço livre entre as colunas, na proporção do que cada uma ocupa hoje (mín. 50px) */
  const aplicarAjustarLargura = () => {
    setComSobra(false);
    const tabela = tabelaRef.current;
    const area = tabela?.parentElement;
    if (!tabela || !area) return;
    const ths = Array.from(tabela.querySelectorAll('thead th')) as HTMLElement[];
    const atuais = ths.slice(1, 1 + colunas.length).map((th) => th.offsetWidth);
    const soma = atuais.reduce((a, b) => a + b, 0);
    const disponivel = area.clientWidth - ths[0].offsetWidth - ths[ths.length - 1].offsetWidth - 1;
    if (soma <= 0 || disponivel <= 0) return;
    const finais = atuais.map((l) => Math.max(50, Math.floor((l * disponivel) / soma)));
    const resto = disponivel - finais.reduce((a, b) => a + b, 0);
    if (resto > 0) finais[finais.length - 1] += resto;
    setLarguras(Object.fromEntries(colunas.map((c, i) => [c.nome, finais[i]])));
  };

  // Modos automáticos: recalcula ao abrir, quando chegam as linhas e no resize da janela
  useEffect(() => {
    if (modoLargura === 'manual') return;
    const aplicar = () => (modoLargura === 'ajustar' ? aplicarAjustarLargura() : aplicarMelhorLargura());
    const id = requestAnimationFrame(aplicar);
    window.addEventListener('resize', aplicar);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener('resize', aplicar);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modoLargura, colunas, linhas]);

  const iniciarRedimensionamento = (e: React.PointerEvent, nome: string) => {
    e.preventDefault();
    e.stopPropagation();
    setModoLargura('manual');
    const tabela = tabelaRef.current;
    if (!tabela) return;
    // Congela as larguras atuais: sem isso o navegador redistribui a sobra e o arraste "escorrega"
    const base = (Array.from(tabela.querySelectorAll('thead th')) as HTMLElement[]).slice(1, 1 + colunas.length).map((th) => th.offsetWidth);
    const indice = colunas.findIndex((c) => c.nome === nome);
    const xInicial = e.clientX;
    const mover = (ev: PointerEvent) => {
      const finais = [...base];
      finais[indice] = Math.max(50, base[indice] + ev.clientX - xInicial);
      // Sem coluna de sobra, a coluna seguinte cede o espaço
      if (!comSobra && indice < finais.length - 1) finais[indice + 1] = Math.max(50, base[indice + 1] - (finais[indice] - base[indice]));
      setLarguras(Object.fromEntries(colunas.map((c, i) => [c.nome, finais[i]])));
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

  const cancelarFechamentoSub = () => {
    if (fecharSubTimer.current) window.clearTimeout(fecharSubTimer.current);
    fecharSubTimer.current = null;
  };
  const abrirSubColunas = (el: HTMLElement) => {
    cancelarFechamentoSub();
    const r = el.getBoundingClientRect();
    const LARGURA = 288; // w-72
    const left = r.right - 4 + LARGURA > window.innerWidth ? Math.max(8, r.left - LARGURA + 4) : r.right - 4;
    const top = Math.max(8, Math.min(r.top, window.innerHeight - 248));
    setSubColunas({ top, left, maxHeight: window.innerHeight - top - 8 });
  };

  const salvarConfiguracao = () => {
    setMenu(false);
    salvarConfigLista(recurso, {
      visiveis: colunas.map((c) => c.nome),
      conhecidas: todas.map((c) => c.nome),
      larguras: modoLargura === 'manual' ? larguras : undefined,
      ordem,
      grade,
      sobra: comSobra,
      modo: modoLargura,
    });
    onToast('Configuração salva.');
  };

  // A borda existe sempre (só fica transparente), senão a altura da linha muda junto com a grade
  const bordas = `border-b border-r ${grade === 'ambas' || grade === 'horizontais' ? 'border-b-stone-100 dark:border-b-stone-800/60' : 'border-b-transparent'} ${
    grade === 'ambas' || grade === 'verticais' ? 'border-r-stone-100 dark:border-r-stone-800/60' : 'border-r-transparent'
  }`;
  const totalColunas = colunas.length + 2 + (comSobra ? 1 : 0);

  return (
    <div className="flex-1 overflow-auto min-h-0">
      <table ref={tabelaRef} className="w-full text-xs border-separate border-spacing-0">
        <thead className="sticky top-0 z-10">
          <tr className="bg-stone-50 dark:bg-stone-950/90 backdrop-blur-xs">
            <th className="sticky left-0 z-20 w-[30px] min-w-[30px] max-w-[30px] px-0 text-center border-b border-r border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-950">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setMenu((v) => !v);
                    setSubColunas(null);
                  }}
                  title="Opções das colunas"
                  className="p-1 mx-auto block text-stone-400 hover:text-blue-600 dark:text-stone-500 dark:hover:text-blue-400 cursor-pointer"
                >
                  <Menu className="w-3.5 h-3.5" />
                </button>
                {menu && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setMenu(false)} />
                    <div className="absolute left-0 top-full z-40 mt-1 w-44 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 shadow-lg py-1 text-left font-normal">
                      <button
                        type="button"
                        onClick={() => {
                          setMenu(false);
                          setModoLargura('ajustar');
                          aplicarAjustarLargura();
                        }}
                        className={`${itemMenu} text-stone-700 dark:text-stone-200`}
                      >
                        Ajustar largura
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setMenu(false);
                          setModoLargura('melhor');
                          aplicarMelhorLargura();
                        }}
                        className={`${itemMenu} text-stone-700 dark:text-stone-200`}
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
                          type="button"
                          onClick={() => {
                            setGrade(valor);
                            setMenu(false);
                          }}
                          className={`${itemMenu} ${grade === valor ? 'text-blue-700 dark:text-blue-300 font-semibold' : 'text-stone-700 dark:text-stone-200'}`}
                        >
                          {rotulo}
                        </button>
                      ))}
                      <div className="my-1 border-t border-stone-200 dark:border-stone-700" />
                      <div
                        className="relative"
                        onMouseEnter={(e) => (subColunas ? cancelarFechamentoSub() : abrirSubColunas(e.currentTarget))}
                        onMouseLeave={() => {
                          cancelarFechamentoSub();
                          fecharSubTimer.current = window.setTimeout(() => setSubColunas(null), 350);
                        }}
                      >
                        <button
                          type="button"
                          onClick={(e) => (subColunas ? setSubColunas(null) : abrirSubColunas(e.currentTarget))}
                          className={`${itemMenu} text-stone-700 dark:text-stone-200 flex items-center justify-between ${subColunas ? 'bg-stone-100 dark:bg-stone-800' : ''}`}
                        >
                          Colunas
                          <ChevronRight className="w-3.5 h-3.5 text-stone-400" />
                        </button>
                        {subColunas &&
                          // Portal no body: dentro da grade (que rola e corta) o submenu ficava cortado
                          createPortal(
                            <div
                              onMouseEnter={cancelarFechamentoSub}
                              style={{ top: subColunas.top, left: subColunas.left, maxHeight: subColunas.maxHeight }}
                              className="fixed z-[70] w-72 overflow-y-auto rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 shadow-lg py-1 text-left font-normal"
                            >
                              {todas.map((c) => (
                                <div key={c.nome} className="px-3 py-1.5 hover:bg-stone-100 dark:hover:bg-stone-800">
                                  <Toggle
                                    checked={colunas.some((v) => v.nome === c.nome)}
                                    onChange={() => alternarColuna(c.nome)}
                                    size="sm"
                                    label={<span className="text-xs text-stone-700 dark:text-stone-200">{c.rotulo}</span>}
                                  />
                                </div>
                              ))}
                            </div>,
                            document.body,
                          )}
                      </div>
                      <div className="my-1 border-t border-stone-200 dark:border-stone-700" />
                      <button type="button" onClick={salvarConfiguracao} className={`${itemMenu} text-stone-700 dark:text-stone-200`}>
                        Salvar Configuração
                      </button>
                    </div>
                  </>
                )}
              </div>
            </th>
            {colunas.map((c) => (
              <th
                key={c.nome}
                draggable
                onDragStart={(e) => {
                  arrastando.current = c.nome;
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  soltarColuna(c.nome);
                }}
                onClick={() => ordenar(c)}
                style={larguras[c.nome] ? { width: larguras[c.nome] } : undefined}
                title={c.valor ? `Ordenar por ${c.rotulo}` : c.rotulo}
                className={`relative px-3 py-2.5 text-center font-semibold text-stone-600 dark:text-stone-300 whitespace-nowrap select-none hover:bg-stone-100 dark:hover:bg-stone-800/60 transition-colors border-b border-r border-stone-200 dark:border-stone-800 ${
                  c.valor ? 'cursor-pointer' : 'cursor-default'
                } ${grade === 'ambas' || grade === 'verticais' ? '' : 'border-r-transparent'}`}
              >
                <span
                  draggable={false}
                  onDragStart={(e) => e.preventDefault()}
                  onPointerDown={(e) => iniciarRedimensionamento(e, c.nome)}
                  onClick={(e) => e.stopPropagation()}
                  title={`Arrastar para redimensionar ${c.rotulo}`}
                  className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-blue-400/60"
                />
                <span className="inline-flex items-center gap-1 justify-center">
                  {c.rotulo}
                  {sort?.nome === c.nome &&
                    (sort.dir === 'asc' ? <ArrowUp className="w-3 h-3 text-blue-600 dark:text-blue-400" /> : <ArrowDown className="w-3 h-3 text-blue-600 dark:text-blue-400" />)}
                </span>
              </th>
            ))}
            {/* Coluna de sobra: fica com o espaço livre, para que arrastar uma coluna mude mesmo a largura */}
            {comSobra && <th className="w-full border-b border-stone-200 dark:border-stone-800" />}
            <th className="sticky right-0 z-20 px-3 py-2.5 text-center font-semibold text-stone-600 dark:text-stone-300 w-px whitespace-nowrap border-b border-l border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-950">
              Ações
            </th>
          </tr>
        </thead>
        <tbody>
          {ordenadas === null ? (
            <tr>
              <td colSpan={totalColunas} className="px-3 py-12 text-center">
                <Loader2 className="w-4 h-4 animate-spin text-stone-400 mx-auto" />
              </td>
            </tr>
          ) : !ordenadas.length ? (
            <tr>
              <td colSpan={totalColunas} className="px-3 py-16 text-center">
                <div className="flex flex-col items-center gap-2 text-stone-400">
                  <Inbox className="w-8 h-8" />
                  <span className="text-xs">{vazio}</span>
                </div>
              </td>
            </tr>
          ) : (
            ordenadas.map((row) => {
              const id = chave(row);
              const marcada = selecionadoId != null && String(selecionadoId) === String(id);
              return (
                <tr
                  key={id}
                  onClick={onClick ? () => onClick(row) : undefined}
                  onDoubleClick={onDoubleClick ? () => onDoubleClick(row) : undefined}
                  className={`group transition-colors ${onClick || onDoubleClick ? 'cursor-pointer' : ''} ${
                    marcada ? 'bg-blue-100 dark:bg-blue-950' : 'bg-white dark:bg-stone-900 hover:bg-stone-50 dark:hover:bg-stone-800'
                  } ${classeLinha?.(row) ?? ''}`}
                >
                  <td className={`sticky left-0 z-[5] w-[30px] min-w-[30px] max-w-[30px] px-0 text-center align-middle bg-inherit border-r border-stone-200 dark:border-stone-800 ${bordas}`}>
                    <ChevronRight
                      className={`w-3.5 h-3.5 mx-auto ${marcada ? 'text-blue-600 dark:text-blue-400' : 'text-stone-300 opacity-0 group-hover:opacity-100 dark:text-stone-600'}`}
                    />
                  </td>
                  {colunas.map((c) => (
                    <td
                      key={c.nome}
                      style={larguras[c.nome] ? { width: larguras[c.nome], maxWidth: larguras[c.nome] } : undefined}
                      className={`px-3 py-[7.5px] text-stone-700 dark:text-stone-300 align-middle ${bordas} ${alinhamento(c.tipo)} ${c.classe ?? ''}`}
                    >
                      {c.render(row)}
                    </td>
                  ))}
                  {comSobra && <td className={`w-full ${bordas}`} />}
                  <td
                    className={`sticky right-0 z-[5] w-px px-3 py-[7.5px] text-center whitespace-nowrap bg-inherit border-l border-stone-200 dark:border-stone-800 ${bordas}`}
                    onClick={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => e.stopPropagation()}
                  >
                    {acoes?.(row)}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
