import { RegistroCrud } from '../types.js';
import { formatCNPJ, formatDateBR, formatDateTimeBR, formatMoeda } from './formatters.js';
import { esc } from './imprimirDocumento.js';
import { fetchOS } from '../services/api.js';

const TIPOS: Record<string, string> = {
  instalacao: 'Instalação',
  manutencao_corretiva: 'Manutenção corretiva',
  manutencao_preventiva: 'Manutenção preventiva',
  treinamento: 'Treinamento',
  visita_tecnica: 'Visita técnica',
  outro: 'Outro',
};

const URL_FOTO = /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\/[^\s"'<>]+$/i;

const hora = (v: unknown) => (v ? String(v).slice(0, 5) : '');

/**
 * Página A4 da OS para o técnico levar: dados do atendimento, espaço para o que foi feito, horários e
 * assinaturas. O que já estiver gravado (feito, início/término, assinatura do app) sai preenchido.
 */
export function htmlOS(o: RegistroCrud): string {
  const logo = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(String(o.empresa_logo || ''))
    ? `<img class="logo" src="${o.empresa_logo}" alt="">`
    : `<div class="empresa">${esc(o.empresa_nome || '')}</div>`;
  const assinatura = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(String(o.assinatura || ''))
    ? `<img class="assinatura" src="${o.assinatura}" alt="">`
    : '';
  const horario = [hora(o.hora_inicio), hora(o.hora_fim)].filter(Boolean).join(' às ');
  const linha = (rotulo: string, valor: unknown) => (valor ? `<div><span class="rot">${rotulo}</span> ${esc(valor)}</div>` : '');
  const titulo = `Ordem de Serviço nº ${o.numero}`;
  const qtd = (v: unknown) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(Number(v) || 0);
  const itens: RegistroCrud[] = o.itens || [];
  const total = itens.reduce((t, i) => t + (Number(i.subtotal) || 0), 0);
  // Serviços e produtos: os lançados e, enquanto a OS não foi encerrada, linhas em branco para o técnico anotar
  const emBranco = o.status === 'concluida' ? 0 : Math.max(8 - itens.length, 4);
  const servicos =
    itens.length || emBranco
      ? `<section><h3>Serviços e produtos utilizados</h3><table class="itens">
    <thead><tr><th class="r" style="width:60px">Qtd.</th><th class="c" style="width:50px">Un.</th><th>Serviço / produto</th><th class="r" style="width:90px">Preço unit.</th><th class="r" style="width:80px">Desconto</th><th class="r" style="width:90px">Subtotal</th></tr></thead>
    <tbody>${itens
      .map(
        (i) => `<tr><td class="r">${qtd(i.quantidade)}</td><td class="c">${esc(i.unidade)}</td>
        <td>${esc(i.item_nome)}${i.item_codigo ? ` <span class="rot">(${esc(i.item_codigo)})</span>` : ''}</td>
        <td class="r">${formatMoeda(i.preco_unitario)}</td><td class="r">${Number(i.desconto) ? formatMoeda(i.desconto) : '—'}</td><td class="r b">${formatMoeda(i.subtotal)}</td></tr>`,
      )
      .join('')}${'<tr class="vazia"><td></td><td></td><td></td><td></td><td></td><td></td></tr>'.repeat(emBranco)}</tbody>
    ${itens.length && !emBranco ? `<tfoot><tr><td colspan="5" class="r b">Total</td><td class="r b">${formatMoeda(total)}</td></tr></tfoot>` : ''}
  </table></section>`
      : '';
  // Fotos do app do técnico numa página à parte (só endereços do Vercel Blob)
  const grade = (momento: string, rotulo: string) => {
    const lista = (o.fotos || []).filter((f: RegistroCrud) => f.momento === momento && URL_FOTO.test(String(f.url)));
    return lista.length
      ? `<section><h3>${rotulo}</h3><div class="grade">${lista.map((f: RegistroCrud) => `<img src="${esc(f.url)}" alt="">`).join('')}</div></section>`
      : '';
  };
  const fotos = (o.fotos || []).length ? `<div class="fotos">${grade('antes', 'Fotos de antes')}${grade('depois', 'Fotos de depois')}</div>` : '';

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(titulo)}</title>
<style>
  @page { size: A4; margin: 12mm 15mm 15mm; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Roboto, Arial, sans-serif; font-size: 11px; color: #1c1917; margin: 0; }
  header { display: flex; justify-content: space-between; align-items: center; gap: 16px; border-bottom: 2px solid #1d4ed8; padding-bottom: 8px; margin-bottom: 10px; }
  .logo { max-height: 56px; max-width: 180px; object-fit: contain; }
  .empresa { font-size: 16px; font-weight: 700; }
  .emp { font-size: 10px; color: #57534e; line-height: 1.4; }
  h1 { font-size: 16px; margin: 0 0 2px; color: #1d4ed8; }
  h3 { font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: #78716c; margin: 0 0 4px; }
  .meta { text-align: right; line-height: 1.5; }
  .grid { display: flex; gap: 12px; margin-bottom: 10px; }
  .grid > section { flex: 1; border: 1px solid #d6d3d1; border-radius: 4px; padding: 6px 8px; line-height: 1.5; }
  .rot { color: #78716c; }
  .b { font-weight: 700; }
  section { margin-bottom: 10px; }
  .caixa { border: 1px solid #d6d3d1; border-radius: 4px; padding: 6px 8px; }
  .pre { white-space: pre-wrap; margin: 0; }
  .linhas { height: 190px; background: repeating-linear-gradient(transparent 0 23px, #d6d3d1 23px 24px); }
  .horas { display: flex; gap: 24px; margin: 10px 0 14px; }
  .horas div { flex: 1; }
  .branco { display: inline-block; min-width: 140px; border-bottom: 1px solid #a8a29e; }
  .aviso { border: 2px solid #be123c; color: #be123c; font-weight: 700; text-align: center; padding: 6px; margin-bottom: 10px; letter-spacing: .1em; }
  footer { margin-top: 28px; display: flex; gap: 40px; align-items: flex-end; }
  footer > div { flex: 1; text-align: center; color: #57534e; }
  .ass { border-top: 1px solid #a8a29e; padding-top: 4px; }
  .assinatura { max-height: 70px; max-width: 100%; display: block; margin: 0 auto; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #f5f5f4; font-size: 10px; text-align: left; padding: 5px 6px; border-bottom: 1px solid #d6d3d1; }
  td { padding: 5px 6px; border-bottom: 1px solid #e7e5e4; vertical-align: top; }
  tfoot td { border-top: 2px solid #1c1917; border-bottom: none; font-size: 12px; }
  .r { text-align: right; white-space: nowrap; } .c { text-align: center; }
  .itens td { border: 1px solid #d6d3d1; }
  .itens th { border: 1px solid #d6d3d1; }
  .vazia td { height: 24px; }
  .dados { text-align: left; margin-top: 10px; line-height: 2.2; }
  .fotos { page-break-before: always; }
  .fotos section { margin-bottom: 14px; }
  .grade { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
  .grade img { width: 100%; height: 55mm; object-fit: cover; border-radius: 4px; page-break-inside: avoid; }
</style></head>
<body>
  <header>
    <div>${logo}<div class="emp">${[o.empresa_cnpj && `CNPJ ${esc(formatCNPJ(o.empresa_cnpj))}`, o.empresa_endereco && esc(o.empresa_endereco)].filter(Boolean).join(' • ')}</div></div>
    <div class="meta">
      <h1>${esc(titulo)}</h1>
      <div class="b">${formatDateBR(o.data_agendada)}${horario ? ` • ${esc(horario)}` : ''}</div>
      <div>${esc(TIPOS[o.tipo] || o.tipo || '')}${o.chamado_numero ? ` • Chamado #${esc(o.chamado_numero)}` : ''}</div>
    </div>
  </header>
  ${o.status === 'cancelada' ? '<div class="aviso">ORDEM DE SERVIÇO CANCELADA</div>' : ''}

  <div class="grid">
    <section>
      <h3>Cliente</h3>
      <div class="b">${esc(o.pessoa_nome)}</div>
      ${linha('CPF/CNPJ', o.pessoa_cpf)}
      ${linha('Telefone', [o.pessoa_telefone, o.pessoa_whatsapp].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' • '))}
      ${linha('Endereço', o.endereco)}
      ${linha('Falar com', [o.contato_nome, o.contato_telefone].filter(Boolean).join(' • '))}
    </section>
    <section style="flex:0 0 32%">
      <h3>Técnico</h3>
      <div class="b">${esc(o.tecnico_nome || '—')}</div>
    </section>
  </div>

  <section><h3>O que será feito</h3><div class="caixa"><p class="pre">${esc(o.servico_solicitado || '')}</p></div></section>

  ${servicos}

  <section><h3>O que foi feito</h3>${
    o.servico_executado ? `<div class="caixa"><p class="pre">${esc(o.servico_executado)}</p></div>` : '<div class="caixa linhas"></div>'
  }</section>

  <div class="horas">
    <div><span class="rot">Início:</span> ${o.inicio_em ? esc(formatDateTimeBR(o.inicio_em)) : '<span class="branco">&nbsp;&nbsp;&nbsp;/&nbsp;&nbsp;&nbsp;/&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;:&nbsp;&nbsp;&nbsp;</span>'}</div>
    <div><span class="rot">Término:</span> ${o.fim_em ? esc(formatDateTimeBR(o.fim_em)) : '<span class="branco">&nbsp;&nbsp;&nbsp;/&nbsp;&nbsp;&nbsp;/&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;:&nbsp;&nbsp;&nbsp;</span>'}</div>
  </div>

  <footer>
    <div><div class="ass">${esc(o.tecnico_nome || 'Técnico')}</div></div>
    <div>
      ${assinatura}
      <div class="ass">Assinatura do cliente — atesto que o serviço acima foi realizado</div>
      <div class="dados">
        <div>Nome: ${o.assinatura_nome ? esc(o.assinatura_nome) : '<span class="branco" style="min-width:75%"></span>'}</div>
        <div>Documento: ${o.assinatura_documento ? esc(o.assinatura_documento) : '<span class="branco" style="min-width:60%"></span>'}</div>
      </div>
    </div>
  </footer>
  ${fotos}
  <script>window.onload = () => { window.focus(); window.print(); };</script>
</body></html>`;
}

/** Abre a OS numa aba, pronta para imprimir. A aba abre no clique (depois de um await, o bloqueador barraria) */
export async function imprimirOS(id: string | number, onErro: (msg: string) => void) {
  const janela = window.open('', '_blank');
  if (!janela) return onErro('O navegador bloqueou a nova aba. Libere pop-ups para este site e tente de novo.');
  janela.document.write('<p style="font-family:sans-serif">Preparando a ordem de serviço…</p>');
  try {
    const o = await fetchOS(id);
    janela.document.open();
    janela.document.write(htmlOS(o));
    janela.document.close();
  } catch (err: any) {
    janela.close();
    onErro(err.message || 'Não foi possível abrir a ordem de serviço.');
  }
}
