# Log de execução

Checklist vivo do que está implementado, do que falta e de como testar. Atualizado a cada
fatia entregue.

Última atualização: 2026-11-22.

## Fase 1 — Fundação do mundo de salas ✅

Backend novo em `backend/src/features/rooms/`, isolado do modo dev.

**Dados** (`features/rooms/schema.sql`):
- `principals` — humano ou bot na mesma tabela; humano ligado a `users`, bot com config JSON.
- `rooms` + `room_members` — sala por projeto, com `lead_id` e `isolated`.
- `room_messages` — transcript único da sala, com FTS5.
- `room_deliveries` — uma entrega por (mensagem, destinatário), com chave de idempotência.
- `room_queue_state` — pausa por bot.
- `room_sessions` — sessão de CLI por (bot, sala), para retomar contexto.
- `room_tasks` e `cards` — tabelas do kanban já criadas; endpoints virão na fase 3.

**Fila** (`features/rooms/queue.rs`):
- Um worker por bot, uma entrega por vez.
- Retomada após restart: `starting`/`running` viram `interrupted`; `queued` volta a rodar.
- Pausa, retomada e cancelamento por token.
- Falha aparece na sala como mensagem do bot.

**Execução**:
- Reaproveita `features/agents/cli.rs`: Claude, Codex e OpenCode.
- System prompt = persona + instruções da sala + membros.
- Prompt = últimas 24 mensagens + a mensagem a responder.
- Sessão CLI estável por (bot, sala).

**HTTP** (`features/rooms/routes.rs`, sob `/api`):
- `GET/POST /principals` — eu + bots; criar bot.
- `GET/POST /projects/{id}/rooms` — listar/criar sala.
- `GET/DELETE /projects/{id}/rooms/{room}` — abrir/apagar.
- `GET/POST /projects/{id}/rooms/{room}/messages` — transcript e envio.
- `GET/POST /projects/{id}/rooms/{room}/queue` — pausar/retomar.
- `DELETE /projects/{id}/rooms/{room}/deliveries/{delivery}` — cancelar uma entrega na fila.
- `POST /projects/{id}/rooms/{room}/members` — adicionar bot.

**UI** (`web/src/features/rooms/`):
- Overlay estilo Slack: lista de salas, chat, criação de sala e de bot, adicionar bot.
- Entrada: botão de salas no cabeçalho do painel de mensagens.
- Nenhuma tela existente foi alterada além desse botão.

**Testes**:
- 3 testes de unidade em `rooms/repository.rs`.
- 1 teste de ponta a ponta em `backend/tests/rooms.rs` (login → bot → sala → envio → fila → erro
  visível na sala).
- Suíte completa: 72 testes de lib + integrações passando.

## Fase 2 — Roteamento do líder ✅

- Chamada de modelo própria (12 s) com o prompt de roteamento: instruções da sala, membros com
  título e persona, últimas 16 mensagens e a mensagem atual.
- Quatro respostas entendidas: `agentIds`, `agentId`, `idle` (ninguém responde) e `question`
  (o líder devolve a pergunta). `taskId` cai no líder até o kanban de tarefas existir.
- Handle desconhecido, JSON quebrado ou timeout: o líder assume, como no OpenBot.
- Menção explícita (`@bot`) e lista explícita de destinatários continuam vencendo o roteador.
- 2 testes unitários do parser.

## Fase 3 — Kanban ✅

**Backend**:
- `GET/POST /projects/{id}/cards`.
- `PATCH/DELETE /projects/{id}/cards/{card_id}`.
- `POST /projects/{id}/cards/{card_id}/move`.
- Campos: título, descrição, responsável, prazo, prioridade, anexos, coluna, sala e mensagem de
  origem.
- Cinco colunas: `todo`, `doing`, `review`, `blocked`, `done`.
- Um card por bot que recebeu o pedido, com `UNIQUE(message_id, owner_id)` para reenvio não
  duplicar.
- Qualquer membro e qualquer bot do projeto move, fecha e reatribui.

**UI**:
- Aba **Quadro** dentro do overlay de salas.
- Cinco colunas, cards com dono, prioridade e prazo.
- Criar card manual, mover por seletor, apagar, e "abrir" a conversa que originou o card.

**Testes**:
- 2 testes de unidade (card por bot, movimento e remoção de dono).
- O teste de ponta a ponta agora verifica que o envio cria o card e que ele muda de coluna.

## Fase 4 — Rotinas ✅

**Núcleo de agendamento** (`features/rooms/schedule.rs`):
- Todos os formatos: `hourly`, `daily`, `weekdays`, `weekly`, `monthly`, `interval`, `advanced`,
  `custom` (cron de 5 campos) e `once`.
