/**
 * Migração única: tira de Pessoas quem ainda é lead (tipo 'lead') e leva para a tabela leads.
 *
 *  - Quem tem negócio, proposta, pedido, chamado, OS, contrato, item de pesquisa, histórico... (qualquer tabela com
 *    pessoa_id fora das que aceitam lead_id) vira cliente (tipo 'cliente') e fica em Pessoas.
 *  - Os demais vão para leads (cidade/UF do endereço principal, o contato principal como "contato"); mensagens,
 *    atendimentos, avaliações, disparos, atividades e conversas de atividade passam do pessoa_id para o lead_id,
 *    e a pessoa sai de Pessoas (endereços e contatos vão junto, pelo ON DELETE CASCADE).
 *
 * Uso (na pasta code):
 *   npx tsx scripts/migrar-leads.ts                      simula (faz tudo numa transação e desfaz no fim)
 *   npx tsx scripts/migrar-leads.ts --aplicar            grava; antes do commit salva o backup em scripts/backup_migrar_leads_AAAAMMDDHHMM.json
 *   npx tsx scripts/migrar-leads.ts --reverter <arquivo> simula a reversão pelo backup; com --aplicar, grava
 *                                                        (lead já convertido em cliente impede)
 *   --empresa N                                          só a empresa N (nas três formas)
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { pool } from '../server/db.js';

/** Tabelas com lead_id: o que era da pessoa passa para o lead */
const LIGADAS = ['campanha_disparos', 'whatsapp_mensagens', 'whatsapp_atendimentos', 'avaliacoes', 'atividades', 'atividade_conversas'];
/** Saem junto com a pessoa (CASCADE) e ficam no backup */
const FILHAS = ['pessoas_enderecos', 'pessoas_contatos'];

const args = process.argv.slice(2);
const aplicar = args.includes('--aplicar');
const iRev = args.indexOf('--reverter');
const arquivoRev = iRev >= 0 ? args[iRev + 1] : null;
const iEmp = args.indexOf('--empresa');
const empresa = iEmp >= 0 ? Number(args[iEmp + 1]) : null;
if (iEmp >= 0 && !Number.isInteger(empresa)) throw new Error('--empresa precisa de um número.');
if (iRev >= 0 && !arquivoRev) throw new Error('--reverter precisa do arquivo de backup.');

