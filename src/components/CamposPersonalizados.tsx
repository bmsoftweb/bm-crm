import React, { useEffect, useState } from 'react';
import { SelectAuto } from './SelectAuto';
import { ArrowDown, ArrowUp, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { CampoPersonalizado } from '../types';
import { fetchConfig, invalidarCamposPersonalizados, salvarConfig } from '../services/api';
import { INPUT_CLASS, LABEL_CLASS, HINT_CLASS } from '../utils/formStyles';
import { Toggle } from './Toggle';
import { ConfirmDialog } from './ConfirmDialog';
import { AvisoErro } from './AvisoErro';

const TIPOS: { value: CampoPersonalizado['tipo']; label: string }[] = [
  { value: 'texto', label: 'Texto' },
  { value: 'textarea', label: 'Texto longo' },
  { value: 'numero', label: 'Número inteiro' },
  { value: 'decimal', label: 'Valor / decimal' },
  { value: 'data', label: 'Data' },
  { value: 'boolean', label: 'Sim / Não' },
  { value: 'lista', label: 'Lista de opções' },
];

/** Nome da chave gravada no registro: sem acento, minúsculo e com "_" no lugar do espaço */
function paraNome(rotulo: string): string {
  return rotulo
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50);
}

interface Props {
  /** Só administradores gravam; os demais veem a configuração sem poder alterar */
  somenteLeitura: boolean;
  onToast: (msg: string) => void;
}

/**
 * Configuração "Campos Personalizados de Pessoas": define os campos extras que o
 * cadastro de pessoas mostra, como a personalização de clientes do pedWeb.
 */
