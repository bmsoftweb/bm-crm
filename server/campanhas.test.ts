import assert from 'node:assert';
import { celularWhatsApp, comAvisoSair, contextoDeCampanha, destinoDe, PEDIU_SAIR, normalizarCriterios, regraDe, sqlCriterios, variaveisDoTexto, personalizar } from './campanhas.js';

// Objeto único (formato do exemplo do migration) vira lista; número e sim/não são convertidos
const c = normalizarCriterios('{"regra":"ultima_compra","operador":">","valor":"60"}');
assert.deepStrictEqual(c, [{ regra: 'ultima_compra', operador: '>', valor: 60 }]);
assert.deepStrictEqual(normalizarCriterios([{ regra: 'tem_email', operador: '=', valor: true }])[0].valor, 1);

// Regra e operador passam por whitelist; o valor vai só como parâmetro
assert.throws(() => normalizarCriterios([{ regra: 'p.id; DROP TABLE x', operador: '=', valor: 1 }]), /não existe/);
assert.throws(() => normalizarCriterios([{ regra: 'tipo', operador: 'OR 1=1 --', valor: 'lead' }]), /operador/);
assert.throws(() => normalizarCriterios([{ regra: 'tem_email', operador: '>', valor: 1 }]), /use "="/);
assert.throws(() => normalizarCriterios([{ regra: 'qtd_pedidos', operador: '=', valor: 'abc' }]), /número/);
assert.throws(() => normalizarCriterios([]), /ao menos um/);

// Cód. integração: "que contém"/"começa com" viram LIKE com % e _ escapados; vazio conta como ''
{
  const r = sqlCriterios(normalizarCriterios([{ regra: 'cod_integracao', operador: 'contem', valor: '10%_a' }, { regra: 'cod_integracao', operador: 'comeca', valor: 'BM' }]), 1);
  assert.ok(r.where.includes("COALESCE(p.cod_integracao, '') LIKE ?"));
  assert.deepStrictEqual(r.params, [1, '%10\\%\\_a%', 'BM%']);
  assert.throws(() => normalizarCriterios([{ regra: 'dias_cadastro', operador: 'contem', valor: 5 }]), /só valem para texto/);
  assert.throws(() => normalizarCriterios([{ regra: 'cod_integracao', operador: '>', valor: 'x' }]), /igual a, diferente de/);
}
const { where, params } = sqlCriterios(normalizarCriterios([{ regra: 'tipo', operador: '=', valor: "x' OR '1'='1" }]), 7);
assert.strictEqual(where, 'p.empresa_id = ? AND p.tipo = ?');
assert.deepStrictEqual(params, [7, "x' OR '1'='1"]);

// Variáveis
assert.deepStrictEqual(variaveisDoTexto('Olá {{nome}}', 'desde {{ ultima_compra }} {{nome}}'), ['nome', 'ultima_compra']);
assert.throws(() => variaveisDoTexto('{{senha}}'), /inexistente: \{\{senha\}\}/);
assert.strictEqual(personalizar('Olá {{Primeiro_Nome}}, {{cidade}}!', { primeiro_nome: 'Ana', cidade: null }), 'Olá Ana, !');

// Destino do disparo: celular (só celular brasileiro: fixo não tem WhatsApp) ou e-mail válido
assert.strictEqual(celularWhatsApp('(47) 98848-9722'), '5547988489722');
assert.strictEqual(celularWhatsApp('47 3521-0000'), null);
assert.strictEqual(celularWhatsApp(''), null);
const comTudo = { email: 'a@b.com.br', whatsapp: '47988489722' };
const soEmail = { email: 'a@b.com.br', whatsapp: '4735210000' };
assert.deepStrictEqual(destinoDe('whatsapp', comTudo), { canal: 'whatsapp', destino: '5547988489722' });
assert.strictEqual(destinoDe('whatsapp', soEmail), null);
assert.deepStrictEqual(destinoDe('email', comTudo), { canal: 'email', destino: 'a@b.com.br' });
assert.strictEqual(destinoDe('email', { email: 'sem-arroba', whatsapp: '47988489722' }), null);
// Multicanal: WhatsApp quando tem celular, senão e-mail; sem nenhum, fica de fora
assert.deepStrictEqual(destinoDe('multicanal', comTudo), { canal: 'whatsapp', destino: '5547988489722' });
assert.deepStrictEqual(destinoDe('multicanal', soEmail), { canal: 'email', destino: 'a@b.com.br' });
assert.strictEqual(destinoDe('multicanal', { email: '', whatsapp: '' }), null);
// Canal sem envio automático: ninguém
assert.strictEqual(destinoDe('sms', comTudo), null);

// Aviso de descadastro: só no WhatsApp e sem repetir quando o texto já fala em SAIR
assert.strictEqual(comAvisoSair('Promoção!\n', 'whatsapp'), 'Promoção!\n\n_Para não receber mais, responda SAIR._');
assert.strictEqual(comAvisoSair('Promoção! Responda sair para sair.', 'whatsapp'), 'Promoção! Responda sair para sair.');
assert.strictEqual(comAvisoSair('Promoção!', 'email'), 'Promoção!');

