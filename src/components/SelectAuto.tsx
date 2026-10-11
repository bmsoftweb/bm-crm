import React from 'react';
import { SelectBusca } from './SelectBusca';
import { OpcaoRef } from '../types';

/** Acima disso a lista vira combo digitável (padrão do projeto) */
const LIMITE = 20;

type Props = Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> & {
  onChange: (e: { target: { value: string } }) => void;
};

/** <option>s dos filhos (os de <optgroup> com o nome do grupo na frente) */
function opcoesDe(children: React.ReactNode, grupo = ''): OpcaoRef[] {
  const lista: OpcaoRef[] = [];
  React.Children.forEach(children, (c) => {
    if (!React.isValidElement<any>(c)) return;
    if (c.type === 'optgroup') lista.push(...opcoesDe(c.props.children, String(c.props.label ?? '')));
    else if (c.type === 'option') {
      const texto = React.Children.toArray(c.props.children).join('');
      lista.push({ value: String(c.props.value ?? texto), label: grupo ? `${grupo}: ${texto}` : texto });
    } else if (c.type === React.Fragment) lista.push(...opcoesDe(c.props.children, grupo));
  });
  return lista;
}

/**
 * Troca direta do <select>: até 20 opções é o select comum; acima disso, o combo digitável (SelectBusca),
 * para achar o item digitando. Mesmo uso: <option>s como filhos e onChange com e.target.value.
 */
export const SelectAuto: React.FC<Props> = ({ children, onChange, value, id, required, disabled, className, ...resto }) => {
  const opcoes = opcoesDe(children);
  const vazia = opcoes.find((o) => o.value === '');
  const reais = opcoes.filter((o) => o.value !== '');
  if (reais.length <= LIMITE) {
    return (
      <select {...resto} id={id} value={value} required={required} disabled={disabled} className={className} onChange={(e) => onChange({ target: { value: e.target.value } })}>
        {children}
      </select>
    );
  }
  return (
    <SelectBusca
      id={id}
      value={value == null ? '' : String(value)}
      options={reais}
      onChange={(v) => onChange({ target: { value: v } })}
      // Opção vazia do select: vira o "nenhum" do combo (e o combo só é obrigatório sem ela)
      vazioLabel={vazia?.label || '— Selecione —'}
      required={required || !vazia}
      disabled={disabled}
      className={(className ?? '').replace(/\bcursor-pointer\b/g, '')}
    />
  );
};
