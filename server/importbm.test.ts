import assert from 'node:assert';
import { comRevenda, converterProduto, enderecoDoBm, enderecoIgual, valorRevenda } from './importbm.js';

// PRODUTOSPRINCIPAL → produtos do CRM
const p = converterProduto({ id: 26070, descricao: ' ABAFADOR CONCHA ', texto: '[blob]', precovenda1: 16.299, unvenda: 'PC', ativo: 'S' });
assert.deepStrictEqual(p, { cod_integracao: 'BM-26070', codigo_sku: '26070', nome: 'ABAFADOR CONCHA', descricao: null, preco_tabela: 16.3, unidade_medida: 'PC', ativo: 1 });
// Sem preço, sem unidade, inativo
const q = converterProduto({ id: 1, descricao: 'ADUBO', precovenda1: null, unvenda: '', ativo: 'N' });
assert.strictEqual(q.preco_tabela, 0);
assert.strictEqual(q.unidade_medida, 'UN');
assert.strictEqual(q.ativo, 0);

// Revenda: nome do vendedor do bmsoft → opção da lista com o mesmo nome (sem diferenciar maiúsculas); sem opção, o nome como veio
const opcoes = ['BMsoft', 'Dimapel', 'ACrescer', 'Company', 'Sysmov'];
assert.strictEqual(valorRevenda('DIMAPEL', opcoes), 'Dimapel');
assert.strictEqual(valorRevenda(' acrescer ', opcoes), 'ACrescer');
assert.strictEqual(valorRevenda('GLOBALTEK', opcoes), 'GLOBALTEK');
assert.strictEqual(valorRevenda('', opcoes), null);
assert.strictEqual(valorRevenda(null, opcoes), null);
// Personalizados: junta a revenda sem perder os outros campos; null quando não muda (ou sem revenda)
assert.strictEqual(comRevenda(null, 'Dimapel'), '{"revenda":"Dimapel"}');
assert.deepStrictEqual(JSON.parse(comRevenda('{"classificacao":"Ouro","revenda":"BMsoft"}', 'Dimapel')!), { classificacao: 'Ouro', revenda: 'Dimapel' });
assert.strictEqual(comRevenda('{"revenda":"Dimapel"}', 'Dimapel'), null);
assert.strictEqual(comRevenda('{"revenda":"Dimapel"}', null), null);
assert.strictEqual(comRevenda('ilegível', 'Company'), '{"revenda":"Company"}');

// Endereço do cadastro do bmsoft → endereço da pessoa (vazio = sem endereço)
const end = enderecoDoBm({ endereco: 'AV JOAO BERTOLI', numero: 819, complemento: null, bairro: 'CENTRO', cep: '89190-000', cidade: 'TAIO', uf: 'sc', cod_cidade: 4217808 });
assert.deepStrictEqual(end, { logradouro: 'AV JOAO BERTOLI', numero: '819', complemento: null, bairro: 'CENTRO', cep: '89190000', cidade: 'TAIO', uf: 'SC', codigo_ibge: '4217808' });
assert.strictEqual(enderecoDoBm({ endereco: '', cidade: null, cep: '' }), null);
assert.strictEqual(enderecoIgual({ ...end, id: 5, obs: 'x' }, end!), true);
assert.strictEqual(enderecoIgual({ ...end, numero: '820' }, end!), false);

console.log('importbm: ok');
process.exit(0);

