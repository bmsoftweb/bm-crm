import React, { useCallback, useEffect, useRef, useState } from 'react';
import { SelectAuto } from './SelectAuto';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ArrowLeft,
  Bold,
  Code2,
  Copy,
  Eraser,
  Eye,
  FileText,
  Italic,
  List,
  ListOrdered,
  Loader2,
  Pencil,
  Plus,
  Redo2,
  Save,
  Trash2,
  Underline,
  Undo2,
} from 'lucide-react';
import {
  ModeloContrato,
  excluirModeloContrato,
  getModeloContrato,
  listarModelosContrato,
  salvarModeloContrato,
  variaveisContrato,
} from '../services/api';
import { INPUT_CLASS, LABEL_CLASS, FIELD_CLASS, HINT_CLASS } from '../utils/formStyles';
import { MODELO_CONTRATO_EXEMPLO } from '../utils/modeloContrato';
import { AvisoErro } from './AvisoErro';
import { ConfirmDialog } from './ConfirmDialog';

interface Props {
  somenteLeitura: boolean;
  onToast: (msg: string) => void;
}

/**
 * Configurações › Modelos de contrato: a empresa pode ter vários modelos (tabela
 * empresas_contratos_modelos). Ao gerar o PDF, na janela de documentos do contrato,
 * escolhe-se o modelo.
 */
