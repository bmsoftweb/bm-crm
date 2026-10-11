import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Save, Loader2, Eye, EyeOff, X, Columns3, Search, Move, Scaling, RotateCcw, Lock } from 'lucide-react';
import { Endereco, FieldDef, Id, OpcaoRef, RegistroCrud, ResourceDef } from '../types';
import { maskCNPJ, cleanCNPJ, toInputDate, toInputDateTime, hojeIso, formatDateTimeBR } from '../utils/formatters';
import { INPUT_CLASS, LABEL_CLASS, FIELD_CLASS, HINT_CLASS } from '../utils/formStyles';
import { DateField } from './DateField';
import { NumberField } from './NumberField';
import { Toggle } from './Toggle';
import { SelectBusca } from './SelectBusca';
import { ImagemField } from './ImagemField';
import { FotosField } from './FotosField';
import type { TamanhoCampo } from '../utils/configListas';
import { AvisoErro } from './AvisoErro';
import { fetchCamposPersonalizados, fetchEnderecos, fetchParticipantes, travaContrato } from '../services/api';
import { EnderecosPessoa } from './EnderecosPessoa';
import { ParticipantesNegocio } from './ParticipantesNegocio';
import { CriteriosSegmento } from './CriteriosSegmento';
import { CorField } from './CorField';

interface RecordFormProps {
  resource: ResourceDef;
  /** Registro em edição; `null` indica inclusão */
  record: RegistroCrud | null;
  refOptions: Record<string, OpcaoRef[]>;
  onCancel: () => void;
  onSave: (payload: RegistroCrud) => Promise<void>;
  /** Campos que hoje aparecem como coluna na lista */
  colunasVisiveis?: string[];
  /** Mostra/oculta o campo como coluna da lista */
  onAlternarColuna?: (campo: string) => void;
  /** Campos que hoje aparecem na busca avançada */
  camposBusca?: string[];
  /** Mostra/oculta o campo na busca avançada */
  onAlternarBusca?: (campo: string) => void;
  /** Ordem dos campos escolhida pelo usuário (arrastando pelo ícone de mover) */
  ordemCampos?: string[];
  onReordenarCampos?: (ordem: string[]) => void;
  /** Largura (colunas de 4) e altura escolhidas em "Customizar layout" */
  tamanhosCampos?: Record<string, TamanhoCampo>;
  onRedimensionarCampo?: (campo: string, tamanho: TamanhoCampo) => void;
  /** Volta tamanhos e posições dos campos ao padrão do app */
  onRestaurarPadrao?: () => void;
  /** Grava as preferências (usuarios.config_listas) ao concluir a customização */
  onSalvarLayout?: () => void;
}

/**
 * Padrões fixos das props opcionais: um [] ou {} novo a cada render mudaria as
 * dependências dos campos e reiniciaria os valores digitados a cada tecla.
 */
const SEM_ORDEM: string[] = [];
const SEM_TAMANHOS: Record<string, TamanhoCampo> = {};

/** Colunas do formulário no desktop (tem que bater com lg:grid-cols-4 do grid) */
const COLUNAS_FORM = 4;

/** Tipo de controle usado por cada tipo de campo personalizado */
const TIPO_CAMPO: Record<string, FieldDef['type']> = {
  texto: 'text',
  textarea: 'textarea',
  numero: 'number',
  decimal: 'decimal',
  data: 'date',
  boolean: 'boolean',
  lista: 'enum',
};

/**
 * Alças de redimensionamento: 4 cantos + 4 meios. Ficam por fora do campo, cobrindo a borda
 * (outline a 4px) e passando 2px dela.
 */
const ALCAS: { dir: string; className: string }[] = [
  { dir: 'nw', className: 'top-0 left-0 -translate-x-full -translate-y-full cursor-nwse-resize' },
  { dir: 'n', className: 'top-0 left-1/2 -translate-x-1/2 -translate-y-full cursor-ns-resize' },
  { dir: 'ne', className: 'top-0 right-0 translate-x-full -translate-y-full cursor-nesw-resize' },
  { dir: 'e', className: 'top-1/2 right-0 translate-x-full -translate-y-1/2 cursor-ew-resize' },
  { dir: 'se', className: 'bottom-0 right-0 translate-x-full translate-y-full cursor-nwse-resize' },
  { dir: 's', className: 'bottom-0 left-1/2 -translate-x-1/2 translate-y-full cursor-ns-resize' },
  { dir: 'sw', className: 'bottom-0 left-0 -translate-x-full translate-y-full cursor-nesw-resize' },
  { dir: 'w', className: 'top-1/2 left-0 -translate-x-full -translate-y-1/2 cursor-ew-resize' },
];