// Descadastro: a mensagem inteira pede para sair; frase com "sair" no meio não conta
for (const t of ['SAIR', 'sair.', ' Parar ', 'não quero mais', 'Nao quero receber', 'me tire da lista', 'stop!']) assert.ok(PEDIU_SAIR.test(t), t);
for (const t of ['quero sair para almoçar', 'não quero pagar agora', 'parar o sistema?', 'oi']) assert.ok(!PEDIU_SAIR.test(t), t);
// Contexto da campanha para a IA: a mensagem recebida e as instruções; sem campanha, nada
const ctx = contextoDeCampanha({ id: 1, nome: 'Novo módulo', mensagem: 'Olá Ana, conheça o módulo fiscal', instrucoes: 'Preço: R$ 99/mês', pessoa_id: 5 });
assert.match(ctx, /campanha "Novo módulo"/);
assert.match(ctx, /Olá Ana, conheça o módulo fiscal/);
assert.match(ctx, /Preço: R\$ 99\/mês/);
assert.strictEqual(contextoDeCampanha(null), '');
assert.doesNotMatch(contextoDeCampanha({ id: 1, nome: 'X', mensagem: 'M', instrucoes: '', pessoa_id: null }), /Instruções/);

console.log('campanhas: ok');

// Seleção com IA: só um SELECT, sem comentários, variáveis ou palavras perigosas, e com :empresa
{
  const { conferirSqlIa } = await import('./selecaoIa.js');
  const ok = "SELECT DISTINCT p.id FROM pessoas p WHERE p.empresa_id = :empresa AND p.nome LIKE '%delete%'";
  assert.strictEqual(conferirSqlIa(ok + ';'), ok);
  for (const [sql, erro] of [
    ['DELETE FROM pessoas', /SELECT/],
    ['SELECT p.id FROM pessoas p WHERE p.empresa_id = :empresa; DROP TABLE x', /comando só/],
    ['SELECT p.id FROM pessoas p WHERE p.empresa_id = :empresa -- x', /comentários/],
    ['SELECT p.id FROM pessoas p WHERE p.empresa_id = :empresa AND SLEEP(10)', /sleep/i],
    ['SELECT p.id FROM pessoas p, information_schema.tables t WHERE p.empresa_id = :empresa', /information_schema/i],
    ['SELECT p.id FROM pessoas p WHERE p.empresa_id = @x', /variáveis/],
    ['SELECT p.id FROM pessoas p', /:empresa/],
    ['SELECT p.id INTO OUTFILE \'/tmp/x\' FROM pessoas p WHERE p.empresa_id = :empresa', /outfile/i],
  ] as const) assert.throws(() => conferirSqlIa(sql), erro, sql);
}

// Formatação do SQL da IA para a tela: uma cláusula por linha, aspas intactas, subconsulta mais recuada
{
  const { formatarSql } = await import('../src/utils/formatters.js');
  const f = formatarSql("select p.id from pessoas p where p.empresa_id = :empresa and p.nome like 'and  where x' and p.id in (select a.pessoa_id from atividades a where a.empresa_id = :empresa)");
  assert.strictEqual(
    f,
    "SELECT p.id\nFROM pessoas p\nWHERE p.empresa_id = :empresa\n  AND p.nome like 'and  where x'\n  AND p.id in (\n    SELECT a.pessoa_id\n    FROM atividades a\n    WHERE a.empresa_id = :empresa)",
  );
  assert.strictEqual(formatarSql(f), f); // formatar de novo não muda
}

// Campos personalizados como regra: "pers:<tipo>:<chave>", chave só com [a-z0-9_], valor como parâmetro
{
  const [num, txt, sim] = normalizarCriterios([
    { regra: 'pers:decimal:limite', operador: '>=', valor: '1500.5' },
    { regra: 'pers:lista:revenda', operador: '=', valor: 'Sim' },
    { regra: 'pers:boolean:vip', operador: '=', valor: true },
  ]);
  assert.strictEqual(num.valor, 1500.5);
  assert.strictEqual(txt.valor, 'Sim');
  assert.strictEqual(sim.valor, 1);
  const { where, params } = sqlCriterios([num, txt, sim], 7);
  assert.ok(where.includes(`'$."limite"'`) && where.includes('CAST(') && where.includes(`= 'true'`), where);
  assert.deepStrictEqual(params, [7, 1500.5, 'Sim', 1]);
  assert.strictEqual(regraDe('pers:data:aniversario')?.valor, 'numero');
  assert.strictEqual(regraDe('pers:texto:x"; DROP'), undefined);
  assert.strictEqual(regraDe('pers:outro:x'), undefined);
  assert.strictEqual(regraDe('toString'), undefined);
  assert.throws(() => normalizarCriterios([{ regra: "pers:texto:a'b", operador: '=', valor: 1 }]), /não existe/);
}
