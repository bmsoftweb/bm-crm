# CRM Web

CRM no estilo Pipedrive com ciclo comercial completo: **funil em Kanban → follow-ups →
proposta versionada → pedido de venda**. Mesma stack, layout, tema e padrões de tela do
b2b-admin (`d:\projetos\b2bweb\admin\code`): Express + Vite + React 19 + Tailwind 4 + mysql2.

## Como rodar

```bash
npm install
npm run dev
```

Sobe em <http://localhost:3000> (`PORT` muda a porta). Build de produção: `npm run build` e `npm start`.

Copie `.env.example` para `.env`. Sem `MYSQL_*`, usa o servidor BMSoft, banco `crmweb`.
Defina `SESSION_SECRET` para as sessões sobreviverem a um reinício do servidor.

## Banco

O script do banco é `extras/crmweb_schema.sql`: todas as chaves primárias são
`INT AUTO_INCREMENT` e quem numera é o MySQL (o servidor nunca gera id). Ele recria as
12 tabelas do CRM e **não apaga `usuarios`** — o login é preservado.

```bash
mysql -h 45.224.130.145 -u bmsoftadm -p crmweb < extras/crmweb_schema.sql
```

`numero_proposta` e `numero_pedido` são o número que o cliente vê: sequência por empresa
atribuída pelo servidor na inclusão, independente do id.

## Login

E-mail (ou nome) + senha da tabela `usuarios`. Senha em branco no banco = primeiro acesso:
a senha digitada é gravada em bcrypt. O servidor devolve um token assinado (HMAC, 30 dias)
exigido em toda rota `/api`. A tela **Usuários** só aparece e só responde para `tipo = 'admin'`.

**Lembrar neste dispositivo**: guarda a sessão, o e-mail e a **senha** no `localStorage`
deste navegador (a senha em base64, que não é criptografia — quem tem acesso à máquina
consegue ler). O link **Limpar**, ao lado da opção, apaga tudo o que ficou guardado.

## Módulos