/** Valor inicial de cada campo ao abrir o formulário */
function initialValue(field: FieldDef, record: RegistroCrud | null): any {
  if (record) {
    const raw = field.json ? lerPersonalizados(record[field.json.campo])[field.json.chave] : record[field.name];
    if (raw === null || raw === undefined) return '';
    if (field.type === 'boolean') return Number(raw) === 1;
    if (field.type === 'date') return toInputDate(raw);
    if (field.type === 'datetime') return toInputDateTime(raw);
    if (field.type === 'cnpj') return maskCNPJ(String(raw));
    if (field.type === 'password') return '';
    if (field.type === 'criterios' || field.type === 'fotos') return raw;
    if (field.type === 'time') return String(raw).slice(0, 5);
    return String(raw);
  }

  // Padrões para um registro novo: o declarado no metadado ou um valor sensato
  // "hoje" em campo de data = a data local do navegador (Brasília), calculada ao abrir o formulário
  if (field.default === 'hoje' && field.type === 'date') return hojeIso();
  if (field.default !== undefined) return field.default;
  switch (field.type) {
    case 'boolean':
      return field.name === 'ativo';
    case 'enum':
      return field.required ? field.options?.[0]?.value ?? '' : '';
    default:
      return '';
  }
}

/** O valor vem do banco como texto JSON; no formulário é um objeto */
function lerPersonalizados(bruto: any): Record<string, any> {
  if (!bruto) return {};
  if (typeof bruto === 'object') return bruto;
  try {
    const obj = JSON.parse(String(bruto));
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
  } catch {
    return {};
  }
}

