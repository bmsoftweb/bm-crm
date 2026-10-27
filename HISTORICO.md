# Histórico de versões

Mais recente primeiro. PATCH a cada envio ao GitHub; MAJOR/MINOR só quando pedido.

## 0.0.185 — 2026-10-27

- Listas: arrastar a borda de uma coluna muda só aquela coluna, também depois do "Ajustar largura" (antes a coluna vizinha compensava e as outras encolhiam um pouco); passando da tela, a lista rola para o lado.
- Listas: "Melhor largura" volta a encolher as colunas pelo conteúdo depois do "Ajustar largura".
- Painel de detalhamento embaixo das listas (grades de detalhe e ficha): abre sempre minimizado e fica como o usuário deixar (aberto ou fechado) ao escolher outros registros.

## 0.0.184 — 2026-10-27

- Listas: arrastar a borda de uma coluna em Atividades/Tarefas (e em toda lista com a coluna inicial, como "Concluir") não bagunça mais as outras colunas; o arraste pegava a largura da coluna vizinha.

## 0.0.183 — 2026-10-27

- Leads separados de Pessoas: nova tela Marketing › Leads (tabela leads, só os campos de contato). A Prospecção, o "Cadastrar" das Conversas e os contatos novos do WhatsApp entram como lead; Pessoas fica só com o cadastro de trabalho. "Converter em cliente" (e o chatbot/Automação ao abrir um negócio) copia o lead para Pessoas e leva junto as conversas, atendimentos, avaliações, disparos e atividades. Lead excluído deixa esses registros sem dono.
- WhatsApp: número que não está em Pessoas é procurado nos leads; a lista e a conversa mostram o nome do lead.
- Prospecção: o "já está no CRM" confere também os leads; "Ver leads" abre a tela de Leads.
- Script scripts/migrar-leads.ts: levou os leads antigos de Pessoas para a tabela leads (quem tinha negócio, proposta, pesquisa ou histórico virou cliente), com backup e reversão.
- Telas que ficam abertas em segundo plano recarregam a lista e os combos ao voltar (ex.: segmento criado na Prospecção aparece na tela de Leads).
- Combos de cadastro e da busca avançada ganharam o botão de atualizar a lista.

## 0.0.182 — 2026-10-27

- Importar pessoas de arquivo: corrigido o erro "HTTP 504" em planilhas grandes (ex.: 6 mil clientes). As pessoas novas e os endereços delas entram num único comando por lote, os endereços de quem já existe são lidos de uma vez, e o navegador envia 150 linhas por vez, para cada lote caber no tempo limite do servidor.

## 0.0.181 — 2026-10-26

- Listas: "Melhor largura" deixa 10px de folga em cada coluna, para o texto no limite não aparecer cortado com "...".

## 0.0.180 — 2026-10-26

- Pesquisa de Satisfação refeita com o CrudView (o mesmo componente de Negócios, Propostas etc.): a lista tem busca, busca avançada, paginação e o menu do indicador; "Novo" e editar abrem a pesquisa numa aba com Filtro e Atendimentos Selecionados. Os atendimentos sorteados também são um CrudView, só com os da pesquisa, com o "Selecionado" na coluna estreita e Conversa do Bot/Registrar retorno nas Ações. Concluir e Excluir ficam nas ações da lista. Removido o componente GradeLista (cópia da lógica do CrudView).

## 0.0.179 — 2026-10-26

- Pesquisa de Satisfação: as grades de pesquisas e de atendimentos selecionados ganharam o padrão completo das listas — menu no indicador (Ajustar/Melhor largura, linhas da grade, Colunas, Salvar Configuração), redimensionar e arrastar colunas, ordenar pelo cabeçalho e configuração salva por usuário. Novo componente GradeLista para levar o mesmo padrão a outras telas com tabela própria.

## 0.0.178 — 2026-10-26

- Pesquisa de Satisfação: as listas de pesquisas e de atendimentos selecionados seguem o padrão dos demais grids (grade de ponta a ponta, cabeçalho fixo, indicador, Ações fixas à direita com ícones pequenos).

## 0.0.177 — 2026-10-26

- Chat de suporte: quando o cliente pede um técnico enquanto conversa com o assistente (bm-help) — escrevendo algo como "quero conversar com um técnico" ou pelo botão novo "Falar com técnico" —, o assistente é desligado e o cliente segue na fila aguardando o técnico. O "Não, obrigado" da oferta agora fica gravado no chamado (antes valia só naquele navegador).

## 0.0.176 — 2026-10-25

- Chat de suporte 50px mais alto: o painel do widget no site passou de 600 para 650px, e a janela do BM-ClientChat também (instalador Setup-BMClientChat.exe atualizado).

## 0.0.175 — 2026-10-25

- Instalador Setup-BMClientChat.exe atualizado: o BM-ClientChat não tem mais a opção "Sair" na bandeja (fica sempre ativo; fecha só ao desligar o Windows, ao atualizar ou ao desinstalar).

## 0.0.174 — 2026-10-25

- Chat de suporte: letra das mensagens, dos campos e dos cartões passou de 14px para 13px.

## 0.0.173 — 2026-10-25

- Chat de suporte: o campo da mensagem e os demais campos do chat ganharam o visual do formulário de abertura (caixa arredondada com borda); no cartão do assistente, a escolha do sistema ocupa a linha toda e o "Não, obrigado" não sai mais do cartão.

## 0.0.172 — 2026-10-25

- Chat de suporte: imagens nos dois sentidos. O cliente manda um print pelo widget (Ctrl+V no campo da mensagem ou botão de clipe) e o técnico também, pela tela de chamados (chamados do site, ou nota interna em qualquer canal). A imagem é reduzida no navegador e aparece em miniatura, que abre grande ao clicar. Com o assistente (bm-help) ativo, o print vai junto para ele analisar. Requer as colunas `chamado_mensagens.imagem` e `imagem_tipo`.

## 0.0.171 — 2026-10-25

- Chat de suporte: enquanto o cliente espera na fila sem técnico, o assistente virtual (bm-help) oferece ajuda. O cliente escolhe o sistema, o assistente responde a dúvida do chamado e as mensagens seguintes (até 10 respostas) e para quando um técnico assume. O botão "Resolveu" encerra o chamado sem precisar de técnico. Na tela do técnico, as respostas aparecem como "Assistente virtual (bm-help)". Requer `extras/bmhelp_assistente.sql` e as variáveis BMHELP_URL, BMHELP_EMAIL e BMHELP_SENHA.
- Instalador Setup-BMClientChat.exe (chat e acesso remoto) disponível em /download.

## 0.0.170 — 2026-10-22

- Chat de suporte: o aviso que aparece depois de encerrar um chamado some sozinho em 3 segundos e o formulário volta ao normal (antes o aviso empurrava o botão de enviar para fora da janela).

## 0.0.169 — 2026-10-22

- BM-ClientChat: botão "X" no topo do chat esconde a janela no ícone perto do relógio (as mensagens continuam chegando).

## 0.0.168 — 2026-10-22

- Suporte pelo BM-ClientChat (programa na máquina do cliente): o chamado aberto por ele registra o nome do computador, que já vem preenchido no pedido de tela remota; arrastar o topo do chat move a janela; mensagem ou cutucão da equipe trazem a janela para a frente e mostram notificação do Windows; quando o cliente abre a janela depois do cutucão, isso fica registrado no chamado.

## 0.0.167 — 2026-10-21

- Quadro "Na fila agora / Técnicos agora" (Chamados Ativos e WhatsApp): chevron na borda de cima para recolher e mostrar (fica salvo no navegador), e linha nova "Atendimentos hoje:" com os chamados abertos hoje e os atendimentos do WhatsApp iniciados hoje.
- Conversas: abrir pelo número (ícone do WhatsApp no disparo da campanha, fila, notificação) acha a conversa gravada, com ou sem o 9 (antes o disparo abria a conversa vazia).

## 0.0.166 — 2026-10-20

- Nome do sistema: "BM-CRM" no lugar de "CRM Web"/"CRMweb" em tudo o que aparece (aba do navegador, menu, login, app instalado/PWA, rodapé dos impressos, Política de Privacidade e Termos). Banco, chaves salvas no navegador e o código "CRMWEB-<id>" das pessoas continuam iguais.
- Menu lateral: títulos das seções em azul claro.

## 0.0.165 — 2026-10-20

- Marketing › Vendas (tabela vendas_produtos, uma linha por produto de cada NF): lista com o Cliente do CRM pelo CNPJ/CPF, cancelada, vendedor. "Importar BM" com aba "SQL do BM" (editar, Testar com todos os campos, Gravar, Restaurar padrão; marcadores :ultimo, :data_de, :data_ate) e "Campos importados" editáveis; reimportar o período substitui as vendas do BM. "Importar" de arquivo como o de Pessoas (código "ARQ-", reimportar substitui a mesma NF). Campos novos do vendedor (ven_cod_integracao, ven_nome; no BM, NFMESTRE.ID_Vendedor e VENDEDORES.Nome).
- Importação de dados (BM e arquivo, em Pessoas, Produtos e Vendas): só gerente e administrador; os botões somem para os outros perfis e o servidor recusa.
- Listas: rodapé "Página X de Y (N registros)".
- Configurações › IA: aba própria para a IA (provedor, modelo, chave, Testar), usada pelo chatbot, pela automação, pelas campanhas e pelas Consultas.
- Campanhas: público "Selecionar com IA" (o pedido em português vira SQL, conferido e rodado só leitura); o SQL pode ser editado, vem formatado (botão Formatar) e o botão "Raw" mostra o comando executado no último Testar. Critérios por campos personalizados de Pessoas (texto, lista, número, data como "dias desde", sim/não).
- Notificações: a campainha do cabeçalho mostra as notificações do usuário (não lidas em número; lida/não lida, todas lidas, só não lidas), e o clique abre a tela certa. Avisos: visita no site, chamado novo na fila, chamado ou conversa transferido para o usuário, tarefa criada pelas automações e avaliação com nota baixa. Em Usuários › Permissões dá para desligar visita no site e chamado na fila; os demais são obrigatórios.
- Telas: sair e voltar mantém a tela como estava (formulário em edição, filtros, rolagem); até 8 telas abertas.
- Marketing › Consultas: chat com os dados. A IA monta a consulta (isolada na empresa, só leitura) e responde com a frase e a tabela; gráfico de barras, linha ou pizza só quando pedido; botão Imprimir; perguntas de volta com opções (uma ou várias) quando falta informação; "Ver o SQL" só para o administrador.

## 0.0.164 — 2026-10-20

- Chat do site (abrir chamado): o celular/WhatsApp precisa ter um DDD que existe no Brasil e não pode ter todos os dígitos iguais (ex.: 11999999999); a tela mostra o motivo e o servidor confere a mesma regra.
- Chat do site: o telefone fixo passa a ser gravado em chamados.contato_fixo (coluna nova). O cabeçalho do chamado mostra o celular e o fixo de quem abriu.
- Pesquisas de Satisfação: o "não sortear quem recebeu pesquisa nos últimos X dias" vem com 30 dias nas pesquisas novas (era 90).

## 0.0.163 — 2026-10-20

- Pesquisas de Satisfação: ação "Concluir" na lista, com confirmação. A pesquisa fica concluída mesmo com gente sem responder e ninguém mais é contatado ("Executar" recusa pesquisa encerrada); quem já foi contatado e responder depois ainda tem a resposta gravada.
- Chat do site (abrir chamado): campo "Telefone fixo (opcional)" ao lado do "Celular / WhatsApp" (obrigatório). O fixo, com DDD, vai na mensagem de abertura do chamado e fica salvo no navegador do cliente.

## 0.0.162 — 2026-10-19

- Visitas do Site: quem ainda está no site aparece com a tag "Visitando..." na coluna Tempo no site (e a Saída fica vazia). O widget avisa que a página segue à vista 3 s depois de abrir, a cada minuto e ao voltar para a aba (/visitas/presente); sem o aviso (navegador fechado sem avisar), em até 90 s volta a mostrar o tempo.

## 0.0.161 — 2026-10-15

- CRM como PWA: dá para instalar no computador e no celular (manifesto com nome, cor e ícones PNG 192/512, ícone adaptável para Android e ícone do iPhone). O service worker (sw.js) não guarda cache: o CRM continua sempre com a versão nova e os dados ao vivo. Vale só no CRM em si; o link de aceite, o widget de suporte, a tela remota e o app do técnico (/tecnico, com o PWA dele) ficam de fora.

## 0.0.160 — 2026-10-15

- Tarefas automáticas (análise da conversa no fim do chamado): a IA lê também a conclusão que o técnico escreveu ao encerrar. O que a conclusão der claramente como concluído (resolvido, feito, enviado…) não vira tarefa; se ela não disser que algo foi concluído, a análise segue normal, só pela conversa.

## 0.0.159 — 2026-10-15

- Quadro "Técnicos agora" (Chamados Ativos e Conversas do WhatsApp): linha "Na fila agora:" no topo, com quantos chamados aguardam na fila (aguardando ou pausados, sem técnico) e quantas conversas do WhatsApp aguardam atendente.

## 0.0.158 — 2026-10-15

- Chamados: no cabeçalho do chamado aberto, a descrição do problema (título) passa a ocupar a largura toda, numa linha abaixo do número/etiquetas e dos botões de ação (antes ficava espremida numa coluna estreita).

## 0.0.157 — 2026-10-14

- Conversas do WhatsApp: quadro "Técnicos agora" no pé da lista, o mesmo dos Chamados Ativos (chamados e conversas em atendimento de cada técnico).
- Conversas do WhatsApp: filtros só com ícones numa linha, com o nome no tooltip (Só as minhas, Todas, Aguardando + Em atendimento, Aguardando, Em atendimento, Encerradas, Só Campanhas), no mesmo bloco da busca, como nos Chamados Ativos.
- Chamados Ativos e Conversas do WhatsApp: a lista lateral passa a ter a mesma largura nas duas telas (352 px).

## 0.0.156 — 2026-10-14

- Chamados Ativos: os filtros da lista (Meus, Todos abertos, Aguardando, Em atendimento, Encerrados) viram ícones numa linha só, com o nome no tooltip.

## 0.0.155 — 2026-10-14

