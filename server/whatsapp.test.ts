import assert from 'node:assert';
import { chaveTelefone, conteudoMensagem, escolherDono, telefoneWhatsApp, imagemDaCampanha } from './whatsapp.js';

assert.strictEqual(telefoneWhatsApp('(41) 99901-2223'), '5541999012223');
assert.strictEqual(telefoneWhatsApp('(41)35238200'), '554135238200');
assert.strictEqual(telefoneWhatsApp('041 99901-2223'), '5541999012223');
assert.strictEqual(telefoneWhatsApp('+55 41 99901-2223'), '5541999012223');
assert.throws(() => telefoneWhatsApp('99901-2223'), /inválido/);
assert.throws(() => telefoneWhatsApp(null), /inválido/);

// Mesma pessoa com e sem o 9, com e sem DDI, formatado ou não
const chave = chaveTelefone('554788489722', true);
assert.strictEqual(chave, '4788489722');
assert.strictEqual(chaveTelefone('(47) 98848-9722'), chave);
assert.strictEqual(chaveTelefone('+55 47 98848-9722'), chave);
assert.strictEqual(chaveTelefone('047 8848-9722'), chave);
assert.strictEqual(chaveTelefone('5547988489722', true), chave);
assert.notStrictEqual(chaveTelefone('(41) 98848-9722'), chave); // outro DDD
assert.strictEqual(chaveTelefone('14155550123', true), '+14155550123'); // fora do Brasil vale inteiro
assert.strictEqual(chaveTelefone('9722'), null);

// Conteúdo das mensagens da Evolution (Baileys)
assert.deepStrictEqual(conteudoMensagem({ conversation: 'Oi' }), { tipo: 'texto', texto: 'Oi', arquivo: null });
assert.deepStrictEqual(conteudoMensagem({ extendedTextMessage: { text: 'Link' }, messageContextInfo: {} }), { tipo: 'texto', texto: 'Link', arquivo: null });
assert.deepStrictEqual(conteudoMensagem({ imageMessage: { caption: 'Foto' } }), { tipo: 'imagem', texto: 'Foto', arquivo: null });
assert.deepStrictEqual(conteudoMensagem({ audioMessage: {} }), { tipo: 'audio', texto: null, arquivo: null });
assert.deepStrictEqual(
  conteudoMensagem({ documentWithCaptionMessage: { message: { documentMessage: { fileName: 'a.pdf', caption: 'Segue' } } } }),
  { tipo: 'documento', texto: 'Segue', arquivo: 'a.pdf' },
);
assert.deepStrictEqual(conteudoMensagem({ ephemeralMessage: { message: { conversation: 'Some' } } }), { tipo: 'texto', texto: 'Some', arquivo: null });
assert.strictEqual(conteudoMensagem({ reactionMessage: { text: '👍' } }), null);
assert.strictEqual(conteudoMensagem({ protocolMessage: {}, messageContextInfo: {} }), null);
assert.deepStrictEqual(conteudoMensagem({ buttonsMessage: { contentText: 'Avalie' } }), { tipo: 'texto', texto: 'Avalie', arquivo: null });
assert.deepStrictEqual(conteudoMensagem({ listResponseMessage: { title: 'Ótimo' } }), { tipo: 'texto', texto: 'Ótimo', arquivo: null });
assert.deepStrictEqual(conteudoMensagem({ interactiveMessage: { body: { text: 'Nota de 1 a 5' } } }), { tipo: 'texto', texto: 'Nota de 1 a 5', arquivo: null });
assert.deepStrictEqual(
  conteudoMensagem({ pollCreationMessageV3: { name: 'Gostou?', options: [{ optionName: 'Sim' }, { optionName: 'Não' }] } }),
  { tipo: 'texto', texto: 'Gostou?\n• Sim\n• Não', arquivo: null },
);
assert.deepStrictEqual(conteudoMensagem({ groupInviteMessage: {} }), { tipo: 'outro', texto: null, arquivo: null });

// Dono do número: WhatsApp da pessoa > WhatsApp do contato > celular do contato > telefones; sem DDD por último
const k = chaveTelefone('554788489722', true)!;
const pessoaFixo = { de: 'p' as const, pessoa_id: 1, contato_id: null, whatsapp: null, telefone: '(47) 98848-9722' };
const contatoWhats = { de: 'c' as const, pessoa_id: 2, contato_id: 20, whatsapp: '47 98848 9722', celular: null, telefone: null };
assert.deepStrictEqual(escolherDono(k, [pessoaFixo, contatoWhats]), { pessoa_id: 2, contato_id: 20 });
assert.deepStrictEqual(escolherDono(k, [{ ...pessoaFixo, whatsapp: '(47) 98848-9722' }, contatoWhats]), { pessoa_id: 1, contato_id: null });
assert.deepStrictEqual(escolherDono(k, [{ de: 'c', pessoa_id: 3, contato_id: 30, whatsapp: null, celular: '47988489722', telefone: null }]), { pessoa_id: 3, contato_id: 30 });
assert.deepStrictEqual(escolherDono(k, [{ de: 'p', pessoa_id: 4, contato_id: null, whatsapp: null, telefone: '8848-9722' }]), { pessoa_id: 4, contato_id: null });
assert.deepStrictEqual(escolherDono(k, [{ de: 'p', pessoa_id: 5, contato_id: null, whatsapp: null, telefone: '(41) 98848-9722' }]), { pessoa_id: null, contato_id: null });

// Imagem da campanha (data URL) → arquivo; formato estranho ou vazio = sem imagem
assert.deepStrictEqual(imagemDaCampanha('data:image/jpeg;base64,QUJD'), { mimetype: 'image/jpeg', base64: 'QUJD', nome: 'imagem.jpg' });
assert.strictEqual(imagemDaCampanha('data:image/png;base64,QUJD')?.nome, 'imagem.png');
assert.strictEqual(imagemDaCampanha('data:application/pdf;base64,QUJD'), null);
assert.strictEqual(imagemDaCampanha(null), null);

console.log('whatsapp: ok');

// Celular do widget (abrir chamado): DDD que existe, 9 na frente, dígitos não todos iguais
{
  const { erroCelular } = await import('../src/utils/formatters.js');
  for (const ok of ['47999998888', '5547999998888', '47912345678']) assert.strictEqual(erroCelular(ok), null, ok);
  for (const ruim of ['4733334444', '479999988', '00999999999', '20987654321', '11999999999', '47900000000']) assert.ok(erroCelular(ruim), ruim);
}
