/**
 * Registro central de metadados das tabelas do banco crmweb.
 *
 * Este arquivo é a ÚNICA fonte de verdade das telas de manutenção:
 *  - o backend usa para montar SQL com whitelist de colunas (evita SQL injection);
 *  - o frontend consome via GET /api/meta/resources para desenhar as telas de CRUD.
 *
 * As chaves primárias são INT AUTO_INCREMENT: quem numera é o MySQL.
 *
 * Multi-tenant: a empresa do usuário logado (usuarios.empresa_id) isola os dados.
 * Todo recurso declara scopeSql, aplicado em TODA consulta (alias "t", um "?" = empresa).
 */

import { FORMAS_PAGAMENTO } from '../src/utils/parcelas.js';

export type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'decimal'
  | 'date'
  | 'datetime'
  | 'time'
  | 'enum'
  | 'boolean'
  | 'password'
  | 'cnpj'
  /** Imagem embutida (data URI), reduzida no navegador antes de gravar */
  | 'imagem'
  /** Conjunto de campos definidos em Configurações, gravado como JSON */
  | 'personalizados'
  /** Regras de segmentação de campanha, gravadas como JSON (server/campanhas.ts) */
  | 'criterios'
  /** Até 4 fotos no Vercel Blob; a coluna guarda os endereços em JSON (server/fotos.ts) */
  | 'fotos'
  /** Cor #RRGGBB escolhida numa tabela de cores (src/components/CorField.tsx) */
  | 'cor';

export interface FieldDef {
  /** Nome da coluna no MySQL */
  name: string;
  /** Rótulo exibido na interface */
  label: string;
  type: FieldType;
  /** Não aparece na ficha embaixo da lista (ex.: campos já resumidos em outro, como os de executor) */
  foraDaFicha?: boolean;
  /** Na exibição, o valor de outro campo vai antes deste ("Luis : Implementar..."); não é gravado */
  prefixo?: { campo: string; exceto?: string };
  /** Texto auxiliar exibido abaixo do campo no formulário */
  hint?: string;
  /** Campo imagem: guarda o arquivo como veio (até ~1,3 MB; maior, reduz para 1600 px) em vez de reduzir para 400×200 */
  imagemOriginal?: boolean;
  placeholder?: string;
  required?: boolean;
  /** Campo apenas leitura (gerado pelo banco ou pelo sistema): nunca vai em INSERT/UPDATE */
  readOnly?: boolean;
  /** Só na alteração: o formulário de inclusão não mostra e a inclusão não grava (ex.: fechamento da OS) */
  soNaAlteracao?: boolean;
  /** Campo só leitura mostrado dentro do formulário na edição (bloqueado), em vez da caixa de dados do banco */
  mostrarNaEdicao?: boolean;
  /** Campo de hora: ao preencher, acerta outro campo de hora somando estas horas (ex.: Das → Até + 2 h) */
  somarHoras?: { campo: string; horas: number };
  /** Exibido na grade de listagem */
  listed?: boolean;
  /** Participa da busca textual (LIKE) da barra de busca rápida */
  searchable?: boolean;
  /** Aparece no painel de busca avançada */
  filterable?: boolean;
  /** Opções para type === 'enum' */
  options?: { value: string; label: string }[];
  /** type === 'boolean' numa coluna char(1) 'S'/'N': grava 'S'/'N' (a leitura vem do sql, como 1/0) */
  simNao?: boolean;
  /** Chave estrangeira: carrega o combo a partir de outro recurso */
  ref?: { resource: string; labelField: string };
  /** Casas decimais para type === 'decimal' */
  scale?: number;
  maxLength?: number;
  /** Desabilita (e zera) o campo quando outro campo tem o valor indicado */
  disabledWhen?: { field: string; equals: string };
  /** Campo numérico que aceita valor negativo (o sinal alterna ao digitar "-") */
  allowNegative?: boolean;
  /** Valor inicial na inclusão ("hoje" em campo de data = a data do dia) */
  default?: string | number | boolean;
  /** Largura sugerida da coluna na grade */
  width?: 'xs' | 'sm' | 'md' | 'lg';
  /** Colunas que o campo ocupa no formulário (de 4); sem isto vale a regra padrão */
  span?: number;
  /**
   * Coluna calculada só da lista: expressão SQL sobre o alias "t" (ex.: subconsulta).
   * Não existe na tabela, não é gravada e não aparece no formulário.
   */
  sql?: string;
}

/** Grade filha exibida no rodapé da listagem quando uma linha é selecionada (mestre-detalhe) */
export interface DetailDef {
  resource: string;
  foreignKey: string;
  label: string;
  /** Campo decimal do filho totalizado no rodapé do painel */
  totalField?: string;
  /** Painel com incluir, editar e excluir (formulário genérico numa janela), com a chave do pai preenchida */
  editavel?: boolean;
}

export interface ResourceDef {
  /** Identificador usado nas rotas: /api/crud/:resource */
  name: string;
  table: string;
  label: string;
  labelSingular: string;
  description: string;
  /** Ícone lucide-react renderizado na sidebar */
  icon: string;
  /** Agrupamento na sidebar */
  group: 'vendas' | 'marketing' | 'cadastros' | 'acesso' | 'suporte';
  /** Não aparece no menu (só como detalhe de outro recurso) */
  oculto?: boolean;
  /** Chave primária */
  pk: string[];
  /** Sempre true no crmweb: as PKs são INT AUTO_INCREMENT */
  autoIncrement: boolean;
  /** Campo usado como rótulo em combos de chave estrangeira */
  labelField: string;
  /**
   * SELECT próprio para os combos (colunas value e label), quando o rótulo depende de
   * outra tabela. Ex.: etapa exibida como "Funil › Etapa". Um "?" = empresa logada.
   */
  optionsSql?: string;
  /** Coluna da empresa (tenant), preenchida pelo servidor na inclusão e nunca editável */
  tenantColumn?: string;
  /** Filtro do tenant sobre o alias "t", com um "?" para a empresa logada */
  scopeSql: string;
  defaultSort: { field: string; dir: 'asc' | 'desc' };
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  /**
   * Filtro "Só as minhas" da lista: condição sobre o alias "t"; cada "?" = usuário logado.
   * Não vai para o navegador (a tela só sabe que o filtro existe).
   */
  minhasSql?: string;
  /** Campo Sim/Não com filtro rápido Todas/Sim/Não na barra da lista (ex.: concluida em atividades) */
  filtroRapido?: string;
  /** Valor com que o filtro rápido abre: '1' = Sim, '0' = Não (sem ele: Todas) */
  filtroRapidoPadrao?: '1' | '0';
  /** Toggle na barra da lista: desligado, acrescenta estes filtros (ex.: esconder as atividades do bot) */
  toggleMostrar?: { label: string; dica: string; ocultar: { field: string; op: 'eq' | 'ne'; value: string }[] };
  /** Excluir só preenche esta coluna com NOW() (o scopeSql deve esconder os excluídos) */
  exclusaoLogica?: string;
  details?: DetailDef[];
  /** Ao clicar numa linha, mostra embaixo a ficha com todos os campos (textos longos por inteiro) */
  ficha?: boolean;
  /** Atividades: além da lista, visões Semana e Mês (data_vencimento, hora_vencimento, duracao, assunto) */
  calendario?: boolean;
  /** Filtro aplicado só na visão Lista (o calendário mostra tudo), com o aviso que aparece no contador */
  filtroLista?: { field: string; op: 'eq' | 'ne'; value: string; aviso: string };
  /**
   * Lista em árvore: registros com o mesmo `grupo` formam uma família; o de menor `ordem`
   * é a raiz e os demais aparecem como filhos (ex.: versões de uma proposta).
   */
  arvore?: { grupo: string; ordem: string };
  /** O formulário não mostra a caixa "Dados gerados pelo banco" */
  semDadosDoBanco?: boolean;
  fields: FieldDef[];
}

const STATUS_NEGOCIO = [
  { value: 'aberto', label: 'Aberto' },
  { value: 'ganho', label: 'Ganho' },
  { value: 'perdido', label: 'Perdido' },
  { value: 'excluido', label: 'Excluído' },
];

export const TIPOS_ATIVIDADE = [
  { value: 'ligacao', label: 'Ligação' },
  { value: 'reuniao', label: 'Reunião Interna' },
  { value: 'reuniao_externa', label: 'Reunião Externa' },
  { value: 'reuniao_virtual', label: 'Reunião Virtual' },
  { value: 'visita', label: 'Visita' },
  { value: 'tarefa', label: 'Tarefa' },
  { value: 'prazo', label: 'Prazo' },
  { value: 'email', label: 'E-mail' },
  { value: 'almoco', label: 'Almoço' },
  { value: 'whatsapp', label: 'WhatsApp' },
];

/** Ícone no começo do assunto das reuniões (vai junto para o título do evento no Google Agenda) */
export const ICONE_DO_TIPO: Record<string, string> = { reuniao_externa: '🚗', reuniao: '🏠', reuniao_virtual: '💻' };
const ICONES = Object.values(ICONE_DO_TIPO);

/** Assunto com o ícone do tipo: troca o de outro tipo de reunião e tira o ícone quando o tipo não tem */
export function assuntoComIcone(assunto: string, tipo: string | null | undefined): string {
  let texto = String(assunto ?? '').trimStart();
  for (let achou = true; achou; ) {
    achou = false;
    for (const i of ICONES) {
      if (texto.startsWith(i)) {
        texto = texto.slice(i.length).trimStart();
        achou = true;
      }
    }
  }
  const icone = tipo ? ICONE_DO_TIPO[tipo] : undefined;
  return icone ? `${icone} ${texto}` : texto;
}

/** Papel do contato na venda */
export const PAPEIS_CONTATO = [
  { value: 'decisor', label: 'Decisor' },
  { value: 'influenciador', label: 'Influenciador' },
  { value: 'usuario', label: 'Usuário' },
  { value: 'financeiro', label: 'Financeiro' },
  { value: 'tecnico', label: 'Técnico' },
  { value: 'outro', label: 'Outro' },
];

/** Para quem vai o lembrete automático da atividade (Configurações › Mensagens automáticas) */
export const LEMBRETE_PARA = [
  { value: 'cliente', label: 'Cliente' },
  { value: 'vendedor', label: 'Vendedor' },
  { value: 'ambos', label: 'Cliente e vendedor' },
  { value: 'todos', label: 'Todos os envolvidos' },
  { value: 'nenhum', label: 'Ninguém' },
];

/** Onde o template aparece: nos dois chats, só no WhatsApp ou só nos Chamados */
export const CANAIS_TEMPLATE = [
  { value: 'todos', label: 'WhatsApp e Suporte' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'suporte', label: 'Suporte' },
];

export const TIPOS_PESSOA = [
  { value: 'lead', label: 'Lead' },
  { value: 'cliente', label: 'Cliente' },
];

export const TIPOS_ENDERECO = [
  { value: 'comercial', label: 'Comercial' },
  { value: 'residencial', label: 'Residencial' },
  { value: 'entrega', label: 'Entrega' },
  { value: 'cobranca', label: 'Cobrança' },
  { value: 'outro', label: 'Outro' },
];

export const TIPOS_INTERACAO = [
  { value: 'nota', label: 'Nota' },
  { value: 'ligacao', label: 'Ligação' },
  { value: 'email', label: 'E-mail' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'reuniao', label: 'Reunião' },
];

export const STATUS_PROPOSTA = [
  { value: 'rascunho', label: 'Rascunho' },
  { value: 'enviada', label: 'Enviada' },
  { value: 'aceita', label: 'Aceita' },
  { value: 'recusada', label: 'Recusada' },
  { value: 'expirada', label: 'Expirada' },
  // Outra versão da mesma proposta foi aceita (definido pela aprovação, não à mão)
  { value: 'fechada', label: 'Fechada' },
];

export const STATUS_PEDIDO = [
  { value: 'rascunho', label: 'Rascunho' },
  { value: 'aguardando_aprovacao', label: 'Aguardando Aprovação' },
  { value: 'aprovado', label: 'Aprovado' },
  { value: 'faturado', label: 'Faturado' },
  { value: 'cancelado', label: 'Cancelado' },
];

const OBJETIVOS_CAMPANHA = [
  { value: 'reativacao', label: 'Reativação' },
  { value: 'nutricao', label: 'Nutrição' },
  { value: 'conversao', label: 'Conversão' },
  { value: 'onboarding', label: 'Onboarding' },
  { value: 'retencao', label: 'Retenção' },
  { value: 'upsell', label: 'Upsell' },
];

/** Canais com envio automático (o banco ainda aceita sms e push, sem envio) */
const CANAIS_CAMPANHA = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'email', label: 'E-mail' },
  { value: 'multicanal', label: 'WhatsApp ou e-mail' },
];

/** Canal de cada disparo (o multicanal da campanha vira um destes) */
const CANAIS_DISPARO = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'email', label: 'E-mail' },
];

const SITUACOES_CAMPANHA = [
  { value: 'rascunho', label: 'Rascunho' },
  { value: 'agendada', label: 'Agendada' },
  { value: 'em_execucao', label: 'Em execução' },
  { value: 'pausada', label: 'Pausada' },
  { value: 'concluida', label: 'Concluída' },
  { value: 'cancelada', label: 'Cancelada' },
];

const SITUACOES_DISPARO = [
  { value: 'pendente', label: 'Pendente' },
  { value: 'enviado', label: 'Enviado' },
  { value: 'entregue', label: 'Entregue' },
  { value: 'lido', label: 'Lido' },
  { value: 'falhou', label: 'Falhou' },
  { value: 'cancelado', label: 'Cancelado' },
];

const TIPOS_CONTRATO = [
  { value: 'recorrente', label: 'Recorrente' },
  { value: 'prazo_fechado', label: 'Prazo fechado' },
];

const SITUACOES_CONTRATO = [
  { value: 'rascunho', label: 'Rascunho' },
  { value: 'aguardando_assinatura', label: 'Aguardando assinatura' },
  { value: 'ativo', label: 'Ativo' },
  { value: 'suspenso', label: 'Suspenso' },
  { value: 'encerrado', label: 'Encerrado' },
  { value: 'cancelado', label: 'Cancelado' },
];

const PERIODICIDADES = [
  { value: 'mensal', label: 'Mensal' },
  { value: 'bimestral', label: 'Bimestral' },
  { value: 'trimestral', label: 'Trimestral' },
  { value: 'semestral', label: 'Semestral' },
  { value: 'anual', label: 'Anual' },
  { value: 'unica', label: 'Única' },
];

/**
 * Perfis de usuário (usuarios.tipo). Vendedor fica com o valor "client" (o que já estava gravado);
 * só o Administrador tem regras próprias (Usuários, Configurações, permissões, assumir conversa de outro)
 */
export const PERFIS = [
  { value: 'admin', label: 'Administrador' },
  { value: 'gerente', label: 'Gerente' },
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'client', label: 'Vendedor' },
  { value: 'funcionario', label: 'Funcionário' },
];

const CRIADO_ATUALIZADO = [
  { name: 'criado_em', label: 'Criado em', type: 'datetime', readOnly: true } as FieldDef,
  { name: 'atualizado_em', label: 'Atualizado em', type: 'datetime', readOnly: true } as FieldDef,
];

