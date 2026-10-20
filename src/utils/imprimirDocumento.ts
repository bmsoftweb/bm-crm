import { RegistroCrud } from '../types.js';
import { STATUS_LABELS, formatCNPJ, formatDateBR, formatMoeda, refProposta } from './formatters.js';

/** Escapa texto vindo do banco antes de entrar no HTML */
export const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const qtd = (v: unknown) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(Number(v) || 0);

/** Nome do item impresso: na proposta, o "Nome na Proposta" do produto, quando preenchido */
export const nomeItem = (i: RegistroCrud, ehProposta: boolean) => (ehProposta && i.nome_proposta) || i.produto_nome;

/**
 * Impressão resumida: os itens de produtos com grupo viram uma linha por grupo, com o valor bruto somado; produto
 * sem grupo fica ele mesmo. Primeiro os grupos (na ordem do 1º item de cada um), depois os sem grupo. Valor bruto
 * (qtd × preço), para a soma das linhas bater com o Subtotal; os descontos continuam nas linhas dos totais.
 */
export function agruparItens(itens: RegistroCrud[], ehProposta = false): { nome: string; valor: number }[] {
  const linhas: { nome: string; valor: number }[] = [];
  const semGrupo: { nome: string; valor: number }[] = [];
  const porGrupo = new Map<string, { nome: string; valor: number }>();
  for (const i of itens) {
    const valor = Math.round((Number(i.quantidade) || 0) * (Number(i.preco_unitario) || 0) * 100) / 100;
    const grupo = i.grupo_id ? String(i.grupo_id) : null;
    const existente = grupo ? porGrupo.get(grupo) : undefined;
    if (existente) {
      existente.valor = Math.round((existente.valor + valor) * 100) / 100;
      continue;
    }
    const linha = { nome: String((grupo ? i.grupo_nome : nomeItem(i, ehProposta)) ?? ''), valor };
    if (grupo) {
      porGrupo.set(grupo, linha);
      linhas.push(linha);
    } else semGrupo.push(linha);
  }
  return [...linhas, ...semGrupo];
}

/**
 * Página A4 da proposta ou do pedido, pronta para o diálogo de impressão do navegador
 * ("Salvar como PDF" gera o arquivo). Recebe o documento como gravado no servidor.
 */
