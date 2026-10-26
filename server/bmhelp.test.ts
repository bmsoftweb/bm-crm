// Teste: npx tsx server/bmhelp.test.ts
import assert from 'node:assert';
import { pedeTecnico } from './bmhelp.js';

for (const t of [
  'quero conversar com um técnico',
  'Quero falar com um atendente',
  'pode me passar para o técnico?',
  'prefiro um humano',
  'quero falar com uma pessoa',
  'técnico por favor',
  'Atendente',
  'cadê o técnico?',
  'quero ser atendido por um tecnico',
]) assert.ok(pedeTecnico(t), t);

for (const t of [
  'como cadastro uma pessoa jurídica?',
  'como chamar a tela de pessoas',
  'o ICMS não sai na nota',
  'quero emitir a nota do técnico de campo', // "técnico" sem pedido de atendimento
]) assert.ok(!pedeTecnico(t), t);

console.log('bmhelp: ok');