/** AAAAMMDDHHMM no horário de Brasília */
function carimbo() {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
      .formatToParts(new Date())
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}${p.month}${p.day}${p.hour}${p.minute}`;
}

type Conn = Awaited<ReturnType<typeof pool.getConnection>>;
/** Linhas com datas em texto: voltam ao banco exatamente como estavam */
const linhas = async (conn: Conn, sql: string, valores: unknown[]) => (await conn.query<any[]>({ sql, values: valores, dateStrings: true }))[0];

async function colunas(conn: Conn, tabela: string): Promise<string[]> {
  const [r] = await conn.query<any[]>('SELECT COLUMN_NAME c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION', [tabela]);
  return r.map((x) => String(x.c));
}

async function migrar() {
  const conn = await pool.getConnection();
  try {
    // Tabelas que fazem do lead um cliente: todas as outras com pessoa_id
    const [tabs] = await conn.query<any[]>(
      "SELECT TABLE_NAME t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'pessoa_id' AND TABLE_NAME NOT IN (?)",
      [[...LIGADAS, ...FILHAS, 'leads', 'pessoas']],
    );
    const deCliente: string[] = tabs.map((x) => String(x.t));
    const comContato = new Set<string>();
    for (const t of LIGADAS) if ((await colunas(conn, t)).includes('contato_id')) comContato.add(t);

    await conn.beginTransaction();
    const [todos] = await conn.query<any[]>(`SELECT id, empresa_id, nome FROM pessoas WHERE tipo = 'lead'${empresa !== null ? ' AND empresa_id = ?' : ''} ORDER BY id`, empresa !== null ? [empresa] : []);
    const viramCliente: number[] = [];
    const motivos = new Map<string, number>();
    const mover: any[] = [];
    for (const p of todos) {
      const onde: string[] = [];
      for (const t of deCliente) {
        const [[r]] = await conn.query<any>(`SELECT EXISTS (SELECT 1 FROM ${t} WHERE pessoa_id = ?) e`, [p.id]);
        if (Number(r.e)) onde.push(t);
      }
      if (onde.length) {
        viramCliente.push(p.id);
        for (const t of onde) motivos.set(t, (motivos.get(t) ?? 0) + 1);
      } else mover.push(p);
    }
    console.log(`Leads em Pessoas: ${todos.length} • viram cliente: ${viramCliente.length} • vão para leads: ${mover.length}`);
    console.log('Viram cliente por ter:', Object.fromEntries(motivos));

    if (viramCliente.length) await conn.query("UPDATE pessoas SET tipo = 'cliente' WHERE id IN (?)", [viramCliente]);

    const backup: any = { criado_em: carimbo(), empresa, clientes: viramCliente, movidos: [] as any[] };
    const ligacoes: Record<string, number> = {};
    for (const p of mover) {
      // Backup antes de mexer: a pessoa, os endereços, os contatos e as linhas ligadas (com o contato_id de cada uma)
      const item: any = {
        pessoa: (await linhas(conn, 'SELECT * FROM pessoas WHERE id = ?', [p.id]))[0],
        filhas: {} as Record<string, any[]>,
        ligadas: {} as Record<string, { id: number; contato_id?: number | null }[]>,
      };
      for (const t of FILHAS) item.filhas[t] = await linhas(conn, `SELECT * FROM ${t} WHERE pessoa_id = ?`, [p.id]);
      for (const t of LIGADAS) {
        item.ligadas[t] = await linhas(conn, `SELECT id${comContato.has(t) ? ', contato_id' : ''} FROM ${t} WHERE pessoa_id = ?`, [p.id]);
        ligacoes[t] = (ligacoes[t] ?? 0) + item.ligadas[t].length;
      }

      // Origem: Prospecção (código do Google ou busca), WhatsApp (tem conversa) ou manual
      const [r] = await conn.query<any>(
        `INSERT INTO leads (empresa_id, origem, nome, contato, telefone, whatsapp, email, cidade, uf, segmento_id, prospeccao_busca_id, google_place_id,
                            nao_receber_campanhas, obs, criado_em, atualizado_em)
         SELECT p.empresa_id,
                CASE WHEN p.google_place_id IS NOT NULL OR p.prospeccao_busca_id IS NOT NULL THEN 'prospeccao'
                     WHEN EXISTS (SELECT 1 FROM whatsapp_mensagens w WHERE w.pessoa_id = p.id) THEN 'whatsapp' ELSE 'manual' END,
                LEFT(p.nome, 255), LEFT(c.nome, 150), LEFT(p.telefone, 30), LEFT(COALESCE(NULLIF(p.whatsapp, ''), NULLIF(c.whatsapp, ''), NULLIF(c.celular, '')), 30),
                LEFT(COALESCE(NULLIF(p.email, ''), NULLIF(c.email, '')), 255), LEFT(e.cidade, 100), e.uf, p.segmento_id, p.prospeccao_busca_id, p.google_place_id,
                COALESCE(p.nao_receber_campanhas, 0), p.obs, p.criado_em, p.atualizado_em
           FROM pessoas p
           LEFT JOIN pessoas_enderecos e ON e.id = (SELECT x.id FROM pessoas_enderecos x WHERE x.pessoa_id = p.id ORDER BY x.principal DESC, x.id LIMIT 1)
           LEFT JOIN pessoas_contatos c ON c.id = (SELECT x.id FROM pessoas_contatos x WHERE x.pessoa_id = p.id ORDER BY x.principal DESC, x.id LIMIT 1)
          WHERE p.id = ?`,
        [p.id],
      );
      item.lead_id = Number(r.insertId);
      for (const t of LIGADAS) {
        // O contato_id era de um contato da pessoa, que sai junto com ela
        await conn.query(`UPDATE ${t} SET lead_id = ?, pessoa_id = NULL${comContato.has(t) ? ', contato_id = NULL' : ''} WHERE pessoa_id = ?`, [item.lead_id, p.id]);
      }
      const [d] = await conn.query<any>("DELETE FROM pessoas WHERE id = ? AND tipo = 'lead'", [p.id]);
      if (d.affectedRows !== 1) throw new Error(`Pessoa ${p.id} (${p.nome}) não pôde ser removida.`);
      backup.movidos.push(item);
    }
    console.log('Ligações passadas para lead_id:', ligacoes);

    if (!aplicar) {
      await conn.rollback();
      console.log('\nSIMULAÇÃO: nada foi gravado. Para gravar: npx tsx scripts/migrar-leads.ts --aplicar' + (empresa !== null ? ` --empresa ${empresa}` : ''));
      return;
    }
    const arquivo = path.resolve('scripts', `backup_migrar_leads_${backup.criado_em}${empresa !== null ? `_empresa${empresa}` : ''}.json`);
    fs.writeFileSync(arquivo, JSON.stringify(backup, null, 1));
    await conn.commit();
    console.log(`\nGRAVADO. Backup para reverter: ${arquivo}\n  npx tsx scripts/migrar-leads.ts --reverter "${arquivo}"`);
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

async function reverter(arquivo: string) {
  const backup = JSON.parse(fs.readFileSync(arquivo, 'utf-8'));
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const insere = async (tabela: string, linha: any) => {
      const cols = Object.keys(linha);
      await conn.query(`INSERT INTO ${tabela} (${cols.join(', ')}) VALUES (?)`, [cols.map((c) => linha[c])]);
    };
    for (const item of backup.movidos) {
      const [[l]] = await conn.query<any>('SELECT id, nome, convertido_em FROM leads WHERE id = ?', [item.lead_id]);
      if (l?.convertido_em) throw new Error(`O lead ${l.id} (${l.nome}) já foi convertido em cliente: reverta à mão.`);
      await insere('pessoas', item.pessoa);
      for (const t of FILHAS) for (const linha of item.filhas[t] ?? []) await insere(t, linha);
      for (const t of LIGADAS) {
        for (const x of item.ligadas[t] ?? []) {
          const temContato = 'contato_id' in x;
          await conn.query(`UPDATE ${t} SET pessoa_id = ?, lead_id = NULL${temContato ? ', contato_id = ?' : ''} WHERE id = ?`, [
            item.pessoa.id,
            ...(temContato ? [x.contato_id] : []),
            x.id,
          ]);
        }
        // O que o lead ganhou depois da migração também volta para a pessoa
        await conn.query(`UPDATE ${t} SET pessoa_id = ?, lead_id = NULL WHERE lead_id = ?`, [item.pessoa.id, item.lead_id]);
      }
      await conn.query('DELETE FROM leads WHERE id = ?', [item.lead_id]);
    }
    if (backup.clientes.length) await conn.query("UPDATE pessoas SET tipo = 'lead' WHERE id IN (?)", [backup.clientes]);
    if (!aplicar) {
      await conn.rollback();
      console.log(`SIMULAÇÃO da reversão (${backup.movidos.length} pessoas, ${backup.clientes.length} de volta a lead): nada foi gravado. Para gravar, acrescente --aplicar.`);
      return;
    }
    await conn.commit();
    console.log(`REVERTIDO: ${backup.movidos.length} pessoas de volta e ${backup.clientes.length} de volta a lead.`);
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

(arquivoRev ? reverter(arquivoRev) : migrar())
  .catch((err) => {
    console.error('ERRO:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