- Cálculo no fuso IANA da rotina, com `chrono-tz`; horário inexistente no DST avança até o
  próximo minuto válido.
- Intervalo mínimo de 3 minutos, validado no save e verificado nas 200 primeiras ocorrências do
  cron.
- `collapse_missed`: um tick atrasado roda **uma vez**, com a última ocorrência perdida.
- 8 testes unitários (fuso, intervalo, semanal, mensal, cron, colapso e validações).

**Store** (`routine_store.rs`):
- `routines` + `routine_triggers` (único por rotina) + `routine_runs`
  (`UNIQUE(trigger_id, scheduled_for)`).
- Rotina pertence a uma sala e roda em um bot membro dela.
- Criar, editar (recalcula a próxima ao mudar schedule/fuso/ativa), apagar, listar por sala, bot
  e projeto.
- `missed_policy` aplicado no boot: `skip` avança para a próxima futura; `run-once` deixa a
  última para rodar.

**Scheduler** (`routine_scheduler.rs`):
- Loop de 30 s; relê a rotina e confere o trigger antes de agir.
- Run aberta → registra ocorrência pulada e avança, sem empilhar execuções.
- Cada run vira mensagem `routine` na sala + entrega na fila + card no quadro.
- Run manual (`testar`) para qualquer rotina.
- Falha, interrupção e cancelamento atualizam o status da run; restart marca em execução como
  `interrupted`.

**HTTP**:
- `GET/POST /projects/{id}/rooms/{room}/routines`.
- `GET /projects/{id}/routines` (todas, para agenda/calendário).
- `PATCH/DELETE /projects/{id}/routines/{routine}`.
- `POST /projects/{id}/routines/{routine}/test`.
- `GET /projects/{id}/routines/{routine}/runs`.

**UI**:
- Aba **Rotinas** no overlay: lista por sala, criar com todos os formatos (menos `advanced`),
  fuso, ativar/desativar, testar e ver histórico.
- Próxima execução e status de cada run visíveis.

**Ainda não**:
- Editor de `advanced` e calendário em grade (hoje a agenda mostra a próxima execução).
- `limit_policy` dependente de cota de uso (não há medição de cota por bot de sala ainda).
- Ferramentas `routine_no_update` / `routine_report_failure` e auto-pausa pela própria run
  (dependem do gateway MCP dos bots de sala).
- Webhooks.

**Testes**:
- O teste de ponta a ponta cria uma rotina, dispara um teste manual, espera a run falhar, confirma
  a mensagem `routine` na sala e o card criado.

## Fase 5 — Memória por bot ✅

**Store** (`memory_store.rs`):
- `bot_memories` + `bot_memory_selections`, com `UNIQUE(agent_id, normalized_text)`.
- Texto normalizado (espaços e caixa) para deduplicar: lembrar a mesma coisa duas vezes não cria
  duas entradas.
- `essential` entra em todo prompt; `searchable` só por busca.
- Inclusão com revisão; escolha explícita do usuário não é sobrescrita por um `remember` repetido.
- Busca por substring e limite de 500 caracteres por memória.

**Injeção**:
- O bot de sala recebe as memórias `essential` no system prompt como
  `<agent_memories count="N">…</agent_memories>`.
- Orçamento de **8 KiB** no bloco serializado; o que não couber fica de fora sem apagar.

**HTTP**:
- `GET/POST /principals/{agent}/memories` (com `?q=`).
- `PATCH/DELETE /memories/{memory}`.

**UI**:
- Aba **Memória** no overlay: escolher bot, buscar, adicionar, alternar
  `sempre`/`sob busca` e apagar.

**Ainda não**:
- Review automático (extrair memória da conversa a cada N turnos).
- Ferramentas `remember`, `forget_memory`, `search_memories` para o próprio bot.
- Enforcement de orçamento na seleção (hoje a injeção trunca; a seleção aceita).

**Testes**:
- 2 testes unitários (normalização e orçamento).
- O teste de ponta a ponta cria memória, confirma a deduplicação, muda a inclusão, verifica a
  revisão e apaga.

## Fase 6 — Ferramentas do bot e browser (primeira fatia) ✅

**Gateway por execução** (`features/rooms/gateway.rs`):
- Servidor MCP próprio por entrega, com URL secreta e token, igual ao modo dev.
- O CLI recebe o gateway como servidor MCP HTTP: Claude, Codex e OpenCode.
- Ferramentas: `create_card`, `move_card`, `list_cards`, `remember`, `search_memories`,
  `send_message`, `browser_open`, `browser_read`, `browser_snapshot`, `browser_click`,
  `browser_type` e, só em execução de rotina, `routine_no_update` e `routine_report_failure`.