// Vendas (NFPRODUTOS + NFMESTRE): data do DBISAM, chaves BM-, documento do cliente e arredondamentos
{
  const { converterVenda, dataBm } = await import('./importbm.js');
  assert.strictEqual(dataBm('2026-10-09T00:00:00'), '2026-10-09');
  assert.strictEqual(dataBm('09/10/2026'), '2026-10-09');
  assert.strictEqual(dataBm(''), null);
  const v = converterVenda({
    id: 7, cod_integracao: 120, pro_cod_integracao: 33, pro_qtdade: '2.5000', pro_un: 'UNID', pro_preco_venda: '10.456', pro_valor_total: '26.14', pro_custo_unit: '6.789',
    nf_data: '2026-10-09', nf_numero: 4521, nf_cfop: '5102', cli_cnpj: '12.345.678/0001-99', cli_nome: 'Papelaria Central', cancelado: 's', nf_valor_total: '150.5', cli_uf_nf: 'sc',
    cli_cnpj_cadastro: '', cli_cidade: 'Rio do Sul', cli_bairro: 'Centro', cli_uf: '', pro_descricao: 'Papel A4', pro_marca: 'Chamex', pro_classe: '020.1', pro_classe_descricao: 'Papelaria',
    ven_cod_integracao: 12, ven_nome: 'João Vendedor',
  });
  // Vendedor: código com o prefixo do BM; sem as colunas no SQL (SQL antigo gravado), fica vazio
  assert.deepStrictEqual([v.ven_cod_integracao, v.ven_nome], ['BM-12', 'João Vendedor']);
  assert.deepStrictEqual([converterVenda({ id: 1, cod_integracao: 1 }).ven_cod_integracao, converterVenda({ id: 1, cod_integracao: 1 }).ven_nome], ['', '']);
  assert.deepStrictEqual(
    [v.cod_integracao, v.pro_cod_integracao, v.cli_cnpj, v.cli_uf, v.nf_data, v.nf_numero, v.pro_un, v.pro_qtdade, v.pro_preco_venda, v.pro_custo_unit],
    ['BM-120', 'BM-33', '12345678000199', 'SC', '2026-10-09', '4521', 'UNI', 2.5, 10.46, 6.79],
  );
  assert.deepStrictEqual([v.cli_nome, v.cancelado, converterVenda({ id: 1, cod_integracao: 1 }).cancelado, v.pro_classe_descricao, v.nf_cfop], ['Papelaria Central', 'S', 'N', 'Papelaria', '5102']);
}

// SQL das vendas (config sql-vendas): só SELECT com os marcadores; período no lugar de :data_de/:data_ate
{
  const { conferirSqlVendas, sqlComPeriodo, SQL_VENDAS_PADRAO } = await import('./importbm.js');
  assert.strictEqual(conferirSqlVendas(SQL_VENDAS_PADRAO + ';'), SQL_VENDAS_PADRAO);
  assert.throws(() => conferirSqlVendas('DELETE FROM NFMESTRE'), /SELECT/);
  assert.throws(() => conferirSqlVendas('SELECT 1; DELETE FROM X'), /comando só/);
  assert.throws(() => conferirSqlVendas('SELECT ID FROM NFMESTRE WHERE ID > :ultimo'), /:data_de/);
  const s = sqlComPeriodo('WHERE D >= :data_de AND D <= :DATA_ATE AND ID > :ultimo', '2026-10-01', '2026-10-31');
  assert.strictEqual(s, "WHERE D >= '2026-10-01' AND D <= '2026-10-31' AND ID > :ultimo");
}

// Mapa de campos das vendas (Campos importados): outra coluna para o total e a primeira preenchida da lista
{
  const { converterVenda, conferirMapaVendas } = await import('./importbm.js');
  const mapa = conferirMapaVendas({ pro_valor_total: 'Valor_Liq', cli_cnpj: 'doc_vazio, CPFCNPJ' });
  const v = converterVenda({ id: 1, cod_integracao: 9, nf_data: '2026-10-01', valor_liq: '12.345', pro_valor_total: '99', cpfcnpj: '123.456.789-00' }, mapa);
  assert.deepStrictEqual([v.pro_valor_total, v.cli_cnpj, v.cod_integracao], [12.35, '12345678900', 'BM-9']);
  assert.throws(() => conferirMapaVendas({ nf_data: '' }), /Data/);
  assert.throws(() => conferirMapaVendas({ pro_marca: 'marca; drop' }), /nome de coluna/);
}

// Vendas de arquivo (Importar): dd/mm/aaaa, 1.234,56, ARQ- nos códigos, padrão no que veio vazio, sem data = fora
{
  const { converterVendaArquivo } = await import('./importarquivo.js');
  const v = converterVendaArquivo(
    { nf_data: '09/10/2026', cod_integracao: '4521', pro_valor_total: '1.234,56', pro_qtdade: '2,5', cli_cnpj: '12.345.678/0001-99', cli_uf: 'santa catarina', cancelado: 'Sim', pro_descricao: '' },
    { cli_cidade: 'Rio do Sul', pro_descricao: 'Serviço' },
  )!;
  assert.deepStrictEqual(
    [v.nf_data, v.cod_integracao, v.pro_valor_total, v.pro_qtdade, v.cli_cnpj, v.cli_uf, v.cancelado, v.cli_cidade, v.pro_descricao],
    ['2026-10-09', 'ARQ-4521', 1234.56, 2.5, '12345678000199', 'SC', 'S', 'Rio do Sul', 'Serviço'],
  );
  assert.strictEqual(converterVendaArquivo({ nf_data: '31/02/2026' }), null);
}
