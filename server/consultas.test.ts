import assert from 'node:assert';
import { conferirGrafico, isolarEmpresa, preencherResposta } from './consultas.js';

// Cada tabela do FROM/JOIN vira só as linhas da empresa e as colunas liberadas, mantendo o apelido
const COLS = { pessoas: ['id', 'nome', 'empresa_id'], pessoas_enderecos: ['pessoa_id', 'cidade', 'empresa_id'], etapas: ['id', 'funil_id', 'nome'], funis: ['id', 'empresa_id'] };
const s = isolarEmpresa(
  "SELECT p.nome AS `Nome` FROM pessoas p JOIN pessoas_enderecos e ON e.pessoa_id = p.id WHERE e.cidade LIKE '%from pessoas%'",
  7,
  COLS,
);
assert.strictEqual(
  s,
  "SELECT p.nome AS `Nome` FROM (SELECT `id`, `nome`, `empresa_id` FROM pessoas WHERE empresa_id = 7) AS p JOIN (SELECT `pessoa_id`, `cidade`, `empresa_id` FROM pessoas_enderecos WHERE empresa_id = 7) AS e ON e.pessoa_id = p.id WHERE e.cidade LIKE '%from pessoas%'",
);
// Sem apelido: o apelido é o nome da tabela; palavra-chave depois do nome não vira apelido
assert.ok(isolarEmpresa('SELECT COUNT(*) FROM pessoas WHERE pessoas.id > 0', 7, COLS).includes('WHERE empresa_id = 7) AS pessoas WHERE pessoas.id > 0'));
assert.ok(isolarEmpresa('SELECT 1 FROM pessoas LEFT JOIN funis ON 1', 7, COLS).includes('AS pessoas LEFT JOIN'));
// Tabela sem empresa_id: pelas linhas do "pai" da empresa
assert.ok(isolarEmpresa('SELECT nome FROM etapas', 7, COLS).includes('`funil_id` IN (SELECT id FROM funis WHERE empresa_id = 7)'));
// Subconsulta também é isolada
assert.ok(!/FROM pessoas WHERE p\b/.test(isolarEmpresa('SELECT 1 FROM funis f WHERE EXISTS (SELECT 1 FROM pessoas x)', 7, COLS)));
// Recusa: tabela fora da lista, outro banco, vírgula
assert.throws(() => isolarEmpresa('SELECT * FROM empresas', 7, COLS), /tabelas do CRM/);
assert.throws(() => isolarEmpresa('SELECT * FROM crmweb.pessoas', 7, COLS), /tabelas do CRM/);
assert.throws(() => isolarEmpresa('SELECT * FROM funis f, pessoas', 7, COLS), /JOIN/);
assert.throws(() => isolarEmpresa('SELECT senha_hash FROM usuarios', 7, COLS), /tabelas do CRM/);

// Números da frase vêm do resultado
const r = { colunas: [{ nome: 'Total', tipo: 'numero' as const }], linhas: [[1234]], truncado: false };
assert.strictEqual(preencherResposta('Você tem {{Total}} clientes ({{linhas}} linha).', r), 'Você tem 1.234 clientes (1 linha).');
// Gráfico só com colunas do resultado; y precisa ser numérico; pizza fica com uma série
{
  const g = { colunas: [{ nome: 'Mês', tipo: 'texto' as const }, { nome: 'Total', tipo: 'numero' as const }, { nome: 'Qtd', tipo: 'numero' as const }], linhas: [['01/2026', 10, 2]], truncado: false };
  assert.deepStrictEqual(conferirGrafico({ tipo: 'linha', x: 'mês', y: ['Total', 'Nada'] }, g), { tipo: 'linha', x: 'Mês', y: ['Total'] });
  assert.deepStrictEqual(conferirGrafico({ tipo: 'pizza', x: 'Mês', y: ['Total', 'Qtd'] }, g)?.y, ['Total']);
  assert.strictEqual(conferirGrafico({ tipo: 'barras', x: 'Mês', y: ['Mês'] }, g), null);
  assert.strictEqual(conferirGrafico({ tipo: '3d', x: 'Mês', y: ['Total'] }, g), null);
}
console.log('consultas: ok');

// Opções da pergunta de volta: no mínimo 2, sem repetidas, no máximo 6
{
  const { conferirOpcoes } = await import('./consultas.js');
  assert.deepStrictEqual(conferirOpcoes({ lista: ['Por valor', ' Por valor ', 'Por quantidade'], multipla: true }), { lista: ['Por valor', 'Por quantidade'], multipla: true });
  assert.strictEqual(conferirOpcoes({ lista: ['Só uma'] }), null);
  assert.strictEqual(conferirOpcoes(null), null);
  assert.strictEqual(conferirOpcoes({ lista: ['1', '2', '3', '4', '5', '6', '7', '8'] })?.lista.length, 6);
}

// Gráfico só com pedido explícito
{
  const { PEDE_GRAFICO } = await import('./consultas.js');
  assert.ok(PEDE_GRAFICO.test('gráfico das vendas por mês') && PEDE_GRAFICO.test('em pizza, clientes por cidade'));
  assert.ok(!PEDE_GRAFICO.test('mostre os clientes de Ituporanga') && !PEDE_GRAFICO.test('vendas por linha de produto'));
}
