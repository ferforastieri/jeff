# Alinhamento do produto — workspace, salas, bots, kanban e voz

Documento vivo. Registra as decisões fechadas com o dono do produto e o que ainda está em
aberto. Não é spec de implementação; é o contrato de produto.

Última atualização: 2026-11-22.

## 1. Instalação

- Dois modos: **servidor** (`install.sh`, terminal) e **computador** (instalador desktop Linux e
  Windows).
- O prompt de componentes de desenvolvimento do `install.sh` (`git,node,pnpm,rust,go,python`) é
  **removido**. Instalação de ferramentas passa a ser uma aba de configuração, sob demanda.
- O onboarding é o mesmo nos dois modos.

## 2. Onboarding

1. **Para mim** ou **para um time**.
2. Atividade: lista fixa — dev, estudo, pesquisa, trabalho, pessoal, outro.
3. Entrevista curta com o configurador: atividade, objetivo principal e ferramentas que já usa.
4. Nome do **agente configurador** (fixo; ajuda a configurar o Jeff).
5. Projeto: escolher ou criar. Projeto pode ser repositório **ou apenas uma pasta**.
6. Modo time: pede o **nome do time** e mostra o **link de convite** no fim.
7. Termina na tela de salas, com a sala **"Geral"** (renomeável) já criada, contendo só pessoas.

- Acesso ao **modo dev** não é perguntado no onboarding: é ligado nas configurações.
- Modo time: contas reais, entrada por **convite por link**, papéis **admin** e **membro**.

## 3. Hierarquia

- **Um workspace por instalação** (o servidor).
- Dentro do workspace, **vários projetos**.
- O **admin** define se um membro vê ou não cada projeto.
- **Salas vivem dentro de um projeto.**

## 4. Identidade

- **Agente é usuário.** Uma única tabela de participantes, com `kind` humano ou bot.
- **DM** é thread de 2 participantes, com estado de leitura: **humano↔humano** e
  **humano↔bot**. Bot↔bot não tem DM; só sala ou tarefa.
- **DM pertence a um projeto.** Trabalho pedido em DM cria card nesse projeto.
- Papéis: **admin** (servidor, membros, visibilidade de projeto, acesso ao dev) e **membro**.
- **Admin** cria sala, adiciona bot, define quem vê cada sala e apaga sala.
- **Quem pediu** pode cancelar a própria tarefa em andamento.
- Card: **qualquer membro do projeto** e **qualquer bot do projeto** move, fecha e reatribui.

## 5. Salas

- Membros: pessoas e bots. Um **líder** (`leadAgentId`).
- O líder **roteia**, não manda: chamada de modelo com JSON estruturado escolhendo um membro,
  vários, `idle`, pergunta de volta, ou continuar tarefa aberta. Na dúvida, assume ele.
- Uma tarefa tem **um dono**. Limite de **2 tarefas rodando por sala** e **8 atribuições
  automáticas por tarefa**.
- `isolated`: memória criada na sala fica na sala.
- **Transcript único da sala**; cada bot mantém thread própria de contexto.
- Sala de voz é entre pessoas; bot participa por texto.

### Voz

- **Somente entre pessoas.** Bot não entra em áudio; lê e escreve texto.
- Até **8 pessoas** por sala de voz, com **várias telas compartilhadas ao mesmo tempo**.
- **Cloudflare Tunnel** para HTTP e **Cloudflare Realtime** para mídia (SFU gerenciado). Nenhuma
  porta aberta no roteador.
- O Jeff emite o token de sessão; App ID e secret ficam nas configurações.

## 6. Bots

- Criados pelo **agente configurador** (que tem ferramentas de admin) ou manualmente.
- Ferramentas de admin do configurador: criar projeto, ligar provedor e chave, instalar skill,
  criar bot, criar sala e criar rotina.
- Executor: **somente engine externa** — cada bot escolhe entre Claude, Codex e OpenCode.
- Workspace: **pasta do projeto**.
- Rotinas: pertencem ao **bot e à sala** (rotina de sala cria tarefa).

## 7. Browser

Cópia integral do modelo do OpenBot:

- Perfil **próprio por bot**, persistente (cookies, logins).
- `snapshot` com árvore de acessibilidade, `ref` + revisão; clique por ref, role, texto, CSS ou
  ponto.