const ORIGENS_LEAD = [
  { value: 'prospeccao', label: 'Prospecção' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'manual', label: 'Manual' },
  { value: 'importacao', label: 'Importação' },
];
const CANAIS_PESQUISA = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'email', label: 'E-mail' },
  { value: 'ligacao', label: 'Ligação' },
];
const SITUACOES_PESQUISA = [
  { value: 'rascunho', label: 'Rascunho' },
  { value: 'em_andamento', label: 'Em andamento' },
  { value: 'concluida', label: 'Concluída' },
  { value: 'cancelada', label: 'Cancelada' },
];
const SITUACOES_ITEM_PESQUISA = [
  { value: 'sorteado', label: 'Sorteado' },
  { value: 'enviado', label: 'Contatado' },
  { value: 'em_conversa', label: 'Em conversa' },
  { value: 'respondido', label: 'Respondido' },
  { value: 'sem_resposta', label: 'Sem resposta' },
  { value: 'falhou', label: 'Falhou' },
];

const ID: FieldDef = { name: 'id', label: 'ID', type: 'number', readOnly: true, width: 'xs' };

const itensFields = (fk: string, label: string, ref: string): FieldDef[] => [
  ID,
  { name: fk, label, type: 'text', required: true, ref: { resource: ref, labelField: 'titulo' } },
  { name: 'produto_id', label: 'Produto', type: 'text', required: true, listed: true, ref: { resource: 'produtos', labelField: 'nome' } },
  { name: 'quantidade', label: 'Quantidade', type: 'decimal', scale: 3, listed: true },
  { name: 'preco_unitario', label: 'Preço Unitário', type: 'decimal', scale: 2, listed: true },
  { name: 'desconto', label: 'Desconto (R$)', type: 'decimal', scale: 2, listed: true },
  { name: 'subtotal', label: 'Subtotal', type: 'decimal', scale: 2, listed: true },
];

/**
 * Itens do documento agrupados como na impressão resumida (agruparItens): uma linha por grupo de produtos, os grupos
 * primeiro (na ordem do 1º item), depois os produtos sem grupo. Valor bruto (qtd × preço). Só leitura.
 */
const resumoPorGrupo = (itens: string, fk: string, doc: string, nomeDoc: string): ResourceDef => ({
  name: `${itens}_grupos`,
  table: `(SELECT MIN(i.id) AS id, i.${fk}, MAX(COALESCE(g.nome, pr.nome)) AS grupo, COUNT(*) AS itens,
                  ROUND(SUM(i.quantidade * i.preco_unitario), 2) AS valor,
                  MAX(pr.grupo_id IS NULL) * 1000000000 + MIN(i.id) AS posicao
             FROM ${itens} i JOIN produtos pr ON pr.id = i.produto_id
             LEFT JOIN produtos_grupos g ON g.id = pr.grupo_id
            GROUP BY i.${fk}, IF(pr.grupo_id IS NULL, CONCAT('i', i.id), CONCAT('g', pr.grupo_id)))`,
  scopeSql: `t.${fk} IN (SELECT id FROM ${doc} WHERE empresa_id = ?)`,
  label: 'Resumo por Grupo',
  labelSingular: 'Grupo',
  description: `Itens do documento (${nomeDoc}) agrupados pelo grupo do produto`,
  icon: 'Layers',
  group: 'vendas',
  oculto: true,
  // A grade de detalhe ordena pela chave: a posição (única) já põe os grupos primeiro
  pk: ['posicao'],
  autoIncrement: true,
  labelField: 'grupo',
  defaultSort: { field: 'posicao', dir: 'asc' },
  canCreate: false,
  canUpdate: false,
  canDelete: false,
  fields: [
    ID,
    { name: fk, label: nomeDoc, type: 'text', ref: { resource: doc, labelField: doc === 'propostas' ? 'titulo' : 'numero_pedido' } },
    { name: 'grupo', label: 'Grupo / Produto', type: 'text', listed: true },
    { name: 'itens', label: 'Itens', type: 'number', listed: true, width: 'xs' },
    { name: 'valor', label: 'Valor', type: 'decimal', scale: 2, listed: true },
    { name: 'posicao', label: 'Posição', type: 'number', readOnly: true },
  ],
});