export function htmlDocumento(p: RegistroCrud, tipo: 'propostas' | 'pedidos', resumida = false): string {
  const ehProposta = tipo === 'propostas';
  const itens: RegistroCrud[] = p.itens || [];
  const descItens = itens.reduce((s, i) => s + (Number(i.desconto) || 0), 0);
  const adicional = Math.round(((Number(p.valor_desconto) || 0) - descItens) * 100) / 100;
  const titulo = ehProposta ? `Proposta ${refProposta(p)}` : `Pedido de Venda nº ${p.numero_pedido}`;
  const condicao = ehProposta ? p.condicoes_pagamento : p.condicao_pagamento;
  const meta = ehProposta
    ? // O controle é o número principal; o nº interno vai pequeno, entre parênteses (sem controle, só o nº)
      `<div>${p.controle ? `<span class="controle">${esc(p.controle)}</span> <span class="id">(nº ${esc(p.numero_proposta)} • v${esc(p.versao)})</span>` : `<span class="b">Nº ${esc(p.numero_proposta)} • v${esc(p.versao)}</span>`}</div>
      <div>Emitida em ${formatDateBR(p.criado_em)}</div>
      <div>Válida até ${formatDateBR(p.data_validade)}</div>`
    : `<div class="b">Nº ${esc(p.numero_pedido)}</div>
      <div>Emissão ${formatDateBR(p.data_emissao)}</div>
      <div>Situação: ${esc(STATUS_LABELS[p.status] || p.status)}</div>
      ${p.proposta_numero ? `<div>Ref. proposta ${esc(refProposta({ controle: p.proposta_controle, numero_proposta: p.proposta_numero, versao: p.proposta_versao }))}</div>` : ''}`;

  const linhas = resumida
    ? agruparItens(itens, ehProposta)
        .map((l, n) => `<tr><td class="c">${n + 1}</td><td>${esc(l.nome)}</td><td class="r b">${formatMoeda(l.valor)}</td></tr>`)
        .join('')
    : itens
    .map(
      (i, n) => `<tr>
        <td class="c">${n + 1}</td>
        <td>${esc(nomeItem(i, ehProposta))}${i.codigo_sku ? `<div class="sku">${esc(i.codigo_sku)}</div>` : ''}</td>
        <td class="r">${qtd(i.quantidade)}</td>
        <td class="c">${esc(i.unidade_medida)}</td>
        <td class="r">${formatMoeda(i.preco_unitario)}</td>
        <td class="r">${Number(i.desconto) ? formatMoeda(i.desconto) : '—'}</td>
        <td class="r b">${formatMoeda(i.subtotal)}</td>
      </tr>`,
    )
    .join('');

  // Quem vende é a empresa logada; o cliente é o contato do documento
  const vendedor = [
    p.empresa_nome && `<div class="b">${esc(p.empresa_nome)}</div>`,
    p.empresa_cnpj && `<div>CNPJ ${esc(formatCNPJ(p.empresa_cnpj))}</div>`,
    p.empresa_endereco && `<div class="pre">${esc(p.empresa_endereco)}</div>`,
  ]
    .filter(Boolean)
    .join('');
  const cliente = [
    p.pessoa_nome && `<div class="b">${esc(p.pessoa_nome)}</div>`,
    p.pessoa_cpf && `<div>CPF ${esc(p.pessoa_cpf)}</div>`,
    [p.pessoa_email, p.pessoa_telefone].filter(Boolean).length && `<div>${esc([p.pessoa_email, p.pessoa_telefone].filter(Boolean).join(' • '))}</div>`,
  ]
    .filter(Boolean)
    .join('');

  // No cabeçalho vai só o logo (nome e CNPJ já estão no bloco "Fornecedor"). Sem logo válido
  // (imagem embutida, a mesma regra da gravação), o nome da empresa ocupa o lugar dele.
  const logo = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(String(p.empresa_logo || ''))
    ? `<img class="logo" src="${p.empresa_logo}" alt="">`
    : `<div class="empresa">${esc(p.empresa_nome || '')}</div>`;

  const bloco = (rotulo: string, texto: unknown) =>
    texto ? `<section><h3>${rotulo}</h3><p class="pre">${esc(texto)}</p></section>` : '';

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(titulo)}</title>
<style>
  @page {
    size: A4;
    margin: 15mm 15mm 20mm;
    /* Rodapé em toda página impressa, na margem (fora do conteúdo) */
    @bottom-right {
      content: "BM-CRM by BMsoft Sistemas © ${new Date().getFullYear()}";
      font: 9px "Segoe UI", Roboto, Arial, sans-serif;
      color: #78716c;
      border-top: 1px solid #d6d3d1;
      vertical-align: top;
      text-align: right;
      padding-top: 3px;
    }
  }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Roboto, Arial, sans-serif; font-size: 11px; color: #1c1917; margin: 0; }
  header { display: flex; justify-content: space-between; align-items: center; gap: 16px; border-bottom: 2px solid #1d4ed8; padding-bottom: 10px; margin-bottom: 10px; }
  .marca { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .logo { max-height: 60px; max-width: 180px; object-fit: contain; }
  .empresa { font-size: 16px; font-weight: 700; }
  h1 { font-size: 16px; margin: 0 0 2px; color: #1d4ed8; }
  h2 { font-size: 13px; margin: 0 0 14px; font-weight: 600; }
  h3 { font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: #78716c; margin: 0 0 4px; }
  .meta { text-align: right; line-height: 1.5; }
  .grid { display: flex; gap: 24px; margin-bottom: 14px; }
  .grid > section { flex: 1; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  th { background: #f5f5f4; font-size: 10px; text-align: left; padding: 6px; border-bottom: 1px solid #d6d3d1; }
  td { padding: 6px; border-bottom: 1px solid #e7e5e4; vertical-align: top; }
  tr { page-break-inside: avoid; }
  .r { text-align: right; white-space: nowrap; } .c { text-align: center; } .b { font-weight: 700; }
  .sku { font-size: 9px; color: #78716c; font-family: monospace; }
  .controle { font-size: 13px; font-weight: 700; }
  .id { font-size: 8px; color: #a8a29e; }
  .totais { margin-left: auto; width: 260px; }
  .totais div { display: flex; justify-content: space-between; padding: 3px 0; }
  .totais .total { border-top: 2px solid #1c1917; margin-top: 4px; padding-top: 6px; font-size: 14px; font-weight: 700; }
  section { margin-bottom: 12px; }
  .pre { white-space: pre-wrap; margin: 0; }
  .aviso { border: 2px solid #be123c; color: #be123c; font-weight: 700; text-align: center; padding: 6px; margin-bottom: 12px; letter-spacing: .1em; }
  footer { margin-top: 40px; display: flex; gap: 40px; }
  footer div { flex: 1; border-top: 1px solid #a8a29e; padding-top: 4px; text-align: center; color: #57534e; }
</style></head>
<body>
  <header>
    <div class="marca">${logo}</div>
    <div class="meta"><h1>${ehProposta ? 'Proposta Comercial' : 'Pedido de Venda'}</h1>${meta}</div>
  </header>
  <h2>${esc(ehProposta ? p.titulo : p.negocio_titulo || '')}</h2>
  ${!ehProposta && p.status === 'cancelado' ? '<div class="aviso">PEDIDO CANCELADO</div>' : ''}

  <div class="grid">
    <section><h3>Fornecedor</h3>${vendedor || '<div>—</div>'}</section>
    <section><h3>Cliente</h3>${cliente || '<div>—</div>'}</section>
    ${condicao ? `<section><h3>${ehProposta ? 'Condições' : 'Condição'} de pagamento</h3><p class="pre">${esc(condicao)}</p></section>` : ''}
  </div>

  <table>
    <thead><tr>
      <th class="c" style="width:28px">#</th><th>Produto / Serviço</th>${
        resumida
          ? '<th class="r">Valor</th>'
          : '<th class="r">Qtd.</th><th class="c">Un.</th><th class="r">Preço unit.</th><th class="r">Desconto</th><th class="r">Subtotal</th>'
      }
    </tr></thead>
    <tbody>${linhas}</tbody>
  </table>

  <div class="totais">
    <div><span>Subtotal</span><span>${formatMoeda(p.valor_subtotal)}</span></div>
    ${descItens ? `<div><span>Descontos nos itens</span><span>− ${formatMoeda(descItens)}</span></div>` : ''}
    ${adicional > 0 ? `<div><span>Desconto adicional</span><span>− ${formatMoeda(adicional)}</span></div>` : ''}
    <div class="total"><span>Total</span><span>${formatMoeda(p.valor_total)}</span></div>
  </div>

  ${
    // Como o cliente vai pagar (parcelas da condição de pagamento)
    p.parcelas?.length
      ? `<section><h3>Parcelas${condicao ? ` — ${esc(condicao)}` : ''}</h3>
    <table><thead><tr><th class="c" style="width:28px">#</th><th class="c">Vencimento</th><th>Forma de pagamento</th><th class="r">Valor</th></tr></thead>
    <tbody>${p.parcelas
      .map(
        (x: RegistroCrud) =>
          `<tr><td class="c">${esc(x.numero)}</td><td class="c">${formatDateBR(x.vencimento)}</td><td>${esc(x.forma_pagamento)}</td><td class="r b">${formatMoeda(x.valor)}</td></tr>`,
      )
      .join('')}</tbody></table></section>`
      : ''
  }

  ${bloco('Observações', p.observacoes)}

  <footer><div>${esc(p.empresa_nome || 'Fornecedor')}</div><div>De acordo — ${esc(p.pessoa_nome || 'Cliente')}</div></footer>
  <script>window.onload = () => { window.focus(); window.print(); };</script>
</body></html>`;
}