- Chamados Ativos: quadro "Técnicos agora" no pé da lista, com cada técnico e quantos atendimentos faz no momento (chamados abertos com ele e conversas do WhatsApp em atendimento). Entram os usuários ativos que atendem agora ou atenderam chamado nos últimos 30 dias; quem está livre aparece em cinza. Atualiza junto com a lista.

## 0.0.154 — 2026-10-14

- Campanhas, critérios do público: botão "Testar". Com os critérios como estão na tela (sem gravar), mostra o total do público e as 50 primeiras pessoas por nome (nome, cód. integração, tipo, cidade/UF, telefone e e-mail). Quem pediu para não receber campanhas fica de fora, como no público real.

## 0.0.153 — 2026-10-14

- Campanhas, critérios do público: regra "Cód. integração" com igual a, diferente de, que contém e começa com. As regras de texto (UF e Cidade também) ganham "que contém" e "começa com"; "diferente de" inclui quem não tem o campo preenchido.

## 0.0.152 — 2026-10-13

- Agenda (Atividades, visão semanal e mensal): "Gerar OS" no menu do botão direito em cima da atividade, com a mesma confirmação do menu da lista; a OS abre em seguida. Só para quem acessa as Ordens de Serviço.

## 0.0.151 — 2026-10-13

- Atividades: incluir uma atividade do tipo Visita ou Reunião Externa já cria a OS (mesma regra do "Gerar OS": cliente, técnico, data/hora com fim 2 h depois, assunto e observação). O aviso da gravação diz o nº da OS ou, se não deu (sem contato, sem acesso às OS), o motivo; a atividade é gravada mesmo assim. Só na inclusão pela tela (alterar o tipo depois ou atividades do Google Agenda não criam OS).

## 0.0.150 — 2026-10-11

- Grids: botões de primeira e última página na paginação (além de anterior e próxima).

## 0.0.149 — 2026-10-10

- Atividades/Tarefas: "Gerar OS" no menu de ações. Cria a Ordem de Serviço com o contato da atividade (ou o do negócio/chamado), quem executa (ou quem gerou), a data e a hora (Até = +2 h), o assunto e a observação, e o chamado de origem; a OS abre em seguida para conferir. Sem contato, avisa e não gera.

## 0.0.148 — 2026-10-10

- Chamados Ativos: o filtro "Encerrados" lista do último encerrado para o mais antigo (os demais filtros continuam na ordem de chegada).

## 0.0.147 — 2026-10-10

- Impressão da OS: "O que foi feito" passa a vir antes do quadro "Serviços e produtos utilizados".

## 0.0.146 — 2026-10-10

- App do técnico: mapa do endereço do cliente no detalhe da OS (Google Maps embutido; sem sinal, um aviso no lugar). O botão "Mapa" virou "Como chegar" e abre a rota no app de mapas do celular.
- Listas suspensas com mais de 20 opções viram combo digitável (filtra ao digitar, setas/Enter/Esc), em todo o sistema: UF do endereço, executor e departamento da atividade, transferir chamado/conversa, funil e etapa, responsável da pesquisa, modelos, critérios, importação de arquivo etc. Até 20 opções continua a lista comum.

## 0.0.145 — 2026-10-10

- App do técnico: "Histórico do cliente" no detalhe da OS (recolhido; fora da tela de fechamento): as últimas 10 OS concluídas do mesmo cliente, de qualquer técnico, com número, data, tipo, técnico e o que foi feito; tocar abre o que seria feito, o que foi feito e os serviços e produtos usados. Vem na sincronização e funciona sem sinal.

## 0.0.144 — 2026-10-10

- Ordens de Serviço: produtos (peças, materiais) junto dos serviços. Cada linha é um serviço ou um produto (o servidor confere); preço em branco = o do serviço ou o de tabela do produto. O painel passa a se chamar "Serviços e produtos".
- Encerrar OS (web): busca única "Adicionar serviço ou produto" por nome ou código (serviços primeiro; produtos buscados no servidor, como no pedido). Esc fecha só a lista da busca.
- App do técnico: no fechamento, busca de serviço ou produto (nome ou código) no catálogo guardado no celular; o catálogo é baixado de novo a cada hora. "Foto" de antes/depois abre direto a câmera traseira (sem a galeria).
- Impressão da OS: produtos lançados saem no quadro "Serviços e produtos utilizados", com o código.
- Banco: os_itens com produto_id e servico_id opcional (extras/os_itens_produtos.sql).

## 0.0.143 — 2026-10-10

- Cadastros › Serviços: código, nome, unidade (UN, HR, VISITA...), preço, descrição e ativo; inativo continua nas OS antigas, marcado.
- Ordens de Serviço: painel "Serviços" embaixo da OS selecionada (como os itens do contrato): serviço, quantidade, preço (em branco = o do cadastro), desconto e subtotal; coluna "Valor" na lista com a soma.
- Ordens de Serviço: ação "Encerrar" (menu "...") para fechar a OS que voltou no papel: o que foi feito, início e término (término em branco = agora), quem assinou e a grade de serviços. Encerrada vira "Corrigir fechamento". Concluir pela edição comum é recusado: use o Encerrar.
- Ordens de Serviço: inclusão só com os dados da abertura (status sempre Aberta); data já vem com hoje; Das e Até lado a lado e o Até vem com Das + 2 h. Na edição, o que foi feito, início e término reais ficam bloqueados (só o fechamento grava). Sem a caixa "Dados gerados pelo banco" na OS, nos serviços da OS e no cadastro de Serviços.
- Impressão da OS: quadro "Serviços e produtos utilizados" com linhas em branco para o técnico anotar (some depois de encerrada), serviços lançados com o total e, numa página à parte, as fotos de antes e depois.
- App do técnico: fotos de antes e depois (câmera ou galeria, até 10 de cada), reduzidas no celular e enviadas ao Storage quando houver sinal (os/<empresa>/<OS>-<antes|depois>-<id>.jpg); remover pede confirmação. Excluir a OS apaga as fotos do Storage.
- App do técnico: "Iniciar atendimento" só registra a chegada (data, hora e local); o fechamento abre no botão "Fechar OS": serviços feitos (catálogo guardado no celular, quantidade com − e +), o que foi feito, assinatura e encerrar. Serviços lançados pelo escritório aparecem para conferir. Tudo funciona sem sinal.
- Calendário dos campos de data fecha também ao sair do campo com Tab.
- Tabelas novas: os_fotos, servicos e os_itens (extras/criar_tabela_os_fotos.sql e extras/criar_tabelas_servicos.sql).

## 0.0.142 — 2026-10-09

- Ordens de Serviço (Suporte › Ordens de Serviço): atendimento externo do técnico no cliente. Cliente, técnico, data e horário, tipo, chamado de origem, com quem falar, endereço (vazio = o principal do cliente), o que será feito e o que foi feito. Número sequencial por empresa; concluída sem término fica com a hora da conclusão. "Só as minhas" = as do técnico logado.
- Ordens de Serviço: ação "Imprimir" abre a OS em A4 para o técnico levar, com espaço para o que foi feito, início/término e as assinaturas do técnico e do cliente (nome e documento). O que já estiver gravado sai preenchido, inclusive a assinatura coletada no app.
- App do técnico (/tecnico): PWA para o celular que funciona sem sinal. Baixa as OS do técnico (abertas e as dos últimos 7 dias); iniciar atendimento (hora e localização), o que foi feito, assinatura do cliente com o dedo e encerrar. Tudo fica salvo no aparelho e vai para o escritório quando houver sinal; OS cancelada ou passada para outro técnico nesse meio-tempo é avisada, e o técnico decide descartar.
- Tabela nova: ordens_servico (extras/criar_tabela_ordens_servico.sql). Dependência nova: dexie.

## 0.0.141 — 2026-10-09

- Chamados Ativos: chamado que não é do técnico (de outro ou aguardando), ao ser aberto, ganha uma aba com "X" para fechar; as abas dos chamados dele continuam sem X.
- Chamados: em atendimento com outro técnico, o chamado fica só para ver (sem ações nem resposta), para todos, administrador inclusive; o servidor também recusa (responder, transferir, pausar, encerrar, tela remota, computador, tarefa).
- Conversas do WhatsApp: o mesmo esquema dos chamados. Abas para as conversas que o técnico atende, aba com "X" para as outras que abrir, e conversa em atendimento com outro técnico só para ver (administrador inclusive: não toma mais o atendimento, não transfere nem limpa a conversa de outro).
- Hora em que o cliente chegou: nos chamados (abertura do chamado; card, abas e cabeçalho) e no WhatsApp (1ª mensagem do cliente no atendimento atual; lista e abas). "14:21" se for hoje, "08/10 14:21" se não.

## 0.0.140 — 2026-10-09

- Chamados: a senha da fila fica num círculo colorido (card, abas e tabela da fila). Aguardando (ou pausado), pela espera desde a abertura: verde até 10 min, laranja de 10 a 20, vermelho acima de 20. Em atendimento (ou pendente do cliente): fundo branco.
- Chamados: a situação "Em andamento" passa a se chamar "Em atendimento" (etiqueta, filtro e cadastro).

## 0.0.139 — 2026-10-09

- Campanhas: opção "Encerrar" no menu de ações. A campanha passa a Concluída (com "Encerrada em") e os disparos pendentes são cancelados; os que já saíram ficam como estão e as respostas seguem normalmente.
- Cabeçalho: saiu o botão "Novo …" (redundante: o Funil tem o "+ Negócio" e as listas têm o "+ Novo" na barra da tela). A campainha (visitas do site) passa a ser sempre o 1º botão. O modo claro/escuro fica só na tela de login (o tema escolhido continua valendo depois de entrar).
- Chamados: no card da lista, a situação fica à direita e a etiqueta de prioridade saiu (continua na tabela da fila e no cabeçalho do chamado).

## 0.0.138 — 2026-10-09

- Prospecção: o segmento passa a ser obrigatório para incluir os leads ("Escolha o segmento"; a opção "Sem segmento" saiu). A tela e o servidor conferem.
- Campanhas: ao gravar (incluir ou alterar) a campanha, os disparos já são gerados, sem enviar (o mesmo que o "Gerar disparos"); o aviso da gravação diz quantos. Não gera sem mensagem, em canal sem envio automático, concluída ou cancelada; sem como gerar (ex.: sem critério de público) grava e avisa o motivo. O envio continua só pelo "Iniciar envio". Campanha em execução: gravar refaz os pendentes, que saem em seguida.
- Chamados: o cliente aparece como "Pessoa / Empresa" (quem abriu / cliente do cadastro) no card da lista, nas abas, na fila, no cabeçalho, nas mensagens do cliente e no título da tela remota; sem cliente no cadastro, só o nome de quem abriu.
- Chat do site (abrir chamado): o campo passa a ser "Celular (WhatsApp)" e só aceita celular (DDD + 9 + 8 dígitos, com ou sem 55); nome e celular continuam obrigatórios.
- Conversas do WhatsApp: na lista, as etiquetas (Aguardando, departamento, técnico, não lidas) ficam juntas à direita.

## 0.0.137 — 2026-10-09

- Chat do site (cliente): no cartão "Acesso remoto" o nome do computador passa a ser obrigatório ("Nome deste computador (OBRIGATÓRIO)"); sem ele o BMSoft Suporte não baixa (a tela e o servidor conferem).
- Acesso remoto só pelo BMSoft Suporte: saíram do cartão o "Abrir AnyDesk", o "Não tenho o AnyDesk" e o envio do número do AnyDesk (e a rota que o recebia); o chat não tenta mais abrir o AnyDesk sozinho. Na tela do técnico, o "Conectar" de quem já tinha mandado o número continua, só abrindo o AnyDesk do técnico.

## 0.0.136 — 2026-10-09

- WhatsApp: o app nunca encerra um atendimento sozinho; só alguém da equipe, pelo Encerrar. Sem resposta do cliente (ao bot ou ao técnico) depois dos minutos de Configurações › Chatbot, a conversa vai para "aguardando" (o técnico que atendia é liberado), sem mensagem ao cliente; saíram o aviso "será encerrado em 30 segundos" e o encerramento. O "ok, obrigado" do cliente também só passa para aguardando.
- Conversa aguardando atendente não volta mais ao bot pelo tempo: fica na fila até um técnico atender ou encerrar. O tempo de Configurações › Chatbot passa a se chamar "Liberar o atendente depois de" (quem assumiu e não respondeu volta a conversa para a fila).
- Automação: o fim da automação deixa a conversa aguardando alguém da equipe encerrar (antes encerrava e mandava a pesquisa).
- Pesquisa de satisfação: sai no Encerrar sempre que alguém da equipe escreveu no atendimento, mesmo que a conversa tenha voltado para aguardando. A resposta do cliente à pesquisa segue como antes.

## 0.0.135 — 2026-10-09

- Automação do WhatsApp: nó novo "Criar tarefa" (grupo CRM). Cria uma tarefa com vencimento na hora para o departamento escolhido (ou para toda a equipe), com assunto e observação usando as variáveis coletadas (ex.: nome e empresa); o telefone do WhatsApp vai junto e, com o cliente cadastrado, a tarefa fica ligada a ele. A conversa segue para o próximo nó, e o fim da automação não pede avaliação (alguém ainda vai retornar o contato).
- Automação: depois de uma Condição de horário, a variável {{horario}} traz o horário por extenso (ex.: "seg a sex, das 08:00 às 18:00").

## 0.0.134 — 2026-10-08

- Chat do site (cliente): no cartão "Acesso remoto", campo "Nome deste computador" (opcional, ex.: Recepção) ao lado do "Baixar BMSoft Suporte". O aviso no chamado traz o nome.
- Chamados (técnico): no "Acessar computador", o computador instalado pelo cliente do chamado vem primeiro entre os sem cliente, em azul com a etiqueta "Deste chamado" e o nome que o cliente deu (o BMDesk reconhece pelo endereço de internet de quem clicou no download). No "Vincular e acessar" o nome vira o apelido do computador e vai no título da aba. O técnico continua confirmando o vínculo.

## 0.0.133 — 2026-10-08