export const CamposPersonalizados: React.FC<Props> = ({ somenteLeitura, onToast }) => {
  const [campos, setCampos] = useState<CampoPersonalizado[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [removendo, setRemovendo] = useState<number | null>(null);

  useEffect(() => {
    fetchConfig<CampoPersonalizado[]>('pessoas', 'campos_personalizados')
      .then(({ valor }) => setCampos(Array.isArray(valor) ? valor : []))
      .catch((err) => setErro(err.message))
      .finally(() => setCarregando(false));
  }, []);

  const alterar = (i: number, dados: Partial<CampoPersonalizado>) =>
    setCampos((lista) => lista.map((c, idx) => (idx === i ? { ...c, ...dados } : c)));

  const mover = (i: number, passo: number) =>
    setCampos((lista) => {
      const destino = i + passo;
      if (destino < 0 || destino >= lista.length) return lista;
      const nova = [...lista];
      [nova[i], nova[destino]] = [nova[destino], nova[i]];
      return nova;
    });

  const incluir = () => setCampos((lista) => [...lista, { nome: '', rotulo: '', tipo: 'texto' }]);

  const gravar = async () => {
    const limpos = campos.map((c) => ({
      ...c,
      rotulo: c.rotulo.trim(),
      // O nome só é gerado na primeira gravação: mudar depois perderia o que já foi preenchido
      nome: c.nome || paraNome(c.rotulo),
      opcoes: c.tipo === 'lista' ? (c.opcoes || []).map((o) => o.trim()).filter(Boolean) : undefined,
    }));

    const semRotulo = limpos.findIndex((c) => !c.rotulo);
    if (semRotulo >= 0) return setErro(`Informe o rótulo do campo ${semRotulo + 1}.`);
    const semNome = limpos.findIndex((c) => !c.nome);
    if (semNome >= 0) return setErro(`O rótulo do campo ${semNome + 1} precisa ter letras ou números.`);
    const repetido = limpos.find((c, i) => limpos.findIndex((o) => o.nome === c.nome) !== i);
    if (repetido) return setErro(`Existe mais de um campo com o nome "${repetido.nome}". Troque um dos rótulos.`);
    const listaVazia = limpos.find((c) => c.tipo === 'lista' && !c.opcoes?.length);
    if (listaVazia) return setErro(`Informe as opções da lista "${listaVazia.rotulo}".`);

    setSalvando(true);
    setErro(null);
    try {
      await salvarConfig('pessoas', 'campos_personalizados', limpos);
      invalidarCamposPersonalizados();
      setCampos(limpos);
      onToast('Campos personalizados gravados.');
    } catch (err: any) {
      setErro(err.message || 'Não foi possível gravar a configuração.');
    } finally {
      setSalvando(false);
    }
  };

  if (carregando) {
    return (
      <div className="py-16 flex items-center justify-center gap-2 text-xs text-stone-500">
        <Loader2 className="w-4 h-4 animate-spin" /> Carregando a configuração…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <p className={HINT_CLASS}>
          Estes campos aparecem no cadastro de pessoas, abaixo dos campos fixos. O nome entre parênteses é a
          chave gravada no registro e não muda depois da primeira gravação.
        </p>
        {!somenteLeitura && (
          <button
            type="button"
            onClick={incluir}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg text-xs font-semibold shadow-xs cursor-pointer shrink-0"
          >
            <Plus className="w-3.5 h-3.5" /> Incluir campo
          </button>
        )}
      </div>

      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} />}

      {campos.length === 0 ? (
        <div className="py-14 text-center text-xs text-stone-400 border border-stone-200 dark:border-stone-800">
          Nenhum campo personalizado. Use "Incluir campo" para criar o primeiro.
        </div>
      ) : (
        <div className="border border-stone-200 dark:border-stone-800">
          {/* Cabeçalho da grade, no padrão das listas do app */}
          <div className="hidden lg:grid grid-cols-12 gap-3 px-3 py-2 bg-stone-50 dark:bg-stone-950/60 border-b border-stone-200 dark:border-stone-800 text-[10px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">
            <div className="col-span-4">Rótulo</div>
            <div className="col-span-2">Tipo</div>
            <div className="col-span-3">Opções da lista</div>
            <div className="col-span-1 text-center">Obrigat.</div>
            <div className="col-span-1 text-center">Na lista</div>
            <div className="col-span-1 text-right">Ações</div>
          </div>
          {campos.map((c, i) => (
            <fieldset
              key={i}
              disabled={somenteLeitura}
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 items-center px-3 py-2 m-0 border-0 border-t border-stone-100 dark:border-stone-800/60 first:border-t-0"
            >
              <div className="flex flex-col gap-1 lg:col-span-4">
                <label className={`${LABEL_CLASS} lg:hidden`}>Rótulo<span className="text-rose-500 ml-1">*</span></label>
                <input
                  value={c.rotulo}
                  maxLength={80}
                  onChange={(e) => alterar(i, { rotulo: e.target.value })}
                  placeholder="Ex.: Limite de crédito"
                  className={`${INPUT_CLASS} w-full`}
                />
                {c.nome && <span className={HINT_CLASS}>({c.nome})</span>}
              </div>

              <div className="flex flex-col gap-1 lg:col-span-2">
                <label className={`${LABEL_CLASS} lg:hidden`}>Tipo</label>
                <SelectAuto
                  value={c.tipo}
                  onChange={(e) => alterar(i, { tipo: e.target.value as CampoPersonalizado['tipo'] })}
                  className={`${INPUT_CLASS} w-full cursor-pointer`}
                >
                  {TIPOS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </SelectAuto>
              </div>

              <div className="flex flex-col gap-1 lg:col-span-3">
                <label className={`${LABEL_CLASS} lg:hidden`}>Opções da lista</label>
                <input
                  // Junta com "," puro: com ", " cada tecla digitada ganhava mais um espaço
                  value={(c.opcoes || []).join(',')}
                  disabled={c.tipo !== 'lista'}
                  onChange={(e) => alterar(i, { opcoes: e.target.value.split(',') })}
                  placeholder={c.tipo === 'lista' ? 'Ouro, Prata, Bronze' : '—'}
                  className={`${INPUT_CLASS} w-full disabled:opacity-40`}
                />
              </div>

              {/* Tela larga: os blocos viram células da grade (lg:contents), cada interruptor na coluna do seu título */}
              <div className="flex items-center justify-between gap-2 lg:contents">
                <div className="flex items-center gap-4 lg:contents">
                  <div className="lg:col-span-1 lg:flex lg:justify-center">
                    <Toggle
                      checked={Boolean(c.obrigatorio)}
                      onChange={(v) => alterar(i, { obrigatorio: v })}
                      size="sm"
                      label={<span className="lg:hidden">Obrigatório</span>}
                      title="Campo de preenchimento obrigatório"
                    />
                  </div>
                  <div className="lg:col-span-1 lg:flex lg:justify-center">
                    <Toggle
                      checked={Boolean(c.listado)}
                      onChange={(v) => alterar(i, { listado: v })}
                      size="sm"
                      label={<span className="lg:hidden">Na lista</span>}
                      title="Mostra este campo como coluna na lista de pessoas"
                    />
                  </div>
                </div>
                {!somenteLeitura && (
                  <div className="flex items-center justify-end gap-0.5 shrink-0 lg:col-span-1">
                    <button
                      type="button"
                      onClick={() => mover(i, -1)}
                      disabled={i === 0}
                      title="Subir"
                      className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 disabled:opacity-30 cursor-pointer"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => mover(i, 1)}
                      disabled={i === campos.length - 1}
                      title="Descer"
                      className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 disabled:opacity-30 cursor-pointer"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setRemovendo(i)}
                      title="Excluir campo"
                      className="p-1.5 rounded-lg text-stone-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </fieldset>
          ))}
        </div>
      )}

      {!somenteLeitura && (
        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={gravar}
            disabled={salvando}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-lg text-xs font-semibold shadow-xs cursor-pointer disabled:opacity-50"
          >
            {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Salvar configuração
          </button>
        </div>
      )}

      {removendo !== null && (
        <ConfirmDialog
          titulo="Excluir campo personalizado?"
          mensagem={`"${campos[removendo]?.rotulo || 'Campo sem rótulo'}" sai do cadastro de pessoas. O que já foi preenchido continua gravado, mas deixa de aparecer.`}
          confirmar="Excluir"
          onConfirmar={() => {
            setCampos((lista) => lista.filter((_, idx) => idx !== removendo));
            setRemovendo(null);
          }}
          onCancelar={() => setRemovendo(null)}
        />
      )}
    </div>
  );
};
