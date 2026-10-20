/**
 * Leitura de arquivos para a importação de pessoas: tudo vira uma tabela de textos
 * (string[][]). CSV/TXT é lido aqui mesmo; Excel e PDF usam bibliotecas carregadas
 * só quando o usuário escolhe um arquivo desse tipo.
 */

export type TipoArquivo = 'csv' | 'excel' | 'pdf';

export function tipoDoArquivo(nome: string): TipoArquivo | null {
  const ext = nome.toLowerCase().split('.').pop() || '';
  if (['csv', 'txt'].includes(ext)) return 'csv';
  if (['xls', 'xlsx', 'ods'].includes(ext)) return 'excel';
  if (ext === 'pdf') return 'pdf';
  return null;
}

// ------------------------------------------------------------
// CSV
// ------------------------------------------------------------

/** UTF-8 quando o arquivo é válido nele; senão Windows-1252 (padrão do Excel no Brasil) */
export function decodificarTexto(buf: ArrayBuffer, codificacao: 'auto' | 'utf-8' | 'windows-1252' = 'auto'): string {
  if (codificacao !== 'auto') return new TextDecoder(codificacao).decode(buf);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('windows-1252').decode(buf);
  }
}

/** O separador que mais aparece, de forma constante, nas primeiras linhas */
export function detectarSeparador(texto: string): string {
  const linhas = texto.split(/\r?\n/).filter((l) => l.trim()).slice(0, 10);
  let melhor = ';';
  let melhorNota = 0;
  for (const sep of [';', ',', '\t', '|']) {
    const contagens = linhas.map((l) => l.split(sep).length - 1);
    const minimo = Math.min(...contagens);
    if (minimo > melhorNota) {
      melhor = sep;
      melhorNota = minimo;
    }
  }
  return melhor;
}

/** CSV com aspas (campo entre aspas pode ter separador, quebra de linha e "" escapado) */
export function lerCsv(texto: string, separador: string, aspas = '"'): string[][] {
  const linhas: string[][] = [];
  let linha: string[] = [];
  let campo = '';
  let dentro = false;
  const t = texto.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (dentro) {
      if (c === aspas) {
        if (t[i + 1] === aspas) {
          campo += aspas;
          i++;
        } else dentro = false;
      } else campo += c;
    } else if (aspas && c === aspas && campo === '') dentro = true;
    else if (c === separador) {
      linha.push(campo);
      campo = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      linha.push(campo);
      linhas.push(linha);
      linha = [];
      campo = '';
    } else campo += c;
  }
  if (campo !== '' || linha.length) {
    linha.push(campo);
    linhas.push(linha);
  }
  return linhas.filter((l) => l.some((c) => c.trim()));
}

// ------------------------------------------------------------
// Excel
// ------------------------------------------------------------

export interface PastaExcel {
  abas: string[];
  ler: (aba: string) => string[][];
}

export async function abrirExcel(buf: ArrayBuffer): Promise<PastaExcel> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  return {
    abas: wb.SheetNames,
    ler: (aba) =>
      (XLSX.utils.sheet_to_json<string[]>(wb.Sheets[aba], { header: 1, raw: false, defval: '', dateNF: 'dd/mm/yyyy' }) as any[][])
        .map((l) => l.map((c) => String(c ?? '')))
        .filter((l) => l.some((c) => c.trim())),
  };
}

// ------------------------------------------------------------
// PDF (relatório)
// ------------------------------------------------------------

/** Pedaço de texto de uma linha do relatório, com a posição horizontal */
export interface Trecho {
  x: number;
  fim: number;
  texto: string;
}

/** Linhas do PDF, de cima para baixo, página a página; cada linha é uma lista de trechos */
export async function lerLinhasPdf(buf: ArrayBuffer): Promise<Trecho[][]> {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const todas: Trecho[][] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const pagina = await doc.getPage(p);
    const conteudo = await pagina.getTextContent();
    const itens = (conteudo.items as any[])
      .filter((i) => typeof i.str === 'string' && i.str.trim())
      .map((i) => ({ x: i.transform[4], y: i.transform[5], fim: i.transform[4] + i.width, texto: i.str }));
    todas.push(...agruparLinhas(itens));
  }
  return todas;
}