- Chamados (técnico): indicador do BMSoft Suporte no cabeçalho do chamado, ao lado do "Acessar computador": verde "online" (com "1 de 3" quando há vários), cinza "instalado, offline" ou laranja "não instalado". Confere os computadores vinculados ao cliente do chamado no BMDesk e se o agente está conectado; verifica ao abrir o chamado e de novo no clique (ex.: depois de o cliente instalar e o técnico vincular). Não aparece em chamado sem cliente no cadastro.

## 0.0.132 — 2026-10-08

- Suporte pelo site: a posição na fila no widget passa a ser a mesma da tela do técnico (entre os chamados abertos, por ordem de chegada); antes contava só os que esperavam sem atendente.

## 0.0.131 — 2026-10-08

- Chamados (técnico): o "Cutucar" também traz o chat para frente no computador do cliente com o BMSoft Suporte instalado (Windows, vinculado ao cliente do chamado e online): o BMDesk manda o agente procurar a janela do navegador com o título que o chat pisca no cutucão, maximizar e pôr na frente. O aviso do técnico diz quando isso foi pedido. Sem BMDesk configurado ou fora do ar, o cutucão continua só no chat (som, tremida, título piscando e notificação do Windows).

## 0.0.130 — 2026-10-08

- Chamados (técnico): a tela remota do "Acessar computador" volta a abrir numa aba nova do navegador (no lugar da aba dentro do atendimento), agora com o cliente e o computador no título da aba ("Cliente — Recepção"). A aba é a página /tela-remota do CRM, com a tela ocupando tudo; o endereço de acesso vai pela sessão da aba (não aparece na barra) e o F5 mantém a tela.
- Em crm.bmsoft.com.br a tela vem embutida com o título do cliente; em outros endereços (localhost, *.vercel.app) a aba abre o MeshCentral direto — sem o erro "remoto.bmsoft.com.br se recusou a se conectar" da aba embutida.
- Pesquisa de satisfação, menos mensagens para o cliente: no máximo uma pesquisa pós-atendimento a cada 7 dias por cliente (contando as da tela Pesquisas de satisfação); só sai se alguém da equipe escreveu no atendimento (assumir e encerrar não conta), e a pergunta usa o nome do último que escreveu; o fim da automação que registrou lead/prospecção não pede avaliação (um consultor ainda vai falar com o cliente).
- Pesquisas de satisfação (tela): o "excluir quem recebeu pesquisa nos últimos X dias" também conta a pesquisa pós-atendimento do WhatsApp (menos quando a pesquisa filtra por nota). A conversa do Bot pede nota e comentário numa mensagem só, encerra com a resposta, aceita "já avaliei"/"não quero" sem insistir e não manda a insistência de 24 h (encerra como sem resposta).

## 0.0.129 — 2026-10-08

- Chamados (técnico): a lista do "Acessar computador" mostra o apelido do computador em destaque e, embaixo, o nome, o usuário logado no Windows e o IP — para achar o computador certo quando o cliente tem vários. O lápis dá/edita o apelido ali mesmo (Enter grava, Esc cancela, vazio apaga). O apelido fica no BMDesk (descrição do computador no MeshCentral) e só pode ser dado nos computadores do cliente do chamado.

## 0.0.128 — 2026-10-08

- Chamados (técnico): "Acessar computador" aparece também no chamado sem cliente no cadastro (ex.: aberto pelo widget com CNPJ/CPF que não existe em Pessoas). Mostra sempre a lista dos computadores recém-instalados sem cliente, com sistema e IP, e o botão "Acessar" (abre sem vincular; para vincular, cadastre o cliente). Por esse caminho só abre computador que não é de nenhum cliente (o BMDesk confere). O acesso entra na linha do tempo do chamado.

## 0.0.127 — 2026-10-07

- Chamados Ativos: o botão "Novo" (abrir chamado) saiu do cabeçalho e fica ao lado da pesquisa da lista, com a mesma altura do campo.

## 0.0.126 — 2026-10-07

- Chamados (técnico): a tela remota do "Acessar computador" abre numa aba dentro do atendimento (Atendimento | computador), em vez de uma aba do navegador. Alternar entre a conversa e a tela não derruba a conexão; o × fecha a tela (pede confirmação); "Abrir em nova aba" leva a tela para o navegador em tela cheia. Funciona em crm.bmsoft.com.br (o MeshCentral libera a exibição só para esse endereço; no localhost o navegador bloqueia e vale o "Abrir em nova aba").

## 0.0.125 — 2026-10-07

- Chamados (técnico): "Acessar computador" também lista os computadores online ainda sem cliente no BMDesk (o que o cliente acabou de instalar pelo widget), com sistema e IP, e o botão "Vincular e acessar": liga o computador ao cliente do chamado e já abre a tela, sem ir ao BMDesk. Só computador sem cliente pode ser vinculado por aqui (trocar de cliente continua no BMDesk). O vínculo entra na linha do tempo do chamado.
- Abre direto só quando o cliente tem um computador, online, e não há computador novo sem cliente esperando.
- O aviso do widget no chamado passa a orientar o "Vincular e acessar".

## 0.0.124 — 2026-10-07

- Integração com o BMDesk (acesso remoto pelo MeshCentral, desk.bmsoft.com.br), configurada por BMDESK_URL e BMDESK_CHAVE no .env (e nas variáveis da Vercel); sem elas fica desligada.
- Widget de suporte: o cartão "Acesso remoto" ganha o botão "Baixar BMSoft Suporte" (instalador do agente, link de 24 h); o AnyDesk continua como alternativa logo abaixo. O chamado registra, só para a equipe, que o cliente abriu o instalador, para o técnico vincular o computador no BMDesk.
- Chamados (técnico): botão "Acessar computador" no cabeçalho do chamado com cliente. Um computador online abre a tela remota direto numa aba nova; vários mostram a lista (online/offline) para escolher. O acesso entra na linha do tempo do chamado com o nome de quem acessou (no MeshCentral aparece a conta de serviço do BMDesk).

## 0.0.123 — 2026-10-07

- Chamados (técnico): o número da fila passa a ser a posição do chamado entre os abertos (na fila ou em atendimento), por ordem de chegada; quando um encerra, os de trás sobem. Encerrado/cancelado fica sem número.
- Widget de suporte: o lugar do cliente na fila conta só os que esperam um técnico (assumido sai e os de trás sobem) e aparece em destaque no chat, num círculo, até o chamado ser assumido.

## 0.0.122 — 2026-10-07

- WhatsApp: o cabeçalho da conversa mostra "Encerrado" (como a lista) quando o atendimento foi encerrado e o cliente ainda não escreveu de novo, em vez de "<bot> atendendo". Nesse estado o botão "Devolver ao bot" não aparece.

## 0.0.121 — 2026-10-07

- WhatsApp: quando o Bot das atividades termina a conversa (ex.: pesquisa de satisfação respondida, ou sem resposta), grava a linha "Conversa do Bot encerrada": a lista mostra Encerrado e um "ok, de nada" logo depois não abre conversa nova. Não conta como atendimento (não sorteia outra pesquisa); passada para a equipe continua na fila.

## 0.0.120 — 2026-10-07

- Chamados Ativos: todos os filtros (inclusive Encerrados) na ordem de chegada dos chamados; a lista traz os 200 mais recentes.

## 0.0.119 — 2026-10-07

- Chamados Ativos: abas dos atendimentos chapadas (sem espaço nem cantos arredondados; a aberta com barra azul embaixo).
- Chamados Ativos: duplo clique no chamado aguardando ou pausado (sem atendente) assume, como o botão Assumir.
- Chamados Ativos: ao encerrar, a tela fica em Chamados Ativos com o chamado encerrado aberto (antes ia para a Fila).
- Fila de Chamados: na tabela, o cliente em cima e o problema embaixo.

## 0.0.118 — 2026-10-07

- Whatsapp: filtro "Só Campanhas" na lista de conversas (as que entraram pelo número das campanhas, em qualquer estado).

## 0.0.117 — 2026-10-07

- Menu: opções favoritas (até 3). Ao passar o mouse aparece uma estrela à direita; clicada, fica fixa e a opção vira um botão (só o ícone) no topo, antes do sino. Gravadas por usuário em `usuarios.config_listas` (chave `_menu`).
- Topo: saiu o card "Banco de Dados xxms".
- Chamados Ativos: saiu o quadro "Na fila" (os aguardando já aparecem na lista de abertos, com a senha); assumir pelo botão do chamado aberto.

## 0.0.116 — 2026-10-07

- Chamados Ativos: lista dos abertos na ordem de chegada (o mais antigo em cima); Encerrados continua do mais recente.
- Senha do dia: cada chamado que entra na fila ganha 1, 2, 3... na ordem de chegada (recomeça a cada dia; não muda ao ser atendido; "Atender agora" não pega senha). Aparece no card dos Chamados Ativos, no quadro "Na fila" e na coluna Senha da Fila de Chamados (conversa do WhatsApp fica sem senha). Calculada na consulta, sem coluna nova.
- Chamados Ativos: card com o nome do cliente em negrito e o problema embaixo; uma aba por chamado que o técnico logado atende, acima do chat (clique abre o chamado).
- WhatsApp: campainha e aviso quando um cliente espera a resposta do técnico há X minutos (Configurações › Chatbot), uma vez por mensagem.
- Inatividade do WhatsApp: conversa que já terminou (despedida do técnico ou "ok, obrigado" do cliente) encerra direto, sem aviso, com a pesquisa de satisfação quando um humano atendia.
- Pesquisa de Satisfação: o sorteio não repete o mesmo cliente na pesquisa.

## 0.0.115 — 2026-10-06

- Suporte pelo site (widget): formulário de abertura com o visual do "Agendar Apresentação" da homepage: rótulo pequeno em maiúsculas em cima, campos em caixa arredondada com borda (foco azul), exemplos dentro dos campos e botão maior. Exceção `campo-site` no CSS; os campos do CRM seguem o padrão sem moldura.

## 0.0.114 — 2026-10-06

- Lead do site: rota pública `POST /api/publico/leads/:empresa` para o formulário "Agendar Apresentação" da homepage. Mesmo caminho do lead do chatbot: pessoa (ou a já cadastrada pelo WhatsApp/e-mail), negócio "Site: <sistema>" no funil para o próximo vendedor do revezamento e atividade "Agendar apresentação (site)" com e-mail e mensagem. Campo-isca contra robôs.

## 0.0.113 — 2026-10-06

- Avaliações (pesquisa de satisfação do WhatsApp) saiu de Vendas e foi para a seção Marketing do menu.
- A sessão é conferida também ao voltar para a aba: se o administrador mudou as permissões do usuário, o menu se atualiza sem precisar sair e entrar de novo.

## 0.0.112 — 2026-10-06

- Visitas do Site: coluna "Nome (chat)" com o nome que o visitante informou no chat do suporte. O chat avisa o widget quem é o cliente (dados já salvos ou chamado aberto); a visita ganha nome e CNPJ/CPF (e o Cliente, se o CNPJ estiver no CRM) e as próximas visitas no mesmo navegador já chegam com eles. Coluna `cliente_nome` em `site_visitas`.
- Visitas do Site: coluna IP na lista; coluna Dispositivo mais larga (não corta "Computador").

## 0.0.111 — 2026-10-06

- Sino no topo do app: pisca quando alguém entra no site (consulta a cada 15 s) e o clique abre Suporte › Visitas do Site (antes "Visitas ao Site"). Abrir a tela dá as visitas como vistas (guardado no navegador, por usuário).
- Visitas do Site: colunas Saída e Tempo no site. O widget avisa quando a página sai de vista (fechou a aba, foi para outro site, trocou de aba ou de página); vale a última saída. Colunas `chave` e `saida_em` em `site_visitas`.

## 0.0.110 — 2026-10-06

- Suporte › Visitas ao Site: o widget registra cada entrada no site (uma por aba do navegador) com página, de onde veio, cliente (quando o widget tem data-cnpj), dispositivo, navegador e IP. Tela só de consulta, com busca e filtros. Tabela `site_visitas`.

## 0.0.109 — 2026-10-06

- Widget de suporte do site: botão volta a ser só o ícone (redondo), sem texto.

## 0.0.108 — 2026-10-06

- Widget de suporte do site: o texto do botão passa de "NOVO SUPORTE" para só "NOVO".

## 0.0.107 — 2026-10-05

- WhatsApp: imagem (e outras mídias) das campanhas aparece na conversa mesmo antes de o cliente responder; ela é buscada no número das campanhas, por onde saiu (antes: "Imagem (não disponível)").
- WhatsApp: o "Sai pelo" vem no número das campanhas quando a última mensagem da conversa foi uma campanha (o mesmo chat em que o cliente recebeu).

## 0.0.106 — 2026-10-05

- WhatsApp: botão "Apagar" na mensagem enviada pela tela, só para quem enviou e até 1 minuto depois (com confirmação). Apaga para todos no WhatsApp do cliente (Evolution e Z-API) e no CRM fica "Mensagem apagada", sem o conteúdo.
- WhatsApp: cliente que responde a uma mensagem de técnico das últimas 48 h (a citada ou, sem citação, a última enviada) vai direto para a Fila de Chamados (Aguardando), sem passar pelo bot. Resposta ao bot, à campanha ou a uma automática segue o fluxo normal.
- WhatsApp: a etiqueta "Campanha" na lista de conversas passa a se chamar "WhatsApp Campanha".

## 0.0.105 — 2026-10-05

- WhatsApp: cliente que responde até 24 h depois de um atendimento encerrado por falta de interação continua na Automação das campanhas (recomeça dela), em vez de cair na do atendimento.
- WhatsApp: rede de segurança — mensagem que nenhuma Automação atende (desligada, em teste) vai para a Fila de Chamados (Aguardando), com a linha "Nenhuma automação atende esta conversa: foi para a fila", em vez de ficar sem resposta.

## 0.0.104 — 2026-10-05

- Listas: os filtros rápidos (Só as minhas, Do bot e o Sim/Não, ex.: Concluída) voltam como estavam da última vez, por tela (lembrados no navegador).
- Campanhas: a imagem vai no tamanho original até ~1,3 MB; maior que isso, é reduzida para 1600 px (antes era reduzida para 400×200).

## 0.0.103 — 2026-10-05