- `send_message` enfileira uma entrega real para outro membro da sala (agente-a-agente).
- `routine_no_update` marca a run como silenciosa e o runner não posta resposta.

**Browser por bot**:
- Perfil persistente por bot (`bot-<id>`), com cookies e logins entre execuções.
- `snapshot` real: limpa refs antigas, marca cada controle visível com `data-jeff-ref`, devolve
  URL, título, texto e lista de elementos com papel, nome, valor e href.
- `click_ref` e `type_ref` operam pela referência do último snapshot, com erro claro quando a
  página mudou.
- `browser_read` já existente reaproveitado (texto, console e rede).

**Dock ao vivo**:
- Aba **Browser** no overlay: escolhe o bot, transmite a tela do Chromium dele e aceita clique,
  roda, teclado e navegação — a mesma sessão que as ferramentas usam.
- Rotas `GET /projects/{project}/bots/{agent}/browser` e `/browser/ws`.

**Testes**:
- Teste com Chromium real: snapshot acha botão e campo, clique dispara o handler da página e
  digitação chega ao `input`.
- Teste do gateway: `tools/list` inclui card/memória/browser, `create_card` grava no projeto,
  `remember` cria memória essencial e `search_memories` encontra.

**Ainda não**:
- `drag`, `fill_fields`, gravação e modo ensinar.
- Cofre de logins/cartões e `takeover`.
- Proxy por perfil e desligamento do Chromium por ociosidade.

## Fase 7 — Onboarding e modo time ✅

**Instalação**:
- O `install.sh` não pergunta mais nada sobre `git/node/pnpm/rust/go/python`. As ferramentas são
  opcionais via `--components` ou instalação posterior nas configurações.
- Dois modos de instalação seguem iguais: servidor (terminal) e computador (desktop).

**Contas e papéis**:
- `users` ganhou `role`, `display_name`, `activity` e `onboarded_at`; o usuário que já existia vira
  admin na migração.
- Convite por link: o admin cria, o convidado abre `/app/?invite=<token>`, cria usuário e senha e
  entra direto. O convite é consumido na mesma transação que cria a conta.
- Admin e membro; o último admin não pode ser rebaixado nem apagado.
- Visibilidade por projeto: `project_members`; admin vê tudo, membro só o que foi liberado.
- Middleware bloqueia qualquer rota `/api/projects/{id}/...` de membro sem acesso (403).

**Primeira configuração**:
- `GET/POST /api/onboarding`.
- Fluxo: Para mim/Time → atividade (dev, estudo, pesquisa, trabalho, pessoal, outro) + objetivo +
  ferramentas → nome do agente → projeto → (nome do time) → concluir.
- Cria o **agente configurador** com persona calibrada, a **DM** dele com o admin e a sala
  **"Geral"**; marca o usuário como configurado.
- Modo time gera um **link de convite de 30 dias** no fim.
- Retomar o onboarding é idempotente: se parou no meio, reaproveita bot, DM e sala.

**UI**:
- Primeira configuração em tela cheia, com etapas e barra de progresso.
- Tela de aceitar convite em `/app/?invite=...`.
- Aba **Time** no overlay: pessoas, papel, remoção, convite com copiar link, convites abertos e
  checkboxes de quem vê o projeto atual.
- Depois de concluir, o app abre direto nas salas.

**Ferramentas de admin do configurador**:
- `list_projects`, `create_project`, `list_agents`, `create_bot`, `list_rooms`, `create_room`,
  `list_routines`, `create_routine`, só disponíveis para o bot marcado em `onboarding.agent`.
- O provedor de IA e skills ainda são configurados pela UI, não por ferramenta.

**Permissões**:
- Criar sala, apagar sala, adicionar bot e pausar fila: só admin.
- Criar bot: só admin.

**Busca**:
- `GET /projects/{id}/room-search` busca salas, mensagens (FTS5) e cards.
- Campo de busca no topo da lista de salas abre o resultado e leva à sala/quadro.

**Notificações de sala**:
- `notifications` ganhou `room_id`; o evento `room` chega pelo SSE e entra na lista do app.
- Notifica: DM, menção em sala, card atribuído, card movido, bot terminou e falha de bot/rotina.
- Sino no cabeçalho de Salas com contador; clicar abre a sala e marca como lida.
- Push ainda é global por instalação, não por usuário.

**Mobile e ambiente**:
- Aba **Salas** no hub mobile; o overlay abre em cima do app Android e cobre texto, quadro, rotinas,
  memória, browser e voz (voz depende do WebView permitir microfone/tela).