/** Junta os itens da mesma altura (tolerância de 3pt) numa linha, ordenados da esquerda para a direita */
export function agruparLinhas(itens: { x: number; y: number; fim: number; texto: string }[]): Trecho[][] {
  const ordenados = [...itens].sort((a, b) => b.y - a.y || a.x - b.x);
  const linhas: { y: number; trechos: Trecho[] }[] = [];
  for (const i of ordenados) {
    const atual = linhas[linhas.length - 1];
    if (atual && Math.abs(atual.y - i.y) <= 3) atual.trechos.push({ x: i.x, fim: i.fim, texto: i.texto });
    else linhas.push({ y: i.y, trechos: [{ x: i.x, fim: i.fim, texto: i.texto }] });
  }
  return linhas.map((l) => l.trechos.sort((a, b) => a.x - b.x));
}

/** Une trechos vizinhos: um espaço maior que `distancia` (pt) separa colunas */
export function unirTrechos(linha: Trecho[], distancia: number): Trecho[] {
  const out: Trecho[] = [];
  for (const t of linha) {
    const ult = out[out.length - 1];
    if (ult && t.x - ult.fim <= distancia) {
      ult.texto += (t.x - ult.fim > 0.5 ? ' ' : '') + t.texto;
      ult.fim = Math.max(ult.fim, t.fim);
    } else out.push({ ...t });
  }
  return out;
}

/** Provável linha de cabeçalho: a primeira, entre as 40 iniciais, com mais colunas */
export function acharCabecalhoPdf(linhas: Trecho[][], distancia: number): number {
  const colunas = linhas.slice(0, 40).map((l) => unirTrechos(l, distancia).length);
  return colunas.indexOf(Math.max(0, ...colunas));
}

/**
 * Tabela a partir das linhas do PDF. As colunas são as da linha de cabeçalho: cada
 * trecho vai para a coluna em que mais se sobrepõe (ou a mais próxima), o que cobre
 * colunas alinhadas à esquerda e números alinhados à direita.
 */
export function tabelaDoPdf(linhas: Trecho[][], linhaCabecalho: number, distancia: number): string[][] {
  const unidas = linhas.map((l) => unirTrechos(l, distancia));
  const cab = unidas[linhaCabecalho] || unidas[0] || [];
  if (!cab.length) return [];
  return unidas.map((linha) => {
    const cells = cab.map(() => '');
    for (const t of linha) {
      let melhor = 0;
      let nota = -Infinity;
      cab.forEach((c, i) => {
        const sobrepoe = Math.min(t.fim, c.fim) - Math.max(t.x, c.x);
        const n = sobrepoe > 0 ? sobrepoe : -Math.abs((t.x + t.fim) / 2 - (c.x + c.fim) / 2);
        if (n > nota) {
          nota = n;
          melhor = i;
        }
      });
      cells[melhor] = cells[melhor] ? `${cells[melhor]} ${t.texto}` : t.texto;
    }
    return cells;
  });
}

// ------------------------------------------------------------
// De → para
// ------------------------------------------------------------

const normalizar = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/** Nomes de coluna que costumam corresponder a cada campo do CRM */
export const SINONIMOS: Record<string, string[]> = {
  cod_integracao: ['codigo', 'cod', 'id', 'codintegracao', 'codcliente', 'codigocliente'],
  nome: ['nome', 'razaosocial', 'cliente', 'nomecliente', 'contato', 'nomecompleto', 'name'],
  email: ['email', 'mail', 'correioeletronico'],
  telefone: ['telefone', 'fone', 'celular', 'whatsapp', 'tel', 'fone1', 'phone', 'contato1'],
  cpf: ['cpf', 'cnpj', 'cpfcnpj', 'documento', 'doc'],
  obs: ['obs', 'observacao', 'observacoes', 'anotacoes', 'notas'],
  segmento: ['segmento', 'ramo', 'ramoatividade', 'ramodeatividade', 'setor', 'categoria'],
  end_cep: ['cep', 'codigopostal', 'zip'],
  end_logradouro: ['logradouro', 'endereco', 'rua', 'end', 'address'],
  end_numero: ['numero', 'num', 'nro', 'n'],
  end_complemento: ['complemento', 'compl'],
  end_bairro: ['bairro', 'distrito'],
  end_cidade: ['cidade', 'municipio', 'localidade', 'city'],
  end_uf: ['uf', 'estado', 'state'],
};