- WhatsApp: corrige o erro "Row N was cut by GROUP_CONCAT()" ao assumir (ou encerrar) conversas longas. Cada conexão do banco sobe o `group_concat_max_len` para 4 MB.
- Atividades: o toggle "Do bot" passa a esconder pelo executor (Bot), não pela origem; assim a pesquisa de satisfação pelo WhatsApp também some.
- Barra das listas: os toggles "Minhas" e "Do bot" ganham um separador à esquerda e ficam centralizados na altura.

## 0.0.102 — 2026-10-05

- Campanhas: campanha iniciada fica travada. No formulário só a Situação muda (pausar, cancelar, concluir), com aviso; o servidor descarta as outras alterações e recusa a exclusão.
- Campanhas: ação "Ver anexos" no menu da campanha, mostrando a imagem que vai com a mensagem (clique para baixar).
- Disparos da campanha: botão "Ver conversa" nos disparos de WhatsApp, que abre Conversas no número que recebeu a mensagem (para ler a resposta do lead).
- WhatsApp: os dados em português do seletor de emojis passam a vir do `emoji-picker-element-data` (o `emojibase-data` novo mudou o formato e o seletor recusava). Sai a dependência `emojibase-data`.
- Atividades na ficha do negócio e no chamado: o resumo "Bot: …" só aparece quando a atividade é executada pelo Bot.

## 0.0.101 — 2026-10-05

- WhatsApp: botão de emoji ao lado de Templates, com o seletor completo (emoji-picker-element): categorias, busca em português, tom de pele e usados recentemente; o emoji entra no ponto do cursor. Novas dependências: `emoji-picker-element` e `emojibase-data`.
- WhatsApp: etiqueta "Pausado" no card da conversa, junto de "Aguardando", quando quem atendia pausou e ela voltou para a fila.
- Atividades: toggle "Do bot" na barra da lista; desligado esconde as executadas pelo Bot e as criadas sozinhas pelo chatbot/automação (lembrado no navegador). Nova origem "Chatbot do WhatsApp".
- Banco: `ALTER TABLE atividades ADD COLUMN criada_por_bot TINYINT(1) NOT NULL DEFAULT 0` + UPDATE das antigas (em extras/crmweb_schema.sql).

## 0.0.100 — 2026-10-05

- WhatsApp: botão "Descartar" nas conversas em Aguardando que não pedem atendimento (ex.: o bot de outra empresa respondendo). A conversa sai da fila como encerrada ("Descartada por ..."), sem pesquisa de satisfação, sem contar como atendimento e sem procurar pendências; uma mensagem nova do cliente volta a abrir atendimento.

## 0.0.99 — 2026-10-05

- WhatsApp: a linha "Sai pelo" fica centralizada entre a conversa e o campo de texto (espaço igual em cima e embaixo).

## 0.0.98 — 2026-10-05

- Prospecção: cada lead incluído guarda a busca de onde veio. Botão "Ver leads em Pessoas" ao abrir uma busca anterior; em Pessoas, campo "Busca da prospecção" (filtro da busca avançada). Os leads já incluídos foram ligados às buscas guardadas pelo código do Google.
- Combos: incluir, alterar ou excluir um registro atualiza na hora os combos daquela tabela (ex.: o segmento criado pelo "+" da Prospecção agora aparece na lista).
- Banco: `ALTER TABLE pessoas ADD COLUMN prospeccao_busca_id INT NULL AFTER google_place_id` (em extras/crmweb_schema.sql).

## 0.0.97 — 2026-10-05

- Pesquisa de satisfação: escolha do WhatsApp por onde sai ("Sai pelo": das campanhas, o padrão, ou principal); o Bot da pesquisa conversa por ele (sem o das campanhas configurado, sai pelo principal). Depois de executada, o número não muda.
- Pesquisa nova já vem preenchida: descrição "Pesquisa dos atendimentos do dia dd/mm/aaaa" (acompanha a data inicial enquanto não for alterada), objetivo sugerido e as datas com o dia útil anterior (ontem; na segunda, a sexta).
- Combos com busca (Segmento, Cliente, Produto...): perto do pé da tela, a lista abre para cima.
- Banco: `ALTER TABLE pesquisas_satisfacao ADD COLUMN conta ENUM('provedor','campanhas') NOT NULL DEFAULT 'campanhas' AFTER canal` (em extras/crmweb_schema.sql).

## 0.0.96 — 2026-10-04

- Painel de Suporte: o card "SLA cumprido" deu lugar a "Chamados hoje" (abertos hoje, comparados com todos os abertos ontem; não depende do período escolhido). O "SLA estourado" do bloco "Agora" continua.

## 0.0.95 — 2026-10-04

- Atividades: a conversa aberta pela atividade (dois cliques na lista ou clique na ficha do negócio) é a do número em que a pessoa conversou no WhatsApp, de preferência a de antes da atividade ser criada; o telefone do cadastro (ex.: o fixo da empresa) só quando não há conversa. Antes abria o telefone do cadastro, que podia não ter conversa e não aparecia na lista.

## 0.0.94 — 2026-10-04

- Templates de mensagem (WhatsApp e Chamados): `{{nome}}` e `{{primeiro_nome}}` usam o nome da pessoa que está conversando (contato da empresa, perfil do WhatsApp ou quem abriu o chamado pelo site), e não mais o nome da empresa.
- Atividades: dois cliques (na lista ou no calendário) abrem a origem da atividade: o chamado, a Conversa do Bot, a conversa do WhatsApp (atividade WhatsApp ou pendência da conversa), o contrato (Renovar contrato) ou a ficha do negócio (Retorno Envio e as manuais). Sem origem, ou sem acesso à tela de destino, abre a edição como antes.

## 0.0.93 — 2026-10-03

- WhatsApp: número de envio. Chamados, mensagens automáticas, avisos para a equipe, aceite, bot das atividades e PDFs saem sempre pelo WhatsApp principal; as respostas das Automações, a pesquisa e o aviso de inatividade saem pelo número por onde o cliente escreveu; na tela, o seletor "Sai pelo" (só com o WhatsApp das campanhas configurado) vem no número do cliente e avisa quando a mensagem vai cair em outro chat.
- Automação das campanhas: só recomeça se chegou uma campanha depois do último encerramento (atendente ou fim da automação); fora isso responde a Automação principal, sem o contexto da campanha. A que está em andamento continua na mesma.
- Automação: ao recomeçar do Início, as respostas da rodada anterior (nome, empresa, e-mail...) são descartadas.

## 0.0.92 — 2026-10-03

- WhatsApp: "Responder" uma mensagem específica, como no WhatsApp (passar o mouse na mensagem; a citação aparece acima do campo, X ou Esc desiste). O cliente vê no celular qual mensagem está sendo respondida (texto e arquivos); no CRM a resposta mostra a citação, que leva à mensagem original. Quando o cliente responde citando uma mensagem, o CRM também mostra a citação.
- Banco: `ALTER TABLE whatsapp_mensagens ADD COLUMN resposta_de INT NULL AFTER wa_id` (em extras/crmweb_schema.sql).

## 0.0.91 — 2026-10-03

- WhatsApp: a conversa aberta (ex.: pelo negócio ou pela atividade) aparece na lista mesmo fora do filtro de estado.
- WhatsApp: o dono da conversa é o cadastro da mensagem mais recente que tem pessoa (antes, o de maior número quando o mesmo celular está em mais de um cadastro). Vale para a lista, o topo da conversa, as linhas de evento/encerramento, a Automação, a inatividade e as pesquisas.
- WhatsApp: as mensagens do bot (Automação e bot das atividades) saem assinadas com o nome do bot ("*Eloisa:* ..."), como as do atendente; o registro no CRM fica sem a assinatura.

## 0.0.90 — 2026-10-03

- Busca avançada (telas com o campo Ativo, como Pessoas): interruptor "Listar também os desativados" no lugar do combo Ativo; desligado lista só os ativos. "Limpar filtros" volta ao padrão (só os ativos).

## 0.0.89 — 2026-10-03

- Cadastros: a cor das etapas do funil e das categorias de chamado é escolhida numa tabela de cores (com "Sem cor"), sem digitar o código; na lista aparece o quadradinho da cor. O servidor só aceita cor no formato #RRGGBB.

## 0.0.88 — 2026-10-03

- Automação das campanhas: quem responde a uma campanha é a pessoa que a recebeu, mesmo quando o número está em outros cadastros (antes valia o cadastro de maior número entre as mensagens do telefone).
- Registrar Prospecção vindo de campanha: só reaproveita o negócio aberto dessa mesma campanha; senão abre um novo ligado a ela (negócios de outras vendas ficam de fora).

## 0.0.87 — 2026-10-03

- Campanhas: "Gerar disparos" só cria as mensagens (a campanha não muda de situação e nada é enviado); a nova ação "Iniciar envio campanha" passa a campanha a Em execução e libera os pendentes (recusa sem disparos pendentes ou com o envio já ligado; retoma a pausada).
- Automação: nó "Registrar Prospecção" (grupo CRM) abre um negócio no funil e na etapa escolhidos (vazios: o primeiro funil e a primeira etapa), cadastra a pessoa como lead se preciso, usa o negócio aberto do mesmo funil e cria a atividade "Prospecção pelo WhatsApp"; vindo de campanha, o negócio fica ligado a ela. Na importação, funil e etapa voltam a vazio.
- Funil de Vendas: cor por etapa (campo Cor no cadastro das etapas), em faixa no topo da coluna do Kanban.
- Banco: `ALTER TABLE etapas ADD COLUMN cor VARCHAR(7) NULL AFTER probabilidade` (em extras/crmweb_schema.sql).

## 0.0.86 — 2026-10-03

- Prospecção: cada busca fica guardada (tabela `prospeccao_buscas`) e pode ser reaberta em "Buscas anteriores", com os filtros e as empresas encontradas, sem gastar a cota do Google.
- Prospecção: a marcação separa "Incluído pela Prospecção" (lead criado por uma busca) de "Já no CRM" (já estava em Pessoas, achado pelo telefone).
- Configurações › WhatsApp das campanhas: o texto do recebimento diz que as respostas seguem a Automação das campanhas, se ligada.
- Banco: `CREATE TABLE prospeccao_buscas` (em extras/crmweb_schema.sql).

## 0.0.85 — 2026-10-03

- Automação: botões Exportar e Importar. Exportar baixa o fluxo do quadro num arquivo JSON (com as imagens dentro, o departamento pelo nome e os cabeçalhos secretos das chamadas de API sem valor); Importar carrega o arquivo no quadro depois de confirmar (só grava ao Salvar), reenvia as imagens, acha o departamento pelo nome e avisa o que revisar.
- Automação: o X do painel de propriedades do nó fecha o painel (antes ele reabria na hora, porque o nó continuava selecionado no quadro).
- Configurações: as abas que não cabem na largura rolam pelas setas ‹ e › (sem a barra de rolagem horizontal).

## 0.0.84 — 2026-10-02

- Prospecção: o código do Google Maps (Place ID) vai para a coluna nova `pessoas.google_place_id`, e o `cod_integracao` do lead fica `CRMWEB-<id>`, como nos cadastros feitos no CRM (livre para o bmsoft). O "Já no CRM" usa o Place ID ou o telefone. Em Pessoas, campo "Google Place ID" só leitura e pesquisável.
- Prospecção: botão "+" ao lado do Segmento cria um segmento ali mesmo (Enter grava, Esc cancela), que já fica selecionado.
- Campanhas: no WhatsApp a mensagem termina sozinha com "_Para não receber mais, responda SAIR._" (nos disparos e na prévia), a não ser que o texto já fale em SAIR.
- Banco: `ALTER TABLE pessoas ADD COLUMN google_place_id VARCHAR(100) NULL AFTER cod_integracao, ADD UNIQUE KEY uk_pessoas_empresa_place (empresa_id, google_place_id)` (em extras/crmweb_schema.sql).

## 0.0.83 — 2026-10-02

- Marketing › Prospecção (nova tela): busca empresas no Google Maps pela Google Places API (oficial) por segmento e cidade/região, com filtros de nota mínima, avaliações mínimas, só com celular e só com site. Opção de ler o site de cada empresa para achar o link do WhatsApp (wa.me), o e-mail e o Instagram. Cada empresa ganha uma nota de qualificação (0 a 100: celular/WhatsApp, nota e avaliações no Google, site, e-mail); quem já está no CRM (pelo código do Google ou pelo telefone) aparece marcado. As escolhidas entram em Pessoas como **lead**, com WhatsApp, telefone, e-mail, endereço principal, segmento opcional e os dados do Google na observação (`cod_integracao` `GP-<id do Google>`).
- Configurações › Prospecção: chave da Google Places API (gravada cifrada); sem ela, vale `GOOGLE_PLACES_API_KEY` do servidor.
- Permissões: nova opção "Prospecção" (usuários com permissões restritas precisam recebê-la).

## 0.0.82 — 2026-10-01

- Configurações › Vendas: "Departamento das propostas no WhatsApp" — a proposta e o pedido enviados pelo WhatsApp ficam privados desse departamento (ex.: Comercial), não importa quem envie; vazio, vale o departamento de quem envia.

## 0.0.81 — 2026-10-01

- WhatsApp: o bot de atendimento e o resumo automático das pendências ignoram as mensagens privadas (não leem nem citam o conteúdo).

## 0.0.80 — 2026-10-01

- Banco: `whatsapp_mensagens.privado_departamento_id` (SQL em extras/crmweb_schema.sql).
- Whatsapp: mensagens privadas — só o departamento da mensagem (e o administrador) vê o conteúdo; os outros veem "🔒 Mensagem privada de <departamento>" (também na prévia da lista; a mídia não abre). Cadeado na mensagem para tornar privada (do próprio departamento; o administrador escolhe) ou pública. Proposta e pedido enviados pelo WhatsApp saem privados do departamento de quem envia.
- Atividades/Tarefas (Lista): 1ª coluna com o círculo de concluir rápido, que abre a janela do resultado; concluída mostra o visto verde.
- Atividades/Tarefas: ao trocar a Lista por Semana ou Mês, o painel de detalhes entra recolhido (abre ao escolher outra atividade).
- Lembrete de validade da proposta: {{numero}} passa a ser o controle.

## 0.0.79 — 2026-10-01

