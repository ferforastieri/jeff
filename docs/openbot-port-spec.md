# Spec de port do OpenBot — rotinas, fila, memória, mailbox e canais

Este documento descreve **o comportamento** dos subsistemas do
[`nightly-labs/openbot`](https://github.com/nightly-labs/openbot) que faltam no Jeff, para
reimplementação em Rust + React.

Não é uma tradução do código do OpenBot. É a especificação observada: entidades, estados,
invariantes e algoritmos, escritos para caber no modelo do Jeff.

> **Licença.** O OpenBot é PolyForm Noncommercial 1.0.0. O port aqui descrito é uma
> reimplementação a partir de comportamento observado, para uso pessoal do Jeff. Não copie
> arquivos, identificadores, comentários nem textos de UI do repositório original.

## Índice

1. [Modelo mental](#1-modelo-mental)
2. [O que o Jeff já tem](#2-o-que-o-jeff-já-tem)
3. [Fila e entregas](#3-fila-e-entregas)
4. [Rotinas](#4-rotinas)
5. [Memória por agente](#5-memória-por-agente)
6. [Mailbox: agente-a-agente](#6-mailbox-agente-a-agente)
7. [Canais (equipes)](#7-canais-equipes)
8. [Contexto e compactação](#8-contexto-e-compactação)
9. [Persistência e crash-safety](#9-persistência-e-crash-safety)
10. [Mapa de port para o Jeff](#10-mapa-de-port-para-o-jeff)
11. [Ordem de implementação](#11-ordem-de-implementação)
12. [Checklist de paridade](#12-checklist-de-paridade)
13. [Onde olhar no OpenBot](#13-onde-olhar-no-openbot)

---

## 1. Modelo mental

O OpenBot tem cinco camadas que se encaixam nesta ordem:

```text
agente ──► thread (conversa) ──► turno (uma execução do modelo)
   │                ▲
   │                │
   ├── rotinas ─────┴──► entrega (delivery) ──► fila ──► turno
   ├── memória
   ├── skills
   └── mailbox ◄── outros agentes / rotinas / canais
```

A ideia central: **nada chama o modelo diretamente**. Todo trabalho — mensagem do usuário,
rotina, mensagem de outro agente, tarefa de canal — vira uma **entrega** (`delivery`) numa fila
por agente. A fila é drenada por um scheduler que respeita limites de concorrência, pausas e
holds. Isso é o que torna rotinas e conversas entre agentes confiáveis: tudo é durável, tudo
tem idempotência, tudo pode ser retomado depois de um crash.

No Jeff, o equivalente de "thread" é `agent_sessions`, e o de "turno" é `agent_runs`. O que
falta é a camada **entrega/fila** entre o pedido e o run.

---

## 2. O que o Jeff já tem

| Conceito OpenBot | Jeff hoje | Gap |
|---|---|---|
| agente persistente | `agent_profiles` (id estável, `config` JSON) | nenhum estrutural |
| thread por agente | `agent_sessions` + índice único de sessão ativa por (chat, agente) | nenhum |
| turno | `agent_runs` + índice único `agent_run_active` | **rejeita em vez de enfileirar** |
| mensagens e eventos | `agent_messages`, `agent_events` (com FTS5) | nenhum |
| compactação | `agent_checkpoints`, `context.rs` | já existe |
| skills por agente | `agent_skills` + `skill_service` | já existe |
| grupo de agentes numa conversa | `chat_id` + roster + router + `@menção` + `delegate` | falta assincronia |
| memória | `agent_memories` de projeto, busca por `instr()` | falta escopo por agente, seleção e orçamento |
| rotinas | — | **nada** |
| fila | — | **nada** |
| mailbox | `delegate` síncrono dentro do turno | falta entrega durável |

Conclusão: o Jeff tem o substrato de dados e eventos. O port é sobretudo **duas tabelas para a
fila, três para rotinas, um scheduler e uma mudança no ciclo do run**.

---

## 3. Fila e entregas

### 3.1 Entidades

Uma **mensagem** é o conteúdo. Uma **entrega** liga uma mensagem a um destinatário.

```text
mensagem: id, remetente, texto, anexos, reply_to, created_at
entrega:  id, mensagem_id, agente_destino, status, turno_id, erro, posição, created_at
```

Uma mensagem pode gerar N entregas (um `@todos`, por exemplo). Cada entrega tem seu próprio
ciclo de vida.

No port para o Jeff isso não precisa ser duas tabelas: `agent_messages` já guarda o texto
visível, então a entrega pode **inlinar** `text` e `reply_to` e referenciar a mensagem só na
exibição. Menos joins, mesma semântica. O que não pode ser inline é a **chave de idempotência**
e o **status** por destinatário.

### 3.2 Remetentes

```rust
enum Sender {
    User,
    Agent { agent_id: String },
    Routine { routine_id: String, run_id: String, routine_name: String, scheduled_for: i64 },
}
```

O remetente decide a apresentação na UI e o comportamento de notificação. Uma entrega de rotina
é silenciosa por padrão; uma do usuário sempre notifica.

### 3.3 Estados

```text
queued ──► starting ──► running ──┬──► completed
                                  ├──► failed
                                  ├──► interrupted   (crash/restart)
                                  └──► cancelled     (usuário cancelou na fila)
```

Regras:

- Só existe **uma** entrega `starting`/`running` por agente (ou até `taskLimit`, ver 3.6).
- `queued` tem `position` (1-based) para ordenar e reordenar.
- `interrupted` é o que o restart deixa para trás; é retomável.
- `cancelled` só é possível enquanto `queued`.

### 3.4 Entrada na fila

Toda entrada passa por:

1. **Validação do destinatário** (existe, pertence ao projeto, não está sendo removido).
2. **Idempotência**: a chave é derivada da origem.
   - rotina agendada: `routine:<trigger_id>:<scheduled_for>`
   - rotina manual: `routine:manual:<run_id>`
   - mensagem do usuário: `client_message_id` (o `request_id` do Jeff já serve)
3. **Escrita durável** antes de qualquer efeito colateral.

### 3.5 Drenagem (o scheduler)

O drenador roda por agente, com quiescência (debounce) para não disparar no meio de uma rajada:

```text
fn schedule_drain(agent_id):
    se já existe drenagem agendada: retorna
    agenda uma drenagem com debounce curto (dezenas de ms)

fn drain(agent_id):
    se fila pausada: retorna
    se existe turno ativo e limite de tarefas atingido: retorna
    pega a primeira entrega que pode iniciar
    se não há: retorna
    marca starting
    prepara o lote (ver 3.7)
    abre o turno
    ao terminar: marca completed/failed/interrupted e chama drain de novo
```

O drenador é **idempotente**: pode ser chamado dez vezes; só uma drenagem avança.

### 3.6 Limites e holds

- `taskLimit` por agente (OpenBot: 1–4, padrão 4; provedores sem concorrência: 1).
- `hold` explicitamente bloqueia a fila: `channel-task` (agente ocupado num canal),
  `provider-restart` (provedor reiniciando), `sign-in` (provedor pedindo login).
- Cota de uso é um gate separado do hold: com `limit_policy = skip` a rotina descarta a
  ocorrência, com `wait` a entrega espera.
- Pausa manual (`paused`) para a fila inteira do agente sem cancelar nada.

No Jeff, `taskLimit` deve começar em **1**: o índice `agent_run_active` já assume isso, e o
harness nativo compartilha sessão por agente.

### 3.7 Agrupamento (batching)

Ao iniciar uma entrega, o drenador puxa **companheiras** para o mesmo turno:

| Origem | Puxa junto |
|---|---|
| mensagem do usuário | mensagens seguintes do mesmo remetente, na mesma lane, ainda `queued` |
| resposta de agente | respostas à mesma requisição, mesma lane |
| continuação de plano | continuações da mesma lane |
| rotina / canal / tarefa | nada (roda sozinha) |

Isso evita N turnos para "oi", "olha isso", "e isso também". O lote vira uma única mensagem de
usuário composta.

`lane` isola conversas paralelas do mesmo agente (chat principal, tarefa, tarefa de canal).

### 3.8 Controles expostos ao usuário

Cancelar (só `queued`), editar (só `queued`, com revisão otimista), reordenar, pausar/retomar a
fila, interromper o turno em andamento.

---

## 4. Rotinas

### 4.1 Entidades

```text
routine:  id, agent_id, name, instruction, active, timezone, limit_policy, missed_policy,
          run_in, created_at, updated_at
trigger:  id, routine_id (UNIQUE), kind ('schedule' | 'webhook'), schedule_json, next_run_at
run:      id, routine_id, trigger_id, agent_id, kind ('scheduled' | 'manual'), source,
          scheduled_for, routine_name, instruction, status, error, delivery_id, created_at
```

Invariantes:

- **Uma rotina tem exatamente um trigger.** `UNIQUE(routine_id)`.
- **`UNIQUE(trigger_id, scheduled_for)` em `run`.** É o que impede execução dupla depois de
  restart, retry ou tick concorrente.
- **`UNIQUE(delivery_id)`** em `run`: uma run gera no máximo uma entrega.
- `next_run_at` é indexado; é a única fonte para o "próximo devido".
- A run copia `routine_name` e `instruction` no momento da criação. Editar a rotina depois não
  altera runs já criadas. `name` vai até 80 caracteres e `instruction` até 100.000 — instruções
  longas são esperadas (procedimento inteiro, não só um pedido).

### 4.2 Formatos de agendamento

```rust
enum Schedule {
    Hourly { minute: u8 },                                  // 0-59
    Daily { time: "HH:MM" },
    Weekdays { time: "HH:MM" },                             // seg-sex
    Weekly { weekday: u8, time: "HH:MM" },                  // 0-6
    Monthly { day: u8, time: "HH:MM" },                     // 1-31
    Interval { amount: u32, unit: Minutes|Hours|Days, anchor_at: i64 },
    Advanced { months: Vec<u8>, days: DaySelection, time: TimeSelection },
    Custom { expression: String },                          // cron de 5 campos
    Once { date: "YYYY-MM-DD", time: "HH:MM" },
}
```

`DaySelection` = todo dia | dias da semana | dias do mês.
`TimeSelection` = hora fixa | a cada N minutos/horas.

### 4.3 Cálculo da próxima ocorrência

```text
next(schedule, tz, after) -> instante
```

- `Once`: o instante local `date + time` no fuso; se já passou, erro.
- `Interval`: primeira ocorrência **estritamente depois** de `after`, na grade
  `anchor + k * duração`. Se `after < anchor`, retorna `anchor`. O anchor é o instante da
  criação (ou o informado).
- Demais (e `Custom`): próxima ocorrência do cron equivalente no fuso.

Regras de validação (na criação e na edição):

- **Intervalo mínimo de 3 minutos** para `Interval`, `Advanced{Every}` e `Custom`.
- `Custom` valida a sintaxe do cron **só no save**; na execução assume que já foi validado.
- Fuso é IANA, validado. O fuso default é o do usuário que criou, ou o do servidor.
- Horário local inexistente (DST) avança até o próximo minuto válido; ambíguo escolhe o primeiro.

### 4.4 O tick

Um único loop. O OpenBot acorda no `next_run_at` mais próximo, com um teto curto para não
dormir demais. No Jeff, um `tokio::time::sleep_until` com teto de 30 s é suficiente e simplifica
o boot e a mudança de relógio.

```text
fn process_due(now):
    para cada trigger com next_run_at <= now (excluindo agentes ocultos/removidos):
        recarrega a rotina
        se não existe, ou está inativa, ou o trigger mudou (id ou next_run_at):
            continue                      # guarda de concorrência
        se schedule == Once:
            cria run 'scheduled' com scheduled_for = next_run_at
            completa o trigger (rotina fica inativa)
            continue
        (scheduled_for, next_run_at) = collapse_missed(schedule, tz, next_run_at, now)
        motivo_skip =
            já existe run viva (entrega queued/starting/running) ? "run aberta"
          : limit_policy == Skip && cota estourada                ? "limite de uso"
          : null
        se motivo_skip:
            registra ocorrências puladas (contador + intervalo)
            avança o trigger para next_run_at
            continue
        cria run 'scheduled' com scheduled_for
        avança o trigger para next_run_at
        enfileira a entrega
```

`collapse_missed`:

```text
scheduled_for = from
next = next(schedule, tz, scheduled_for)
enquanto next <= now:
    scheduled_for = next
    next = next(schedule, tz, scheduled_for)
retorna (scheduled_for, next)
```

Ou seja: um tick atrasado executa **uma vez**, com `scheduled_for` da última ocorrência perdida.
As demais são descartadas — não há rajada de runs atrasadas.

### 4.5 Políticas

| Política | Valores | Efeito |
|---|---|---|
| `limit_policy` | `wait` (padrão) / `skip` | com cota de uso estourada, `skip` descarta a ocorrência; `wait` tenta de novo quando a cota voltar |
| `missed_policy` | `skip` (padrão) / `run-once` | o que fazer com ocorrências perdidas **enquanto o app estava fechado** |
| `run_in` | `chat` (padrão) / `thread` | a run roda no chat principal do agente ou numa conversa própria da rotina |

`missed_policy` só é aplicado no boot (`skip_missed`), não no tick normal. No boot:

- `skip`: registra todas as ocorrências perdidas e avança para a próxima futura.
- `run-once`: registra todas menos a última e deixa a última como próxima a rodar.
- `Once` que venceu enquanto fechado: com `skip`, vira uma run "perdida" registrada; com
  `run-once`, roda ao abrir.

### 4.6 Entrega da run

A run **não** chama o modelo. Ela cria uma entrega:

```text
sender  = Routine { routine_id, run_id, routine_name, scheduled_for }
texto   = run.instruction          # exatamente a instrução, sem wrapper
destino = thread da rotina (se run_in == thread) ou chat principal
chave   = "routine:<trigger_id>:<scheduled_for>"   # ou "routine:manual:<run_id>"
```

O `delivery_id` é gravado de volta na run. Se a entrega não puder ser criada, a run vira
`cancelled` e o erro é registrado.

### 4.7 Estados da run

```text
queued ──► running ──┬──► succeeded
                     ├──► failed
                     ├──► interrupted
                     ├──► needs-attention   (o agente fez uma pergunta e parou)
                     └──► cancelled
```

- `needs-attention` volta para `running` quando o usuário responde.
- `cancelled` é o estado de runs puladas por política, rotina apagada, agente removido.

### 4.8 Silêncio e falha

Duas ferramentas só existem para runs:

- `routine_no_update` — "nada a reportar". Sem texto, sem notificação. Só para runs agendadas,
  de script ou webhook. Teste manual sempre mostra a resposta.
- `routine_report_failure` — encerra a run como `failed` com um motivo, mesmo que o agente ainda
  responda.

Uma run agendada/script/webhook é **silenciosa por padrão**: o resultado vai para a conversa,
mas não gera push. Teste manual (`kind = manual`, `source = test`) notifica.

### 4.9 Auto-pausa pela própria run

Durante uma run, o agente pode chamar `update_routine(active: false)` na **própria** rotina —
o caso de uso é "monitorar até acontecer algo, depois parar de checar".

Semântica:

1. A rotina pausa e guarda `paused_by_run.scheduled_for` (por quê).
2. Se o turno dessa run terminar em **falha**, a rotina é religada automaticamente.
3. Se terminar bem, permanece pausada.

Sem isso, um "me avise quando X" ficaria rodando para sempre, ou morreria por um erro transitório.

### 4.10 Webhooks (fase posterior)

Rotina com `trigger.kind = webhook`:

- URL pública + segredo de assinatura (HMAC), event type e filtros.
- A requisição vira uma run com `source = webhook`; o corpo entra como **dado não confiável**.
- Só pode ser criada/alterada num turno iniciado por uma pessoa.
- `next_run_at` não se aplica; o trigger é acionado por HTTP.

### 4.11 Ferramentas expostas ao agente

`list_routines`, `create_routine`, `update_routine`, `delete_routine`, `test_routine`,
`routine_no_update`, `routine_report_failure`, `create_webhook_routine`,
`update_webhook_routine`. O histórico de runs é só UI (`list_routine_runs` no IPC), não é
ferramenta de agente.

Todas aceitam `agentId` opcional para agir em outro agente local (o agente precisa de permissão).

---

## 5. Memória por agente

### 5.1 Entidades

```text
memory:            id, agent_id, text, normalized_text, origin ('automatic' | 'manual'),
                   source_turn_id, site, created_at, updated_at
                   UNIQUE(agent_id, normalized_text)
memory_selection:  memory_id, inclusion ('essential' | 'searchable'),
                   user_controlled, revision
```

`normalized_text` é o texto normalizado (trim, colapso de espaços, casefold). É a chave de
deduplicação: o agente pode tentar lembrar a mesma coisa dez vezes; só existe uma entrada.

`site` (opcional) liga a memória a um host/URL; serve para mostrar a memória na página
correspondente.

### 5.2 Essential vs searchable

| | essential | searchable |
|---|---|---|
| entra no prompt | sempre | só quando buscada |
| orçamento | **8 KiB** serializado | — |
| uso típico | preferências do usuário, fatos que valem em qualquer tarefa | detalhes de um projeto, histórico |

Inclusão no system prompt:

```xml
<agent_memories count="3">
[{"id":"...","text":"...","origin":"manual","site":"..."}]
</agent_memories>
```

O orçamento é medido em **bytes UTF-8 do bloco serializado**. Quando estoura, as memórias mais
recentes que não couberem ficam de fora (e a UI mostra o uso).

### 5.3 Review automático

Um turno de background, sem ferramentas, que lê a conversa e propõe operações:

```text
MemoryReviewResult { operations: [ add | update | forget ] }   # no máximo 20
```

Gatilhos:

- a cada **20 turnos** no agente (configurável; `0` desliga), ou
- **3 turnos ociosos** e **15 minutos** sem atividade.

Entrada: últimas **200** mensagens + log de navegação + até **12.000** caracteres de memórias
`searchable` (para não duplicar).

Regras de aplicação:

- `add` com `inclusion` (`essential` só se realmente global) e `site` opcional.
- `update` / `forget` exigem `memoryId`.
- Dedupe por `normalized_text`; se já existe, vira `update` da existente.
- Escolha feita pelo **usuário** (`user_controlled`) nunca é sobrescrita pelo review.
- Tudo é aplicado numa transação; ao final, uma mensagem de sistema resume o que mudou
  ("lembrei de X", "esqueci Y").

### 5.4 Seleção e revisão

`set_memory_inclusion` recebe `changes: [{ memoryId, inclusion, expectedRevision }]`:

- revisão otimista: se `revision` não confere, rejeita o lote inteiro;
- mudança do usuário marca `user_controlled = true`;
- o agente não pode alterar memória controlada pelo usuário;
- nunca apaga texto — só muda a inclusão.

### 5.5 Ferramentas

`remember` (staged, só commita se o turno terminar bem), `forget_memory`, `search_memories`
(até 10 resultados), `list_memories` (paginado por cursor), `set_memory_inclusion`.

O `remember` é **staged**: a mutação fica pendente durante o turno e só é aplicada no commit.
Turno que falha não deixa memória pela metade.

### 5.6 Limites

- texto por memória: **500** caracteres.
- total por agente: 64 / 128 / 256 / 512 (padrão **256**), configurável.
- máximo de operações por review: 20.

---

## 6. Mailbox: agente-a-agente

### 6.1 Semântica

Uma mensagem de A para B é uma entrega normal na fila de B, com `sender.kind = Agent`. Nada mais.
O que muda:

- **`reply_to_message_id`**: a mensagem responde a uma requisição anterior.
- **`expects_reply`**: se `false`, a mensagem é informativa e não gera resposta.
- **Tarefa (`task_id`)**: conversa separada, com contexto próprio.
- **Await**: A pode registrar que está esperando resposta de B; a resposta "acorda" A.

### 6.2 Regras

1. A mensagem só é entregue se B existir e aceitar mensagens de A (política de remetentes).
2. Entregas de agente **não** interrompem um turno em andamento: entram na fila.
3. Se B não existe mais, a entrega vira `failed` com motivo, e A é notificado.
4. A resposta de B é entregue a A como uma nova entrega, com `reply_to_message_id`.
5. `expects_reply = false` existe para "avise que terminei" — o padrão é esperar resposta.
6. Entregas de agente passam por um gate de destinatário (agente existente e não sendo
   removido) e por uma política de remetentes permitidos; sem isso, um agente pode inundar outro.
   Não há pingue-pongue implícito: cada resposta é uma entrega explícita.

### 6.3 Await / wake (opcional na primeira fase)

`await_event` abre uma espera declarada: "estou aguardando algo externo (build, checagem
futura)". A próxima run de uma rotina (ou mensagem de agente) que nomeia o `wait_id` repete o
pedido original com a nota da espera. `close_wait` encerra. É o que transforma rotinas em
"acorde quando".

### 6.4 Tarefas

`start_task` cria uma conversa paralela do mesmo agente, com contexto próprio:

- a mensagem inicial (brief) é a única coisa que ela vê do chat de origem;
- roda em paralelo, na sua própria lane;
- a resposta final volta como relatório na conversa de origem;
- `message_task` continua, `close_task` arquiva.

No Jeff, isso é uma `agent_sessions` adicional com `chat_id` sintético + lane própria.

---

## 7. Canais (equipes)

Um canal é um chat compartilhado com **um dono por tarefa**:

```text
channel: id, nome, título, instruções, membros[], lead_agent_id, isolated, browser, icon
task:    id, channel_id, parent_task_id, root_task_id, owner_agent_id,
         request_message_id, instruction, expected_result, source_message_ids[],
         dependencies[], resources[], state, revision, assignment_count
```

### 7.1 Estados da tarefa

```text
queued ──► running ──┬──► completed
                     ├──► waiting   (pergunta ao usuário)
                     ├──► paused
                     ├──► failed
                     └──► cancelled
```

### 7.2 Regras de concorrência

- `CHANNEL_PARALLEL_LIMIT = 2`: no máximo 2 tarefas rodando por canal.
- `CHANNEL_ASSIGNMENT_LIMIT = 8`: no máximo 8 atribuições automáticas por tarefa; ao atingir,
  pede intervenção ("continue ou reatribua").
- Um agente só assume uma tarefa se não estiver ocupado no canal.
- Toda troca de dono é explícita e auditada (autor `coordinator` quando é automático).

### 7.3 Comandos

`save`, `send`, `request`, `stop`, `resume`, `reassign`, `cancel`, `read`, `archive`, `restore`.
Cada comando carrega `operation_id` para idempotência.

### 7.4 Memória e rotinas de canal

O canal tem suas próprias memórias (mesmo formato de `MemoryEntry`, escopo `channel`) e suas
próprias rotinas, cuja run vira uma `request` no canal (cria uma tarefa).

**Recomendação:** no Jeff, a fase 1 não deve implementar canais. O `chat_id` com roster + router
já cobre 80% do caso de uso. Canal resolve coordenação de tarefas concorrentes, que só faz
sentido depois que a fila existir.

---

## 8. Contexto e compactação

OpenBot compacta por **thread**, não por run:

- orçamento de entrada e reserva de saída;
- quando passa do limite, gera um resumo com o modelo de background e grava um snapshot;
- mantém as últimas N mensagens literais + resumo do que ficou para trás;
- a memória `essential` entra **depois** da compactação (nunca é resumida).

O Jeff já faz isso em `context.rs` (`INPUT_BUDGET`, `SOFT_BUDGET`, `RECENT_BUDGET`,
`agent_checkpoints`). O port precisa apenas garantir que:

1. o bloco `<agent_memories>` seja injetado **fora** do que é resumido;
2. o resumo não engula mensagens de rotina silenciosas (elas poluem o histórico);
3. a compactação rode antes de um turno de rotina, não depois.

---

## 9. Persistência e crash-safety

Regras que valem a pena copiar:

1. **Toda mutação de fila/rotina é uma transação**; o evento só é emitido depois do commit.
2. **Idempotência por chave**, não por "verificar antes de fazer":
   - `UNIQUE(trigger_id, scheduled_for)`
   - `UNIQUE(delivery_id)`
   - `UNIQUE(agent_id, normalized_text)`
   - `client_message_id` / `request_id`
3. **Recuperação no boot** em ordem: carrega fila → marca `starting`/`running` como
   `interrupted` com motivo → recompõe holds → retoma o que é retomável → `skip_missed` das
   rotinas.
4. **Limite de retomadas automáticas.** O Jeff já tem `MAX_AUTO_RESUMES = 5` em
   `agent_run_recoveries`. Mantenha.
5. **Comando com receipt**: cada operação de UI tem `operation_id`; repetir a operação devolve o
   mesmo resultado em vez de duplicar.

---

## 10. Mapa de port para o Jeff

### 10.1 Tabelas novas

```sql
-- Fila: uma linha por (mensagem, destinatário).
CREATE TABLE IF NOT EXISTS agent_deliveries (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  project_id TEXT NOT NULL,
  recipient_agent_id TEXT NOT NULL REFERENCES agent_profiles(id),
  chat_id TEXT NOT NULL,
  sender_kind TEXT NOT NULL CHECK(sender_kind IN ('user','agent','routine')),
  sender_agent_id TEXT,
  routine_id TEXT,
  routine_run_id TEXT,
  text TEXT NOT NULL,
  attachments TEXT NOT NULL DEFAULT '[]',
  reply_to_message_id TEXT,
  expects_reply INTEGER NOT NULL DEFAULT 1,
  task_id TEXT,
  status TEXT NOT NULL CHECK(status IN
    ('queued','starting','running','completed','failed','interrupted','cancelled')),
  position INTEGER,
  turn_id TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS agent_delivery_queue
  ON agent_deliveries(recipient_agent_id, status, position);

CREATE TABLE IF NOT EXISTS agent_queue_state (
  agent_id TEXT PRIMARY KEY REFERENCES agent_profiles(id) ON DELETE CASCADE,
  paused INTEGER NOT NULL DEFAULT 0,
  hold TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_routines (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  project_id TEXT NOT NULL,
  agent_id TEXT NOT NULL REFERENCES agent_profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  instruction TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  timezone TEXT NOT NULL,
  limit_policy TEXT NOT NULL DEFAULT 'wait' CHECK(limit_policy IN ('wait','skip')),
  missed_policy TEXT NOT NULL DEFAULT 'skip' CHECK(missed_policy IN ('skip','run-once')),
  run_in TEXT NOT NULL DEFAULT 'chat' CHECK(run_in IN ('chat','thread')),
  paused_by_run TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS agent_routine_name
  ON agent_routines(agent_id, name);

CREATE TABLE IF NOT EXISTS agent_routine_triggers (
  id TEXT PRIMARY KEY,
  routine_id TEXT NOT NULL UNIQUE REFERENCES agent_routines(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('schedule','webhook')),
  schedule TEXT NOT NULL,
  next_run_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS agent_routine_due
  ON agent_routine_triggers(next_run_at) WHERE next_run_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS agent_routine_runs (
  id TEXT PRIMARY KEY,
  routine_id TEXT NOT NULL REFERENCES agent_routines(id) ON DELETE CASCADE,
  trigger_id TEXT,
  agent_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('scheduled','manual')),
  source TEXT,
  scheduled_for INTEGER NOT NULL,
  routine_name TEXT NOT NULL,
  instruction TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN
    ('queued','running','needs-attention','succeeded','failed','interrupted','cancelled')),
  error TEXT,
  missed TEXT,
  delivery_id TEXT UNIQUE REFERENCES agent_deliveries(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(trigger_id, scheduled_for)
);
CREATE INDEX IF NOT EXISTS agent_routine_runs_list
  ON agent_routine_runs(routine_id, created_at DESC);

-- Memória: estende a tabela existente.
ALTER TABLE agent_memories ADD COLUMN agent_id TEXT NOT NULL DEFAULT '';
ALTER TABLE agent_memories ADD COLUMN normalized_text TEXT NOT NULL DEFAULT '';
ALTER TABLE agent_memories ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE agent_memories ADD COLUMN source_turn_id TEXT;
ALTER TABLE agent_memories ADD COLUMN site TEXT;
ALTER TABLE agent_memories ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS agent_memory_unique
  ON agent_memories(agent_id, normalized_text) WHERE agent_id <> '';

CREATE TABLE IF NOT EXISTS agent_memory_selections (
  memory_id TEXT PRIMARY KEY REFERENCES agent_memories(id) ON DELETE CASCADE,
  inclusion TEXT NOT NULL DEFAULT 'searchable' CHECK(inclusion IN ('essential','searchable')),
  user_controlled INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 0
);
```

Notas:

- `agent_memories` atual é de projeto; a migração deve copiar `project_id` e deixar `agent_id`
  vazio nas antigas (memória de projeto legada), ou atribuí-las ao primeiro agente do chat.
- `position` é apenas ordenação (1-based) recalculada dentro de uma transação ao inserir,
  cancelar ou reordenar. Não use índice único: a reordenação geraria colisões intermediárias.

### 10.2 Mudanças em tabelas existentes

| Tabela | Mudança |
|---|---|
| `agent_runs` | o índice `agent_run_active` continua, mas passa a valer só para `running`/`waiting`; a admissão deixa de ser `409` e passa a criar uma `delivery` `queued` |
| `agent_profiles` | adicionar `workspace_path` (workspace por agente), `archived`, `updated_at` |
| `agent_sessions` | adicionar `lane` (chat / task / routine:<id>) e permitir N sessões ativas por agente por lane |
| `agent_messages` | adicionar `delivery_id` e `sender_kind` para reconstruir a origem |

### 10.3 Mudanças no runtime Rust

1. **`Runtime::start` deixa de rodar o turno.** Ele valida, cria a entrega e chama
   `drain(agent_id)`. O turno nasce no drenador.
2. **`Runtime::run_turn` recebe um lote de entregas**, não um `text: String`.
3. **`delegate` vira `send_message` + await.** Mantenha `delegate` como atalho síncrono por
   compatibilidade, mas implemente-o por cima do mailbox para não ter dois caminhos.
4. **Novo módulo `scheduler`** no `app`: loop de rotinas + drenador, protegido pelo
   `instance_lock.rs` existente.
5. **Eventos**: emitir `delivery`, `queue`, `routine-run` no `EventHub` para a UI reagir sem
   polling.

### 10.4 Fuso horário

`chrono` sozinho não resolve IANA. Adicione `chrono-tz`. O cálculo de cron precisa considerar o
fuso local: itere sobre minutos locais, não UTC, senão DST quebra o agendamento.

Alternativa mais barata: usar o crate `cron` para o parse e calcular as ocorrências com
`chrono-tz`, validando que a diferença entre ocorrências consecutivas nunca é < 3 min.

---

## 11. Ordem de implementação

| Fase | Entrega | Depende de | LOC estimado |
|---|---|---|---|
| 0 | Spec + testes de semântica de `next()` e `collapse_missed` | — | 300 |
| 1 | Tabelas de entrega/fila + drenador simples (`taskLimit = 1`) | — | 600 |
| 2 | Rotinas: store, tick, tools, UI de lista/editor | 1 | 1.500 |
| 3 | Memória por agente: escopo, seleção, injeção, tools | 1 | 900 |
| 4 | Review automático de memória | 3 | 400 |
| 5 | Mailbox assíncrono + tarefas (`start_task`) | 1 | 1.800 |
| 6 | Canais + rotinas de canal | 5 | 2.500 |
| 7 | Webhooks | 2 | 500 |

Fase 1 é obrigatória antes de 2. Sem fila, rotina que dispara durante um turno colide com o
índice único e vira erro para o usuário.

---

## 12. Checklist de paridade

Rotinas:

- [ ] criar rotina diária, avançar o relógio e ver exatamente uma run
- [ ] reiniciar o app durante uma run e ver a run como `interrupted`, não duplicada
- [ ] tick atrasado 3 dias gera **uma** run com `scheduled_for` da última ocorrência
- [ ] `missed_policy = run-once` roda a última perdida no boot; `skip` não roda
- [ ] `limit_policy = skip` descarta quando a cota estoura; `wait` mantém
- [ ] rotina `once` desativa após rodar
- [ ] run que chama `update_routine(active:false)` pausa; se o turno falhar, religa
- [ ] `routine_no_update` não gera notificação; teste manual sempre mostra
- [ ] editar a instrução não altera runs já criadas
- [ ] apagar a rotina cancela runs queued e interrompe a running

Fila:

- [ ] duas mensagens seguidas do usuário viram um turno só (batching)
- [ ] mensagem durante turno ativo entra como `queued` e não retorna erro
- [ ] cancelar entrega `queued` não afeta o turno em andamento
- [ ] pausar a fila impede início de novas entregas, sem matar a atual
- [ ] restart deixa tudo `interrupted` e retoma no máximo 5 vezes

Memória:

- [ ] `remember` em turno que falha não persiste
- [ ] mesma memória duas vezes não duplica (`normalized_text`)
- [ ] `essential` entra no prompt; `searchable` só por busca
- [ ] estourar 8 KiB tira as mais antigas do prompt, sem apagar
- [ ] usuário muda inclusão e o review não sobrescreve

Mailbox:

- [ ] A envia para B ocupado: entra na fila, não interrompe
- [ ] B responde e a resposta chega em A com `reply_to`
- [ ] `expects_reply = false` não gera resposta
- [ ] B removido: entrega falha com motivo, A é avisado
- [ ] remetente bloqueado pela política não consegue enfileirar para B
- [ ] resposta com `reply_to` não inicia nova espera infinita (cada resposta é explícita)

---

## 13. Onde olhar no OpenBot

Referência de comportamento (leitura, não cópia). Caminhos relativos à raiz do repositório
`nightly-labs/openbot`.

| Assunto | Arquivos |
|---|---|
| Schema base | `src/backend/migrations/0008-baseline.ts` |
| Contratos de fila | `packages/contracts/src/ipc-queue.ts`, `ipc-agent-tasks.ts` |
| Drenagem / execução | `src/backend/agent/drain-scheduler.ts`, `agent/turn-lifecycle.ts` |
| Mailbox | `src/backend/mailbox-store.ts`, `agent/mailbox-sync.ts` |
| Rotinas | `packages/contracts/src/ipc-routines.ts`, `src/backend/agent/routine-scheduler.ts`, `src/backend/routine-store.ts`, `packages/team-client/src/routine-schedule.ts` |
| Rotinas silenciosas | `src/backend/agent/routine-quiet-runs.ts`, `agent/routine-tools.ts` |
| Memória | `packages/contracts/src/ipc-agent-memories.ts`, `agent-memory-context.ts`, `src/backend/agent-memory-store.ts`, `src/backend/agent/agent-memories.ts`, `agent/memory-review.ts` |
| Canais | `packages/contracts/src/ipc-chat-channels.ts`, `src/backend/channel-service.ts`, `src/backend/channel-history.ts` |
| Compactação | `src/backend/agent/context-compaction.ts`, `src/backend/database/thread-summaries.ts` |

Ao consultar, resista a dois atalhos: copiar nomes de campos sem necessidade (o Jeff usa
`camelCase` no JSON e `snake_case` no SQL) e replicar as camadas de event sourcing do OpenBot.
O Jeff não precisa de `orchestration_events` + projections + receipts de comando; precisa de
transações com `UNIQUE` de idempotência, que resolvem o mesmo problema com uma fração do código.