| Módulo | Onde | O que faz |
| --- | --- | --- |
| Kanban de vendas | Funil de Vendas | Colunas por etapa com total e contagem; arrastar entre etapas; soltar em **Ganho**/**Perdido** (pede motivo); semáforo de follow-up (verde em dia, vermelho atrasado, amarelo sem atividade); concluir a próxima atividade no próprio card |
| Follow-ups e timeline | Ficha do negócio | Agendar atividade (modal), concluir/reabrir, histórico de notas/ligações/e-mails/WhatsApp/reuniões. `data_ultimo_contato` e `data_proximo_followup` são recalculados pelo servidor a cada gravação |
| Propostas | Ficha › Propostas, ou menu Propostas | Itens do catálogo com pesquisa, quantidade × preço − desconto, desconto adicional, versões v1, v2… por negócio; **Aprovar Proposta e Gerar Pedido** marca a proposta como aceita e clona os itens num pedido |
| Pedidos | Ficha › Pedidos, ou menu Pedidos de Venda | Digitação com condição de pagamento, status, observações e vínculo com proposta de origem e negócio. Faturado/cancelado: só o status muda. Proposta e pedido têm **Imprimir / PDF** (página A4 pelo diálogo de impressão do navegador) |

Cadastros (Minha Empresa, Pessoas, Segmentos, Produtos, Funis, Etapas, Usuários), Atividades e
Histórico usam as telas genéricas de CRUD dirigidas por metadados, iguais às do b2b-admin.

**Segmentos** agrupam as pessoas (`pessoas.segmento_id`): o combo do cadastro só oferece os
ativos, a lista filtra por segmento na busca avançada e excluir um segmento desvincula as
pessoas sem apagá-las (`ON DELETE SET NULL`).

### Configurações

Tela **Configurações** (menu Sistema), com uma aba por grupo, no formato do
meuConsultorioWeb. Cada aba grava na tabela `config` (`empresa_id + grupo + chave`,
valor em JSON) e só administradores alteram.

| Grupo | Chave | O que faz |
| --- | --- | --- |
| pessoas | campos_personalizados | Campos extras do cadastro de pessoas: rótulo, tipo (texto, texto longo, inteiro, decimal, data, sim/não, lista), opções da lista, obrigatório e ordem — como a personalização de clientes do pedWeb |

O `nome` (chave gravada no registro) é gerado do rótulo na primeira gravação e não
muda depois, para não perder o que já foi preenchido.

Os campos configurados entram no formulário de Pessoas como campos normais: cada um
com o controle do seu tipo e sujeitos a mover, redimensionar e "Salvar Configuração",
como os campos fixos. Os valores vão para `pessoas.personalizados` num JSON
`{ nome_do_campo: valor }`.

Com **Na lista** marcado, o campo também vira coluna na listagem (valor lido de dentro
do JSON). Essas colunas não ordenam nem entram na busca, porque não são colunas do
MySQL, e são controladas só pela configuração — não pelo "Salvar Configuração" da lista.

### Proprietário e envolvidos (negócios)

`negocios.proprietario_id` é o dono do negócio; na inclusão sem escolha, fica quem criou. Os outros
usuários envolvidos ficam em `negocios_participantes` e são editados no formulário do negócio
(seção *Envolvidos*), gravados junto no **Salvar** (`server/participantes.ts`, mesmo esquema dos
endereços). A ficha mostra proprietário e envolvidos; o card do Kanban, as iniciais do proprietário.
Na lista de negócios há a coluna Proprietário (filtrável) e a coluna calculada *Envolvidos*
(desligada por padrão; ligue no menu ☰ › Colunas). Usuários inativos aparecem como "(inativo)".

### Endereços (pessoas)

Tabela `pessoas_enderecos`: vários endereços por pessoa, um **principal**. São editados no próprio
cadastro da pessoa (seção *Endereços*) e gravados junto no **Salvar**: o formulário manda a lista
completa em `enderecos` e o servidor sincroniza (`server/enderecos.ts`: sai o removido, atualiza o
que tem id, inclui o resto). O CEP busca logradouro, bairro, cidade, UF e código IBGE no ViaCEP.
Na lista de pessoas, o painel de detalhe tem a aba *Endereços* (somente leitura).
A coluna **Cidade/UF** da lista vem do endereço principal: é uma coluna calculada (`sql` no
FieldDef, em `server/schema.ts`), que ordena, busca e filtra mas não é gravada. As colunas da lista
podem ser ligadas/desligadas no menu ☰ do cabeçalho (*Colunas*) e gravadas em *Salvar Configuração*.

### Importar (arquivo)

Na lista de **Pessoas**, o botão **Importar** abre um assistente em 4 etapas: **Arquivo**
(`.xls`, `.xlsx`, `.ods`, `.csv`, `.txt` ou `.pdf`), **Formato** (opções conforme o tipo, com prévia),
**De → para** (colunas do arquivo → campos do CRM, sugerido pelos nomes) e **Importar**.

- CSV/TXT: separador (detectado), codificação (UTF-8 ou Windows, detectada), aspas, cabeçalho.
- Excel: aba da planilha, cabeçalho, linhas a ignorar.
- PDF (relatório com texto, não digitalizado): as colunas vêm da linha de cabeçalho (achada
  sozinha); cabeçalhos repetidos, rodapés e totais saem pelo "mínimo de colunas preenchidas".

O arquivo é lido no navegador; o servidor (`POST /api/importar/pessoas`, lotes de até 2.000
linhas) recebe só os campos. Chave: código do arquivo → `cod_integracao` `ARQ-<código>`; sem
código, o CPF/CNPJ. Célula vazia não apaga dado existente. Entram sempre como **cliente**.
**Segmento** vem pelo nome (sem diferença de maiúsculas/acentos); opção de criar os que não
existirem. **Campos personalizados** entram convertidos para o tipo do campo (número 1.234,56,
data dd/mm/aaaa, Sim/Não/S/N/1/0/X, opção da lista); valor inválido fica em branco e aparece com
⚠ na prévia. Na atualização os personalizados são mesclados (`JSON_MERGE_PATCH`).
Cada campo do de → para tem um **Padrão**: completa as **pessoas novas** quando o campo não tem
coluna ou a célula está vazia. Quem já existe não é alterado pelo padrão.
**Endereço principal** (CEP, logradouro, número, complemento, bairro, cidade, UF — sigla ou nome
do estado): na pessoa nova vira o endereço principal; em quem já existe completa o principal
(ou cria um). CEP/UF inválidos ficam em branco; trocar a cidade limpa o código IBGE.
Teste do leitor: `npx tsx src/utils/importarArquivo.test.ts`.

### Importar BM (pessoas)

Na lista de **Pessoas**, ao lado de *Novo*, o botão **Importar BM** traz a tabela `PESSOAS` do
bmsoft (base DBISAM) pela bmAPI. O modal pede só o **número do servidor**: URL, porta e token
(`X-API-Key`) vêm da tabela MySQL `bmapi.servidores` e nunca chegam ao navegador.

Chave: `bmsoft PESSOAS.ID` → `crmweb pessoas.cod_integracao`, dentro da empresa logada. De → para:
`Nome` → nome, `Email` → e-mail, `Fone1`/`Celular`/`Fone2` → telefone, `CPFCNPJ` → cpf (só dígitos),
`Obs` → observação. Quem vem de outro sistema entra como **cliente** (`tipo = 'cliente'`);
lead é quem nasce aqui no CRM. Só entram as pessoas ativas (`Ativo = 'S'`); quem já foi
importado é atualizado, o resto é incluído, então dá para reimportar quantas vezes quiser.

### Prospecção

Tela **Prospecção** (menu Marketing, `server/prospeccao.ts`). Busca empresas no Google Maps pela
**Google Places API (New)**, a API oficial (nada de raspar a busca do Google, que os termos proíbem):
"o que procurar" + "cidade ou região", até 60 empresas por busca. Saem as fechadas e as que não
passam nos filtros (nota mínima, avaliações mínimas, só com site, só com celular). Com **Ler os sites**,
o servidor abre a página inicial de cada empresa (só endereços públicos, 6 s e 600 KB no máximo) e
pega o celular do link do WhatsApp (`wa.me`), o e-mail e o Instagram.

Nota de qualificação (0 a 100): WhatsApp no site 35 ou celular 30; nota no Google ≥ 4,5 → 20, ≥ 4 → 12;
avaliações ≥ 100 → 20, ≥ 30 → 12; site 15; e-mail 10. Quem já está no CRM (pelo `cod_integracao`
`GP-<id do Google>` ou pelo telefone) aparece marcado e não é incluído de novo. **Incluir como lead**
grava a pessoa (`tipo = 'lead'`) com WhatsApp, telefone, e-mail, segmento opcional, endereço principal e
os dados do Google na observação. A busca em si não grava nada.

Chave: **Configurações › Prospecção** (cifrada) ou `GOOGLE_PLACES_API_KEY` no `.env`. O Google cobra
cada busca (telefone e avaliações são campos da faixa Enterprise). Teste:
`npx tsx server/prospeccao.test.ts` (com as variáveis `MYSQL_*` definidas).

## Arquitetura

```
server.ts           login, token de sessão, preferências de listas, Vite/SPA
server/schema.ts    metadados das tabelas (fonte de verdade das telas genéricas)
server/crud.ts      CRUD genérico (chaves INT AUTO_INCREMENT do MySQL)
server/regras.ts    regras pós-gravação: follow-up do negócio, datas de ganho/perda, concluída em
server/crm.ts       Kanban, ficha do negócio, propostas, pedidos, painel
server/config.ts    configurações da empresa (tabela config: empresa + grupo + chave)
server/importbm.ts  importação das pessoas do bmsoft pela bmAPI
server/prospeccao.ts busca de leads no Google Maps (Places API) e inclusão em Pessoas
server/totais.ts    cálculo dos totais de proposta/pedido (teste: npx tsx server/totais.test.ts)
src/components/     Kanban, NegocioFicha, DocumentoEditor, AtividadeModal, Dashboard + telas genéricas
```

Os totais de proposta e pedido são sempre recalculados no servidor; a tela só mostra a prévia.
A conexão MySQL usa `time_zone = '-03:00'` (horário de Brasília).

## Multi-tenant

A empresa de trabalho é a do cadastro do usuário (`usuarios.empresa_id` → `empresas.id`).
O servidor a relê a cada requisição a partir do token (nunca vem do navegador) e:

- filtra toda consulta pelo `scopeSql` do recurso (`server/schema.ts`): `empresa_id = ?` nas tabelas
  com a coluna; etapas pelo funil; itens pela proposta/pedido; `empresas` pelo próprio id;
- grava `empresa_id` sozinho nas inclusões (o campo não aparece nos formulários);
- recusa vínculos (contato, negócio, etapa, produto...) que apontem para registro de outra empresa.

A tela **Minha Empresa** só permite editar. Na impressão, a empresa aparece como fornecedora e o
contato como cliente.