- Banco: tabela `pedido_parcelas` (SQL em extras/crmweb_schema.sql).
- Pedidos: as parcelas da proposta passam para o pedido ao aprovar (vencimentos, formas, valores e ajustes); o pedido tem a mesma seção de parcelas (Recalcular / Refazer Parcelas), imprime e clona as parcelas.
- Propostas: a referência para as pessoas passa a ser o controle (ex.: "Proposta 2026/001-01") na impressão, no PDF e no nome do arquivo, no envio, na página do cliente, no "Ref. proposta" do pedido, nas telas, avisos e histórico; sem controle, "nº 1 v1".

## 0.0.78 — 2026-10-01

- Página de aprovação do cliente (link da proposta): mostra os anexos da proposta, com nome, tamanho e link para abrir.

## 0.0.77 — 2026-10-01

- Envio da proposta: os anexos vão junto. No e-mail, anexados ao PDF (passando de 20 MB no total, vão como links no texto); no WhatsApp, cada anexo numa mensagem logo depois do PDF (imagem, vídeo ou documento).

## 0.0.76 — 2026-10-01

- Banco: tabelas `condicoes_pagamento`, `proposta_parcelas` (com `ajustada`) e `proposta_anexos` (SQL em extras/crmweb_schema.sql).
- Cadastros › Condições de Pagamento (prazos em dias, ex.: 0/30/60, e forma padrão). Na proposta, escolher a condição gera as parcelas (vencimento, forma e valor); valor acertado à mão fica "ajustada" e o Recalcular divide o restante entre as outras; "Refazer Parcelas" gera tudo de novo. A soma tem de bater com o total. As parcelas saem na impressão, no PDF enviado e na página de aprovação; Nova versão e Clonar copiam.
- Propostas: anexos (PDFs, imagens...) no Vercel Blob, até 25 MB cada, enviados direto do navegador; ligados ao número da proposta, valem para todas as versões.
- Proposta nova: Cliente é o 1º campo (com o foco) e o "+" ao lado do Negócio inclui um negócio na hora (cliente + título da proposta).
- Impressão da proposta: o controle é o número principal no cabeçalho; o nº interno vai pequeno, entre parênteses.
- Pedidos: aba "Resumo por Grupo" no detalhe; nas propostas ela passa a ser a 1ª aba. Painéis de detalhe com números à direita e datas centralizadas.
- Propostas: opção TEMPORÁRIA "Reverter" (administrador) para voltar a proposta aceita/recusada a Enviada nos testes.

## 0.0.75 — 2026-10-01

- Propostas: tudo o que vai para o cliente sai sempre resumido (PDF do envio por e-mail/WhatsApp, página de aprovação do link e PDF de lá). No pedido, o envio continua com a opção "PDF resumido".
- Proposta: "Impressão resumida" agora vale só para o Imprimir / PDF do editor.

## 0.0.74 — 2026-10-01

- Banco: `produtos.nome_proposta` (SQL em extras/crmweb_schema.sql).
- Produtos: campo "Nome na Proposta" — preenchido, sai no lugar do Nome na proposta impressa (detalhada e resumida), no PDF enviado e na página de aprovação do cliente.
- Propostas: aba "Resumo por Grupo" no detalhe da lista (itens agrupados como na impressão resumida, só leitura).
- Impressão resumida e Resumo por Grupo: os grupos primeiro, depois os produtos sem grupo.

## 0.0.73 — 2026-10-01

- Banco: tabela `produtos_grupos`, `produtos.grupo_id` e `propostas.impressao_resumida` (SQL em extras/crmweb_schema.sql).
- Cadastros › Grupos de Produtos; produto ganha o campo Grupo (1ª coluna da lista, que abre por grupo, sem grupo no fim).
- Propostas e pedidos: impressão resumida — os produtos do mesmo grupo saem numa linha só, com o nome do grupo e o valor somado; sem grupo, o próprio produto. Menu da lista com "Imprimir detalhada" e "Imprimir resumida"; envio por e-mail/WhatsApp com "PDF resumido".
- Proposta: campo "Impressão resumida" (guardado; Nova versão e Clonar mantêm). Com ele ligado, a impressão do editor, o envio, a página de aprovação do link e o PDF do link saem agrupados.
- Listas: coluna nova (listada por padrão) aparece mesmo com configuração salva; ordenar por campo ligado (ex.: Grupo) ordena pelo nome do registro ligado, os vazios no fim.
- Chamados Ativos: abre no filtro "Todos abertos".

## 0.0.72 — 2026-10-01

- Banco: `pessoas.ativo` (SQL em extras/crmweb_schema.sql).
- Pessoas: campo Ativo (toggle, coluna e filtro). Inativo continua nos combos (propostas, negócios) com "(inativo)" no nome, para propostas de reativação.
- Importar BM (pessoas): traz também os inativos do bmsoft, que entram inativos; os já importados seguem o Ativo do bmsoft. O resumo mostra quantos vieram inativos.
- Produtos: ícone Clonar na lista — cópia com "(cópia)" no nome, mesmo preço, unidade e descrição, sem SKU, código de integração e fotos; abre a cópia para editar.
- Menu: Fila de Chamados logo depois do Painel de Suporte.
- Fila de Chamados: conversas do WhatsApp aguardando atendimento entram na fila junto com os chamados, em ordem de chegada, com a coluna Origem (Chamado / WhatsApp); "Atender" pega a conversa e abre no Whatsapp.
- Whatsapp: botão Pausar — a conversa sai de quem atende e volta para a Fila de Chamados (sem voltar ao bot), com a etiqueta "pausado".
- Chamados Ativos: o card mostra quem atende (azul) e, se for outro, o técnico padrão do cliente.

## 0.0.71 — 2026-10-01

- Chamados Ativos: quadro "Na fila" embaixo da lista, com posição, número, espera, cliente e atendente; clicar abre o chamado e "Assumir" assume sem sair da tela.
- Chamados Ativos: o atendente aparece em linha própria no card (o nome comprido do cliente escondia o técnico nos chamados em andamento).
- Fila de Chamados: chamado esperando há mais de 10 minutos toca uma buzina alta para o Suporte, a cada minuto até alguém assumir, com aviso na tela.

## 0.0.70 — 2026-09-30

- Painel de Suporte: clicar no técnico abre a Consulta de Chamados filtrada por ele; gráficos no tempo com todos os rótulos a 45° (por dia até 45 dias, por semana até 92, por mês além disso) e sem colunas vazando.
- Listas (todos os cadastros): uma resposta atrasada não sobrescreve mais a carga mais recente (ex.: filtro aplicado mostrando a lista sem filtro).

## 0.0.69 — 2026-09-30

- Suporte › Painel de Suporte (permissão nova `painel_suporte`): período (7/30/90 dias, este mês, mês passado, este ano) comparado com o anterior equivalente — chamados abertos/encerrados, tempo até assumir e de resolução, SLA cumprido, atendimentos do WhatsApp, % só pelo bot, satisfação e taxa de resposta; situação de agora (em aberto, fila, SLA estourado, aguardando cliente, pausados); gráficos por dia/mês, por categoria, canal, prioridade, departamento e forma de encerramento; notas; mapa de calor dia × hora; desempenho por técnico; clientes com mais chamados.
- Widget de suporte do site: botão com o texto "NOVO SUPORTE" (temporário; `ROTULO` no widget.js) e tremida para chamar a atenção ao aparecer (3 vezes, para ao abrir o chat; respeita "reduzir animações").

## 0.0.68 — 2026-09-30

- Banco: `atividades.criado_por` (SQL em extras/crmweb_schema.sql).
- Atividades/Tarefas: menu do botão direito (Mês e Semana) ganha "Excluir", com confirmação. Só o dono (quem incluiu; sem autor gravado, o executor) ou um administrador exclui — regra também no servidor, vale para a Lista. A ficha mostra "Criado por".

## 0.0.67 — 2026-09-30

- Atividades/Tarefas: lista, calendário e ficha mostram quem executa antes do assunto ("Luis : Implementar..."; o ícone da reunião continua na frente). Só na exibição: o assunto gravado e o título no Google não mudam.
- Atividade incluída para outro usuário: quem incluiu entra automaticamente como envolvido.
- Ficha da atividade sem os campos Executor: Bot / usuário / departamento (o "Quem executa" já resume).

## 0.0.66 — 2026-09-30

- Atividades/Tarefas, visão Semana: arrastar a atividade muda o horário (de 15 em 15 min) e o dia; soltar na faixa do dia inteiro tira a hora; sombra mostra onde vai cair.
- Visão Mês: arrastar a atividade muda o dia (mantém a hora).
- Visão Lista: não mostra as atividades vindas do Google Agenda (aparecem só em Semana e Mês; o contador avisa).

## 0.0.65 — 2026-09-30

- Atividades/Tarefas, visões Mês e Semana: botão direito abre um menu com "Novo" (inclusão já com o dia clicado; na grade de horas da semana, também a hora, de meia em meia hora) e "Editar" (a atividade sob o mouse; desabilitado em espaço vazio).

## 0.0.64 — 2026-09-30

- Banco: `atividades.google_event_id` e `atividades.google_importada`; tipos de atividade `visita`, `reuniao_externa` e `reuniao_virtual` (SQL em extras/crmweb_schema.sql). Variáveis novas: `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` (cadastrar também na Vercel).
- Google Agenda (Configurações › Google Agenda): conecta a conta Google da empresa. Do Google para o CRM vêm todos os eventos (de hoje em diante) de todas as agendas da conta; evento alterado ou excluído no Google altera ou exclui a atividade. Do CRM para o Google vão só Visita e Reunião Interna/Externa/Virtual, na agenda escolhida (botão Salvar). Tipo do evento importado pelo ícone do título ou pelo texto (reunião na BM = Interna, online/Meet = Virtual, outra reunião = Externa, o resto = Tarefa). Sincroniza a cada minuto (cron da Vercel) e pelo botão "Sincronizar agora".
- Reuniões levam ícone no começo do assunto: 🚗 Externa, 🏠 Interna, 💻 Virtual.
- Tipos de atividade: "Reunião" passa a se chamar Reunião Interna; novos Visita, Reunião Externa e Reunião Virtual.
- Atividades/Tarefas: visões Semana (domingo primeiro, grade de horas) e Mês, além da Lista; atividades vindas do Google em roxo (Origem "Google Agenda"); clicar numa atividade abre embaixo a ficha com todos os campos e os textos completos (observação, resultado, resumo do bot).
- Páginas públicas de Política de Privacidade (/privacidade.html) e Termos de Serviço (/termos.html), exigidas pelo Google.
- WhatsApp: o aviso "Atendimento liberado pelo tempo" diz quem não respondeu (o atendente ou o cliente).

## 0.0.63 — 2026-09-30

- Aviso de atividade nova: quando outra pessoa marca uma atividade para o usuário (Quem executa) ou para o departamento dele (sem usuário), toca a campainha e mostra o aviso em qualquer tela; com o navegador em outra janela ou aba, notificação do sistema que abre Atividades. As que o próprio usuário grava não avisam.
- Login: título "CRM" no lugar de "Gestão Comercial".

## 0.0.62 — 2026-09-30

- Pesquisa de satisfação: depois do primeiro sorteio o filtro (e a quantidade) não muda mais — tela bloqueada com aviso, sem "Salvar e sortear"; o servidor mantém o filtro gravado. Mais atendimentos, só pelo "Sortear +x".

## 0.0.61 — 2026-09-29

- Banco: tabelas `pesquisas_satisfacao`, `pesquisas_satisfacao_itens` e `whatsapp_atendimentos`; `avaliacoes.chamado_id`; `atividades.resultado` e `atividades.concluida_por` (SQL em extras/crmweb_schema.sql). Bibliotecas novas: imapflow e mailparser (leitura de e-mail).
- Suporte › Pesquisa de Satisfação: abas Pesquisas, Filtro (período — abre em ontem —, chamados/WhatsApp, notas, segmentos, clientes, técnicos, departamentos, categorias, não repetir cliente, quantos sortear) e Atendimentos Selecionados (sorteio, marcar/desmarcar, Executar, Sortear +x, contato de cada cliente, retorno). WhatsApp: conversa do Bot com análise (nota, comentário, resumo); e-mail: texto da IA com código no assunto e leitura das respostas por IMAP; ligação: atividade para quem liga e modal de retorno. Precisa retornar: tarefa para o técnico que atendeu.
- Atendimentos do WhatsApp encerrados passam a ser registrados (whatsapp_atendimentos), com a avaliação ligada; a avaliação do chat do site aponta para o chamado.
- Configurações › E-mail: duas contas — comercial (propostas, pedidos, contratos, campanhas) e do suporte (pesquisa de satisfação, Bot de chamados; em branco usa a comercial) — com servidor IMAP.
- Suporte › Consulta de Chamados: todos os chamados com busca avançada (cliente, datas, status, técnico, categoria, nota...) e "Abrir" em Chamados Ativos.
- Chamados Ativos: botão "Histórico (n)" com os outros chamados do cliente (mesma pessoa ou mesmo CNPJ/CPF do site), com a conclusão, e "Abrir".
- Atividades/Tarefas: menu "..." com Concluir (janela do resultado), Conversa do Bot e Registrar retorno; coluna Resultado; grava quem concluiu (coluna "Concluída por"; "Bot" quando o Bot conclui; linha no chamado com o nome); filtro rápido Concluída (abre em Não).
- WhatsApp: cortesia logo depois do agradecimento da pesquisa ou do encerramento ("de nada", "obrigado", "👍") não abre conversa nova; filtro abre em "Aguardando + Em atendimento".
- Menu: WhatsApp em Suporte; Atividades/Tarefas na Visão Geral; Templates em Cadastros.

## 0.0.60 — 2026-09-29

- WhatsApp: atendimento encerrado por falta de interação não manda mais a pesquisa de satisfação (o cliente estava ausente; a resposta atrasada abria um atendimento novo).
- Atividades: menu renomeado para "Atividades/Tarefas"; coluna "Origem" (Bot, Pendência da conversa, Chamado, Manual), também na busca avançada; tarefas da análise de pendências saem com a hora da análise.
- Busca avançada: "Aplicar filtros" sempre aplica e fecha o painel (Limpar mantém aberto).

## 0.0.59 — 2026-09-29