/** Coluna sugerida para cada campo (índice ou -1), sem repetir coluna */
export function sugerirDePara(cabecalho: string[], campos: { campo: string; rotulo: string }[]): Record<string, number> {
  const norm = cabecalho.map(normalizar);
  const usadas = new Set<number>();
  const out: Record<string, number> = {};
  for (const { campo, rotulo } of campos) {
    const nomes = SINONIMOS[campo] || [normalizar(rotulo)];
    let idx = norm.findIndex((h, i) => !usadas.has(i) && nomes.includes(h));
    if (idx < 0) idx = norm.findIndex((h, i) => !usadas.has(i) && h && nomes.some((n) => n.length > 3 && h.includes(n)));
    out[campo] = idx;
    if (idx >= 0) usadas.add(idx);
  }
  return out;
}

// lerNumero e lerData ficam em formatters.ts (o servidor também usa: este arquivo carrega Excel/PDF)
import { lerData, lerNumero } from './formatters';
export { lerData, lerNumero };

/**
 * Texto do arquivo no formato que o cadastro grava para o campo personalizado.
 * undefined = célula vazia; null = valor que não serve para o tipo do campo.
 */
export function valorPersonalizado(
  texto: string,
  tipo: string,
  opcoes: string[] = [],
): string | boolean | null | undefined {
  const s = texto.trim();
  if (!s) return undefined;
  switch (tipo) {
    case 'numero': {
      const n = lerNumero(s);
      return n !== null && Number.isInteger(Number(n)) ? n : null;
    }
    case 'decimal':
      return lerNumero(s);
    case 'data':
      return lerData(s);
    case 'boolean': {
      const n = normalizar(s);
      if (['sim', 's', 'yes', 'y', '1', 'true', 'x', 'verdadeiro', 'v'].includes(n)) return true;
      if (['nao', 'n', 'no', '0', 'false', 'falso', 'f'].includes(n)) return false;
      return null;
    }
    case 'lista':
      return opcoes.find((o) => normalizar(o) === normalizar(s)) ?? null;
    default:
      return s.slice(0, 1000);
  }
}

const UFS: Record<string, string> = {
  AC: 'acre', AL: 'alagoas', AM: 'amazonas', AP: 'amapa', BA: 'bahia', CE: 'ceara', DF: 'distrito federal',
  ES: 'espirito santo', GO: 'goias', MA: 'maranhao', MG: 'minas gerais', MS: 'mato grosso do sul',
  MT: 'mato grosso', PA: 'para', PB: 'paraiba', PE: 'pernambuco', PI: 'piaui', PR: 'parana',
  RJ: 'rio de janeiro', RN: 'rio grande do norte', RO: 'rondonia', RR: 'roraima', RS: 'rio grande do sul',
  SC: 'santa catarina', SE: 'sergipe', SP: 'sao paulo', TO: 'tocantins',
};

/**
 * CEP e UF do endereço como o servidor vai gravar (mesma regra de lerUf em
 * server/importarquivo.ts). undefined = vazio; null = inválido, fica em branco.
 */
export function valorEndereco(campo: string, texto: string): string | null | undefined {
  const s = texto.trim();
  if (!s) return undefined;
  if (campo === 'end_cep') {
    const d = s.replace(/\D/g, '');
    return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : null;
  }
  if (campo === 'end_uf') {
    const n = s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    if (UFS[n.toUpperCase()]) return n.toUpperCase();
    return Object.keys(UFS).find((uf) => UFS[uf] === n) ?? null;
  }
  return s;
}