export const RESOURCES: ResourceDef[] = [
  // ============================================================
  // VENDAS
  // ============================================================
  {
    name: 'negocios',
    table: 'negocios',
    tenantColumn: 'empresa_id',
    scopeSql: 't.empresa_id = ?',
    label: 'Negócios',
    labelSingular: 'Negócio',
    description: 'Oportunidades do funil de vendas',
    icon: 'Handshake',
    group: 'vendas',
    pk: ['id'],
    autoIncrement: true,
    labelField: 'titulo',
    defaultSort: { field: 'criado_em', dir: 'desc' },
    canCreate: true,
    canUpdate: true,
    canDelete: true,
    details: [
      { resource: 'atividades', foreignKey: 'negocio_id', label: 'Atividades' },
      { resource: 'propostas', foreignKey: 'negocio_id', label: 'Propostas', totalField: 'valor_total' },
    ],
    fields: [
      ID,
      { name: 'titulo', label: 'Título', type: 'text', required: true, listed: true, searchable: true, maxLength: 255 },
      { name: 'valor', label: 'Valor', type: 'decimal', scale: 2, listed: true, filterable: true },
      { name: 'moeda', label: 'Moeda', type: 'text', maxLength: 3, default: 'BRL', width: 'xs' },
      { name: 'etapa_id', label: 'Funil › Etapa', type: 'text', required: true, listed: true, filterable: true, ref: { resource: 'etapas', labelField: 'nome' } },
      { name: 'funil_id', label: 'Funil', type: 'text', readOnly: true, filterable: true, ref: { resource: 'funis', labelField: 'nome' } },
      { name: 'pessoa_id', label: 'Contato', type: 'text', listed: true, filterable: true, ref: { resource: 'pessoas', labelField: 'nome' } },
      {
        name: 'proprietario_id',
        label: 'Proprietário',
        type: 'text',
        listed: true,
        filterable: true,
        ref: { resource: 'usuarios', labelField: 'nome' },
        hint: 'Em branco na inclusão: fica com quem criou o negócio',
      },
      {
        name: 'campanha_id',
        label: 'Campanha de origem',
        type: 'text',
        filterable: true,
        ref: { resource: 'campanhas', labelField: 'nome' },
        hint: 'Preenchida sozinha quando o lead vem de quem respondeu a uma campanha',
      },
      {
        // Editados no formulário do negócio (server/participantes.ts); aqui só a coluna da lista
        name: 'envolvidos',
        label: 'Envolvidos',
        type: 'text',
        readOnly: true,
        searchable: true,
        sql: `(SELECT GROUP_CONCAT(u.nome ORDER BY u.nome SEPARATOR ', ') FROM negocios_participantes np
                JOIN usuarios u ON u.id = np.usuario_id WHERE np.negocio_id = t.id)`,
      },
      { name: 'status', label: 'Status', type: 'enum', required: true, listed: true, filterable: true, options: STATUS_NEGOCIO },
      { name: 'motivo_perda', label: 'Motivo da Perda', type: 'text', maxLength: 255, disabledWhen: { field: 'status', equals: 'aberto' } },
      { name: 'data_fechamento_esperada', label: 'Fechamento Esperado', type: 'date', listed: true, filterable: true },
      { name: 'data_ganho', label: 'Data do Ganho', type: 'datetime', readOnly: true },
      { name: 'data_perda', label: 'Data da Perda', type: 'datetime', readOnly: true },
      { name: 'data_ultimo_contato', label: 'Último Contato', type: 'datetime', readOnly: true, listed: true },
      { name: 'data_proximo_followup', label: 'Próximo Follow-up', type: 'datetime', readOnly: true, listed: true },
      ...CRIADO_ATUALIZADO,
    ],
  },
  {
    name: 'atividades',
    table: 'atividades',
    tenantColumn: 'empresa_id',
    scopeSql: 't.empresa_id = ?',
    label: 'Atividades/Tarefas',
    labelSingular: 'Atividade',
    description: 'Follow-ups agendados: ligações, reuniões, tarefas e prazos',
    icon: 'CalendarCheck',
    group: 'vendas',
    pk: ['id'],
    autoIncrement: true,
    labelField: 'assunto',
    defaultSort: { field: 'data_vencimento', dir: 'desc' },
    filtroRapido: 'concluida',
    // Abre nas pendentes
    filtroRapidoPadrao: '0',
    ficha: true,
    calendario: true,
    // As vindas do Google Agenda aparecem só no calendário
    filtroLista: { field: 'origem', op: 'ne', value: 'google', aviso: 'sem as vindas do Google Agenda (veja em Semana ou Mês)' },
    // Sim/Não "Do bot": desligado esconde as que o Bot executa e as que o chatbot/automação cria sozinho
    toggleMostrar: {
      label: 'Do bot',
      dica: 'Mostrar as atividades do bot (executadas pelo Bot ou criadas pelo chatbot/automação do WhatsApp)',
      ocultar: [
        // Pelo executor, não pela origem: a pesquisa de satisfação pelo WhatsApp tem origem "pesquisa" e é executada pelo Bot
        { field: 'executor_bot', op: 'ne', value: '1' },
        { field: 'origem', op: 'ne', value: 'chatbot' },
      ],
    },
    // Minhas: as do usuário, as do departamento dele e as de qualquer pessoa
    minhasSql: `(t.executor_id = ? OR (t.executor_id IS NULL AND (t.departamento_id IS NULL
                   OR t.departamento_id = (SELECT u.departamento_id FROM usuarios u WHERE u.id = ?)))
                 OR EXISTS (SELECT 1 FROM atividade_envolvidos e WHERE e.atividade_id = t.id AND e.usuario_id = ?))`,
    canCreate: true,
    canUpdate: true,
    canDelete: true,
    fields: [
      ID,
      {
        name: 'assunto',
        label: 'Assunto',
        type: 'text',
        required: true,
        listed: true,
        searchable: true,
        maxLength: 255,
        // Lista, calendário e ficha mostram "Luis : Implementar..." (quem executa antes do assunto)
        prefixo: { campo: 'quem_executa', exceto: 'Qualquer pessoa' },
      },
      { name: 'tipo', label: 'Tipo', type: 'enum', required: true, listed: true, filterable: true, options: TIPOS_ATIVIDADE, default: 'tarefa' },
      { name: 'data_vencimento', label: 'Vencimento', type: 'date', required: true, listed: true, filterable: true },
      { name: 'hora_vencimento', label: 'Hora', type: 'time', listed: true },
      { name: 'duracao', label: 'Duração', type: 'time', default: '00:15' },
      {
        name: 'lembrete_para',
        label: 'Lembrete para',
        type: 'enum',
        required: true,
        options: LEMBRETE_PARA,
        default: 'cliente',
        hint: 'WhatsApp automático antes da atividade, se ligado em Configurações › Mensagens automáticas. Vendedor = o usuário que executa ou, sem ele, o responsável do negócio. Todos = cliente, vendedor e envolvidos. Com o Bot executando: com quem ele conversa.',
      },
      {
        name: 'quem_executa',
        label: 'Quem executa',
        type: 'text',
        readOnly: true,
        listed: true,
        sql: `IF(t.executor_bot = 1, 'Bot', COALESCE((SELECT u.nome FROM usuarios u WHERE u.id = t.executor_id),
                       (SELECT d.nome FROM departamentos d WHERE d.id = t.departamento_id), 'Qualquer pessoa'))`,
      },
      {
        name: 'executor_bot',
        label: 'Executor: Bot',
        type: 'boolean',
        foraDaFicha: true,
        filterable: true,
        hint: 'No dia e hora, a IA conversa pelo WhatsApp com quem está em "Lembrete para" seguindo o assunto e a observação (sem WhatsApp, manda um e-mail). Sem hora: começa às 8h',
      },
      { name: 'executor_id', label: 'Executor (usuário)', type: 'text', foraDaFicha: true, filterable: true, ref: { resource: 'usuarios', labelField: 'nome' }, hint: 'Ou um usuário ou um departamento; os dois vazios = qualquer pessoa' },
      { name: 'departamento_id', label: 'Executor (departamento)', type: 'text', foraDaFicha: true, filterable: true, ref: { resource: 'departamentos', labelField: 'nome' } },
      {
        // Gravados pela janela da atividade (server/participantes.ts); aqui só a coluna da lista
        name: 'envolvidos',
        label: 'Envolvidos',
        type: 'text',
        readOnly: true,
        listed: true,
        searchable: true,
        sql: `(SELECT GROUP_CONCAT(u.nome ORDER BY u.nome SEPARATOR ', ') FROM atividade_envolvidos e
                JOIN usuarios u ON u.id = e.usuario_id WHERE e.atividade_id = t.id)`,
      },
      { name: 'negocio_id', label: 'Negócio', type: 'text', listed: true, filterable: true, ref: { resource: 'negocios', labelField: 'titulo' } },
      { name: 'pessoa_id', label: 'Contato', type: 'text', listed: true, ref: { resource: 'pessoas', labelField: 'nome' } },
      // Atividade de um lead (Marketing › Leads); na conversão passa para a pessoa
      { name: 'lead_id', label: 'Lead', type: 'text', filterable: true, ref: { resource: 'leads', labelField: 'nome' } },
      {
        // De onde veio: Bot executando, criada pelo chatbot/automação (atividades.criada_por_bot), pendência achada na análise de uma conversa (server/pendencias.ts, pela
        // observação), tarefa de chamado, ou lançada à mão. Calculada: não há coluna no banco
        name: 'origem',
        label: 'Origem',
        type: 'enum',
        readOnly: true,
        listed: true,
        filterable: true,
        options: [
          { value: 'google', label: 'Google Agenda' },
          { value: 'pesquisa', label: 'Pesquisa de satisfação' },
          { value: 'bot', label: 'Bot' },
          { value: 'chatbot', label: 'Chatbot do WhatsApp' },
          { value: 'pendencia', label: 'Pendência da conversa' },
          { value: 'chamado', label: 'Chamado' },
          { value: 'manual', label: 'Manual' },
        ],
        // Google Agenda: atividade criada a partir de um evento do Google (server/agendaGoogle.ts)
        sql: `(CASE WHEN t.google_importada = 1 THEN 'google'
                    WHEN EXISTS (SELECT 1 FROM pesquisas_satisfacao_itens i WHERE i.atividade_id = t.id) OR t.observacao LIKE 'Retorno da pesquisa de satisfação%' THEN 'pesquisa'
                    WHEN t.executor_bot = 1 THEN 'bot'
                    WHEN t.criada_por_bot = 1 THEN 'chatbot'
                    WHEN t.observacao LIKE 'Identificada pela análise automática%' THEN 'pendencia'
                    WHEN t.chamado_id IS NOT NULL THEN 'chamado' ELSE 'manual' END)`,
      },
      {
        // Tarefa criada num chamado do suporte (server/chamados.ts)
        name: 'chamado',
        label: 'Chamado',
        type: 'text',
        readOnly: true,
        listed: true,
        searchable: true,
        sql: `(SELECT CONCAT('Nº ', c.numero, ' • ', c.titulo) FROM chamados c WHERE c.id = t.chamado_id)`,
      },
      // Para o duplo clique abrir o chamado em Chamados Ativos ou o contrato que gerou a atividade (App.tsx)
      { name: 'chamado_id', label: 'Chamado (id)', type: 'text', readOnly: true, foraDaFicha: true, sql: 't.chamado_id' },
      { name: 'contrato_id', label: 'Contrato (id)', type: 'text', readOnly: true, foraDaFicha: true, sql: 't.contrato_id' },
      { name: 'concluida', label: 'Concluída', type: 'boolean', listed: true, filterable: true },
      { name: 'concluida_em', label: 'Concluída em', type: 'datetime', readOnly: true },
      {
        // Quem concluiu (atividades.concluida_por); o que o Bot conclui sozinho fica sem usuário e aparece como "Bot"
        name: 'concluida_por_nome',
        label: 'Concluída por',
        type: 'text',
        readOnly: true,
        listed: true,
        sql: `(CASE WHEN t.concluida = 0 THEN NULL
                    WHEN t.concluida_por IS NOT NULL THEN (SELECT u.nome FROM usuarios u WHERE u.id = t.concluida_por)
                    WHEN t.executor_bot = 1 THEN 'Bot' END)`,
      },
      { name: 'observacao', label: 'Observação', type: 'textarea' },
      // O que foi feito: preenchido no "Concluir" da lista (ou aqui)
      { name: 'resultado', label: 'Resultado', type: 'textarea', listed: true, searchable: true },
      { name: 'bot_resumo', label: 'Resumo do bot', type: 'textarea', readOnly: true },
      // Dono: quem incluiu pela tela (gravado pelo servidor); só ele ou um administrador exclui
      { name: 'criado_por', label: 'Criado por', type: 'text', readOnly: true, ref: { resource: 'usuarios', labelField: 'nome' } },
      ...CRIADO_ATUALIZADO,
    ],
  },
  {
    name: 'historico_interacoes',
    table: 'historico_interacoes',
    tenantColumn: 'empresa_id',
    scopeSql: 't.empresa_id = ?',
    label: 'Histórico de Interações',
    labelSingular: 'Interação',
    description: 'Linha do tempo: notas, ligações, e-mails, WhatsApp e reuniões realizados',
    icon: 'History',
    group: 'vendas',
    pk: ['id'],
    autoIncrement: true,
    labelField: 'descricao',
    defaultSort: { field: 'criado_em', dir: 'desc' },
    canCreate: true,
    canUpdate: true,
    canDelete: true,
    fields: [
      ID,
      { name: 'criado_em', label: 'Data', type: 'datetime', readOnly: true, listed: true },
      { name: 'tipo', label: 'Tipo', type: 'enum', required: true, listed: true, filterable: true, options: TIPOS_INTERACAO, default: 'nota' },
      { name: 'descricao', label: 'Descrição', type: 'textarea', required: true, listed: true, searchable: true },
      { name: 'negocio_id', label: 'Negócio', type: 'text', listed: true, filterable: true, ref: { resource: 'negocios', labelField: 'titulo' } },
      { name: 'pessoa_id', label: 'Contato', type: 'text', listed: true, ref: { resource: 'pessoas', labelField: 'nome' } },
      { name: 'proposta_id', label: 'Proposta', type: 'text', ref: { resource: 'propostas', labelField: 'titulo' } },
      { name: 'pedido_id', label: 'Pedido', type: 'text', ref: { resource: 'pedidos', labelField: 'numero_pedido' } },
    ],
  },
  {
    // Pesquisa de satisfação do WhatsApp (server/pesquisa.ts): só leitura, gravada pelo atendimento
    name: 'avaliacoes',
    table: 'avaliacoes',
    tenantColumn: 'empresa_id',
    scopeSql: 't.empresa_id = ?',
    label: 'Avaliações',
    labelSingular: 'Avaliação',
    description: 'Pesquisa de satisfação do WhatsApp: nota de 1 a 5 ao encerrar o atendimento',
    icon: 'Star',
    group: 'marketing',
    pk: ['id'],
    autoIncrement: true,
    labelField: 'id',
    defaultSort: { field: 'pedida_em', dir: 'desc' },
    canCreate: false,
    canUpdate: false,
    canDelete: false,
    fields: [
      ID,
      { name: 'pedida_em', label: 'Data', type: 'datetime', readOnly: true, listed: true, filterable: true },
      {
        name: 'cliente',
        label: 'Cliente',
        type: 'text',
        readOnly: true,
        listed: true,
        searchable: true,
        sql: `COALESCE((SELECT p.nome FROM pessoas p WHERE p.id = t.pessoa_id),
                       (SELECT w.nome_contato FROM whatsapp_mensagens w WHERE w.empresa_id = t.empresa_id AND w.telefone = t.telefone AND w.nome_contato IS NOT NULL ORDER BY w.id DESC LIMIT 1),
                       CONCAT('+', t.telefone))`,
      },
      { name: 'atendente_id', label: 'Atendente', type: 'text', readOnly: true, listed: true, filterable: true, ref: { resource: 'usuarios', labelField: 'nome' } },
      { name: 'departamento_id', label: 'Departamento', type: 'text', readOnly: true, listed: true, filterable: true, ref: { resource: 'departamentos', labelField: 'nome' } },
      { name: 'origem', label: 'Atendido por', type: 'enum', readOnly: true, listed: true, filterable: true, options: [{ value: 'atendente', label: 'Equipe' }, { value: 'jornada', label: 'Bot / automação' }] },
      { name: 'nota', label: 'Nota', type: 'number', readOnly: true, listed: true, filterable: true, width: 'xs' },
      { name: 'comentario', label: 'Comentário', type: 'textarea', readOnly: true, listed: true, searchable: true },
      {
        name: 'situacao',
        label: 'Situação',
        type: 'enum',
        readOnly: true,
        listed: true,
        filterable: true,
        options: [
          { value: 'aguardando_nota', label: 'Aguardando nota' },
          { value: 'aguardando_comentario', label: 'Aguardando comentário' },
          { value: 'respondida', label: 'Respondida' },
          { value: 'expirada', label: 'Sem resposta' },
        ],
      },
      { name: 'telefone', label: 'WhatsApp', type: 'text', readOnly: true, searchable: true },
      { name: 'respondida_em', label: 'Respondida em', type: 'datetime', readOnly: true },
    ],
  },
  {
    name: 'propostas',
    table: 'propostas',
    tenantColumn: 'empresa_id',
    scopeSql: 't.empresa_id = ?',
    label: 'Propostas',
    labelSingular: 'Proposta',
    description: 'Propostas comerciais com itens do catálogo e controle de versões',
    icon: 'FileSignature',
    group: 'vendas',
    pk: ['id'],
    autoIncrement: true,
    labelField: 'titulo',
    optionsSql: "SELECT id AS value, CONCAT('#', numero_proposta, ' v', versao, ' — ', titulo) AS label FROM propostas WHERE empresa_id = ? ORDER BY numero_proposta DESC LIMIT 1000",
    defaultSort: { field: 'numero_proposta', dir: 'desc' },
    canCreate: true,
    canUpdate: true,
    canDelete: true,
    details: [
      // Resumo por Grupo é a 1ª aba do detalhe
      { resource: 'proposta_itens_grupos', foreignKey: 'proposta_id', label: 'Resumo por Grupo', totalField: 'valor' },
      { resource: 'proposta_itens', foreignKey: 'proposta_id', label: 'Itens da Proposta', totalField: 'subtotal' },
    ],
    // Versões da proposta em árvore: a v1 em cima, as demais como filhas
    arvore: { grupo: 'numero_proposta', ordem: 'versao' },
    fields: [
      ID,
      { name: 'numero_proposta', label: 'Número', type: 'number', readOnly: true, listed: true, width: 'xs' },
      { name: 'versao', label: 'Versão', type: 'number', readOnly: true, listed: true, width: 'xs' },
      // Controle livre; padrão AAAA/NNN (+ "-02", "-03"… nas versões), gerado em server/crm.ts
      {
        name: 'qtd_versoes',
        label: 'Versões',
        type: 'number',
        readOnly: true,
        width: 'xs',
        sql: `(SELECT COUNT(*) FROM propostas x WHERE x.empresa_id = t.empresa_id AND x.numero_proposta = t.numero_proposta)`,
      },
      { name: 'controle', label: 'Controle', type: 'text', listed: true, searchable: true, filterable: true, maxLength: 30, width: 'sm' },
      { name: 'titulo', label: 'Título', type: 'text', required: true, listed: true, searchable: true, maxLength: 255 },
      { name: 'negocio_id', label: 'Negócio', type: 'text', required: true, listed: true, filterable: true, ref: { resource: 'negocios', labelField: 'titulo' } },
      { name: 'pessoa_id', label: 'Contato', type: 'text', ref: { resource: 'pessoas', labelField: 'nome' } },
      { name: 'status', label: 'Status', type: 'enum', required: true, listed: true, filterable: true, options: STATUS_PROPOSTA },
      { name: 'valor_subtotal', label: 'Subtotal', type: 'decimal', scale: 2, readOnly: true },
      { name: 'valor_desconto', label: 'Desconto', type: 'decimal', scale: 2, readOnly: true },
      { name: 'valor_total', label: 'Total', type: 'decimal', scale: 2, readOnly: true, listed: true, filterable: true },
      { name: 'validade_dias', label: 'Validade (dias)', type: 'number' },
      { name: 'data_validade', label: 'Válida até', type: 'date', listed: true, filterable: true },
      { name: 'condicoes_pagamento', label: 'Condições de Pagamento', type: 'textarea' },
      { name: 'observacoes', label: 'Observações', type: 'textarea' },
      ...CRIADO_ATUALIZADO,
    ],
  },
  {
    name: 'proposta_itens',
    table: 'proposta_itens',
    scopeSql: 't.proposta_id IN (SELECT id FROM propostas WHERE empresa_id = ?)',
    label: 'Itens da Proposta',
    labelSingular: 'Item da Proposta',
    description: 'Produtos incluídos em cada proposta',
    icon: 'ListOrdered',
    group: 'vendas',
    oculto: true,
    pk: ['id'],
    autoIncrement: true,
    labelField: 'produto_id',
    defaultSort: { field: 'criado_em', dir: 'asc' },
    canCreate: false,
    canUpdate: false,
    canDelete: false,
    fields: [...itensFields('proposta_id', 'Proposta', 'propostas'), { name: 'criado_em', label: 'Criado em', type: 'datetime', readOnly: true }],
  },
  resumoPorGrupo('proposta_itens', 'proposta_id', 'propostas', 'Proposta'),
  {
    name: 'pedidos',
    table: 'pedidos',
    tenantColumn: 'empresa_id',
    scopeSql: 't.empresa_id = ?',
    label: 'Pedidos de Venda',
    labelSingular: 'Pedido',
    description: 'Digitação e fechamento dos pedidos de venda',
    icon: 'ShoppingCart',
    group: 'vendas',
    pk: ['id'],
    autoIncrement: true,
    labelField: 'numero_pedido',
    optionsSql: "SELECT id AS value, CONCAT('Pedido #', numero_pedido) AS label FROM pedidos WHERE empresa_id = ? ORDER BY numero_pedido DESC LIMIT 1000",
    defaultSort: { field: 'numero_pedido', dir: 'desc' },
    canCreate: true,
    canUpdate: true,
    canDelete: true,
    details: [
      { resource: 'pedido_itens', foreignKey: 'pedido_id', label: 'Itens do Pedido', totalField: 'subtotal' },
      { resource: 'pedido_itens_grupos', foreignKey: 'pedido_id', label: 'Resumo por Grupo', totalField: 'valor' },
    ],
    fields: [
      ID,
      { name: 'numero_pedido', label: 'Número', type: 'number', readOnly: true, listed: true, width: 'xs' },
      { name: 'data_emissao', label: 'Emissão', type: 'datetime', readOnly: true, listed: true, filterable: true },
      { name: 'negocio_id', label: 'Negócio', type: 'text', listed: true, filterable: true, ref: { resource: 'negocios', labelField: 'titulo' } },
      { name: 'proposta_id', label: 'Proposta de Origem', type: 'text', ref: { resource: 'propostas', labelField: 'titulo' } },
      { name: 'pessoa_id', label: 'Contato', type: 'text', ref: { resource: 'pessoas', labelField: 'nome' } },
      { name: 'status', label: 'Status', type: 'enum', required: true, listed: true, filterable: true, options: STATUS_PEDIDO },
      { name: 'valor_subtotal', label: 'Subtotal', type: 'decimal', scale: 2, readOnly: true },
      { name: 'valor_desconto', label: 'Desconto', type: 'decimal', scale: 2, readOnly: true },
      { name: 'valor_total', label: 'Total', type: 'decimal', scale: 2, readOnly: true, listed: true, filterable: true },
      { name: 'condicao_pagamento', label: 'Condição de Pagamento', type: 'text', listed: true, maxLength: 100 },
      { name: 'observacoes', label: 'Observações', type: 'textarea' },
      ...CRIADO_ATUALIZADO,
    ],
  },
  {
    name: 'pedido_itens',
    table: 'pedido_itens',
    scopeSql: 't.pedido_id IN (SELECT id FROM pedidos WHERE empresa_id = ?)',
    label: 'Itens do Pedido',
    labelSingular: 'Item do Pedido',
    description: 'Produtos incluídos em cada pedido',
    icon: 'ListOrdered',
    group: 'vendas',
    oculto: true,
    pk: ['id'],
    autoIncrement: true,
    labelField: 'produto_id',
    defaultSort: { field: 'criado_em', dir: 'asc' },
    canCreate: false,
    canUpdate: false,
    canDelete: false,
    fields: [...itensFields('pedido_id', 'Pedido', 'pedidos'), { name: 'criado_em', label: 'Criado em', type: 'datetime', readOnly: true }],
  },
  resumoPorGrupo('pedido_itens', 'pedido_id', 'pedidos', 'Pedido'),
  {
    // Totais, documentos, assinatura (D4Sign) e renovação: server/contratos.ts
    name: 'contratos',
    table: 'contratos',
    tenantColumn: 'empresa_id',
    scopeSql: 't.empresa_id = ?',
    label: 'Contratos',
    labelSingular: 'Contrato',
    description: 'Contratos recorrentes e de prazo fechado: vigência, valores, renovação e assinatura eletrônica',
    icon: 'ScrollText',
    group: 'vendas',
    pk: ['id'],
    autoIncrement: true,
    labelField: 'titulo',
    defaultSort: { field: 'numero', dir: 'desc' },
    canCreate: true,
    canUpdate: true,
    canDelete: true,
    details: [{ resource: 'contrato_itens', foreignKey: 'contrato_id', label: 'Itens', totalField: 'subtotal', editavel: true }],
    fields: [
      ID,
      { name: 'numero', label: 'Número', type: 'number', readOnly: true, listed: true, width: 'xs' },
      { name: 'titulo', label: 'Título', type: 'text', required: true, listed: true, searchable: true, maxLength: 255, span: 3 },
      { name: 'pessoa_id', label: 'Cliente', type: 'text', required: true, listed: true, filterable: true, ref: { resource: 'pessoas', labelField: 'nome' } },
      { name: 'tipo', label: 'Tipo', type: 'enum', required: true, listed: true, filterable: true, options: TIPOS_CONTRATO, default: 'recorrente' },
      { name: 'situacao', label: 'Situação', type: 'enum', required: true, listed: true, filterable: true, options: SITUACOES_CONTRATO, default: 'rascunho' },
      {
        // Pelos documentos: via assinada (D4Sign ou anexada como "Assinado") ou envio em andamento
        name: 'assinatura',
        label: 'Assinatura',
        type: 'enum',
        readOnly: true,
        listed: true,
        filterable: true,
        options: [
          { value: 'assinado', label: 'Assinado' },
          { value: 'em_assinatura', label: 'Em assinatura' },
          { value: 'nao_assinado', label: 'Não assinado' },
        ],
        sql: `(CASE WHEN EXISTS (SELECT 1 FROM contrato_documentos d WHERE d.contrato_id = t.id AND (d.assinatura_situacao = 'assinado' OR d.tipo = 'assinado')) THEN 'assinado'
                    WHEN EXISTS (SELECT 1 FROM contrato_documentos d WHERE d.contrato_id = t.id AND d.assinatura_situacao IN ('enviado', 'visualizado')) THEN 'em_assinatura'
                    ELSE 'nao_assinado' END)`,
      },
      {
        // Andamento do último envio à D4Sign: signatários que já assinaram de quantos há
        name: 'assinaturas',
        label: 'Assinaturas',
        type: 'text',
        readOnly: true,
        listed: true,
        sql: `(SELECT CONCAT((SELECT COUNT(*) FROM JSON_TABLE(d.signatarios, '$[*]' COLUMNS (a BOOLEAN PATH '$.assinado')) j WHERE j.a),
                             ' de ', JSON_LENGTH(d.signatarios))
                 FROM contrato_documentos d
                WHERE d.contrato_id = t.id AND d.assinatura_situacao IN ('enviado', 'visualizado', 'assinado') AND JSON_LENGTH(d.signatarios) > 0
                ORDER BY d.assinatura_enviada_em DESC, d.id DESC LIMIT 1)`,
      },
      {
        // Quando a via assinada chegou ao CRM (a D4Sign finaliza só depois do último signatário)
        name: 'assinado_em',
        label: 'Assinado em',
        type: 'date',
        readOnly: true,
        listed: true,
        filterable: true,
        sql: `(SELECT DATE(MAX(COALESCE(d.assinatura_concluida_em, d.criado_em))) FROM contrato_documentos d
                WHERE d.contrato_id = t.id AND (d.assinatura_situacao = 'assinado' OR d.tipo = 'assinado'))`,
      },
      { name: 'data_inicio', label: 'Início', type: 'date', required: true, listed: true, filterable: true },
      { name: 'data_fim', label: 'Fim', type: 'date', listed: true, filterable: true, hint: 'Em branco: prazo indeterminado' },
      { name: 'periodicidade', label: 'Periodicidade', type: 'enum', required: true, listed: true, options: PERIODICIDADES, default: 'mensal' },
      { name: 'dia_vencimento', label: 'Dia de vencimento', type: 'number', width: 'xs' },
      { name: 'valor_periodo', label: 'Valor por período', type: 'decimal', scale: 2, readOnly: true, listed: true, hint: 'Soma dos itens' },
      { name: 'valor_total', label: 'Valor total', type: 'decimal', scale: 2, readOnly: true, listed: true, hint: 'Da vigência (sem fim: 12 meses)' },
      { name: 'renovacao_automatica', label: 'Renovação automática', type: 'boolean', listed: true, default: true, hint: 'Vencido, renova por 12 meses; sem ela, encerra' },
      { name: 'aviso_renovacao_dias', label: 'Aviso de renovação (dias)', type: 'number', default: 60, hint: 'Cria a tarefa "Renovar contrato" antes do fim' },
      { name: 'indice_reajuste', label: 'Índice de reajuste', type: 'text', maxLength: 20, placeholder: 'IPCA, IGP-M…' },
      { name: 'data_proximo_reajuste', label: 'Próximo reajuste', type: 'date' },
      { name: 'negocio_id', label: 'Negócio', type: 'text', filterable: true, ref: { resource: 'negocios', labelField: 'titulo' } },
      { name: 'proposta_id', label: 'Proposta', type: 'text', ref: { resource: 'propostas', labelField: 'titulo' } },
      { name: 'proprietario_id', label: 'Responsável', type: 'text', listed: true, filterable: true, ref: { resource: 'usuarios', labelField: 'nome' } },
      { name: 'motivo_encerramento', label: 'Motivo do encerramento', type: 'text', maxLength: 255, disabledWhen: { field: 'situacao', equals: 'ativo' } },
      { name: 'observacoes', label: 'Observações', type: 'textarea' },
      { name: 'cod_integracao', label: 'Cód.Integração', type: 'text', maxLength: 50, hint: 'Código no sistema de gestão' },
      { name: 'encerrado_em', label: 'Encerrado em', type: 'datetime', readOnly: true },
      ...CRIADO_ATUALIZADO,
    ],
  },
  {
    // Editados no painel de detalhe do contrato; subtotal e totais calculados pelo servidor
    name: 'contrato_itens',
    table: 'contrato_itens',
    scopeSql: 't.contrato_id IN (SELECT id FROM contratos WHERE empresa_id = ?)',
    label: 'Itens do Contrato',
    labelSingular: 'Item do Contrato',
    description: 'Produtos e licenças do contrato',
    icon: 'ListOrdered',
    group: 'vendas',
    oculto: true,
    pk: ['id'],
    autoIncrement: true,
    labelField: 'id',
    defaultSort: { field: 'id', dir: 'asc' },
    canCreate: true,
    canUpdate: true,
    canDelete: true,
    fields: [
      ID,
      { name: 'contrato_id', label: 'Contrato', type: 'text', required: true, ref: { resource: 'contratos', labelField: 'titulo' } },
      { name: 'produto_id', label: 'Produto', type: 'text', required: true, listed: true, ref: { resource: 'produtos', labelField: 'nome' } },
      { name: 'quantidade', label: 'Quantidade', type: 'decimal', scale: 3, required: true, listed: true, default: '1.000' },
      { name: 'preco_unitario', label: 'Valor por período', type: 'decimal', scale: 2, listed: true, hint: 'Em branco: preço de tabela do produto' },
      { name: 'desconto', label: 'Desconto (R$)', type: 'decimal', scale: 2, listed: true },
      { name: 'subtotal', label: 'Subtotal', type: 'decimal', scale: 2, readOnly: true, listed: true },
      { name: 'criado_em', label: 'Criado em', type: 'datetime', readOnly: true },
    ],
  },

  // ============================================================
  // CADASTROS
  // ============================================================
  {
    name: 'empresas',
    table: 'empresas',
    scopeSql: 't.id = ?',
    label: 'Minha Empresa',
    labelSingular: 'Empresa',
    description: 'Dados da empresa logada (impressos nas propostas e pedidos)',
    icon: 'Building2',
    group: 'cadastros',
    pk: ['id'],
    autoIncrement: true,
    labelField: 'nome',
    defaultSort: { field: 'nome', dir: 'asc' },
    canCreate: false,
    canUpdate: true,
    canDelete: false,
    fields: [
      ID,
      { name: 'nome', label: 'Nome', type: 'text', required: true, listed: true, searchable: true, maxLength: 255 },
      { name: 'cnpj', label: 'CNPJ', type: 'cnpj', listed: true, searchable: true },
      { name: 'endereco', label: 'Endereço', type: 'textarea', listed: true, searchable: true },
      { name: 'logo', label: 'Logo', type: 'imagem', hint: 'Aparece no cabeçalho da impressão de propostas e pedidos' },
      ...CRIADO_ATUALIZADO,
    ],
  },
  {
    name: 'pessoas',
    table: 'pessoas',
    tenantColumn: 'empresa_id',
    scopeSql: 't.empresa_id = ?',
    label: 'Pessoas',
    labelSingular: 'Pessoa',
    description: 'Contatos dos leads e clientes',
    icon: 'Users',
    group: 'cadastros',
    pk: ['id'],
    autoIncrement: true,
    labelField: 'nome',
    // Inativos continuam nos combos (proposta para reativar o sistema), marcados
    optionsSql: `SELECT id AS value, CONCAT(nome, IF(ativo = 1, '', ' (inativo)')) AS label
                   FROM pessoas WHERE empresa_id = ? ORDER BY nome LIMIT 5000`,
    defaultSort: { field: 'nome', dir: 'asc' },
    canCreate: true,
    canUpdate: true,
    canDelete: true,
    details: [
      { resource: 'negocios', foreignKey: 'pessoa_id', label: 'Negócios', totalField: 'valor' },
      { resource: 'atividades', foreignKey: 'pessoa_id', label: 'Atividades' },
      { resource: 'pessoas_contatos', foreignKey: 'pessoa_id', label: 'Contatos', editavel: true },
      { resource: 'pessoas_enderecos', foreignKey: 'pessoa_id', label: 'Endereços' },
    ],
    fields: [
      ID,
      { name: 'tipo', label: 'Tipo', type: 'enum', required: true, listed: true, filterable: true, options: TIPOS_PESSOA, default: 'cliente', width: 'xs', span: 1 },
      // Tipo + Nome dividem a primeira linha do formulário (grade de 4 colunas)
      { name: 'nome', label: 'Nome', type: 'text', required: true, listed: true, searchable: true, maxLength: 255, span: 3 },
      { name: 'segmento_id', label: 'Segmento', type: 'text', listed: true, filterable: true, ref: { resource: 'segmentos', labelField: 'nome' } },
      {
        name: 'ativo',
        label: 'Ativo',
        type: 'boolean',
        listed: true,
        filterable: true,
        default: true,
        width: 'xs',
        hint: 'Inativo continua nas listas (propostas, negócios) para quando o cliente quiser reativar. Vem do bmsoft na importação',
      },
      {
        name: 'nao_receber_campanhas',
        label: 'Não receber campanhas',
        type: 'boolean',
        filterable: true,
        default: false,
        hint: 'Fica fora de todas as campanhas. Marcado sozinho quando a pessoa responde "SAIR" a uma campanha no WhatsApp',
      },
      { name: 'tecnico_padrao_id', label: 'Técnico Padrão', type: 'text', listed: true, filterable: true, ref: { resource: 'usuarios', labelField: 'nome' }, hint: 'Quem atende os chamados e o WhatsApp deste cliente (outro técnico ainda pode assumir)' },
      { name: 'email', label: 'E-mail', type: 'text', listed: true, searchable: true, maxLength: 255 },
      { name: 'telefone', label: 'Telefone', type: 'text', listed: true, searchable: true, maxLength: 50 },
      { name: 'whatsapp', label: 'WhatsApp', type: 'text', listed: true, searchable: true, maxLength: 20, hint: 'Com DDD. Usado nas campanhas e mensagens automáticas (sem ele, vale o telefone)' },
      { name: 'cpf', label: 'CPF', type: 'text', searchable: true, maxLength: 14, placeholder: '000.000.000-00' },
      { name: 'anydesk_id', label: 'ID AnyDesk', type: 'text', maxLength: 20, hint: 'Número do AnyDesk do cliente: o técnico conecta direto pelo chamado (o cliente também envia pelo chat do site)' },
      { name: 'obs', label: 'Observação', type: 'textarea' },
      { name: 'personalizados', label: 'Campos Personalizados', type: 'personalizados' },
      { name: 'cod_integracao', label: 'Cód.Integração', type: 'text', readOnly: true, listed: true, filterable: true, searchable: true, hint: 'Preenchido pela importação do bmsoft (PESSOAS.ID)' },
      { name: 'google_place_id', label: 'Google Place ID', type: 'text', readOnly: true, searchable: true, hint: 'Código da empresa no Google Maps, gravado pela Prospecção: evita incluir o mesmo lead de novo' },
      {
        name: 'prospeccao_busca_id',
        label: 'Busca da prospecção',
        type: 'text',
        readOnly: true,
        filterable: true,
        ref: { resource: 'prospeccao_buscas', labelField: 'termo' },
        hint: 'Busca da Prospecção que incluiu este lead',
      },
      {
        name: 'cidade_uf',
        label: 'Cidade/UF',
        type: 'text',
        readOnly: true,
        listed: true,
        searchable: true,
        filterable: true,
        // Do endereço principal (ou do primeiro, se nenhum estiver marcado)
        sql: `(SELECT NULLIF(CONCAT_WS(' / ', e.cidade, e.uf), '') FROM pessoas_enderecos e
                WHERE e.pessoa_id = t.id ORDER BY e.principal DESC, e.id LIMIT 1)`,
      },
      ...CRIADO_ATUALIZADO,
    ],
  },
  {
    // Contatos da pessoa: quem se fala dentro da empresa-cliente. Mantidos no detalhe da pessoa
    name: 'pessoas_contatos',
    table: 'pessoas_contatos',
    tenantColumn: 'empresa_id',
    scopeSql: 't.empresa_id = ?',
    label: 'Contatos',
    labelSingular: 'Contato',
    description: 'Contatos das pessoas (quem se fala na empresa-cliente)',
    icon: 'Users',
    group: 'cadastros',
    oculto: true,
    pk: ['id'],
    autoIncrement: true,
    labelField: 'nome',
    defaultSort: { field: 'principal', dir: 'desc' },
    canCreate: true,
    canUpdate: true,
    canDelete: true,
    fields: [
      ID,
      // sem ref: o painel já está na pessoa (o servidor confere que ela é da empresa)
      { name: 'pessoa_id', label: 'Pessoa', type: 'number', required: true },
      { name: 'nome', label: 'Nome', type: 'text', required: true, listed: true, searchable: true, maxLength: 150, span: 2 },
      { name: 'cargo', label: 'Cargo', type: 'text', listed: true, maxLength: 100 },
      { name: 'departamento', label: 'Departamento', type: 'text', listed: true, maxLength: 100 },
      { name: 'papel', label: 'Papel na venda', type: 'enum', listed: true, options: PAPEIS_CONTATO },
      { name: 'whatsapp', label: 'WhatsApp', type: 'text', listed: true, maxLength: 20, placeholder: '(00) 00000-0000' },
      { name: 'celular', label: 'Celular', type: 'text', listed: true, maxLength: 20, placeholder: '(00) 00000-0000' },
      { name: 'telefone', label: 'Telefone', type: 'text', maxLength: 20 },
      { name: 'ramal', label: 'Ramal', type: 'text', maxLength: 10 },
      { name: 'email', label: 'E-mail', type: 'text', listed: true, maxLength: 255, span: 2 },
      { name: 'data_nascimento', label: 'Nascimento', type: 'date' },
      { name: 'linkedin', label: 'LinkedIn', type: 'text', maxLength: 255, placeholder: 'https://www.linkedin.com/in/...' },
      { name: 'principal', label: 'Principal', type: 'boolean', listed: true, hint: 'Um só por pessoa: marcar este desmarca o anterior' },
      { name: 'ativo', label: 'Ativo', type: 'boolean', listed: true, default: true, hint: 'Desligue quando sair da empresa-cliente: fica no histórico, mas não recebe mensagens' },
      { name: 'aceita_whatsapp', label: 'Aceita WhatsApp', type: 'boolean', default: true },
      { name: 'aceita_email', label: 'Aceita e-mail', type: 'boolean', default: true },
      { name: 'obs', label: 'Observação', type: 'textarea' },
      ...CRIADO_ATUALIZADO,
    ],
  },
  {
    // Endereços são editados no próprio cadastro da pessoa (server/enderecos.ts);
    // este recurso só alimenta o painel de detalhe da lista
    name: 'pessoas_enderecos',
    table: 'pessoas_enderecos',
    tenantColumn: 'empresa_id',
    scopeSql: 't.empresa_id = ?',
    label: 'Endereços',
    labelSingular: 'Endereço',
    description: 'Endereços das pessoas',
    icon: 'MapPin',
    group: 'cadastros',
    oculto: true,
    pk: ['id'],
    autoIncrement: true,
    labelField: 'logradouro',
    defaultSort: { field: 'id', dir: 'asc' },
    canCreate: false,
    canUpdate: false,
    canDelete: false,
    fields: [
      ID,
      // sem ref: o painel já está na pessoa e o combo carregaria todas as pessoas à toa
      { name: 'pessoa_id', label: 'Pessoa', type: 'number' },
      { name: 'tipo', label: 'Tipo', type: 'enum', listed: true, options: TIPOS_ENDERECO },
      { name: 'principal', label: 'Principal', type: 'boolean', listed: true },
      { name: 'cep', label: 'CEP', type: 'text', listed: true },
      { name: 'logradouro', label: 'Logradouro', type: 'text', listed: true },
      { name: 'numero', label: 'Número', type: 'text', listed: true },
      { name: 'complemento', label: 'Complemento', type: 'text', listed: true },
      { name: 'bairro', label: 'Bairro', type: 'text', listed: true },
      { name: 'cidade', label: 'Cidade', type: 'text', listed: true },
      { name: 'uf', label: 'UF', type: 'text', listed: true },
      { name: 'codigo_ibge', label: 'Cód. IBGE', type: 'text' },
      { name: 'pais', label: 'País', type: 'text' },
      { name: 'obs', label: 'Observação', type: 'text', listed: true },
      ...CRIADO_ATUALIZADO,
    ],
  },
  {
    name: 'departamentos',
    table: 'departamentos',
    tenantColumn: 'empresa_id',
    scopeSql: 't.empresa_id = ?',
    label: 'Departamentos',
    labelSingular: 'Departamento',
    description: 'Áreas da empresa (Vendas, Suporte, Financeiro...): agrupam usuários e recebem atividades',
    icon: 'Network',
    group: 'cadastros',
    pk: ['id'],
    autoIncrement: true,
    labelField: 'nome',
    optionsSql: `SELECT id AS value, CONCAT(nome, IF(ativo = 1, '', ' (inativo)')) AS label
                   FROM departamentos WHERE empresa_id = ? ORDER BY ativo DESC, nome LIMIT 1000`,
    defaultSort: { field: 'nome', dir: 'asc' },
    canCreate: true,
    canUpdate: true,
    canDelete: true,
    details: [{ resource: 'usuarios', foreignKey: 'departamento_id', label: 'Usuários do Departamento' }],
    fields: [
      ID,
      { name: 'nome', label: 'Nome', type: 'text', required: true, listed: true, searchable: true, maxLength: 80 },
      { name: 'ativo', label: 'Ativo', type: 'boolean', listed: true, filterable: true, default: true, width: 'xs' },
      { name: 'criado_em', label: 'Criado em', type: 'datetime', readOnly: true },
    ],
  },
  {
    // Cadastros › Templates: textos prontos para responder no WhatsApp e nos Chamados (botão ao lado do campo da mensagem)
    name: 'templates',
    table: 'templates_mensagens',
    tenantColumn: 'empresa_id',
    scopeSql: 't.empresa_id = ?',
    label: 'Templates',
    labelSingular: 'Template',
    description: 'Mensagens prontas para o WhatsApp e os chamados',
    icon: 'MessageSquareText',
    group: 'cadastros',
    pk: ['id'],
    autoIncrement: true,
    labelField: 'descricao',
    defaultSort: { field: 'descricao', dir: 'asc' },
    canCreate: true,
    canUpdate: true,
    canDelete: true,
    fields: [
      ID,
      { name: 'descricao', label: 'Descrição', type: 'text', required: true, listed: true, searchable: true, maxLength: 100, span: 3, hint: 'Nome curto: é o que aparece na lista de escolha' },
      { name: 'canal', label: 'Canal', type: 'enum', required: true, listed: true, filterable: true, options: CANAIS_TEMPLATE, default: 'todos', width: 'xs', span: 1 },
      {
        name: 'texto',
        label: 'Texto',
        type: 'textarea',
        required: true,
        listed: true,
        searchable: true,
        hint: 'Variáveis: {{nome}} e {{primeiro_nome}} do cliente, {{atendente}} = quem envia',
      },
      { name: 'ativo', label: 'Ativo', type: 'boolean', listed: true, filterable: true, default: true, width: 'xs' },
      ...CRIADO_ATUALIZADO,
    ],
  },
  {
    // Suporte › Pesquisa de Satisfação: a lista no CrudView; incluir e abrir usam o editor próprio
    // (src/components/PesquisasSatisfacao.tsx), que grava pelas rotas de server/pesquisasSatisfacao.ts.
    // Por isso os campos são só leitura: o CRUD genérico só lista e exclui.
    name: 'pesquisas_satisfacao',
    table: 'pesquisas_satisfacao',
    tenantColumn: 'empresa_id',
    scopeSql: 't.empresa_id = ?',
    label: 'Pesquisa de Satisfação',
    labelSingular: 'Pesquisa',
    description: 'Sorteie atendimentos e pergunte aos clientes como foi',
    icon: 'ClipboardCheck',
    group: 'suporte',
    pk: ['id'],
    autoIncrement: true,
    labelField: 'descricao',
    defaultSort: { field: 'id', dir: 'desc' },
    canCreate: true,
    canUpdate: true,
    canDelete: true,
    semDadosDoBanco: true,
    fields: [
      ID,
      { name: 'criado_em', label: 'Criada em', type: 'date', readOnly: true, listed: true, filterable: true, width: 'sm' },
      { name: 'descricao', label: 'Descrição', type: 'text', readOnly: true, listed: true, searchable: true, filterable: true },
      { name: 'canal', label: 'Contato', type: 'enum', readOnly: true, listed: true, filterable: true, options: CANAIS_PESQUISA },
      { name: 'situacao', label: 'Situação', type: 'enum', readOnly: true, listed: true, filterable: true, options: SITUACOES_PESQUISA },
      { name: 'total_filtrados', label: 'Filtrados', type: 'number', readOnly: true, listed: true, width: 'xs' },
      {
        name: 'selecionados',
        label: 'Selecionados',
        type: 'number',
        readOnly: true,
        listed: true,
        width: 'xs',
        sql: '(SELECT COUNT(*) FROM pesquisas_satisfacao_itens i WHERE i.pesquisa_id = t.id AND i.selecionado = 1)',
      },
      {
        name: 'respondidos',
        label: 'Respondidos',
        type: 'number',
        readOnly: true,
        listed: true,
        width: 'xs',
        sql: "(SELECT COUNT(*) FROM pesquisas_satisfacao_itens i WHERE i.pesquisa_id = t.id AND i.situacao = 'respondido')",
      },
      {
        name: 'media',
        label: 'Nota média',
        type: 'decimal',
        scale: 1,
        readOnly: true,
        listed: true,
        width: 'xs',
        sql: '(SELECT ROUND(AVG(i.nota), 1) FROM pesquisas_satisfacao_itens i WHERE i.pesquisa_id = t.id AND i.nota IS NOT NULL)',
      },
      { name: 'criado_por_nome', label: 'Criada por', type: 'text', readOnly: true, sql: '(SELECT u.nome FROM usuarios u WHERE u.id = t.criado_por)' },
      { name: 'executada_em', label: 'Executada em', type: 'datetime', readOnly: true, filterable: true },
      { name: 'concluida_em', label: 'Concluída em', type: 'datetime', readOnly: true, filterable: true },
    ],
  },
  {
    // Atendimentos sorteados de uma pesquisa (aba Atendimentos Selecionados do editor). Só leitura aqui:
    // marcar/desmarcar, executar e registrar retorno usam as rotas de server/pesquisasSatisfacao.ts
    name: 'pesquisa_itens',
    table: 'pesquisas_satisfacao_itens',
    scopeSql: 't.pesquisa_id IN (SELECT id FROM pesquisas_satisfacao WHERE empresa_id = ?)',
    label: 'Atendimentos Selecionados',
    labelSingular: 'Atendimento',
    description: 'Atendimentos sorteados na pesquisa de satisfação',
    icon: 'ListOrdered',
    group: 'suporte',
    oculto: true,
    pk: ['id'],
    autoIncrement: true,
    labelField: 'assunto',
    defaultSort: { field: 'lote', dir: 'asc' },
    canCreate: false,
    canUpdate: false,
    canDelete: false,
    fields: [
      ID,
      { name: 'pesquisa_id', label: 'Pesquisa', type: 'number', readOnly: true },
      { name: 'lote', label: 'Lote', type: 'number', readOnly: true, listed: true, filterable: true, width: 'xs' },
      { name: 'data_atendimento', label: 'Atendido em', type: 'datetime', readOnly: true, listed: true, filterable: true },
      { name: 'assunto', label: 'Atendimento', type: 'text', readOnly: true, listed: true, searchable: true },
      {
        name: 'pessoa_nome',
        label: 'Cliente',
        type: 'text',
        readOnly: true,
        listed: true,
        searchable: true,
        sql: '(SELECT pe.nome FROM pessoas pe WHERE pe.id = t.pessoa_id)',
      },
      {
        name: 'pessoa_contato',
        label: 'Contato do cliente',
        type: 'text',
        readOnly: true,
        listed: true,
        // Depois de contatado, o destino usado; antes, o do cadastro pelo tipo de contato (e-mail, ou WhatsApp/telefone)
        sql: `COALESCE(NULLIF(t.destino, ''), (SELECT IF(ps.canal = 'email', NULLIF(pe.email, ''), COALESCE(NULLIF(pe.whatsapp, ''), NULLIF(pe.telefone, '')))
                 FROM pessoas pe JOIN pesquisas_satisfacao ps ON ps.id = t.pesquisa_id WHERE pe.id = t.pessoa_id))`,
      },
      {
        name: 'atendente_nome',
        label: 'Técnico',
        type: 'text',
        readOnly: true,
        listed: true,
        sql: "COALESCE((SELECT u.nome FROM usuarios u WHERE u.id = t.atendente_id), 'Bot')",
      },
      { name: 'situacao', label: 'Situação', type: 'enum', readOnly: true, listed: true, filterable: true, options: SITUACOES_ITEM_PESQUISA },
      { name: 'nota', label: 'Nota', type: 'number', readOnly: true, listed: true, filterable: true, width: 'xs' },
      { name: 'resumo', label: 'Retorno do cliente', type: 'text', readOnly: true, listed: true },
      { name: 'comentario', label: 'Comentário', type: 'text', readOnly: true },
      { name: 'precisa_retorno', label: 'Tarefa de retorno', type: 'boolean', readOnly: true, listed: true, filterable: true, width: 'xs' },
      { name: 'registrado_por_nome', label: 'Registrado por', type: 'text', readOnly: true, sql: '(SELECT u.nome FROM usuarios u WHERE u.id = t.registrado_por)' },
      { name: 'selecionado', label: 'Selecionado', type: 'boolean', readOnly: true, filterable: true },
      { name: 'atividade_id', label: 'Atividade', type: 'number', readOnly: true },
      { name: 'executor_bot', label: 'Executor Bot', type: 'number', readOnly: true, sql: '(SELECT a.executor_bot FROM atividades a WHERE a.id = t.atividade_id)' },
      { name: 'enviado_em', label: 'Contatado em', type: 'datetime', readOnly: true },
      { name: 'respondido_em', label: 'Respondido em', type: 'datetime', readOnly: true },
    ],
  },
  {
    // Suporte › Consulta de Chamados: todos os chamados em lista, para filtrar por cliente, período, status, técnico...
    // Só leitura: o atendimento continua em Chamados Ativos (a ação "Abrir" da linha leva para lá)
    name: 'chamados',
    table: 'chamados',
    tenantColumn: 'empresa_id',
    scopeSql: 't.empresa_id = ?',
    label: 'Consulta de Chamados',
    labelSingular: 'Chamado',
    description: 'Todos os chamados, com filtro por cliente, data, status, técnico, categoria e nota',
    icon: 'ListOrdered',
    group: 'suporte',
    pk: ['id'],
    autoIncrement: true,
    labelField: 'titulo',
    // Combo (Ordem de Serviço › Chamado de origem): "#12 Título", os mais novos primeiro
    optionsSql: `SELECT id AS value, CONCAT('#', numero, ' ', titulo) AS label FROM chamados WHERE empresa_id = ? ORDER BY id DESC LIMIT 5000`,
    defaultSort: { field: 'criado_em', dir: 'desc' },
    canCreate: false,
    canUpdate: false,
    canDelete: false,
    fields: [
      ID,
      { name: 'numero', label: 'Nº', type: 'number', listed: true, searchable: true, filterable: true, width: 'xs', readOnly: true },
      { name: 'titulo', label: 'Título', type: 'text', listed: true, searchable: true, readOnly: true },
      { name: 'pessoa_id', label: 'Cliente', type: 'text', listed: true, filterable: true, readOnly: true, ref: { resource: 'pessoas', labelField: 'nome' } },
      // Chamado aberto pelo site sem cliente cadastrado: quem abriu
      { name: 'contato_nome', label: 'Contato (site)', type: 'text', searchable: true, readOnly: true },
      {
        name: 'status',
        label: 'Status',
        type: 'enum',
        listed: true,
        filterable: true,
        readOnly: true,
        options: [
          { value: 'aguardando', label: 'Aguardando' },
          { value: 'em_andamento', label: 'Em atendimento' },
          { value: 'pendente_cliente', label: 'Pendente do cliente' },
          { value: 'pausado', label: 'Pausado' },
          { value: 'encerrado', label: 'Encerrado' },
          { value: 'cancelado', label: 'Cancelado' },
        ],
      },
      {
        name: 'prioridade',
        label: 'Prioridade',
        type: 'enum',
        filterable: true,
        readOnly: true,
        options: [
          { value: 'baixa', label: 'Baixa' },
          { value: 'normal', label: 'Normal' },
          { value: 'alta', label: 'Alta' },
          { value: 'urgente', label: 'Urgente' },
        ],
      },
      { name: 'categoria_id', label: 'Categoria', type: 'text', listed: true, filterable: true, readOnly: true, ref: { resource: 'chamado_categorias', labelField: 'nome' } },
      { name: 'atendente_id', label: 'Técnico', type: 'text', listed: true, filterable: true, readOnly: true, ref: { resource: 'usuarios', labelField: 'nome' } },
      { name: 'departamento_id', label: 'Departamento', type: 'text', filterable: true, readOnly: true, ref: { resource: 'departamentos', labelField: 'nome' } },
      {
        name: 'canal',
        label: 'Canal',
        type: 'enum',
        filterable: true,
        readOnly: true,
        options: [
          { value: 'interno', label: 'Interno' },
          { value: 'whatsapp', label: 'WhatsApp' },
          { value: 'telefone', label: 'Telefone' },
          { value: 'email', label: 'E-mail' },
          { value: 'web', label: 'Site' },
        ],
      },
      { name: 'criado_em', label: 'Aberto em', type: 'datetime', listed: true, filterable: true, readOnly: true },
      { name: 'encerrado_em', label: 'Encerrado em', type: 'datetime', listed: true, filterable: true, readOnly: true },
      { name: 'sla_prazo', label: 'SLA até', type: 'datetime', filterable: true, readOnly: true },
      {
        // Nota que o cliente deu no fim (chat do site); sem avaliação, vazio
        name: 'nota',
        label: 'Nota',
        type: 'number',
        listed: true,
        filterable: true,
        readOnly: true,
        width: 'xs',
        sql: `(SELECT av.nota FROM avaliacoes av WHERE av.chamado_id = t.id AND av.nota IS NOT NULL ORDER BY av.id DESC LIMIT 1)`,
      },
      { name: 'descricao', label: 'Descrição', type: 'textarea', searchable: true, readOnly: true },
      { name: 'conclusao', label: 'Conclusão', type: 'textarea', searchable: true, readOnly: true },
    ],
  },
  {
    // Atendimento externo do técnico no cliente: impressa para levar (server/os.ts) e, depois, no app do técnico
    name: 'ordens_servico',
    table: 'ordens_servico',
    tenantColumn: 'empresa_id',
    scopeSql: 't.empresa_id = ?',
    label: 'Ordens de Serviço',
    labelSingular: 'Ordem de Serviço',
    description: 'Atendimentos externos dos técnicos no cliente',
    icon: 'Wrench',
    group: 'suporte',
    pk: ['id'],
    autoIncrement: true,
    labelField: 'numero',
    defaultSort: { field: 'data_agendada', dir: 'desc' },
    minhasSql: 't.tecnico_id = ?',
    ficha: true,
    semDadosDoBanco: true,
    // Serviços cobrados, lançados como os itens do pedido (preço em branco = o do cadastro de Serviços)
    details: [{ resource: 'os_itens', foreignKey: 'os_id', label: 'Serviços e produtos', totalField: 'subtotal', editavel: true }],
    canCreate: true,
    canUpdate: true,
    canDelete: true,
    fields: [
      ID,
      { name: 'numero', label: 'Nº', type: 'number', listed: true, searchable: true, filterable: true, width: 'xs', readOnly: true },
      { name: 'pessoa_id', label: 'Cliente', type: 'text', required: true, listed: true, filterable: true, span: 2, ref: { resource: 'pessoas', labelField: 'nome' } },
      { name: 'tecnico_id', label: 'Técnico', type: 'text', required: true, listed: true, filterable: true, ref: { resource: 'usuarios', labelField: 'nome' } },
      { name: 'data_agendada', label: 'Data', type: 'date', required: true, listed: true, filterable: true, default: 'hoje' },
      { name: 'hora_inicio', label: 'Das', type: 'time', listed: true, somarHoras: { campo: 'hora_fim', horas: 2 } },
      { name: 'hora_fim', label: 'Até', type: 'time' },
      {
        name: 'status',
        label: 'Status',
        type: 'enum',
        required: true,
        listed: true,
        filterable: true,
        default: 'aberta',
        // OS nova é sempre aberta (o servidor grava o padrão do banco)
        soNaAlteracao: true,
        options: [
          { value: 'aberta', label: 'Aberta' },
          { value: 'em_execucao', label: 'Em execução' },
          { value: 'concluida', label: 'Concluída' },
          { value: 'cancelada', label: 'Cancelada' },
        ],
      },
      {
        name: 'tipo',
        label: 'Tipo',
        type: 'enum',
        required: true,
        listed: true,
        filterable: true,
        default: 'visita_tecnica',
        options: [
          { value: 'instalacao', label: 'Instalação' },
          { value: 'manutencao_corretiva', label: 'Manutenção corretiva' },
          { value: 'manutencao_preventiva', label: 'Manutenção preventiva' },
          { value: 'treinamento', label: 'Treinamento' },
          { value: 'visita_tecnica', label: 'Visita técnica' },
          { value: 'outro', label: 'Outro' },
        ],
      },
      { name: 'chamado_id', label: 'Chamado de origem', type: 'text', filterable: true, ref: { resource: 'chamados', labelField: 'titulo' } },
      { name: 'contato_nome', label: 'Falar com', type: 'text', maxLength: 120 },
      { name: 'contato_telefone', label: 'Telefone do contato', type: 'text', maxLength: 20 },
      { name: 'endereco', label: 'Endereço do atendimento', type: 'text', searchable: true, maxLength: 500, span: 4, hint: 'Vazio = o endereço principal do cliente' },
      { name: 'servico_solicitado', label: 'O que será feito', type: 'textarea', required: true, listed: true, searchable: true },
      {
        name: 'valor_total',
        label: 'Valor',
        type: 'decimal',
        scale: 2,
        listed: true,
        readOnly: true,
        sql: '(SELECT COALESCE(SUM(i.subtotal), 0) FROM os_itens i WHERE i.os_id = t.id)',
      },
      // Fechamento: só na alteração (na inclusão a OS ainda não foi feita)
      // Fechamento: gravado só pelo Encerrar (web) ou pelo app do técnico; na edição aparece bloqueado
      { name: 'servico_executado', label: 'O que foi feito', type: 'textarea', searchable: true, readOnly: true, mostrarNaEdicao: true },
      { name: 'inicio_em', label: 'Início real', type: 'datetime', readOnly: true, mostrarNaEdicao: true },
      { name: 'fim_em', label: 'Término real', type: 'datetime', readOnly: true, mostrarNaEdicao: true },
      { name: 'observacao', label: 'Observação interna', type: 'textarea', hint: 'Não sai na impressão' },
      { name: 'assinatura_nome', label: 'Assinado por', type: 'text', readOnly: true },
      { name: 'assinatura', label: 'Assinatura do cliente', type: 'imagem', readOnly: true },
      { name: 'criado_por', label: 'Aberta por', type: 'text', readOnly: true, ref: { resource: 'usuarios', labelField: 'nome' } },
      ...CRIADO_ATUALIZADO,
    ],
  },
  {
    name: 'os_itens',
    table: 'os_itens',
    scopeSql: 't.os_id IN (SELECT id FROM ordens_servico WHERE empresa_id = ?)',
    label: 'Serviços e produtos da OS',
    labelSingular: 'Item da OS',
    semDadosDoBanco: true,
    description: 'Serviços e produtos (peças, materiais) de cada ordem de serviço',
    icon: 'ListOrdered',
    group: 'suporte',
    oculto: true,
    pk: ['id'],
    autoIncrement: true,
    labelField: 'id',
    defaultSort: { field: 'id', dir: 'asc' },
    canCreate: true,
    canUpdate: true,
    canDelete: true,
    fields: [
      ID,
      { name: 'os_id', label: 'OS', type: 'text', required: true, ref: { resource: 'ordens_servico', labelField: 'numero' } },
      // Cada linha é um serviço OU um produto (regras.ts confere)
      { name: 'servico_id', label: 'Serviço', type: 'text', listed: true, ref: { resource: 'servicos', labelField: 'nome' }, hint: 'Ou um serviço ou um produto' },
      { name: 'produto_id', label: 'Produto', type: 'text', listed: true, ref: { resource: 'produtos', labelField: 'nome' } },
      { name: 'quantidade', label: 'Quantidade', type: 'decimal', scale: 3, required: true, listed: true, default: '1.000' },
      { name: 'preco_unitario', label: 'Preço Unitário', type: 'decimal', scale: 2, listed: true, hint: 'Em branco: o preço do cadastro (Serviços ou Produtos)' },
      { name: 'desconto', label: 'Desconto (R$)', type: 'decimal', scale: 2, listed: true },
      { name: 'subtotal', label: 'Subtotal', type: 'decimal', scale: 2, readOnly: true, listed: true },
      { name: 'criado_em', label: 'Criado em', type: 'datetime', readOnly: true },
    ],
  },
  {
    // Suporte › Visitas do Site (sino do topo): gravadas pelo widget.js (uma por aba do navegador; server/suporte.ts). Só leitura
    name: 'site_visitas',
    table: 'site_visitas',
    tenantColumn: 'empresa_id',
    scopeSql: 't.empresa_id = ?',
    label: 'Visitas do Site',
    labelSingular: 'Visita',
    description: 'Entradas no site com o widget de suporte: página, origem, cliente e dispositivo',
    icon: 'Globe',
    group: 'suporte',
    pk: ['id'],
    autoIncrement: true,
    labelField: 'pagina',
    defaultSort: { field: 'criado_em', dir: 'desc' },
    canCreate: false,
    canUpdate: false,
    canDelete: false,
    fields: [
      ID,
      { name: 'criado_em', label: 'Data/hora', type: 'datetime', listed: true, filterable: true, readOnly: true },
      // Última vez que a página saiu de vista (fechou, foi para outro site, trocou de aba); vazio = sem aviso do navegador
      // Enquanto a pessoa segue no site a saída fica no futuro (aviso de presença do widget): aí a coluna fica vazia
      { name: 'saida_em', label: 'Saída', type: 'datetime', listed: true, filterable: true, readOnly: true, sql: 'IF(t.saida_em > NOW(), NULL, t.saida_em)' },
      {
        name: 'tempo_site',
        label: 'Tempo no site',
        type: 'text',
        listed: true,
        readOnly: true,
        width: 'xs',
        // "Visitando...": a saída está no futuro (o widget avisa a cada minuto que a página segue à vista: /visitas/presente)
        sql: (() => {
          const s = 'TIMESTAMPDIFF(SECOND, t.criado_em, t.saida_em)';
          return `CASE WHEN t.saida_em > NOW() THEN 'Visitando...' WHEN t.saida_em IS NULL THEN NULL WHEN ${s} < 60 THEN CONCAT(${s}, ' s') WHEN ${s} < 3600 THEN CONCAT(${s} DIV 60, ' min')
                  ELSE CONCAT(${s} DIV 3600, ' h ', LPAD(${s} % 3600 DIV 60, 2, '0'), ' min') END`;
        })(),
      },
      { name: 'pagina', label: 'Página', type: 'text', listed: true, searchable: true, filterable: true, readOnly: true },
      { name: 'titulo', label: 'Título da página', type: 'text', searchable: true, readOnly: true },
      // Site de onde veio (Google, outro site...); vazio = digitou o endereço ou favorito
      { name: 'origem', label: 'Veio de', type: 'text', listed: true, searchable: true, filterable: true, readOnly: true },
      // CNPJ/CPF do widget (data-cnpj) ou do chat: liga a visita à Pessoa
      { name: 'pessoa_id', label: 'Cliente', type: 'text', listed: true, filterable: true, readOnly: true, ref: { resource: 'pessoas', labelField: 'nome' } },
      // Nome que o visitante informou no chat do suporte (nesta visita ou numa anterior, no mesmo navegador)
      { name: 'cliente_nome', label: 'Nome (chat)', type: 'text', listed: true, searchable: true, filterable: true, readOnly: true },
      { name: 'documento', label: 'CNPJ/CPF', type: 'text', searchable: true, filterable: true, readOnly: true },
      {
        name: 'dispositivo',
        label: 'Dispositivo',
        type: 'enum',
        listed: true,
        filterable: true,
        readOnly: true,
        width: 'sm',
        options: [
          { value: 'celular', label: 'Celular' },
          { value: 'computador', label: 'Computador' },
        ],
        sql: `IF(t.navegador LIKE '%Mobi%' OR t.navegador LIKE '%Android%', 'celular', 'computador')`,
      },
      { name: 'navegador', label: 'Navegador', type: 'text', searchable: true, readOnly: true },
      { name: 'ip', label: 'IP', type: 'text', listed: true, searchable: true, filterable: true, readOnly: true, width: 'sm' },
    ],
  },
  {
    name: 'chamado_categorias',
    table: 'chamado_categorias',
    tenantColumn: 'empresa_id',
    scopeSql: 't.empresa_id = ?',
    label: 'Categorias de Chamado',
    labelSingular: 'Categoria de Chamado',
    description: 'Tipos de chamado de suporte (Suporte técnico, Financeiro...) com o prazo de SLA em horas',
    icon: 'Tags',
    group: 'cadastros',
    pk: ['id'],
    autoIncrement: true,
    labelField: 'nome',
    optionsSql: `SELECT id AS value, CONCAT(nome, ' (', sla_horas, 'h)') AS label
                   FROM chamado_categorias WHERE empresa_id = ? AND ativo = 1 ORDER BY nome LIMIT 1000`,
    defaultSort: { field: 'nome', dir: 'asc' },
    canCreate: true,
    canUpdate: true,
    canDelete: true,
    fields: [
      ID,
      { name: 'nome', label: 'Nome', type: 'text', required: true, listed: true, searchable: true, maxLength: 80 },
      { name: 'sla_horas', label: 'SLA (horas)', type: 'number', required: true, listed: true, default: 24, width: 'xs', hint: 'Prazo para resolver, contado da abertura do chamado' },
      { name: 'cor', label: 'Cor', type: 'cor', listed: true, width: 'xs', hint: 'Etiqueta da categoria na fila' },
      { name: 'ativo', label: 'Ativo', type: 'boolean', listed: true, filterable: true, default: true, width: 'xs' },
      { name: 'criado_em', label: 'Criado em', type: 'datetime', readOnly: true },
    ],
  },
  {
    // Marketing › Leads: contatos que ainda não são clientes (server/leads.ts). Convertido some da lista
    // (vira pessoa: botão Converter ou ao abrir negócio, chamado, OS, proposta ou pedido)
    name: 'leads',
    table: 'leads',
    tenantColumn: 'empresa_id',
    scopeSql: 't.empresa_id = ? AND t.convertido_em IS NULL',
    label: 'Leads',
    labelSingular: 'Lead',
    description: 'Contatos que ainda não são clientes: da Prospecção, do WhatsApp e cadastrados à mão',
    icon: 'Target',
    group: 'marketing',
    pk: ['id'],
    autoIncrement: true,
    labelField: 'nome',
    optionsSql: 'SELECT id AS value, nome AS label FROM leads WHERE empresa_id = ? AND convertido_em IS NULL ORDER BY nome LIMIT 5000',
    defaultSort: { field: 'criado_em', dir: 'desc' },
    canCreate: true,
    canUpdate: true,
    canDelete: true,
    details: [{ resource: 'atividades', foreignKey: 'lead_id', label: 'Atividades' }],
    fields: [
      ID,
      { name: 'nome', label: 'Nome', type: 'text', required: true, listed: true, searchable: true, maxLength: 255, span: 3 },
      { name: 'origem', label: 'Origem', type: 'enum', required: true, listed: true, filterable: true, options: ORIGENS_LEAD, default: 'manual', width: 'xs', span: 1 },
      { name: 'contato', label: 'Contato', type: 'text', listed: true, searchable: true, maxLength: 150, hint: 'Com quem falar na empresa' },
      { name: 'whatsapp', label: 'WhatsApp', type: 'text', listed: true, searchable: true, maxLength: 30, hint: 'Com DDD. Usado nas campanhas (sem ele, vale o telefone)' },
      { name: 'telefone', label: 'Telefone', type: 'text', listed: true, searchable: true, maxLength: 30 },
      { name: 'email', label: 'E-mail', type: 'text', listed: true, searchable: true, maxLength: 255 },
      { name: 'cidade', label: 'Cidade', type: 'text', listed: true, searchable: true, filterable: true, maxLength: 100 },
      { name: 'uf', label: 'UF', type: 'text', listed: true, filterable: true, maxLength: 2, width: 'xs' },
      { name: 'segmento_id', label: 'Segmento', type: 'text', listed: true, filterable: true, ref: { resource: 'segmentos', labelField: 'nome' } },
      {
        name: 'nao_receber_campanhas',
        label: 'Não receber campanhas',
        type: 'boolean',
        filterable: true,
        default: false,
        hint: 'Fica fora de todas as campanhas. Marcado sozinho quando responde "SAIR" a uma campanha no WhatsApp',
      },
      { name: 'obs', label: 'Observação', type: 'textarea' },
      {
        name: 'prospeccao_busca_id',
        label: 'Busca da prospecção',
        type: 'text',
        readOnly: true,
        filterable: true,
        ref: { resource: 'prospeccao_buscas', labelField: 'termo' },
        hint: 'Busca da Prospecção que incluiu este lead',
      },
      { name: 'google_place_id', label: 'Google Place ID', type: 'text', readOnly: true, hint: 'Código no Google Maps, gravado pela Prospecção: evita incluir o mesmo lead de novo' },
      ...CRIADO_ATUALIZADO,
    ],
  },
  {
    // Buscas guardadas da Prospecção (server/prospeccao.ts): só para o combo "Busca da prospecção" de Pessoas
    name: 'prospeccao_buscas',
    table: 'prospeccao_buscas',
    tenantColumn: 'empresa_id',
    scopeSql: 't.empresa_id = ?',
    label: 'Buscas da Prospecção',
    labelSingular: 'Busca da Prospecção',
    description: 'Buscas feitas na Prospecção',
    icon: 'Radar',
    group: 'marketing',
    oculto: true,
    pk: ['id'],
    autoIncrement: true,
    labelField: 'termo',
    optionsSql: `SELECT id AS value, CONCAT(termo, ' – ', local, ' – ', DATE_FORMAT(criado_em, '%d/%m/%Y %H:%i')) AS label
                   FROM prospeccao_buscas WHERE empresa_id = ? ORDER BY id DESC LIMIT 1000`,
    defaultSort: { field: 'criado_em', dir: 'desc' },
    canCreate: false,
    canUpdate: false,
    canDelete: false,
    fields: [
      ID,
      { name: 'termo', label: 'Termo', type: 'text', listed: true, searchable: true },
      { name: 'local', label: 'Local', type: 'text', listed: true, searchable: true },
      { name: 'criado_em', label: 'Feita em', type: 'datetime', listed: true, readOnly: true },
    ],
  },
  {
    name: 'segmentos',
    table: 'segmentos',
    tenantColumn: 'empresa_id',
    scopeSql: 't.empresa_id = ?',
    label: 'Segmentos',
    labelSingular: 'Segmento',
    description: 'Segmentação das pessoas: grupos usados para filtrar e direcionar o atendimento',
    icon: 'Tags',
    group: 'cadastros',
    pk: ['id'],
    autoIncrement: true,
    labelField: 'nome',
    // Os inativos também vêm (senão a lista de pessoas mostraria "…" no lugar do nome),
    // marcados e no fim do combo
    optionsSql: `SELECT id AS value, CONCAT(nome, IF(ativo = 1, '', ' (inativo)')) AS label
                   FROM segmentos WHERE empresa_id = ? ORDER BY ativo DESC, nome LIMIT 1000`,
    defaultSort: { field: 'nome', dir: 'asc' },
    canCreate: true,
    canUpdate: true,
    canDelete: true,
    details: [{ resource: 'pessoas', foreignKey: 'segmento_id', label: 'Pessoas do Segmento' }],
    fields: [
      ID,
      { name: 'nome', label: 'Nome', type: 'text', required: true, listed: true, searchable: true, maxLength: 100 },
      { name: 'descricao', label: 'Descrição', type: 'text', listed: true, searchable: true, maxLength: 255, span: 3 },
      { name: 'ativo', label: 'Ativo', type: 'boolean', listed: true, filterable: true, default: true, width: 'xs' },
      ...CRIADO_ATUALIZADO,
    ],
  },
  {
    name: 'produtos',
    table: 'produtos',
    tenantColumn: 'empresa_id',
    scopeSql: 't.empresa_id = ?',
    label: 'Produtos',
    labelSingular: 'Produto',
    description: 'Catálogo de produtos e serviços com preço de tabela',
    icon: 'Package',
    group: 'cadastros',
    pk: ['id'],
    autoIncrement: true,
    labelField: 'nome',
    defaultSort: { field: 'grupo_id', dir: 'asc' }, // sem grupo no fim; no grupo, pelo nome
    canCreate: true,
    canUpdate: true,
    canDelete: true,
    fields: [
      ID,
      // Grupo é a 1ª coluna da lista
      {
        name: 'grupo_id',
        label: 'Grupo',
        type: 'text',
        listed: true,
        filterable: true,
        ref: { resource: 'produtos_grupos', labelField: 'nome' },
        hint: 'Na proposta/pedido impresso "resumido", os produtos do mesmo grupo saem numa linha só, com o nome do grupo e o valor somado',
      },
      { name: 'codigo_sku', label: 'SKU', type: 'text', listed: true, searchable: true, maxLength: 50, width: 'sm' },
      { name: 'nome', label: 'Nome', type: 'text', required: true, listed: true, searchable: true, maxLength: 255 },
      { name: 'nome_proposta', label: 'Nome na Proposta', type: 'text', searchable: true, maxLength: 255, hint: 'Preenchido: sai no lugar do Nome na proposta impressa, no PDF enviado e na página de aprovação do cliente' },
      { name: 'descricao', label: 'Descrição', type: 'textarea', searchable: true },
      { name: 'preco_tabela', label: 'Preço de Tabela', type: 'decimal', scale: 2, required: true, listed: true, filterable: true },
      { name: 'unidade_medida', label: 'Unidade', type: 'text', maxLength: 10, listed: true, default: 'UN', width: 'xs' },
      { name: 'ativo', label: 'Ativo', type: 'boolean', listed: true, filterable: true },
      { name: 'cod_integracao', label: 'Cód.Integração', type: 'text', readOnly: true, filterable: true, searchable: true, hint: 'Preenchido pela importação do bmsoft (PRODUTOSPRINCIPAL.ID)' },
      { name: 'fotos', label: 'Fotos', type: 'fotos', hint: 'Até 4 fotos, do computador ou da internet' },
      ...CRIADO_ATUALIZADO,
    ],
  },
  {
    // Cadastros › Serviços: o que se cobra na Ordem de Serviço
    name: 'servicos',
    table: 'servicos',
    tenantColumn: 'empresa_id',
    scopeSql: 't.empresa_id = ?',
    label: 'Serviços',
    labelSingular: 'Serviço',
    semDadosDoBanco: true,
    description: 'Serviços com preço, lançados nas ordens de serviço',
    icon: 'Hammer',
    group: 'cadastros',
    pk: ['id'],
    autoIncrement: true,
    labelField: 'nome',
    // Inativos continuam no combo (OS antiga com o serviço), marcados
    optionsSql: `SELECT id AS value, CONCAT(nome, IF(ativo = 1, '', ' (inativo)')) AS label
                   FROM servicos WHERE empresa_id = ? ORDER BY ativo DESC, nome LIMIT 5000`,
    defaultSort: { field: 'nome', dir: 'asc' },
    canCreate: true,
    canUpdate: true,
    canDelete: true,
    fields: [
      ID,
      { name: 'codigo', label: 'Código', type: 'text', listed: true, searchable: true, maxLength: 50, width: 'sm' },
      { name: 'nome', label: 'Nome', type: 'text', required: true, listed: true, searchable: true, maxLength: 255 },
      { name: 'unidade', label: 'Unidade', type: 'text', required: true, listed: true, maxLength: 10, default: 'UN', width: 'xs', hint: 'Ex.: UN, HR, VISITA' },
      { name: 'preco', label: 'Preço', type: 'decimal', scale: 2, required: true, listed: true, filterable: true },
      { name: 'descricao', label: 'Descrição', type: 'textarea', searchable: true },
      { name: 'ativo', label: 'Ativo', type: 'boolean', listed: true, filterable: true, default: true },
      ...CRIADO_ATUALIZADO,
    ],
  },
  {
    // Condições de pagamento: os prazos geram as parcelas da proposta (vencimento, forma e valor)
    name: 'condicoes_pagamento',
    table: 'condicoes_pagamento',
    tenantColumn: 'empresa_id',
    scopeSql: 't.empresa_id = ?',
    label: 'Condições de Pagamento',
    labelSingular: 'Condição de Pagamento',
    description: 'Prazos e forma de pagamento: na proposta, geram as parcelas com vencimento e valor',
    icon: 'CreditCard',
    group: 'cadastros',
    pk: ['id'],
    autoIncrement: true,
    labelField: 'nome',
    defaultSort: { field: 'nome', dir: 'asc' },
    canCreate: true,
    canUpdate: true,
    canDelete: true,
    fields: [
      ID,
      { name: 'nome', label: 'Nome', type: 'text', required: true, listed: true, searchable: true, maxLength: 100, hint: 'Como aparece na proposta (ex.: Entrada + 30/60 dias)' },
      {
        name: 'prazos',
        label: 'Prazos (dias)',
        type: 'text',
        required: true,
        listed: true,
        maxLength: 100,
        placeholder: '0/30/60',
        hint: 'Dias de cada parcela a partir da data da proposta, separados por "/": 0 = à vista; 30/60/90 = três parcelas',
      },
      { name: 'forma_pagamento', label: 'Forma de Pagamento', type: 'enum', required: true, listed: true, filterable: true, options: FORMAS_PAGAMENTO.map((f) => ({ value: f, label: f })), default: 'Boleto', hint: 'Forma padrão das parcelas (pode ser trocada em cada parcela na proposta)' },
      { name: 'ativo', label: 'Ativo', type: 'boolean', listed: true, filterable: true, default: true, width: 'xs' },
      ...CRIADO_ATUALIZADO,
    ],
  },
  {
    // Grupo de produtos: na impressão resumida da proposta/pedido, os itens do grupo saem numa linha só
    name: 'produtos_grupos',
    table: 'produtos_grupos',
    tenantColumn: 'empresa_id',
    scopeSql: 't.empresa_id = ?',
    label: 'Grupos de Produtos',
    labelSingular: 'Grupo de Produtos',
    description: 'Agrupam os produtos na impressão resumida da proposta e do pedido (ex.: LICENÇA BMSOFT, MENSALIDADE BMSOFT)',
    icon: 'Layers',
    group: 'cadastros',
    pk: ['id'],
    autoIncrement: true,
    labelField: 'nome',
    defaultSort: { field: 'nome', dir: 'asc' },
    canCreate: true,
    canUpdate: true,
    canDelete: true,
    details: [{ resource: 'produtos', foreignKey: 'grupo_id', label: 'Produtos do Grupo' }],
    fields: [
      ID,
      { name: 'nome', label: 'Nome', type: 'text', required: true, listed: true, searchable: true, maxLength: 100, hint: 'Como sai na proposta/pedido resumido' },
      ...CRIADO_ATUALIZADO,
    ],
  },
  {
    name: 'funis',
    table: 'funis',
    tenantColumn: 'empresa_id',
    scopeSql: 't.empresa_id = ?',
    label: 'Funis de Vendas',
    labelSingular: 'Funil',
    description: 'Pipelines de vendas',
    icon: 'Filter',
    group: 'cadastros',
    pk: ['id'],
    autoIncrement: true,
    labelField: 'nome',
    defaultSort: { field: 'ordem', dir: 'asc' },
    canCreate: true,
    canUpdate: true,
    canDelete: true,
    // Etapas não têm menu próprio: são mantidas aqui, no detalhe do funil
    details: [{ resource: 'etapas', foreignKey: 'funil_id', label: 'Etapas', editavel: true }],
    fields: [
      ID,
      { name: 'nome', label: 'Nome', type: 'text', required: true, listed: true, searchable: true, maxLength: 100 },
      { name: 'ordem', label: 'Ordem', type: 'number', listed: true, width: 'xs' },
      { name: 'ativo', label: 'Ativo', type: 'boolean', listed: true, filterable: true },
      ...CRIADO_ATUALIZADO,
    ],
  },
  {
    name: 'etapas',
    table: 'etapas',
    scopeSql: 't.funil_id IN (SELECT id FROM funis WHERE empresa_id = ?)',
    label: 'Etapas do Funil',
    labelSingular: 'Etapa',
    description: 'Colunas do Kanban de cada funil',
    icon: 'Columns3',
    group: 'cadastros',
    oculto: true,
    pk: ['id'],
    autoIncrement: true,
    labelField: 'nome',
    optionsSql:
      "SELECT e.id AS value, CONCAT(f.nome, ' › ', e.nome) AS label FROM etapas e JOIN funis f ON f.id = e.funil_id WHERE f.empresa_id = ? ORDER BY f.ordem, f.nome, e.ordem LIMIT 1000",
    defaultSort: { field: 'ordem', dir: 'asc' },
    canCreate: true,
    canUpdate: true,
    canDelete: true,
    fields: [
      ID,
      { name: 'funil_id', label: 'Funil', type: 'text', required: true, listed: true, filterable: true, ref: { resource: 'funis', labelField: 'nome' } },
      { name: 'nome', label: 'Nome', type: 'text', required: true, listed: true, searchable: true, maxLength: 100 },
      { name: 'ordem', label: 'Ordem', type: 'number', listed: true, width: 'xs' },
      { name: 'probabilidade', label: 'Probabilidade (%)', type: 'decimal', scale: 2, listed: true, default: '100.00' },
      { name: 'cor', label: 'Cor', type: 'cor', listed: true, width: 'xs', hint: 'Faixa no topo da coluna do Kanban' },
      ...CRIADO_ATUALIZADO,
    ],
  },

  // ============================================================
  // MARKETING (campanhas: server/campanhas.ts)
  // ============================================================
  {
    name: 'campanhas',
    table: 'campanhas',
    tenantColumn: 'empresa_id',
    scopeSql: 't.empresa_id = ? AND t.excluida_em IS NULL',
    exclusaoLogica: 'excluida_em',
    label: 'Campanhas',
    labelSingular: 'Campanha',
    description: 'Público por critérios, mensagem personalizada e disparos: outro público ou outro texto, outra campanha',
    icon: 'Megaphone',
    group: 'marketing',
    pk: ['id'],
    autoIncrement: true,
    labelField: 'nome',
    defaultSort: { field: 'id', dir: 'desc' },
    canCreate: true,
    canUpdate: true,
    canDelete: true,
    details: [{ resource: 'campanha_disparos', foreignKey: 'campanha_id', label: 'Disparos' }],
    fields: [
      ID,
      { name: 'nome', label: 'Nome', type: 'text', required: true, listed: true, searchable: true, maxLength: 150 },
      { name: 'objetivo', label: 'Objetivo', type: 'enum', required: true, listed: true, filterable: true, options: OBJETIVOS_CAMPANHA, default: 'conversao' },
      {
        name: 'canal',
        label: 'Enviar por',
        type: 'enum',
        required: true,
        listed: true,
        filterable: true,
        options: CANAIS_CAMPANHA,
        default: 'whatsapp',
        hint: 'Multicanal: WhatsApp para quem tem celular, e-mail para os demais',
      },
      { name: 'situacao', label: 'Situação', type: 'enum', required: true, listed: true, filterable: true, options: SITUACOES_CAMPANHA, default: 'rascunho' },
      { name: 'criterios', label: 'Público (critérios)', type: 'criterios', required: true, hint: 'A pessoa entra no público quando atende a todos os critérios' },
      { name: 'publico_estimado', label: 'Público', type: 'number', readOnly: true, listed: true, width: 'xs', hint: 'Pessoas que atendem aos critérios (recalculado ao gravar e ao gerar os disparos)' },
      { name: 'assunto', label: 'Assunto', type: 'text', maxLength: 255, hint: 'Do e-mail; no WhatsApp vai em negrito no começo da mensagem' },
      {
        name: 'mensagem',
        label: 'Mensagem',
        type: 'textarea',
        searchable: true,
        hint: 'Variáveis: {{nome}}, {{primeiro_nome}}, {{email}}, {{telefone}}, {{cidade}}, {{ultima_compra}}, {{empresa}}',
      },
      {
        name: 'instrucoes_ia',
        label: 'Instruções para a IA',
        type: 'textarea',
        hint: 'Quem responder a esta campanha no WhatsApp das campanhas é atendido pela Automação das campanhas: a IA recebe a mensagem enviada e este texto (o que explicar, preços, condições, perguntas frequentes)',
      },
      {
        name: 'imagem',
        label: 'Imagem',
        type: 'imagem',
        imagemOriginal: true,
        hint: 'Opcional (PNG, JPEG ou WebP): vai no tamanho original até ~1,3 MB; maior que isso, é reduzida para 1600 px. No WhatsApp vai com a mensagem de legenda; no e-mail, como anexo',
      },
      {
        name: 'enviar_a_partir_de',
        label: 'Enviar a partir de',
        type: 'datetime',
        listed: true,
        hint: 'Em branco: o envio começa assim que os disparos forem gerados',
      },
      { name: 'descricao', label: 'Descrição', type: 'textarea', searchable: true },
      {
        name: 'qtd_disparos',
        label: 'Disparos',
        type: 'number',
        readOnly: true,
        listed: true,
        width: 'xs',
        sql: '(SELECT COUNT(*) FROM campanha_disparos d WHERE d.campanha_id = t.id)',
      },
      {
        name: 'qtd_pendentes',
        label: 'Pendentes',
        type: 'number',
        readOnly: true,
        listed: true,
        width: 'xs',
        sql: "(SELECT COUNT(*) FROM campanha_disparos d WHERE d.campanha_id = t.id AND d.situacao = 'pendente')",
      },
      {
        name: 'qtd_enviados',
        label: 'Enviados',
        type: 'number',
        readOnly: true,
        listed: true,
        width: 'xs',
        sql: "(SELECT COUNT(*) FROM campanha_disparos d WHERE d.campanha_id = t.id AND d.situacao IN ('enviado', 'entregue', 'lido'))",
      },
      {
        name: 'qtd_responderam',
        label: 'Responderam',
        type: 'number',
        readOnly: true,
        listed: true,
        width: 'xs',
        sql: '(SELECT COUNT(*) FROM campanha_disparos d WHERE d.campanha_id = t.id AND d.respondido_em IS NOT NULL)',
      },
      {
        name: 'qtd_leads',
        label: 'Leads',
        type: 'number',
        readOnly: true,
        listed: true,
        width: 'xs',
        sql: "(SELECT COUNT(*) FROM negocios n WHERE n.campanha_id = t.id AND n.status <> 'excluido')",
      },
      { name: 'iniciada_em', label: 'Iniciada em', type: 'datetime', readOnly: true, listed: true, filterable: true },
      { name: 'encerrada_em', label: 'Encerrada em', type: 'datetime', readOnly: true, listed: true },
      { name: 'criada_por', label: 'Criada por', type: 'text', readOnly: true, ref: { resource: 'usuarios', labelField: 'nome' } },
      { name: 'criada_em', label: 'Criada em', type: 'datetime', readOnly: true },
      { name: 'atualizada_em', label: 'Atualizada em', type: 'datetime', readOnly: true },
    ],
  },
  {
    // Vendas de produtos vindas do ERP (uma linha por produto de cada NF): base para campanhas e análises
    name: 'vendas_produtos',
    table: 'vendas_produtos',
    tenantColumn: 'empresa_id',
    scopeSql: 't.empresa_id = ?',
    label: 'Vendas',
    labelSingular: 'Venda',
    description: 'Produtos vendidos (do ERP): nota, cliente, produto, quantidade, preço e custo',
    icon: 'Receipt',
    group: 'marketing',
    pk: ['id'],
    autoIncrement: true,
    labelField: 'pro_descricao',
    defaultSort: { field: 'nf_data', dir: 'desc' },
    canCreate: true,
    canUpdate: true,
    canDelete: true,
    fields: [
      ID,
      { name: 'nf_data', label: 'Data', type: 'date', required: true, listed: true, filterable: true },
      { name: 'nf_numero', label: 'Nº da NF', type: 'text', listed: true, searchable: true, filterable: true, maxLength: 20, hint: 'Número da NF ou de outro documento de venda' },
      { name: 'cod_integracao', label: 'Cód. integração (NF)', type: 'text', searchable: true, filterable: true, maxLength: 50, hint: 'ID da NF no ERP' },
      { name: 'nf_cfop', label: 'CFOP', type: 'text', listed: true, filterable: true, maxLength: 5, width: 'xs' },
      { name: 'cli_cnpj', label: 'CNPJ/CPF', type: 'cnpj', listed: true, searchable: true, filterable: true },
      { name: 'cli_nome', label: 'Cliente (NF)', type: 'text', listed: true, searchable: true, filterable: true, maxLength: 50, hint: 'Nome do cliente na nota' },
      {
        name: 'cliente',
        label: 'Cliente',
        type: 'text',
        listed: true,
        readOnly: true,
        // A Pessoa do CRM com o mesmo CNPJ/CPF (vazio se o cliente não está cadastrado)
        // COLLATE: a vendas_produtos foi criada com utf8mb4_0900_ai_ci e pessoas é utf8mb4_unicode_ci
        sql: "(SELECT p.nome FROM pessoas p WHERE p.empresa_id = t.empresa_id AND p.cpf = t.cli_cnpj COLLATE utf8mb4_unicode_ci AND t.cli_cnpj <> '' ORDER BY p.id LIMIT 1)",
      },
      { name: 'cli_cidade', label: 'Cidade', type: 'text', listed: true, searchable: true, filterable: true, maxLength: 50 },
      { name: 'cli_uf', label: 'UF', type: 'text', listed: true, filterable: true, maxLength: 2, width: 'xs', default: 'SC' },
      { name: 'cli_bairro', label: 'Bairro', type: 'text', searchable: true, filterable: true, maxLength: 50 },
      { name: 'nf_valor_total', label: 'Total da NF', type: 'decimal', scale: 2 },
      { name: 'ven_nome', label: 'Vendedor', type: 'text', listed: true, searchable: true, filterable: true, maxLength: 50 },
      { name: 'ven_cod_integracao', label: 'Cód. integração (vendedor)', type: 'text', searchable: true, filterable: true, maxLength: 50, hint: 'ID do vendedor no ERP' },
      { name: 'pro_cod_integracao', label: 'Cód. integração (produto)', type: 'text', searchable: true, filterable: true, maxLength: 50, hint: 'ID do produto no ERP' },
      { name: 'pro_descricao', label: 'Produto', type: 'text', required: true, listed: true, searchable: true, filterable: true, maxLength: 255, span: 2 },
      { name: 'pro_marca', label: 'Marca', type: 'text', listed: true, searchable: true, filterable: true, maxLength: 50 },
      { name: 'pro_classe', label: 'Classe', type: 'text', listed: true, searchable: true, filterable: true, maxLength: 50 },
      { name: 'pro_classe_descricao', label: 'Descrição da classe', type: 'text', listed: true, searchable: true, filterable: true, maxLength: 50 },
      { name: 'pro_qtdade', label: 'Quantidade', type: 'decimal', scale: 3, listed: true },
      { name: 'pro_un', label: 'Un.', type: 'text', listed: true, maxLength: 3, width: 'xs' },
      { name: 'pro_preco_venda', label: 'Preço de venda', type: 'decimal', scale: 2, listed: true },
      { name: 'pro_valor_total', label: 'Total do produto', type: 'decimal', scale: 2, listed: true },
      { name: 'pro_custo_unit', label: 'Custo unitário', type: 'decimal', scale: 2 },
      // char(1) 'S'/'N' no banco (como no bmsoft)
      { name: 'cancelado', label: 'Cancelado', type: 'boolean', listed: true, filterable: true, width: 'xs', simNao: true, sql: "IF(t.cancelado = 'S', 1, 0)" },
    ],
  },
  {
    // Gerados pelo "Gerar disparos" da campanha (server/campanhas.ts), já com destino e texto personalizados;
    // a situação muda pelo envio (WhatsApp: server/whatsapp.ts; e-mail: server/campanhas.ts)
    name: 'campanha_disparos',
    table: 'campanha_disparos',
    scopeSql: 't.campanha_id IN (SELECT id FROM campanhas WHERE empresa_id = ? AND excluida_em IS NULL)',
    label: 'Disparos',
    labelSingular: 'Disparo',
    description: 'Mensagens das campanhas, uma por pessoa, com o destino e a situação do envio',
    icon: 'Send',
    group: 'marketing',
    pk: ['id'],
    autoIncrement: true,
    labelField: 'nome',
    defaultSort: { field: 'id', dir: 'desc' },
    canCreate: false,
    canUpdate: false,
    canDelete: false,
    fields: [
      ID,
      { name: 'campanha_id', label: 'Campanha', type: 'text', listed: true, filterable: true, ref: { resource: 'campanhas', labelField: 'nome' } },
      { name: 'pessoa_id', label: 'Pessoa', type: 'number' },
      { name: 'nome', label: 'Cliente', type: 'text', listed: true, searchable: true },
      { name: 'canal', label: 'Enviar por', type: 'enum', listed: true, filterable: true, options: CANAIS_DISPARO, width: 'xs' },
      { name: 'destino', label: 'Celular / e-mail', type: 'text', listed: true, searchable: true },
      { name: 'situacao', label: 'Situação', type: 'enum', listed: true, filterable: true, options: SITUACOES_DISPARO },
      { name: 'agendado_para', label: 'Agendado para', type: 'datetime', listed: true, filterable: true },
      { name: 'enviado_em', label: 'Enviado em', type: 'datetime', listed: true },
      { name: 'entregue_em', label: 'Entregue em', type: 'datetime' },
      { name: 'lido_em', label: 'Lido em', type: 'datetime', listed: true },
      { name: 'respondido_em', label: 'Respondeu em', type: 'datetime', listed: true, filterable: true },
      { name: 'erro', label: 'Erro', type: 'text', listed: true },
      { name: 'assunto', label: 'Assunto', type: 'text' },
      { name: 'mensagem', label: 'Mensagem', type: 'textarea' },
    ],
  },

  // ============================================================
  // ACESSO
  // ============================================================
  {
    name: 'usuarios',
    table: 'usuarios',
    tenantColumn: 'empresa_id',
    scopeSql: 't.empresa_id = ?',
    label: 'Usuários',
    labelSingular: 'Usuário',
    description: 'Quem acessa o CRM',
    icon: 'KeyRound',
    group: 'acesso',
    pk: ['id'],
    autoIncrement: true,
    labelField: 'nome',
    // Combos de proprietário/envolvidos: os inativos vêm marcados e no fim, para as
    // listas continuarem mostrando o nome de quem saiu
    optionsSql: `SELECT id AS value, CONCAT(nome, IF(ativo = 1, '', ' (inativo)')) AS label
                   FROM usuarios WHERE empresa_id = ? ORDER BY ativo DESC, nome LIMIT 1000`,
    defaultSort: { field: 'nome', dir: 'asc' },
    canCreate: true,
    canUpdate: true,
    canDelete: true,
    fields: [
      { name: 'id', label: 'ID', type: 'number', readOnly: true, listed: true, width: 'xs' },
      { name: 'nome', label: 'Nome', type: 'text', required: true, listed: true, searchable: true, maxLength: 150 },
      { name: 'email', label: 'E-mail', type: 'text', required: true, listed: true, searchable: true, maxLength: 150 },
      { name: 'telefone', label: 'WhatsApp', type: 'text', listed: true, maxLength: 20, hint: 'Com DDD: recebe os lembretes das atividades dos negócios dele' },
      { name: 'senha_hash', label: 'Senha', type: 'password', hint: 'Em branco na inclusão: a senha é definida no primeiro acesso' },
      { name: 'cargo', label: 'Cargo', type: 'text', listed: true, maxLength: 80 },
      { name: 'departamento_id', label: 'Departamento', type: 'text', listed: true, filterable: true, ref: { resource: 'departamentos', labelField: 'nome' } },
      { name: 'tipo', label: 'Perfil', type: 'enum', required: true, listed: true, filterable: true, options: PERFIS, default: 'client', hint: 'Administrador acessa tudo; os demais, o que estiver liberado em Permissões' },
      {
        name: 'revezamento',
        label: 'Entra no revezamento de leads',
        type: 'boolean',
        listed: true,
        filterable: true,
        default: false,
        hint: 'Leads novos da automação vão, um de cada vez, para quem tem isto ligado',
      },
      { name: 'ativo', label: 'Ativo', type: 'boolean', listed: true, filterable: true },
      { name: 'created_at', label: 'Criado em', type: 'datetime', readOnly: true },
    ],
  },
];

export const RESOURCE_MAP: Record<string, ResourceDef> = Object.fromEntries(
  RESOURCES.map((r) => [r.name, r]),
);

export function getResource(name: string): ResourceDef | null {
  return Object.prototype.hasOwnProperty.call(RESOURCE_MAP, name) ? RESOURCE_MAP[name] : null;
}

/** Colunas graváveis: exclui readOnly, a PK e a coluna do tenant (esta vem da sessão) */
export function writableFields(resource: ResourceDef): FieldDef[] {
  return resource.fields.filter((f) => !f.readOnly && !resource.pk.includes(f.name) && f.name !== resource.tenantColumn);
}

/** Expressão SQL da coluna: a própria coluna da tabela ou a expressão da coluna calculada */
export function colunaSql(resource: ResourceDef, nome: string): string {
  return resource.fields.find((f) => f.name === nome)?.sql ?? `t.${nome}`;
}

/** Todas as colunas conhecidas — whitelist de ordenação e filtros */
export function columnNames(resource: ResourceDef): string[] {
  return resource.fields.map((f) => f.name);
}