- Pendências de conversa: quando um atendimento do WhatsApp é encerrado (botão, tempo, fim da automação, falta de interação), um chamado é encerrado ou uma conversa do Bot das atividades termina (inclusive passada para a equipe), a IA lê a conversa inteira e cria tarefas para o que ficou pendente (pediu para falar com alguém, reclamação, pedido não resolvido): para o usuário identificado, senão o departamento, senão o responsável escolhido em Configurações › Chatbot (sem ele: o primeiro administrador). Linha "Análise da conversa" no WhatsApp/chamado; não repete tarefas abertas do cliente. Liga/desliga em Configurações › Chatbot.
- Bot das atividades: conversa passada para a equipe cujas pendências viraram tarefas conta como resolvida (a atividade pode ser concluída).
- WhatsApp: filtro "Aguardando + Em atendimento"; data junto com a hora nas mensagens e nas linhas de evento/encerramento.
- Atividades: lista abre com o vencimento mais recente primeiro (mesmo dia pela hora); ícone do Bot em todas as linhas (apagado nas atividades sem Bot).

## 0.0.58 — 2026-09-29

- Banco: `atividades.executor_bot`, `bot_iniciado_em`, `bot_resumo`, "todos" em `lembrete_para`; tabelas `atividade_conversas` e `atividade_mensagens` (SQL em extras/crmweb_schema.sql).
- Atividades: "Quem executa" = Bot. No dia e hora (sem hora: 8h), a IA (Configurações › Chatbot) conversa pelo WhatsApp com quem está em "Lembrete para", seguindo o assunto e a observação, até cumprir; sem WhatsApp, e-mail único. Pede atendente/reclama: passa para a equipe (conversa "Aguardando" no WhatsApp) e avisa o responsável. Sem resposta: insistência em 24 h e, mais 24 h, "sem resposta". Tudo cumprido: atividade concluída com resumo; senão fica pendente com o resumo. Janela "Conversa do Bot" (chat por pessoa) na lista de Atividades, na ficha do negócio e nas tarefas do chamado.
- "Lembrete para": opção "Todos os envolvidos" (cliente, vendedor e envolvidos), também no lembrete automático.
- Tela de login: versão do sistema no rodapé.

## 0.0.57 — 2026-09-29

- Chat do site: a notificação do Windows aparece a cada mensagem do técnico (antes, com a anterior ainda na Central de Notificações, a nova só a substituía em silêncio).

## 0.0.56 — 2026-09-29

- Banco: `atividades.chamado_id` e tabela `atividade_envolvidos` (SQL em extras/crmweb_schema.sql).
- Chamados: botão "Tarefa" cria uma atividade ligada ao chamado e ao cliente (prazo, quem executa, envolvidos; lembrete para quem executa). Lista de tarefas no chamado, com concluir/reabrir; criar, concluir e reabrir entram na linha do tempo. Encerrar com tarefa aberta avisa, sem bloquear.
- Atividades: vários usuários envolvidos (janela da atividade e formulário), colunas Chamado e Envolvidos na lista; "Minhas" inclui as que o usuário acompanha. Painel: "Chamado nº" nas próximas atividades.
- Chat do site: resposta do técnico toca som (se o cliente não estiver digitando), abre o painel do widget sozinho e, com a página fora de vista, pisca o título da aba e mostra notificação do Windows (clique traz a janela; permissão pedida ao abrir o chat, só em https). Cutucão: "precisa de sua atenção".

## 0.0.55 — 2026-09-29

- WhatsApp: filtro na lista de conversas (Todas, Aguardando, Em atendimento, Encerradas); a tela abre em Aguardando.

## 0.0.54 — 2026-09-28

- Banco: `campanha_disparos.respondido_em` e `negocios.campanha_id` (SQL em extras/crmweb_schema.sql).
- Campanhas: mensagem recebida da pessoa até 15 dias depois do envio marca o disparo como respondido ("Respondeu em" no painel Disparos), por qualquer número.
- Campanhas: o lead aberto pela IA fica com a "Campanha de origem" (a da conversa no número das campanhas ou, no padrão, a recebida nos últimos 15 dias); campo novo em Negócios.
- Lista de Campanhas: colunas Responderam e Leads.

## 0.0.53 — 2026-09-28

- Banco: `whatsapp_conversas.conta`, `campanhas.instrucoes_ia` e `pessoas.nao_receber_campanhas` (SQL em extras/crmweb_schema.sql).
- Whatsapp: a conversa lembra por qual número entrou (padrão ou WhatsApp das campanhas) e tudo sai por ele: bot, respostas da tela, "digitando", mídia; etiqueta "Campanha" na lista. Trocar de número recomeça a automação.
- Automação das campanhas (Configurações › Automação › Campanhas): fluxo próprio para quem responde no WhatsApp das campanhas. A IA recebe a mensagem da campanha que a pessoa recebeu (últimos 15 dias) e as "Instruções para a IA" da campanha; o lead abre o negócio "Campanha <nome>: <interesse>".
- Campanhas: "SAIR" (ou "parar", "não quero mais"...) no WhatsApp das campanhas descadastra a pessoa ("Não receber campanhas" em Pessoas), cancela os disparos pendentes dela e confirma; o público e a geração de disparos deixam os descadastrados de fora.

## 0.0.52 — 2026-09-28

- Banco: `campanhas.imagem` (SQL em extras/crmweb_schema.sql).
- Campanhas: imagem opcional (PNG, JPEG ou WebP, até ~700 KB): no WhatsApp vai com a mensagem de legenda (texto acima de 1.000 caracteres sai numa mensagem logo depois da imagem); no e-mail, como anexo. A pré-visualização mostra a imagem.
- Configurações › WhatsApp: "WhatsApp das campanhas", outro número só para as campanhas (mesmos campos, teste, QR Code e recebimento), para um bloqueio por disparo em massa não derrubar o número do atendimento. Sem ele, as campanhas saem pelo WhatsApp padrão. Respostas a esse número entram na conversa sem o bot responder. A instância precisa ser diferente da padrão.
- Disparos: botão para enviar na hora um disparo pendente ou que falhou (mesma trava do envio automático, sem duplicar); o painel "Disparos" se atualiza depois de gerar e de enviar; cabeçalho "Ações" no painel de detalhe quando há botões extras.
- Campo de data e hora: a hora não toma mais a linha (a data e o ícone do calendário sumiam).

## 0.0.51 — 2026-09-28

- Banco: campanhas unificadas. `campanhas` ganhou criterios, publico_estimado, assunto, mensagem e enviar_a_partir_de; nova tabela `campanha_disparos`; saem campanha_segmentos, campanha_segmento_pessoas, campanha_mensagens e disparos_mensagens (SQL em extras/crmweb_schema.sql; etapa 2 — apagar as tabelas antigas — depois desta versão no ar).
- Campanhas: tudo numa tela só — público por critérios, "Enviar por" (WhatsApp, e-mail ou WhatsApp ou e-mail), assunto, mensagem com variáveis e "Enviar a partir de". Outro público ou outro texto = outra campanha. Menu Marketing: só Campanhas e Disparos.
- Campanhas: "Gerar disparos" cria um registro por pessoa (cliente, canal, celular/e-mail, assunto e mensagem já personalizados, situação, agendamento); quem não tem o contato fica de fora, quem já recebeu não recebe de novo, os pendentes são refeitos. "Pré-visualizar" mostra o público e a mensagem pronta. Ações no menu "...".
- Campanhas: envio por e-mail (SMTP da empresa), além do WhatsApp; falha do servidor de e-mail deixa o disparo pendente para o próximo ciclo.
- Segmentos de campanha: o campo "Tipo" saiu da tela (coluna com padrão no banco).

## 0.0.50 — 2026-09-28

- Importar BM (pessoas): o campo personalizado "revenda", se existir, recebe o nome do vendedor do bmsoft (PESSOAS.ID_Vendedor → VENDEDORES.Nome), usando a opção da lista com o mesmo nome (sem diferenciar maiúsculas) ou o nome como veio.
- Importar BM (pessoas): o endereço do cadastro do bmsoft entra em Endereços da pessoa, marcado "Importado do bmsoft" (principal quando a pessoa ainda não tem um); as próximas importações atualizam só esse endereço.
- Busca avançada: os campos personalizados podem entrar na busca (lupa no formulário); lista vira combo, Sim/Não, faixas para número e data, texto por "contém". Filtro no servidor dentro do JSON.
- Busca avançada: "Aplicar filtros" fecha o painel (fica o resumo); "Limpar filtros" mantém aberto.
- Configurações › Campos Personalizados: interruptores e botões alinhados com os títulos das colunas.

## 0.0.49 — 2026-09-28

- Suporte pelo site (/suporte): CNPJ/CPF, nome, WhatsApp e descrição obrigatórios na tela (barra âmbar), com as mesmas regras do servidor: o navegador avisa antes de enviar.

## 0.0.48 — 2026-09-28

- Suporte pelo link direto (/suporte?e=<empresa>&cnpj=<opcional>, para mandar ao cliente): no computador abre como o painel do widget, centralizado; no celular, a tela toda. Dentro do widget, no site, nada muda.

## 0.0.47 — 2026-09-28

- Chamados Ativos: depois de gravar uma nota interna, o interruptor "Nota interna" volta a desligado (a próxima mensagem é resposta ao cliente).

## 0.0.46 — 2026-09-28

- Banco: `chamados.conclusao` (SQL em extras/crmweb_schema.sql).
- Chamados Ativos: ao encerrar, o técnico escreve a conclusão do atendimento (obrigatória); ela aparece no fim da conversa do chamado encerrado, com o técnico e a hora. Só a equipe vê.
- Chamados: o "Conectar" do AnyDesk usa o número do cadastro da pessoa ou, sem ele (ou sem pessoa), o último que o mesmo cliente mandou em qualquer chamado (mesma pessoa ou mesmo CNPJ/CPF). O número enviado pelo site vai também para a pessoa com o CNPJ/CPF informado, quando o chamado não tem pessoa.

## 0.0.45 — 2026-09-28

- Banco: nova tabela `templates_mensagens` (SQL em extras/crmweb_schema.sql).
- Suporte › Templates: cadastro de mensagens prontas (descrição, texto, canal WhatsApp/Suporte/ambos, ativo), com permissão por usuário. Botão de templates ao lado do campo da mensagem no WhatsApp e nos Chamados Ativos: busca, e ao escolher o texto vai para o campo com {{nome}}, {{primeiro_nome}} e {{atendente}} trocados.
- Whatsapp: card em atendimento com barra azul de 3 px na borda esquerda; sem hora de início gravada, o card mostra só o nome do atendente.
- Avisos sonoros: campainha ("ding-dong") quando um chamado ou uma conversa do WhatsApp é transferido para o técnico, quando um chamado é transferido para o departamento dele (antes sem som) e quando uma conversa do WhatsApp chega ao departamento dele (antes dois bipes). Quem transferiu não ouve.

## 0.0.44 — 2026-09-28

- Whatsapp: ícone "Limpar a conversa" no cabeçalho (só administrador, com confirmação): apaga as mensagens do número no CRM e a situação do atendimento; a próxima mensagem do cliente começa do zero. Pesquisa pendente expira; chamados perdem só a ligação com a resposta apagada.

## 0.0.43 — 2026-09-28

- Whatsapp: encerramento por falta de interação. Cliente sem responder X minutos à última mensagem do bot ou do técnico (Configurações › Chatbot, padrão 10; 0 desliga): o bot avisa que vai encerrar e, 30 s depois sem resposta, encerra (pesquisa se um técnico atendia). Não vale para conversa aguardando atendente, parada num Esperar da Automação ou campanhas. Roda no cron do WhatsApp e no servidor local, com trava no banco.
- Whatsapp: tag "Encerrado" na lista depois de encerrar, até o cliente mandar mensagem de novo (a nota da pesquisa não conta).
- Whatsapp e Chamados Ativos: o chat fica na última mensagem enquanto o técnico está no fim (imagem, áudio ou resposta do bot que chega depois não escondem mais o fim).
- Chat do site: sem "Pular avaliação"; o cliente avalia para abrir um novo atendimento.

## 0.0.42 — 2026-09-28

- Chatbot: escolha da IA usada pela Automação: Gemini, Claude (Opus 5, Sonnet 5, Haiku 4.5) ou DeepSeek (deepseek-flash). Cada IA com a sua chave (gravada cifrada; trocar de IA não apaga a chave da outra). O nome do assistente é o primeiro campo da tela.
- Chatbot: Claude e DeepSeek pelo SDK oficial da Anthropic (`@anthropic-ai/sdk`); o DeepSeek pelo endereço compatível (api.deepseek.com/anthropic). Claude com esforço baixo e, no Opus 5, fallback automático da Anthropic quando o filtro de segurança recusa.
- Automação: os nós passaram a se chamar "IA" e "IA Ex"; a linha de falha explica também os erros do Claude e do DeepSeek (créditos/saldo acabaram, sobrecarga 529, chave inválida).
- Whatsapp: documento enviado pelo cliente (PDF, planilha...) baixa ao clicar, com o nome original.

## 0.0.41 — 2026-09-28

- Banco: `pessoas.tecnico_padrao_id` (SQL em extras/crmweb_schema.sql).
- Pessoas: campo "Técnico Padrão" (quem atende os chamados e o WhatsApp do cliente; outro técnico ainda pode assumir).
- Fila de Chamados: coluna "Técnico" com o técnico padrão do cliente. Chamados Ativos mostram o técnico padrão enquanto o chamado está sem atendente, e no cabeçalho do chamado quando outro técnico atende.
- Whatsapp: etiqueta com o técnico padrão nas conversas que ninguém atende; o filtro "minhas" traz também as conversas aguardando dos clientes de que o usuário é o técnico padrão.
- Automação: falha (Gemini sobrecarregado, limite de uso/tokens, chave inválida, API, imagem, laço etc.) vira uma linha em vermelho na conversa, só para a equipe, com o erro em português.
- Automação: quando o Gemini falha nos nós IA e IA Ex, o cliente é avisado e a conversa passa para a equipe (aguardando atendente) em vez de ficar sem resposta.

## 0.0.40 — 2026-09-27