- Abas com dono, opener, back/forward, fechar.
- Formulários completos: `fill_fields`, `select_option`, `set_checked`, `drag`, `upload_files`,
  `wait_for`, `press`, `hover`, `scroll`.
- `evaluate`, `run_script`, `handle_dialog`, `set_environment` (viewport, tema, reduced motion).
- Screenshot, gravação de sessão, modo ensinar (vira skill), diagnóstico de console/rede por aba.
- Cofre criptografado: `list_logins`, `save_vault_item`, `request_vault_item`, `submit_secret`,
  `fill_card`, `request_link_payment`.
- `request_takeover` (captcha/2FA), aprovação para ação sensível, proxy por perfil,
  identidade/UA/client hints.
- **O bot nunca vê segredo**: o valor vai do cofre para o campo. Quando precisa de humano, é
  takeover — a pessoa digita na aba e o bot continua.
- Chromium roda no **servidor**, via CDP; o painel existente (frames + mouse/teclado) vira o
  dock. Bot ocioso derruba o browser e sobe sob demanda.
- Cofre usa o AES-GCM que o Jeff já usa para chaves de API.

## 8. Rotinas

Modelo do OpenBot, portado:

- `schedule` (hourly, daily, weekdays, weekly, monthly, interval, advanced, custom, once),
  intervalo mínimo de 3 minutos.
- `trigger.next_run_at` indexado; `UNIQUE(trigger_id, scheduled_for)` em run.
- `limit_policy` (wait/skip), `missed_policy` (skip/run-once), `run_in` (chat/thread).
- Run silenciosa por padrão quando agendada; `routine_no_update`, `routine_report_failure`.
- Auto-pausa pela própria run, com religação automática se o turno falhar.
- Webhooks em fase posterior.
- **Edição nos dois lugares**: perfil do bot e sala (mesma rotina).
- **Visualização em calendário**, com execuções futuras e passadas.
- **Resultado na sala** como mensagem; **detalhe e erros na rotina**.

## 9. Kanban

- Pedido de **trabalho** a um bot (que não é rotina) **sempre** vira card.
- Quem cria o card é o **agente**: ele reconhece o pedido como trabalho e **delega ao participante
  correto** (pessoa ou bot) — mesmo modelo de roteamento da sala.
- O usuário também pode **criar card manualmente** e **atribuir a alguém**.
- **Um quadro por projeto**, mostrando cards de todas as salas dele.
- A **conversa acontece na sala**; o card apenas referencia a mensagem que o originou. Card não
  tem thread própria.
- Card atribuído a uma **pessoa** vira **tarefa pessoal com notificação**.
- **Cinco colunas**: A fazer, Andamento, Revisão, Bloqueado, Concluído.
- Campos do card: **título, descrição, responsável, prazo, prioridade e anexos**.
- **Movimento sempre explícito**: o bot move por ferramenta, o humano arrasta. O status do card
  não é derivado do estado do run; é uma decisão de quem move.
- **Qualquer membro do projeto** e **qualquer bot do projeto** pode mover, fechar e reatribuir.
- Rotina **não** cria card.

## 10. Modo dev

- **Intocado.** Nenhuma tela atual muda.
- Quem tem acesso vê dev e salas ao mesmo tempo.
- Acesso ligado nas configurações.
- Kanban, salas e bots são superfícies novas; reaproveitam o que der sem confundir com o dev.

## 11. Notificações, mobile, busca e auditoria

- **Notifica**: DM, menção, card atribuído, bot terminou, rotina falhou, card mudou de coluna.
- **Canais**: no app (sino/lista), push no Android (inclusive com app fechado) e som. Sem e-mail.
- **Android**: tudo — salas, DM, kanban, voz e tela compartilhada.
- **Busca**: por projeto (salas, mensagens, cards e arquivos do projeto aberto).
- **Auditoria**: histórico visível dentro do card e da sala — quem fez o quê e quando. Sem painel
  separado; log técnico continua existindo por baixo.

## 12. Pendências menores

- Voz: limite prático de telas simultâneas (o SFU aguenta; o custo é banda).
- Retenção: por quanto tempo mensagens, cards concluídos e gravações de browser ficam guardados.