export const ModelosContrato: React.FC<Props> = ({ somenteLeitura, onToast }) => {
  const [lista, setLista] = useState<{ id: number; descricao: string }[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<ModeloContrato | null>(null);
  const [excluindo, setExcluindo] = useState<{ id: number; descricao: string } | null>(null);
  const [abrindo, setAbrindo] = useState<number | null>(null);

  const carregar = useCallback(() => {
    listarModelosContrato()
      .then(setLista)
      .catch((e) => setErro(e.message));
  }, []);
  useEffect(carregar, [carregar]);

  /** Abre o modelo no editor; "copiar" abre como modelo novo com o mesmo texto */
  const abrir = async (id: number, copiar = false) => {
    setAbrindo(id);
    setErro(null);
    try {
      const m = await getModeloContrato(id);
      setEditando(copiar ? { descricao: `Cópia de ${m.descricao}`.slice(0, 255), formato_html: m.formato_html } : m);
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setAbrindo(null);
    }
  };

  if (editando) {
    return (
      <EditorModelo
        modelo={editando}
        somenteLeitura={somenteLeitura}
        onToast={onToast}
        onVoltar={() => {
          setEditando(null);
          carregar();
        }}
        onSalvo={(id) => setEditando((m) => (m ? { ...m, id } : m))}
      />
    );
  }

  const th = 'px-3 py-2 font-semibold text-stone-600 dark:text-stone-300 border-b border-stone-200 dark:border-stone-800 whitespace-nowrap';
  const td = 'px-3 py-2 border-b border-stone-100 dark:border-stone-800/60 align-middle';
  const icone = 'p-1 rounded text-stone-400 transition-colors cursor-pointer';

  return (
    <div className="flex flex-col gap-3 max-w-3xl">
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} />}

      {!somenteLeitura && (
        <div>
          <button
            type="button"
            onClick={() => setEditando({ descricao: '', formato_html: '' })}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-lg text-xs font-semibold shadow-xs cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Novo modelo
          </button>
        </div>
      )}

      {!lista ? (
        <Loader2 className="w-4 h-4 animate-spin text-stone-400" />
      ) : !lista.length ? (
        <p className="text-xs text-stone-500 py-6 text-center border border-dashed border-stone-300 dark:border-stone-700 rounded-lg">
          Nenhum modelo cadastrado. Crie um em &quot;Novo modelo&quot; (há um modelo de exemplo para começar).
        </p>
      ) : (
        <table className="w-full text-xs border-separate border-spacing-0">
          <thead>
            <tr className="bg-stone-50 dark:bg-stone-950">
              <th className={`${th} text-left`}>Descrição</th>
              <th className={`${th} text-center w-px`}>Ações</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((m) => (
              <tr key={m.id} onDoubleClick={() => abrir(m.id)} className="hover:bg-stone-50 dark:hover:bg-stone-800/40">
                <td className={td}>{m.descricao}</td>
                <td className={`${td} text-center whitespace-nowrap`}>
                  {abrindo === m.id ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-stone-400 inline" />
                  ) : (
                    <div className="inline-flex items-center gap-1">
                      <button onClick={() => abrir(m.id)} title={somenteLeitura ? 'Ver' : 'Editar'} className={`${icone} hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40`}>
                        {somenteLeitura ? <Eye className="w-3.5 h-3.5" /> : <Pencil className="w-3.5 h-3.5" />}
                      </button>
                      {!somenteLeitura && (
                        <>
                          <button onClick={() => abrir(m.id, true)} title="Duplicar (novo modelo com o mesmo texto)" className={`${icone} hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40`}>
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => setExcluindo(m)} title="Excluir" className={`${icone} hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40`}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {excluindo && (
        <ConfirmDialog
          titulo={`Excluir o modelo "${excluindo.descricao}"?`}
          mensagem="Os PDFs já gerados com ele continuam nos contratos."
          onConfirmar={async () => {
            await excluirModeloContrato(excluindo.id);
            setExcluindo(null);
            onToast('Modelo excluído.');
            carregar();
          }}
          onCancelar={() => setExcluindo(null)}
        />
      )}
    </div>
  );
};

/** Botões de formatação: comando do editor nativo do navegador (execCommand) */
const FERRAMENTAS: { titulo: string; icone: React.ReactNode; cmd: string }[] = [
  { titulo: 'Negrito', icone: <Bold className="w-4 h-4" />, cmd: 'bold' },
  { titulo: 'Itálico', icone: <Italic className="w-4 h-4" />, cmd: 'italic' },
  { titulo: 'Sublinhado', icone: <Underline className="w-4 h-4" />, cmd: 'underline' },
  { titulo: 'Lista', icone: <List className="w-4 h-4" />, cmd: 'insertUnorderedList' },
  { titulo: 'Lista numerada', icone: <ListOrdered className="w-4 h-4" />, cmd: 'insertOrderedList' },
  { titulo: 'Alinhar à esquerda', icone: <AlignLeft className="w-4 h-4" />, cmd: 'justifyLeft' },
  { titulo: 'Centralizar', icone: <AlignCenter className="w-4 h-4" />, cmd: 'justifyCenter' },
  { titulo: 'Alinhar à direita', icone: <AlignRight className="w-4 h-4" />, cmd: 'justifyRight' },
  { titulo: 'Justificar', icone: <AlignJustify className="w-4 h-4" />, cmd: 'justifyFull' },
  { titulo: 'Limpar formatação', icone: <Eraser className="w-4 h-4" />, cmd: 'removeFormat' },
  { titulo: 'Desfazer', icone: <Undo2 className="w-4 h-4" />, cmd: 'undo' },
  { titulo: 'Refazer', icone: <Redo2 className="w-4 h-4" />, cmd: 'redo' },
];

const BLOCOS = [
  { valor: 'p', rotulo: 'Parágrafo' },
  { valor: 'h1', rotulo: 'Título' },
  { valor: 'h2', rotulo: 'Cláusula' },
  { valor: 'h3', rotulo: 'Subtítulo' },
];

/** Editor de um modelo: descrição + HTML editado visualmente (ou no código), com {{variáveis}} */
const EditorModelo: React.FC<{
  modelo: ModeloContrato;
  somenteLeitura: boolean;
  onToast: (msg: string) => void;
  onVoltar: () => void;
  onSalvo: (id: number) => void;
}> = ({ modelo, somenteLeitura, onToast, onVoltar, onSalvo }) => {
  const [descricao, setDescricao] = useState(modelo.descricao);
  const [html, setHtml] = useState(modelo.formato_html);
  const [modo, setModo] = useState<'visual' | 'html'>('visual');
  const [variaveis, setVariaveis] = useState<{ nome: string; descricao: string }[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [trocarPeloExemplo, setTrocarPeloExemplo] = useState(false);
  const editor = useRef<HTMLDivElement>(null);
  const codigo = useRef<HTMLTextAreaElement>(null);
  /** Última seleção dentro do editor: o menu de variáveis tira o foco dele */
  const selecao = useRef<Range | null>(null);

  useEffect(() => {
    variaveisContrato().then(setVariaveis).catch(() => {});
  }, []);

  // O editor visual é "não controlado": o HTML entra ao abrir e ao voltar do modo código
  useEffect(() => {
    if (modo === 'visual' && editor.current && editor.current.innerHTML !== html) editor.current.innerHTML = html;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modo]);

  useEffect(() => {
    const guardar = () => {
      const s = document.getSelection();
      if (s?.rangeCount && editor.current?.contains(s.anchorNode)) selecao.current = s.getRangeAt(0).cloneRange();
    };
    document.addEventListener('selectionchange', guardar);
    return () => document.removeEventListener('selectionchange', guardar);
  }, []);

  const lerEditor = () => setHtml(editor.current?.innerHTML ?? '');

  const comando = (cmd: string, valor?: string) => {
    editor.current?.focus();
    if (selecao.current) {
      const s = document.getSelection();
      s?.removeAllRanges();
      s?.addRange(selecao.current);
    }
    document.execCommand(cmd, false, valor);
    lerEditor();
  };

  const inserirVariavel = (nome: string) => {
    if (!nome) return;
    const texto = `{{${nome}}}`;
    if (modo === 'visual') return comando('insertText', texto);
    const t = codigo.current;
    if (!t) return;
    const ini = t.selectionStart;
    setHtml(html.slice(0, ini) + texto + html.slice(t.selectionEnd));
    requestAnimationFrame(() => {
      t.focus();
      t.setSelectionRange(ini + texto.length, ini + texto.length);
    });
  };

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    setSalvando(true);
    setErro(null);
    try {
      const atual = modo === 'visual' ? editor.current?.innerHTML ?? '' : html;
      const r = await salvarModeloContrato({ id: modelo.id, descricao, formato_html: atual });
      const id = modelo.id ?? Number(r.id);
      onSalvo(id);
      // O servidor limpa código executável: a tela mostra o que ficou gravado
      const gravado = await getModeloContrato(id);
      setHtml(gravado.formato_html);
      if (editor.current && modo === 'visual') editor.current.innerHTML = gravado.formato_html;
      onToast('Modelo de contrato gravado.');
    } catch (err: any) {
      setErro(err.message);
    } finally {
      setSalvando(false);
    }
  };

  const usarExemplo = () => {
    setHtml(MODELO_CONTRATO_EXEMPLO);
    if (editor.current) editor.current.innerHTML = MODELO_CONTRATO_EXEMPLO;
    if (!descricao.trim()) setDescricao('Licenciamento de software e serviços');
    setTrocarPeloExemplo(false);
  };

  const botao =
    'p-1.5 rounded text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700 cursor-pointer disabled:opacity-40 disabled:cursor-default';

  return (
    <form onSubmit={salvar} className="flex flex-col gap-3 max-w-5xl">
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} />}

      <div className="flex items-end gap-3">
        <button
          type="button"
          onClick={onVoltar}
          title="Voltar à lista de modelos (o que não foi salvo se perde)"
          className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-xs font-semibold text-stone-700 dark:text-stone-200 border border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          Modelos
        </button>
        <div className={`${FIELD_CLASS} flex-1`}>
          <label htmlFor="modelo-descricao" className={LABEL_CLASS}>Descrição do modelo</label>
          <input
            id="modelo-descricao"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            onFocus={(e) => e.target.select()}
            required
            maxLength={255}
            readOnly={somenteLeitura}
            autoComplete="off"
            placeholder="Ex.: Licenciamento mensal, Implantação, Suporte anual…"
            className={`${INPUT_CLASS} w-full`}
          />
        </div>
      </div>

      {/* Barra de ferramentas */}
      <div className="flex flex-wrap items-center gap-1 p-1.5 rounded-lg border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-950/60 sticky top-0 z-10">
        <SelectAuto
          aria-label="Estilo do bloco"
          disabled={somenteLeitura || modo === 'html'}
          onChange={(e) => {
            comando('formatBlock', e.target.value);
            e.target.value = '';
          }}
          defaultValue=""
          className={`${INPUT_CLASS} w-32 cursor-pointer`}
        >
          <option value="" disabled>
            Estilo…
          </option>
          {BLOCOS.map((b) => (
            <option key={b.valor} value={b.valor}>
              {b.rotulo}
            </option>
          ))}
        </SelectAuto>
        {FERRAMENTAS.map((f) => (
          <button
            key={f.cmd}
            type="button"
            title={f.titulo}
            disabled={somenteLeitura || modo === 'html'}
            // mousedown sem foco: a seleção do texto continua no editor
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => comando(f.cmd)}
            className={botao}
          >
            {f.icone}
          </button>
        ))}
        <span className="w-px h-6 bg-stone-300 dark:bg-stone-700 mx-1" />
        <SelectAuto
          aria-label="Inserir variável"
          disabled={somenteLeitura}
          value=""
          onChange={(e) => inserirVariavel(e.target.value)}
          className={`${INPUT_CLASS} w-52 cursor-pointer`}
        >
          <option value="">Inserir variável…</option>
          {variaveis.map((v) => (
            <option key={v.nome} value={v.nome} title={v.descricao}>
              {v.descricao} — {`{{${v.nome}}}`}
            </option>
          ))}
        </SelectAuto>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              if (modo === 'visual') lerEditor();
              setModo(modo === 'visual' ? 'html' : 'visual');
            }}
            title={modo === 'visual' ? 'Editar o código HTML' : 'Voltar ao editor visual'}
            className={`${botao} flex items-center gap-1.5 text-xs font-semibold px-2`}
          >
            {modo === 'visual' ? <Code2 className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            {modo === 'visual' ? 'HTML' : 'Visual'}
          </button>
        </div>
      </div>

      {/* Área de edição, no formato da página do PDF */}
      {modo === 'visual' ? (
        <div
          ref={editor}
          contentEditable={!somenteLeitura}
          suppressContentEditableWarning
          onInput={lerEditor}
          aria-label="Texto do modelo de contrato"
          className="editor-contrato min-h-[480px] max-h-[65vh] overflow-y-auto rounded-lg border border-stone-200 dark:border-stone-800 bg-white text-stone-900 px-12 py-10 text-[11pt] leading-relaxed outline-none focus:ring-2 focus:ring-blue-500/40"
        />
      ) : (
        <textarea
          ref={codigo}
          value={html}
          onChange={(e) => setHtml(e.target.value)}
          readOnly={somenteLeitura}
          spellCheck={false}
          aria-label="Código HTML do modelo de contrato"
          className={`${INPUT_CLASS} w-full min-h-[480px] max-h-[65vh] font-mono text-[11px] leading-relaxed resize-y`}
        />
      )}

      <p className={HINT_CLASS}>
        As variáveis entre chaves duplas (ex.: {'{{cliente_nome}}'}) são trocadas pelos dados de cada contrato ao gerar o PDF, na janela de
        documentos do contrato. Insira-as pelo menu para não quebrá-las com formatação no meio.
      </p>

      {!somenteLeitura && (
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={salvando}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-lg text-xs font-semibold shadow-xs cursor-pointer disabled:opacity-50"
          >
            {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Salvar modelo
          </button>
          <button
            type="button"
            onClick={() => ((modo === 'visual' ? editor.current?.innerHTML ?? '' : html).trim() ? setTrocarPeloExemplo(true) : usarExemplo())}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold text-stone-700 dark:text-stone-200 border border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer"
          >
            <FileText className="w-4 h-4" />
            Usar modelo de exemplo
          </button>
        </div>
      )}

      {trocarPeloExemplo && (
        <ConfirmDialog
          titulo="Substituir pelo modelo de exemplo?"
          mensagem="O texto atual do editor é trocado pelo modelo de exemplo. Nada é gravado até você clicar em Salvar."
          confirmar="Substituir"
          onConfirmar={usarExemplo}
          onCancelar={() => setTrocarPeloExemplo(false)}
        />
      )}
    </form>
  );
};