- Banco: `chamados.status` ganhou 'pausado'; nova tabela `chamado_secoes`; `chamado_mensagens.secao_id` (SQL em extras/crmweb_schema.sql).
- Chamados: seções de atendimento. Assumir, abrir já atendendo ou receber por transferência abre uma seção (atendente e início); pausa, transferência e encerramento a fecham (fim e motivo). Toda mensagem grava a seção aberta.
- Chamados Ativos: botão "Pausar". O chamado volta para a Fila sem atendente, com a etiqueta "Pausado" (qualquer um assume), e o cliente recebe a mensagem de pausa (chat do site ou WhatsApp). Cutucar e Tela Remota saíram do cabeçalho (ficam ao lado de "Nota interna").
- Chamados Ativos: ao encerrar ou pausar, a tela vai para a Fila de Chamados.
- Chamados: quem é do departamento Suporte ouve um som próprio ("dim-dim-dom") e vê um aviso quando entra chamado novo na fila, e começa o sistema na Fila de Chamados.
- Chamados: o aviso de mensagem do cliente só conta mensagens que chegaram depois que o técnico assumiu (assumir um chamado pausado não dispara mais aviso falso).
- Chat do site: "Recebemos sua mensagem." e, na linha de baixo, "Se quiser, mande mais detalhes por aqui."
- Menu: "Conversas" passou a "Whatsapp".

## 0.0.39 — 2026-09-27

- Menu: ícone de cadeado ao lado do nome do usuário para alterar a própria senha (confere a atual, nova com pelo menos 4 caracteres, gravada em bcrypt).
- Chat do site: "Recebemos o seu pedido" passou a "Recebemos sua mensagem...".

## 0.0.38 — 2026-09-27

- Fila de Chamados: mesmo visual das listas do app (painel chapado, barra no topo, grade de ponta a ponta com cabeçalho fixo e coluna Ações).
- Chamados Ativos: "Conectar" (no cabeçalho e na mensagem com o número do AnyDesk) pede a tela remota no chat do cliente e já abre o AnyDesk do técnico conectando.

## 0.0.37 — 2026-09-27

- Chamados Ativos: os botões "Cutucar" e "Tela Remota" aparecem também ao lado do "Nota interna", junto do campo da mensagem (continuam no cabeçalho).

## 0.0.36 — 2026-09-26

- Chamados: aviso sonoro (três notas, diferente do bipe do WhatsApp) e aviso na tela quando o cliente escreve num chamado aberto que o usuário atende; a conversa aberta se atualiza. A verificação passou a cada 5 s.
- Chamados Ativos: botão "Cutucar" (chamado do site, já assumido, no máximo um a cada 10 s). No chat do cliente toca uma campainha, o chat treme e aparece "Fulano está chamando a sua atenção"; com o painel do widget fechado, o botão flutuante no site treme e ganha um ponto vermelho.

## 0.0.35 — 2026-09-26

- Chamados Ativos e chat do site: o campo da mensagem não é mais desabilitado durante o envio (fica só leitura), então o cursor não sai dele e dá para escrever a próxima sem clicar; Enter repetido durante o envio é ignorado.

## 0.0.34 — 2026-09-26

- Chamados Ativos e chat do site: depois de enviar a mensagem (Enter), o cursor volta para o campo, para escrever a próxima sem clicar.

## 0.0.33 — 2026-09-26

- Suporte pelo site: ao terminar o atendimento, o chat volta direto ao formulário de novo atendimento (sem o botão "Novo atendimento"). Cancelado vai na hora; encerrado mostra a avaliação e, ao enviar (ou "Pular avaliação"), volta ao formulário com um aviso, os dados do cliente preenchidos e o foco no Assunto.

## 0.0.32 — 2026-09-26

- Suporte pelo site: botão "Encerrar" no chat do cliente (com confirmação). Com atendente, o chamado fica encerrado e o cliente avalia; sem ninguém ter assumido, fica cancelado (saiu da fila), sem avaliação. A linha do tempo da equipe registra quem encerrou.

## 0.0.31 — 2026-09-26

Número do AnyDesk pelo chat e botão Conectar. Banco: coluna pessoas.anydesk_id.

- Suporte pelo site: o cartão "Acesso remoto" tem o campo para o cliente enviar o número do AnyDesk ("Seu endereço").
- Chamados Ativos: o número chega na linha do tempo com o botão "Conectar", que abre o AnyDesk do técnico já conectando no cliente (anydesk:<número>); o botão também fica no cabeçalho do chamado.
- O número fica gravado na Pessoa (campo "ID AnyDesk", editável no cadastro): nos próximos chamados do cliente o "Conectar" já aparece.

## 0.0.30 — 2026-09-26

- Suporte pelo site: pedido de Tela Remota que chega com o chat aberto tenta abrir o AnyDesk sozinho, uma vez (num quadro invisível, sem tirar o chat da tela). Se o navegador bloquear (sem clique recente do cliente), fica o cartão com o botão "Abrir AnyDesk".

## 0.0.29 — 2026-09-26