- Aba **Time** agora instala ferramentas do servidor (`git`, `node`, `pnpm`, `rust`, `go`, `python`)
  com allowlist fixa, via `apt-get`/`sudo -n`. `GET /api/environment` mostra o que falta.

**Auditoria**:
- `room_events` registra criação de sala, membro, card (criado/movido/editado/apagado) e rotina
  (criada/editada/apagada/testada).
- Aba de histórico na sala e histórico por card no quadro.

**Push por usuário**:
- `push_tokens.user_id`; resposta de bot e notificação de sala vão só para os dispositivos do
  usuário certo. Som de notificação usa o som de pergunta configurado.

**Status final**: todas as fases do plano estão implementadas. A única validação pendente é a
mídia real da voz, que exige App ID/secret do Cloudflare Realtime — o código está pronto e o
caminho sem credencial é testado.

## Fase 8 — Voz ✅ código escrito (validação com credencial pendente)

**Backend** (`features/voice/`):
- Credencial do Cloudflare Realtime (App ID + secret) guardada nas configurações, com o secret
  criptografado pela mesma chave mestre do resto do Jeff.
- `GET/PUT /api/voice/config` (admin) — o secret nunca volta na resposta.
- `POST .../rooms/{room}/voice/join`: cria a sessão no Cloudflare, publica o áudio e devolve a
  resposta SDP.
- `POST .../voice/exchange`: publica tracks novos (tela) e assina tracks remotos no mesmo SDP.
- `POST .../voice/leave`: fecha os tracks no Cloudflare e remove o participante.
- `GET .../voice/participants`: quem está na sala e quais tracks publicou.
- Registro de participantes em memória, por sala.

**Cliente** (`VoicePanel`):
- Aba **Voz** na sala: entrar/sair, mudo, compartilhar tela, parar tela.
- WebRTC com oferta não-trickle (espera ICE), áudio do microfone, assinatura dos áudios e das
  telas dos outros, grade de vídeos.
- Tela de configuração para o admin quando não há credencial; membro vê "peça ao admin".

**Testes**:
- Sem credencial, `join` devolve “Voz não configurada” antes de qualquer chamada de rede.
- Salvar App ID/secret marca `configured: true`.

**Pendente de validação real**:
- Com App ID e secret, testar o formato exato do SDP e os nomes de track contra a API do
  Cloudflare (o desenho segue a API `sessions/new`, `tracks/new` e `tracks/close`).
- Fechar o track de tela no Cloudflare ao parar de compartilhar (hoje o cliente para de enviar).
- Limpar participante que fecha a aba sem sair, indicador de quem fala e layout de várias telas.

## Como testar agora

1. Subir o servidor (`cargo run --bin jeff` ou o binário instalado).
2. Abrir um projeto → painel de mensagens → botão de salas.
3. Criar um bot escolhendo engine e modelo.
4. Criar uma sala, marcar o bot e defini-lo como líder.
5. Enviar uma mensagem.
6. Abrir a aba **Quadro**: o pedido virou um card do bot. Mover, editar ou criar um card manual.
7. Abrir a aba **Rotinas**: criar uma rotina diária, ativar/desativar, testar e ver o histórico.
8. Abrir a aba **Memória**: adicionar um fato, marcar como "sempre" e ver que ele entra no prompt
   do bot na próxima resposta.
9. Pedir ao bot "crie um card para revisar X": ele chama a ferramenta, o card nasce no quadro e a
   resposta aparece na sala.
10. Pedir "lembre que eu prefiro respostas curtas": a memória aparece na aba Memória.
11. Pedir para abrir um site: `browser_open` + `browser_snapshot` funcionam no Chromium do bot,
    com perfil próprio e persistente.
12. Modo time: concluir a primeira configuração como Time, copiar o link de convite, abrir em uma
    janela anônima e criar a conta. O membro entra sem ver projetos até o admin liberar na aba
    **Time**.

O bot responde se a CLI estiver instalada e autenticada. Sem CLI, a sala mostra o erro exato no
lugar da resposta.

Com dois ou mais bots e um líder, o líder escolhe quem responde. Isso usa o provedor de IA
configurado em Configurações → IA; sem provedor, a decisão cai no próprio líder.


## Fase 10 — PostgreSQL ✅

- `Store` em `PgPool` + SeaORM para conexão e migrations.
- Schema completo em `backend/schema/postgres.sql`; SQLite removido do app.
- Queries convertidas para Postgres: placeholders `$n`, upserts, `RETURNING`,
  FTS com `tsvector`.
- Testes rodando contra um Postgres real com schema isolado por teste.
- Driver SQLite da aba **Bancos de dados** e a feature `sqlx/sqlite` também removidos.
- Redis opcional: cache de sessão por 60s e fanout de notificações entre instâncias.