export const RecordForm: React.FC<RecordFormProps> = ({
  resource,
  record,
  refOptions,
  onCancel,
  onSave,
  colunasVisiveis,
  onAlternarColuna,
  camposBusca,
  onAlternarBusca,
  ordemCampos = SEM_ORDEM,
  onReordenarCampos,
  tamanhosCampos = SEM_TAMANHOS,
  onRedimensionarCampo,
  onRestaurarPadrao,
  onSalvarLayout,
}) => {
  const isEdit = Boolean(record);
  const formRef = useRef<HTMLFormElement>(null);
  // Inclusão: o foco já vem no primeiro campo vazio (os que já vêm com o padrão ficam para trás)
  useEffect(() => {
    if (record) return;
    const id = requestAnimationFrame(() => {
      const campos: HTMLInputElement[] = Array.from(
        formRef.current?.querySelectorAll<HTMLInputElement>('input:not([type=hidden]):not([disabled]):not([readonly]), select:not([disabled]), textarea:not([disabled])') ?? [],
      );
      (campos.find((c) => !c.value) ?? campos[0])?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [record]);

  /** Pessoa: endereços editados no próprio cadastro e gravados junto no Salvar (null = ainda carregando) */
  const comEnderecos = resource.name === 'pessoas';
  const [enderecos, setEnderecos] = useState<Endereco[] | null>(comEnderecos && !record ? [] : null);
  useEffect(() => {
    if (!comEnderecos || !record) return;
    let vivo = true;
    fetchEnderecos(record[resource.pk[0]] as string)
      .then((l) => vivo && setEnderecos(l))
      .catch((err) => vivo && setError(err.message || 'Não foi possível carregar os endereços.'));
    return () => {
      vivo = false;
    };
  }, [comEnderecos, record, resource]);

  /** Negócio e atividade: usuários envolvidos, também gravados junto no Salvar (null = ainda carregando) */
  const comParticipantes = resource.name === 'negocios' || resource.name === 'atividades';
  /** Quem já responde pelo registro não aparece como envolvido: o proprietário do negócio, quem executa a atividade */
  const campoDono = resource.name === 'atividades' ? 'executor_id' : 'proprietario_id';
  const [participantes, setParticipantes] = useState<number[] | null>(comParticipantes && !record ? [] : null);
  useEffect(() => {
    if (!comParticipantes || !record) return;
    let vivo = true;
    fetchParticipantes(record[resource.pk[0]] as string, resource.name as 'negocios' | 'atividades')
      .then((l) => vivo && setParticipantes(l.map((p) => Number(p.id))))
      .catch((err) => vivo && setError(err.message || 'Não foi possível carregar os envolvidos.'));
    return () => {
      vivo = false;
    };
  }, [comParticipantes, record, resource]);

  // Ícones de customização dos rótulos (coluna, lupa, mover) começam escondidos
  const [mostrarIcones, setMostrarIcones] = useState(false);

  /** Rótulo do campo + botão que mostra/oculta o campo como coluna da lista */
  const rotulo = (f: FieldDef) => {
    const naLista = colunasVisiveis?.includes(f.name) ?? false;
    const naBusca = camposBusca?.includes(f.name) ?? false;
    return (
      <div className="flex items-center gap-1.5 min-h-[18px]">
        <label htmlFor={`form-${resource.name}-${f.name}`} className={LABEL_CLASS}>
          {f.label}
          {f.required && <span className="text-rose-500 ml-1">*</span>}
        </label>
        {mostrarIcones && onAlternarColuna && f.type !== 'password' && !f.json && (
          <button
            type="button"
            tabIndex={-1}
            onClick={() => onAlternarColuna(f.name)}
            title={naLista ? 'Ocultar esta coluna da lista' : 'Mostrar esta coluna na lista'}
            aria-pressed={naLista}
            className={`p-0.5 rounded cursor-pointer transition-colors ${
              naLista
                ? 'text-blue-600 dark:text-blue-400'
                : 'text-stone-300 hover:text-stone-500 dark:text-stone-600 dark:hover:text-stone-400'
            }`}
          >
            <Columns3 className="w-3.5 h-3.5" />
          </button>
        )}
        {/* Campo personalizado: a coluna é escolhida em Configurações; a busca avançada, aqui */}
        {mostrarIcones && onAlternarBusca && f.type !== 'password' && (
          <button
            type="button"
            tabIndex={-1}
            onClick={() => onAlternarBusca(f.name)}
            title={naBusca ? 'Tirar este campo da busca avançada' : 'Usar este campo na busca avançada'}
            aria-pressed={naBusca}
            className={`p-0.5 rounded cursor-pointer transition-colors ${
              naBusca
                ? 'text-blue-600 dark:text-blue-400'
                : 'text-stone-300 hover:text-stone-500 dark:text-stone-600 dark:hover:text-stone-400'
            }`}
          >
            <Search className="w-3.5 h-3.5" />
          </button>
        )}
        {mostrarIcones && onReordenarCampos && (
          <span
            draggable
            onDragStart={(e) => {
              arrastando.current = f;
              e.dataTransfer.effectAllowed = 'move';
              // A "fotografia" arrastada é o campo inteiro, não só o ícone
              const campo = (e.currentTarget as HTMLElement).closest('[data-campo]');
              if (campo) e.dataTransfer.setDragImage(campo, 12, 12);
            }}
            onDragEnd={() => {
              arrastando.current = null;
              setAlvo(null);
            }}
            title="Arraste para reposicionar o campo"
            className="ml-auto p-0.5 rounded cursor-grab active:cursor-grabbing text-stone-300 hover:text-stone-500 dark:text-stone-600 dark:hover:text-stone-400"
          >
            <Move className="w-3.5 h-3.5" />
          </span>
        )}
      </div>
    );
  };

  /** Campo JSON dos campos personalizados (quando o recurso tem um) */
  const campoPersonalizados = useMemo(
    () => resource.fields.find((f) => f.type === 'personalizados'),
    [resource],
  );
  /**
   * Os campos personalizados entram na grade como campos normais: podem ser movidos,
   * redimensionados e gravados junto, só que o valor mora dentro do campo JSON.
   */
  const [camposJson, setCamposJson] = useState<FieldDef[]>([]);
  useEffect(() => {
    if (!campoPersonalizados) return setCamposJson([]);
    let vivo = true;
    fetchCamposPersonalizados()
      .then((lista) => {
        if (!vivo) return;
        setCamposJson(
          lista.map((c) => ({
            name: `${campoPersonalizados.name}.${c.nome}`,
            label: c.rotulo,
            type: TIPO_CAMPO[c.tipo] || 'text',
            required: c.obrigatorio,
            options: c.tipo === 'lista' ? (c.opcoes || []).map((op) => ({ value: op, label: op })) : undefined,
            json: { campo: campoPersonalizados.name, chave: c.nome },
          })),
        );
      })
      .catch(() => vivo && setCamposJson([]));
    return () => {
      vivo = false;
    };
  }, [campoPersonalizados]);
  const editableFields = useMemo(
    () =>
      [
        ...resource.fields.filter((f) => {
          // Só leitura: fica fora, menos o marcado para aparecer (bloqueado) na edição
          if (f.readOnly) return Boolean(isEdit && f.mostrarNaEdicao);
          if (!isEdit && f.soNaAlteracao) return false;
          // O campo JSON em si não é editável: quem aparece são os campos configurados
          if (f.type === 'personalizados') return false;
          if (resource.autoIncrement && resource.pk.includes(f.name)) return false;
          // A chave composta não pode ser alterada depois de criada
          if (isEdit && !resource.autoIncrement && resource.pk.includes(f.name)) return false;
          return true;
        }),
        ...camposJson,
      ]
      .sort((a, b) => {
        const pos = (nome: string) => {
          const i = ordemCampos.indexOf(nome);
          return i < 0 ? ordemCampos.length : i;
        };
        return pos(a.name) - pos(b.name);
      }),
    [resource, isEdit, ordemCampos, camposJson],
  );

  // Arraste de campos para reposicioná-los no formulário
  const arrastando = useRef<FieldDef | null>(null);
  const [alvo, setAlvo] = useState<string | null>(null);

  const propsArraste = (f: FieldDef) =>
    onReordenarCampos
      ? {
          'data-campo': f.name,
          onDragOver: (e: React.DragEvent) => {
            const origem = arrastando.current;
            if (!origem) return;
            e.preventDefault();
            if (alvo !== f.name) setAlvo(f.name);
          },
          onDragLeave: () => setAlvo((atual) => (atual === f.name ? null : atual)),
          onDrop: (e: React.DragEvent) => {
            e.preventDefault();
            const origem = arrastando.current;
            arrastando.current = null;
            setAlvo(null);
            if (!origem || origem.name === f.name) return;
            const nomes = editableFields.map((c) => c.name).filter((n) => n !== origem.name);
            nomes.splice(nomes.indexOf(f.name), 0, origem.name);
            onReordenarCampos(nomes);
          },
        }
      : {};


  const readOnlyFields = useMemo(
    () => (resource.semDadosDoBanco ? [] : resource.fields.filter((f) => f.readOnly && !f.mostrarNaEdicao && record && record[f.name] != null)),
    [resource, record],
  );

  const [values, setValues] = useState<Record<string, any>>(() => {
    const next: Record<string, any> = {};
    for (const f of editableFields) next[f.name] = initialValue(f, record);
    return next;
  });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealPassword, setRevealPassword] = useState(false);
  // Recarrega o formulário quando a aba passa a apontar para outro registro
  useEffect(() => {
    const next: Record<string, any> = {};
    for (const f of editableFields) next[f.name] = initialValue(f, record);
    setValues(next);
    setError(null);
    setRevealPassword(false);
  }, [record, editableFields]);

  /** Contrato assinado e travado: campos que só mudam por aditivo (null = nada travado) */
  const [travados, setTravados] = useState<Set<string> | null>(null);
  const contratoId = resource.name === 'contratos' && record ? record.id : null;
  useEffect(() => {
    setTravados(null);
    if (!contratoId) return;
    let vivo = true;
    travaContrato(contratoId as number)
      .then((t) => {
        if (vivo && t.travado) setTravados(new Set(resource.fields.map((f) => f.name).filter((n) => !t.campos_livres.includes(n))));
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [contratoId, resource.fields]);

  /** Campanha já iniciada: só a situação muda (o servidor descarta o resto) */
  const campanhaIniciada = resource.name === 'campanhas' && Boolean(record?.iniciada_em);

  /** Campo desabilitado pela regra disabledWhen do metadado (ex.: grupo de um admin), pela trava do contrato ou da campanha iniciada */
  const estaDesabilitado = (field: FieldDef, vals: Record<string, any> = values) =>
    Boolean(travados?.has(field.name)) ||
    (campanhaIniciada && field.name !== 'situacao') ||
    Boolean(field.disabledWhen && String(vals[field.disabledWhen.field] ?? '') === field.disabledWhen.equals);

  const setValue = (name: string, value: any) => {
    setValues((prev) => {
      const next = { ...prev, [name]: value };
      // Hora que acerta outra (ex.: Das → Até = Das + 2 h), sem passar da meia-noite
      const soma = resource.fields.find((f) => f.name === name)?.somarHoras;
      const hm = /^(\d{2}):(\d{2})/.exec(String(value ?? ''));
      if (soma && hm) {
        const min = Math.min(23 * 60 + 59, Number(hm[1]) * 60 + Number(hm[2]) + soma.horas * 60);
        next[soma.campo] = `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
      }
      // Campos que ficaram desabilitados por esta mudança perdem o valor
      for (const f of editableFields) {
        if (f.disabledWhen?.field === name && estaDesabilitado(f, next)) next[f.name] = '';
      }
      return next;
    });
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Só o próprio formulário salva. Formulários de janelas abertas a partir daqui
    // (renderizadas em portal) também disparam este evento pela árvore do React.
    if (e.target !== e.currentTarget) return;
    setIsSaving(true);
    setError(null);

    try {
      const payload: RegistroCrud = {};
      const doJson: Record<string, any> = {};
      for (const f of editableFields) {
        if (f.readOnly) continue;
        let v = values[f.name];
        if (f.type === 'cnpj') v = cleanCNPJ(String(v ?? ''));
        if (f.type === 'boolean') v = f.json ? Boolean(v) : v ? 1 : 0;
        if (f.type === 'password' && String(v ?? '').trim() === '') continue;
        if (f.json) {
          if (v !== '' && v !== null && v !== undefined) doJson[f.json.chave] = v;
          continue;
        }
        payload[f.name] = v === '' ? null : v;
      }
      if (campoPersonalizados) payload[campoPersonalizados.name] = doJson;
      // Sem a lista carregada, os endereços gravados ficam como estão
      if (comEnderecos && enderecos) payload.enderecos = enderecos as any;
      if (comParticipantes && participantes)
        payload[resource.name === 'atividades' ? 'envolvidos' : 'participantes'] = participantes.filter(
          (id) => String(id) !== String(values[campoDono] ?? ''),
        ) as any;
      await onSave(payload);
    } catch (err: any) {
      setError(err.message || 'Não foi possível salvar o registro.');
    } finally {
      setIsSaving(false);
    }
  };

  const inputClass = `${INPUT_CLASS} w-full`;

  const renderField = (field: FieldDef) => {
    const value = values[field.name] ?? '';
    const inputId = `form-${resource.name}-${field.name}`;

    // Só leitura dentro do formulário (ex.: fechamento da OS): o valor, sem editar
    if (field.readOnly) {
      const texto = !value ? '—' : field.type === 'datetime' ? formatDateTimeBR(String(value)) : String(value);
      return (
        <div id={inputId} className={`${inputClass} min-h-[34px] whitespace-pre-wrap opacity-70 cursor-not-allowed`} title="Preenchido no fechamento da OS">
          {texto}
        </div>
      );
    }

    // Chave estrangeira: combo alimentado pelo recurso referenciado
    if (field.ref) {
      return (
        <SelectBusca
          id={inputId}
          value={value}
          options={refOptions[field.name] || []}
          onChange={(v) => setValue(field.name, v)}
          required={Boolean(field.required)}
          vazioLabel={field.required ? '— Selecione —' : '— Nenhum —'}
          className={inputClass}
        />
      );
    }

    switch (field.type) {
      case 'boolean':
        return <Toggle id={inputId} checked={Boolean(value)} onChange={(v) => setValue(field.name, v)} />;

      case 'enum':
        return (
          <select
            id={inputId}
            value={String(value ?? '')}
            onChange={(e) => setValue(field.name, e.target.value)}
            required={Boolean(field.required)}
            className={`${inputClass} cursor-pointer`}
          >
            {!field.required && <option value="">— Nenhum —</option>}
            {field.options?.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        );

      case 'imagem':
        return <ImagemField id={inputId} value={String(value ?? '')} onChange={(v) => setValue(field.name, v)} rotulo={field.label} original={field.imagemOriginal} />;

      case 'fotos':
        return <FotosField id={inputId} produtoId={(record?.id as Id | undefined) ?? null} value={value} onChange={(v) => setValue(field.name, v)} />;

      case 'cor':
        return <CorField id={inputId} value={String(value ?? '')} onChange={(v) => setValue(field.name, v)} />;

      case 'criterios':
        return <CriteriosSegmento id={inputId} value={value} onChange={(v) => setValue(field.name, v)} />;

      case 'textarea':
        return (
          <textarea
            id={inputId}
            value={String(value ?? '')}
            onChange={(e) => setValue(field.name, e.target.value)}
            rows={3}
            placeholder={field.placeholder}
            required={Boolean(field.required)}
            className={`${inputClass} resize-y`}
          />
        );

      case 'password':
        return (
          <div className="relative">
            <input
              id={inputId}
              type={revealPassword ? 'text' : 'password'}
              value={String(value ?? '')}
              onChange={(e) => setValue(field.name, e.target.value)}
              autoComplete="new-password"
              placeholder={isEdit ? 'Deixe em branco para manter a senha atual' : 'Defina a senha inicial'}
              className={`${inputClass} pr-10`}
            />
            <button
              type="button"
              onClick={() => setRevealPassword((p) => !p)}
              tabIndex={-1}
              className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 cursor-pointer"
            >
              {revealPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        );

      case 'cnpj':
        return (
          <input
            id={inputId}
            type="text"
            value={String(value ?? '')}
            onChange={(e) => setValue(field.name, maskCNPJ(e.target.value))}
            maxLength={18}
            placeholder="00.000.000/0000-00"
            required={Boolean(field.required)}
            className={`${inputClass} font-mono`}
          />
        );

      case 'number':
      case 'decimal':
        return (
          <NumberField
            id={inputId}
            value={value}
            onChange={(v) => setValue(field.name, v)}
            scale={field.type === 'decimal' ? field.scale ?? 2 : 0}
            allowNegative={field.allowNegative}
            required={Boolean(field.required)}
            className={inputClass}
          />
        );

      case 'time':
        return (
          <input
            id={inputId}
            type="time"
            value={String(value ?? '')}
            onChange={(e) => setValue(field.name, e.target.value)}
            required={Boolean(field.required)}
            className={inputClass}
          />
        );

      case 'date':
        return (
          <DateField
            id={inputId}
            value={String(value ?? '')}
            onChange={(v) => setValue(field.name, v)}
            required={Boolean(field.required)}
            className={inputClass}
          />
        );

      case 'datetime':
        return (
          <DateField
            id={inputId}
            value={String(value ?? '')}
            onChange={(v) => setValue(field.name, v)}
            required={Boolean(field.required)}
            withTime
            className={inputClass}
          />
        );

      default:
        return (
          <input
            id={inputId}
            type="text"
            value={String(value ?? '')}
            onChange={(e) => setValue(field.name, e.target.value)}
            maxLength={field.maxLength}
            placeholder={field.placeholder}
            required={Boolean(field.required)}
            className={inputClass}
          />
        );
    }
  };

  /** Campos longos ocupam a linha inteira do grid */
  const isWide = (f: FieldDef) => f.type === 'textarea' || f.type === 'cor' || f.type === 'imagem' || f.type === 'criterios' || f.type === 'fotos' || f.maxLength === 255;

  // "Customizar layout": cada campo ganha borda e alças; a largura anda em colunas de um grid
  // de 4 (no desktop) e a altura é a do controle, em px.
  const [customizando, setCustomizando] = useState(false);
  const gradeRef = useRef<HTMLDivElement>(null);
  const spanPadrao = (f: FieldDef) => Math.min(f.span ?? (isWide(f) ? COLUNAS_FORM : 1), COLUNAS_FORM);

  const iniciarRedimensionamentoCampo = (e: React.PointerEvent, f: FieldDef, dir: string) => {
    e.preventDefault();
    e.stopPropagation();
    const grade = gradeRef.current;
    const campo = (e.currentTarget as HTMLElement).closest('[data-campo]') as HTMLElement | null;
    if (!grade || !campo || !onRedimensionarCampo) return;

    const estilo = getComputedStyle(grade);
    const gap = parseFloat(estilo.columnGap) || 0;
    const colunas = estilo.gridTemplateColumns.split(' ').length;
    const larguraColuna = (grade.clientWidth - gap * (colunas - 1)) / colunas;
    const controle = campo.querySelector('input:not([type=file]), select, textarea') as HTMLElement | null;
    const larguraInicial = campo.offsetWidth;
    const alturaInicial = controle?.offsetHeight || 0;
    const x0 = e.clientX;
    const y0 = e.clientY;
    const sinalX = dir.includes('e') ? 1 : dir.includes('w') ? -1 : 0;
    const sinalY = dir.includes('s') ? 1 : dir.includes('n') ? -1 : 0;

    const mover = (ev: PointerEvent) => {
      const tamanho: TamanhoCampo = {};
      // A largura só existe no grid de COLUNAS_FORM colunas (desktop)
      if (sinalX && colunas === COLUNAS_FORM) {
        const largura = larguraInicial + sinalX * (ev.clientX - x0);
        tamanho.span = Math.min(COLUNAS_FORM, Math.max(1, Math.round((largura + gap) / (larguraColuna + gap))));
      }
      if (sinalY && controle) {
        tamanho.altura = Math.max(24, Math.round(alturaInicial + sinalY * (ev.clientY - y0)));
      }
      if (tamanho.span !== undefined || tamanho.altura !== undefined) onRedimensionarCampo(f.name, tamanho);
    };
    const soltar = () => {
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
      document.body.style.cursor = '';
    };
    document.body.style.cursor = getComputedStyle(e.currentTarget as Element).cursor;
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
  };

  /** Variáveis e classes que aplicam o tamanho escolhido ao contêiner do campo */
  const estiloTamanho = (f: FieldDef): React.CSSProperties => {
    const t = tamanhosCampos[f.name] || {};
    return {
      // span gravado no grid antigo (12) é limitado às colunas atuais
      ['--span' as string]: Math.min(t.span ?? spanPadrao(f), COLUNAS_FORM),
      ...(t.altura ? { ['--altura' as string]: `${t.altura}px` } : {}),
    } as React.CSSProperties;
  };
  const classeTamanho = (f: FieldDef) =>
    `campo-span ${tamanhosCampos[f.name]?.altura ? 'campo-altura' : ''} ${
      customizando ? 'relative outline outline-1 outline-blue-400 outline-offset-4' : ''
    }`;

  const alcas = (f: FieldDef) =>
    customizando &&
    onRedimensionarCampo &&
    ALCAS.map((alca) => (
      <span
        key={alca.dir}
        onPointerDown={(e) => iniciarRedimensionamentoCampo(e, f, alca.dir)}
        className={`absolute z-10 w-[7px] h-[7px] bg-blue-500 ${alca.className}`}
      />
    ));

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0 bg-white dark:bg-stone-900">
      {/* Corpo rolável */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="max-w-5xl mx-auto px-5 py-5 space-y-4">
          {onRedimensionarCampo && (
            <div className="flex justify-end gap-1 -mt-3 mb-1">
              {onRestaurarPadrao && (
                <button
                  type="button"
                  onClick={onRestaurarPadrao}
                  title="Voltar tamanhos e posições dos campos ao padrão do app"
                  className="flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-semibold cursor-pointer transition-colors text-stone-400 hover:text-stone-600 dark:hover:text-stone-300"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Padrão
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  if (customizando) onSalvarLayout?.(); // "Concluir" grava
                  setCustomizando(!customizando);
                }}
                title={customizando ? 'Concluir a customização do layout' : 'Customizar o tamanho dos campos'}
                aria-pressed={customizando}
                className={`flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-semibold cursor-pointer transition-colors ${
                  customizando
                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300'
                    : 'text-stone-400 hover:text-stone-600 dark:hover:text-stone-300'
                }`}
              >
                <Scaling className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  if (mostrarIcones) onSalvarLayout?.(); // esconder os ícones grava o que foi mudado
                  setMostrarIcones(!mostrarIcones);
                }}
                title={mostrarIcones ? 'Esconder os ícones de customização dos campos' : 'Mostrar os ícones de customização dos campos'}
                aria-pressed={mostrarIcones}
                className={`flex items-center px-2 py-1 rounded cursor-pointer transition-colors ${
                  mostrarIcones
                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300'
                    : 'text-stone-400 hover:text-stone-600 dark:hover:text-stone-300'
                }`}
              >
                {mostrarIcones ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              </button>
            </div>
          )}
          {error && (
            <AvisoErro mensagem={error} onFechar={() => setError(null)} />
          )}

          {travados && (
            <div className="flex items-start gap-2 p-3 rounded-lg border border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-stone-950/60 text-xs text-stone-700 dark:text-stone-300">
              <Lock className="w-4 h-4 shrink-0" />
              <span>
                <b>Contrato assinado: travado.</b> Os campos em cinza só mudam por aditivo (Documentos › Liberar para aditivo, por um
                administrador). Os demais continuam livres.
              </span>
            </div>
          )}
          {campanhaIniciada && (
            <div className="flex items-start gap-2 p-3 rounded-lg border border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-stone-950/60 text-xs text-stone-700 dark:text-stone-300">
              <Lock className="w-4 h-4 shrink-0" />
              <span>
                <b>Campanha iniciada: travada.</b> Só a situação muda (pausar, cancelar ou concluir). Para outro texto ou outro público, crie outra campanha.
              </span>
            </div>
          )}

          <div ref={gradeRef} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {editableFields.map((field) => {
              return (
                <div
                  key={field.name}
                  {...propsArraste(field)}
                  style={estiloTamanho(field)}
                  className={`${FIELD_CLASS} ${isWide(field) ? 'sm:col-span-2' : ''} ${classeTamanho(field)} ${
                    alvo === field.name ? 'outline-2 outline-dashed outline-blue-400 outline-offset-2' : ''
                  }`}
                >
                  {alcas(field)}
                  {rotulo(field)}
                  {/* fieldset desabilitado propaga o disabled para o controle, qualquer que seja o tipo */}
                  <fieldset
                    disabled={estaDesabilitado(field)}
                    className={`min-w-0 border-0 p-0 m-0 ${estaDesabilitado(field) ? 'opacity-50' : ''}`}
                  >
                    {renderField(field)}
                  </fieldset>
                  {field.hint && <p className={HINT_CLASS}>{field.hint}</p>}
                </div>
              );
            })}
          </div>

          {comParticipantes && (
            <ParticipantesNegocio
              ids={participantes || []}
              onChange={setParticipantes}
              opcoes={refOptions[campoDono] || []}
              proprietarioId={values[campoDono]}
              oQue={resource.name === 'atividades' ? 'nesta atividade' : 'neste negócio'}
              carregando={participantes === null}
            />
          )}

          {comEnderecos && (
            <EnderecosPessoa enderecos={enderecos || []} onChange={setEnderecos} carregando={enderecos === null} />
          )}

          {/* Metadados gerados pelo banco */}
          {readOnlyFields.length > 0 && (
            <div className="pt-3 border-t border-stone-200 dark:border-stone-800">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 mb-2">
                Dados gerados pelo banco
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {readOnlyFields.map((f) => (
                  <div
                    key={f.name}
                    className="bg-stone-50 dark:bg-stone-800/50 rounded-lg px-3 py-2 border border-stone-200 dark:border-stone-700/60"
                  >
                    <div className="text-[10px] text-stone-500 dark:text-stone-400">{f.label}</div>
                    <div className="text-xs font-mono text-stone-800 dark:text-stone-200 truncate">
                      {String(record?.[f.name] ?? '—')}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Barra de ações fixa ao pé da tela */}
      <div className="px-5 py-3 border-t border-stone-200 dark:border-stone-800 flex items-center justify-between gap-2.5 bg-stone-50 dark:bg-stone-950/40 shrink-0">
        <span className="text-[11px] text-stone-500 dark:text-stone-400 truncate">
          {isEdit
            ? `Registro #${resource.pk.map((c) => record?.[c]).join(' / ')} • tabela ${resource.table}`
            : `Inclusão na tabela ${resource.table}`}
        </span>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSaving}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-xs font-semibold text-stone-600 dark:text-stone-300 border border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors cursor-pointer disabled:opacity-40"
          >
            <X className="w-3.5 h-3.5" />
            <span>Cancelar</span>
          </button>
          <button
            type="submit"
            id="btn-salvar-registro"
            disabled={isSaving}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white shadow-xs transition-all cursor-pointer disabled:opacity-50"
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            <span>{isSaving ? 'Salvando…' : 'Salvar'}</span>
          </button>
        </div>
      </div>
    </form>
  );
};