- Chamados Ativos: botão "Tela Remota" (chamado do site, já assumido). O chat do cliente mostra o cartão "Acesso remoto" com "Abrir AnyDesk" (protocolo anydesk://) e o link para baixar; o cliente manda no chat o número do AnyDesk para o técnico conectar. O pedido fica na linha do tempo do chamado.

## 0.0.28 — 2026-09-26

- Widget de suporte (widget.js): funciona também quando o site insere o script depois de carregar (Wix › Código personalizado) ou no <head>.

## 0.0.27 — 2026-09-26

Chamados de suporte, suporte pelo site, fotos de produtos e a Automação no lugar do Chatbot. Banco: tabelas chamados, chamado_mensagens e chamado_categorias; colunas chamados.contato_nome/contato_telefone/contato_documento e produtos.fotos. Vercel: Blob ligado ao projeto (BLOB_READ_WRITE_TOKEN).

- Suporte › Fila de Chamados: chamados aguardando, em ordem de chegada (posição, cliente, categoria, prioridade, espera, SLA vencido) e Assumir; etiqueta com a quantidade no menu.
- Suporte › Chamados Ativos: lista com filtros rápidos (Meus, Todos, Aguardando, Em andamento, Encerrados) e busca; chamado aberto com a linha do tempo, resposta ao cliente (vai pelo WhatsApp da pessoa) ou nota interna, Assumir, Transferir (usuário ou departamento, que devolve à fila) e Encerrar. Novo Chamado com busca do cliente, categoria (SLA em horas), prioridade, canal e "Atender agora". Cadastros › Categorias de Chamado. As duas telas entram nas Permissões.
- Suporte pelo site: widget.js (botão flutuante + painel) abre /suporte, onde o cliente abre o chamado (CNPJ/CPF, nome, WhatsApp, assunto e descrição), vê a posição na fila, conversa com a equipe e avalia de 1 a 5 no fim. O acesso ao chamado é pelo token assinado guardado no navegador que abriu.
- Produtos: até 4 fotos (do computador ou da internet), reduzidas a 400 px no lado maior e gravadas no Vercel Blob no padrão do b2b (produtos/<empresa>/<id 9 dígitos>-<posição>.jpg, ?v=<md5>); saem do storage ao remover e ao excluir o produto.
- Listas: o nome do registro ligado (produto do item de pedido, pessoa do negócio...) vem do servidor; não aparece mais "…" em cadastros com mais de 5.000 registros.
- Configurações: a aba Jornada virou Automação e é quem atende o WhatsApp; o Chatbot ficou só com chave, modelo, nome, tempo para devolver ao bot, revezamento e pesquisa. O nó IA (Gemini) ganhou texto-base próprio (sem ele, usa o texto-base antigo). Saíram o bot sem automação e o menu de departamentos do Chatbot.

## 0.0.26 — 2026-09-26

Importação do bmsoft pelo token da bmAPI e importação de produtos. Banco: coluna produtos.cod_integracao (única por empresa).

- Importar BM: pede o token da bmAPI (X-API-Key) no lugar do número do servidor. O CRM acha o servidor dono do token em bmapi.servidores (endereço, porta e identificação, mostrada ao lado do campo enquanto se digita) e grava o token cifrado na configuração da empresa: nas próximas vezes não precisa digitar ("Trocar token" para mudar). O token não volta ao navegador; a busca pelo número do servidor saiu.
- Produtos › Importar BM: importa PRODUTOSPRINCIPAL (ID → cód. integração BM-<id> e SKU, Descricao → nome, Texto → descrição, PrecoVenda1 → preço de tabela, UNVenda → unidade, Ativo → ativo). Entram os ativos; os já importados são atualizados, inclusive desativados quando ficam inativos no bmsoft.

## 0.0.25 — 2026-09-25

Menu lateral recolhível e ajustes na tela de aprovação da proposta.

- Menu lateral: alça fina com chevron, centralizada na borda, recolhe o menu para uma faixa só com os ícones (nome no tooltip; conversas não vistas como ponto vermelho) e abre de novo. A escolha fica guardada no navegador. No celular continua a gaveta.
- Aprovação da proposta pelo link: no lugar dos botões Aprovar/Recusar, o título "Para aprovar preencha abaixo:" com o formulário de aprovação; embaixo de "Aprovar e assinar", o botão "Recusar a Proposta", que abre o motivo da recusa com Voltar e Confirmar recusa.

## 0.0.24 — 2026-09-25

Jornada: nó "IA (Gemini) Ex"; ações das listas em menu "...".

- Nó "IA (Gemini) Ex" (Integrações): texto-base próprio (o que a IA deve fazer) e de 1 a 9 saídas ("quando o cliente quiser..."), cada uma um ponto de ligação, mais "não identificou". A IA pergunta, entende a resposta (número ou palavras) e segue pela saída certa; se a primeira mensagem já disser o que o cliente quer, vai direto (número solto na abertura não conta). Sem entender depois das tentativas configuradas (padrão 3), ou sem o Gemini, sai por "não identificou". A escolha fica em {{ia_opcao}}. Usa a chave e o modelo de Configurações › Chatbot.
- Propostas e Pedidos de Venda: a coluna Ações virou um botão "..." com menu popup (ícone e nome de cada ação; Editar e Excluir no fim). Regra: coluna com mais de 3 ícones usa o menu.

## 0.0.23 — 2026-09-25

Aprovação da proposta pelo cliente com assinatura digital. Banco: colunas propostas.aceite_* (token, em, nome, documento, ip, navegador, assinatura, hash).

- Envio da proposta (WhatsApp ou e-mail): além do PDF, a mensagem leva o link único /p/<código> para o cliente aprovar e assinar. Ícone "Copiar link" na lista de propostas para mandar por outro meio.
- Tela do cliente (sem login, pensada para celular): empresa, número/versão, itens, total, validade, condições e PDF. Aprovar: nome, CPF/CNPJ, assinatura desenhada no quadro e "Li e aprovo". Recusar: nome e motivo. Link de proposta já respondida, vencida, substituída por versão nova ou fechada mostra o aviso correspondente.
- Aprovação: proposta aceita, demais versões fechadas e pedido gerado (mesma rotina do botão Aprovar); grava data/hora, IP, navegador, a imagem da assinatura e o hash SHA-256 do conteúdo aprovado. Recusa: proposta recusada, motivo no histórico. Nos dois casos o dono do negócio é avisado pelo WhatsApp.
- Na proposta aberta no CRM, quadro com a resposta do cliente (assinatura, documento, data, IP e hash).

## 0.0.22 — 2026-09-25

Pesquisa de satisfação do WhatsApp. Banco: tabela avaliacoes.

- Sai quando a equipe clica em Encerrar numa conversa que atendeu e quando o cliente chega ao fim da jornada: nota de 1 a 5 (número ou estrelas); nota de 1 a 3 pede um comentário; agradecimento no fim. Resposta que não é nota descarta a pesquisa e segue o atendimento normal; sem resposta, vence nos minutos configurados. As respostas não acionam o bot nem entram no histórico da IA.
- Configurações › Chatbot › Pesquisa de satisfação: liga/desliga (começa desligada), textos da pergunta ({{atendente}}), do pedido de comentário e do agradecimento, validade em minutos e prévia.
- Resultados: linha na conversa ("Cliente avaliou ⭐⭐⭐⭐ (4)" e o comentário), tela Vendas › Avaliações (só leitura, com filtros) e card "Satisfação no mês" no Painel de Vendas (média geral e por atendente).

## 0.0.21 — 2026-09-25

Usuários: permissões, perfis e revezamento de leads. Banco: colunas usuarios.permissoes (JSON) e usuarios.revezamento; usuarios.tipo com os perfis admin, gerente, supervisor, client (Vendedor) e funcionario.

- Usuários › Permissões (ícone na coluna Ações): modal com as opções do menu, agrupadas como na barra lateral, para liberar ou não cada uma (com "Marcar todos" por grupo e destaque da linha). Sem permissão, a opção some do menu e o servidor recusa a lista daquele cadastro, o Painel, as Conversas e as Configurações; combos dos formulários e painéis de detalhe continuam funcionando. Usuário sem nada gravado acessa tudo; administrador acessa tudo.
- Configurações e Usuários: só administradores (os campos personalizados de Pessoas continuam lidos por todos).
- Perfis: Administrador, Gerente, Supervisor, Vendedor e Funcionário.
- Revezamento de leads: campo "Entra no revezamento de leads" no cadastro do usuário (qualquer perfil). Chatbot e jornada distribuem os leads entre os usuários ativos com o campo ligado; ninguém no revezamento, o lead fica sem responsável. Configurações › Chatbot mostra quem está no revezamento (a lista de vendedores que ficava lá saiu).
- Jornada: ao chegar ao Fim (ou a uma saída sem ligação), a conversa ganha a linha "Atendimento encerrado pelo cliente (fim da jornada)".

## 0.0.20 — 2026-09-25

- Conversas: ao enviar, o botão mostra "Enviando..." e o campo de mensagem fica desabilitado até terminar; depois o cursor volta ao campo.

## 0.0.19 — 2026-09-25

- Conversas: Encerrar só aparece com atendimento em andamento (e o servidor recusa encerrar de novo); Transferir só para quem está atendendo (ou o administrador); botões desabilitados enquanto a ação é gravada.

## 0.0.18 — 2026-09-25

Conversas: atender, travar e transferir. Banco: coluna whatsapp_conversas.atendido_em.

- Estados da conversa: com o bot/jornada, Aguardando (ninguém pegou) ou Em atendimento (quem e desde quando), no cabeçalho e no card da lista.
- Botão Atender: pega a conversa e trava para o atendente (os outros veem, mas não respondem nem mudam o atendimento; o servidor também recusa). Administrador pode Assumir de outro. Responder sem ninguém atendendo pega a conversa.
- Transferir: para um atendente (já fica com ele) ou para um departamento (volta a aguardar, com aviso sonoro para quem é de lá).
- Atendente que pegou e não respondeu no tempo de devolver ao bot: a conversa volta a aguardar. Com o chatbot desligado, conversa sem atendente fica aguardando.
- Linhas na conversa (só no CRM): começou o atendimento, assumiu, transferiu, devolveu ao bot, liberado pelo tempo.
- "Só as minhas": as que eu atendo e as que aguardam no meu departamento (ou sem departamento).

## 0.0.17 — 2026-09-25

- Conversas: linha "Atendimento encerrado pelo tempo, sem resposta de atendente" quando a conversa volta ao bot pelo tempo, com a hora em que o tempo acabou; a IA também recomeça depois dela.
- Conversas: a barra de gravação de áudio tem a mesma altura do campo de texto (os botões não achatam mais).

## 0.0.16 — 2026-09-25

- Conversas: Encerrar deixa uma linha na conversa ("Atendimento encerrado por Luis · 14:01"), que não vai para o cliente; a IA passa a considerar só as mensagens depois do último encerramento.
- Ícone do app: funil de vendas no azul do logo (public/favicon.svg), no lugar do ícone padrão.

## 0.0.15 — 2026-09-25

- Jornada: depois do Fim (ou de uma saída sem ligação), a próxima mensagem do cliente recomeça a jornada do Início (antes só recomeçava depois dos minutos de devolver ao bot).

## 0.0.14 — 2026-09-25

- Conversas: resposta do bot ainda sendo escrita aparece como "digitando..." (não mais um balão vazio com relógio); as respostas do bot aparecem com o nome do assistente ("Eloisa (bot)").
- Chatbot: a IA só pode dizer que vai transferir se usar a transferência para humano na mesma resposta.

## 0.0.13 — 2026-09-25

- Jornada: os tipos de nó ficam numa barra lateral à esquerda do quadro, agrupados (Conversa, Lógica, Integrações, CRM, Encerrar). Clique inclui no centro do quadro; arrastar até o quadro inclui onde for solto.

## 0.0.12 — 2026-09-25

- Conversas: botão Encerrar — fim da sessão, como se o tempo de devolver ao bot tivesse passado (sai do departamento e da jornada; a próxima mensagem do cliente recomeça). "Devolver ao bot" agora continua a mesma sessão (mantém o departamento). Os botões aparecem também nas conversas atendidas pela jornada.
- Aviso sonoro e na tela, em qualquer tela do app (consulta a cada 15 s, também com a aba em segundo plano), quando um cliente é encaminhado ao departamento do usuário e ninguém assumiu.
- Mensagens enviadas pela tela Conversas chegam ao cliente com o nome do atendente em negrito ("*Luis:* ..."), também na legenda de imagem, vídeo e documento; no CRM ficam gravadas sem o nome.

## 0.0.11 — 2026-09-25

WhatsApp: jornada de atendimento, menu de departamentos, envio de mídia e quem executa as atividades. Banco: tabelas departamentos e jornada_arquivos; colunas usuarios.departamento_id, atividades.executor_id e departamento_id, whatsapp_conversas.departamento_id, no_atual, variaveis e retomar_em. Dependência nova: @xyflow/react.

- Configurações › Jornada: editor gráfico do atendimento do WhatsApp (arrastar nós e ligar saídas). Nós: Início, Mensagem, Enviar imagem, Menu, Pergunta, Condição (horário, cadastrado, negócio aberto, variável), Condição múltipla, Esperar (retomado pelo cron), Chamar API (https, variáveis, cabeçalhos secretos cifrados, campos da resposta viram variáveis), IA (Gemini), Registrar lead, Departamento e Fim. Modo teste (só os números da lista) ou todos os clientes; modelo a partir do menu do Chatbot.
- Chatbot: menu de departamentos (número ou texto, com a IA como apoio); por departamento, o bot continua ou passa direto para humano, com atividade para o departamento e aviso no WhatsApp de quem é dele. Tempo para devolver ao bot agora em minutos (a configuração antiga, em horas, é convertida). O bot não responde números de usuários da empresa.
- Conversas: enviar imagem, vídeo, áudio e documento (até 3 MB) e gravar áudio pelo microfone; etiqueta do departamento e filtro "Só as minhas".
- Cadastros › Departamentos; usuário com departamento. Atividade com "Quem executa" (usuário, departamento ou qualquer pessoa), coluna na lista e na ficha do negócio, filtro "Só as minhas". Lembrete "para o vendedor" vai para quem executa (sem executor, para o responsável do negócio).
- Configurações › WhatsApp: situação da conexão num quadro com o número conectado.
- Formulários de inclusão abrem com o foco no primeiro campo vazio.

## 0.0.10 — 2026-09-25

- Conversas: imagens, figurinhas, áudios e vídeos aparecem na conversa. O arquivo é buscado na Evolution na hora (o CRM não guarda a mídia); imagem abre em tamanho real ao clicar, áudio com player, vídeo carrega ao clicar em "Carregar vídeo". Mídia que o WhatsApp não tem mais aparece como "não disponível".

## 0.0.9 — 2026-09-25

Chatbot com IA (Gemini) no WhatsApp. Banco: tabela whatsapp_conversas.

- Configurações › Chatbot: liga/desliga, chave do Gemini (gravada cifrada), modelo (Gemini 3.8 Flash, 3.5 Flash, 3.5 Flash-Lite, 3.1 Flash-Lite), nome do assistente, texto-base da empresa, horas para devolver ao bot e vendedores do revezamento. Botão "Testar Gemini".
- O bot responde o tempo todo, com espera aleatória de 1 a 30 segundos e "digitando..." (evita banimento), só a última mensagem recebida e nunca duas vezes a mesma.
- Quem ainda não é cliente vira lead: pessoa com o WhatsApp, contato (se informou a empresa), negócio na primeira etapa do funil para o próximo vendedor do revezamento e atividade WhatsApp para ele.
- Passa a conversa para um humano quando o cliente pede ou quando não sabe responder. Conversas: etiqueta "Bot atendendo"/"Humano atendendo" com os botões Assumir e Devolver ao bot; responder pela tela assume a conversa; volta ao bot depois das horas configuradas sem resposta de atendente. Respostas do bot aparecem marcadas "Bot".
- Ficha do negócio: ícone do WhatsApp ao lado da pessoa, abre a conversa.
- Configurações › WhatsApp: a situação da conexão virou um quadro abaixo dos botões, com o número conectado e a instância.

## 0.0.8 — 2026-09-25

- Ícone do WhatsApp na lista de Pessoas e na aba Contatos do painel de detalhes: abre a conversa com o WhatsApp da pessoa (sem ele, o telefone) ou do contato (WhatsApp, celular, telefone). Sem número, o ícone fica apagado; sem DDD, avisa para corrigir o cadastro.
- Configurações › WhatsApp: uma instância só pode ser usada por uma empresa (o mesmo servidor + nome na Evolution, ou o mesmo ID na Z-API). Outra empresa com a mesma instância recebe "nome da instância inválido".

## 0.0.7 — 2026-09-25

WhatsApp, etapa 3 (mensagens automáticas), contatos das pessoas e nova conversa. Banco: colunas whatsapp_mensagens.origem, erro, nome_contato e contato_id; atividades.lembrete_para; usuarios.telefone; pessoas.whatsapp; tabela pessoas_contatos.

- Mensagens automáticas (Configurações › Mensagens automáticas): lembrete de atividade (X horas antes), proposta perto de vencer, pedido aprovado/faturado, contrato perto de vencer e assinatura pendente. Texto editável com variáveis, liga/desliga e antecedência por evento. Saem das 8h às 20h, junto com as campanhas (cron da Vercel), com a origem reservada antes do envio: o mesmo aviso nunca sai duas vezes.
- Lembrete de atividade: campo "Lembrete para" na atividade (cliente, vendedor, os dois, ninguém) e mensagem própria para o vendedor (responsável do negócio). Usuários ganham o campo WhatsApp.
- Ficha do negócio: atividade do tipo WhatsApp pendente abre a conversa com o cliente; enviar a mensagem por ali conclui a atividade.
- Contatos das pessoas (quem se fala na empresa-cliente): aba Contatos no painel de detalhes da lista de Pessoas, com incluir, editar e excluir; um principal por pessoa. Pessoa ganha o campo WhatsApp, usado primeiro nas campanhas, mensagens automáticas e no envio de proposta/pedido.
- Conversas: o número é ligado à pessoa ou ao contato (WhatsApp, celular, telefone); mostra o contato e a empresa, o nome do perfil do WhatsApp de quem não está cadastrado ("não cadastrado") e o número ao lado do nome. Cadastro rápido do número como nova pessoa ou como contato de uma pessoa. Botão "Nova" para abrir conversa com uma pessoa, um contato ou um número digitado. Mensagens automáticas aparecem marcadas; as que falharam mostram o motivo.
- Tipo de atividade WhatsApp; critério de segmento "Tem WhatsApp cadastrado"; variável {{whatsapp}} nas campanhas.

## 0.0.6 — 2026-09-24

WhatsApp, etapa 2: tela de conversas.

- Novo menu Conversas (Visão Geral), com a etiqueta de mensagens recebidas não vistas (atualiza a cada 30 s).
- Lista de conversas por número: nome da pessoa ou telefone formatado, prévia e horário da última mensagem, contador de não vistas e busca por nome ou telefone (atualiza a cada 10 s).
- Conversa: balões separados por dia, situação das enviadas (enviada, entregue, lida, falhou), quem enviou (usuário ou campanha), rótulo de imagem/áudio/documento; abrir marca como vistas; conversa sem pessoa é ligada ao cadastro quando o número passa a existir (atualiza a cada 5 s).
- Responder pela tela (Enter envia, Shift+Enter quebra a linha): sai pelo WhatsApp da empresa, registrada com o usuário.
- No celular, uma coluna por vez.
- Mensagens de empresas (botões, lista, modelo, interativa, enquete) e as respostas a elas passam a aparecer como texto; formato desconhecido fica registrado no log.

## 0.0.5 — 2026-09-24

WhatsApp, etapa 1: receber mensagens e status de entrega (Evolution API). Tabela nova whatsapp_mensagens.

- Recebimento: a Evolution avisa o CRM em /api/webhooks/evolution/<token> (o token identifica a empresa). Mensagens recebidas e as enviadas pelo celular são gravadas e ligadas à pessoa pelo telefone (com ou sem o 9, com ou sem DDI, endereçamento LID; cadastro sem DDD liga pelos 8 últimos dígitos). Grupos, reações e outras instâncias são ignorados.
- Mensagens enviadas pelo CRM (campanhas, proposta/pedido em PDF) ficam registradas com o id do WhatsApp, a pessoa e o usuário.
- Status de entrega: entregue/lida atualizam a mensagem e o disparo da campanha (entregue_em, lido_em), sem voltar atrás.
- Configurações › WhatsApp: quadro "Recebimento de mensagens" com o botão "Ativar recebimento", que cadastra o endereço na Evolution (recusa endereço local: ativar pela Vercel).
- Atividades: novo tipo WhatsApp.

## 0.0.4 — 2026-09-24

- WhatsApp: o botão "Desconectar" só fica liberado quando o número está comprovadamente conectado. Com a situação desconhecida (instância inexistente, chave recusada), ele ficava liberado e devolvia erro do provedor; nesses casos o "Testar conexão" mostra a causa.

## 0.0.3 — 2026-09-24

- WhatsApp (Evolution API): o QR Code fechava sozinho e avisava "conectado" sem o número ter sido lido. A Evolution 2.3.7 continua dizendo "open" em instance/connectionState e instance/connect depois que o aparelho é removido. A situação da conexão agora vem de instance/fetchInstances (Testar conexão, indicador Conectado/Desconectado e espera do QR), e quando o connect diz "open" sem estar conectado o app faz logout na instância e pede o QR de novo.

## 0.0.2 — 2026-09-24

Deploy na Vercel.

- Corrigido "Falha no login (HTTP 404)" na Vercel: só o frontend era publicado. O app Express passou para server/app.ts e é servido pela função api/index.ts; o vercel.json manda todo /api/* para ela. O server.ts ficou só para rodar local (Vite, porta e rotinas). Imports do servidor com extensão .js (a Vercel roda ESM sem empacotar).
- PDF de proposta, pedido e contrato na Vercel: Chromium para serverless (@sparticuz/chromium + puppeteer-core). Fora da Vercel continua o Edge/Chrome instalado.
- Rotinas pelo cron da Vercel (plano Pro): envio das campanhas de WhatsApp a cada minuto (/api/cron/whatsapp, até 45 s por execução, o resto fica para o minuto seguinte) e rotina de contratos a cada hora (/api/cron/contratos). Rotas protegidas pelo CRON_SECRET.
- Webhook da D4Sign processa o aviso antes de responder (na Vercel a função pode ser congelada depois da resposta).
- O build do servidor (server.cjs e sourcemap) saiu de dist/, que a Vercel publica, para build/.

## 0.0.1 — 2026-09-24

Primeira versão publicada no GitHub.

- CRM multiempresa: funil de vendas, negócios, atividades, pessoas, propostas (com versões) e pedidos, produtos, segmentos, contratos com assinatura pela D4Sign e campanhas por e-mail e WhatsApp.
- WhatsApp (Z-API ou Evolution API), em Configurações › WhatsApp: botão "Conectar WhatsApp" com QR Code que atualiza a cada 45 s e fecha sozinho ao conectar; botão "Desconectar" com confirmação; situação Conectado/Desconectado na tela, liberando só o botão que faz sentido. "Testar conexão" com o número desconectado passou a ser aviso, não erro.
- D4Sign: ao abrir a configuração com as chaves gravadas, o campo "Cofre dos contratos" já mostra o nome do cofre, não o UUID.
- Segurança: usuário e senha do MySQL saíram do código e passaram a ser obrigatórios no .env (MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD).
