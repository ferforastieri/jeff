# PostgreSQL com SeaORM

Concluído. O Jeff não usa mais SQLite para os dados do app.

## O que mudou

- `Store` abre um `PgPool` e mantém a conexão SeaORM viva.
- `crate::db::Database` aplica as migrations SeaORM no boot (`JEFF_DATABASE_URL`).
- `backend/schema/postgres.sql` é a primeira migration. Novas mudanças entram como
  migrations novas, sem editar a primeira.
- As 279 queries foram convertidas para `$1..$n`; `INSERT OR IGNORE` virou
  `ON CONFLICT DO NOTHING`, `last_insert_rowid` virou `RETURNING id` e FTS5 virou
  `tsvector` + `websearch_to_tsquery`/`ts_rank`.
- Índices únicos parciais continuam existindo (sessão ativa, run ativo, skill
  ativa, card por mensagem/dono).
- `backend/src/**/schema.sql` do SQLite foi removido.
- Redis opcional (`JEFF_REDIS_URL`): cache de sessão e fanout de notificações
  entre instâncias.

SeaORM é usado para conexão e migrations; as consultas continuam em SQL direto
para manter o desempenho nos caminhos quentes (fila, eventos, busca). É um ORM
para o ciclo de vida do banco, não uma camada obrigatória em cima de cada query.

## Rodar

```bash
export JEFF_DATABASE_URL=postgres://jeff:jeff@127.0.0.1:5432/jeff
cargo run --manifest-path backend/Cargo.toml --bin jeff
```

Sem `JEFF_DATABASE_URL` o servidor recusa subir.

No `install.sh` de Debian/Ubuntu/LXC, a ausência da URL faz o instalador
instalar o PostgreSQL local, criar o papel/banco `jeff` com senha gerada e
gravar a URL no `jeff.env`. Ele também instala o Redis local e grava
`JEFF_REDIS_URL`. Para usar serviços externos, exporte as URLs antes de rodar o
instalador.

## Testes

Os testes precisam de um Postgres descartável. `JEFF_TEST_SCHEMA=1` faz cada
`Store` criar um schema próprio, então a suíte pode rodar em paralelo:

```bash
createdb jeff_test
TEST_DATABASE_URL='postgres://fernando@localhost/jeff_test?host=/var/run/postgresql' \
JEFF_DATABASE_URL='postgres://fernando@localhost/jeff_test?host=/var/run/postgresql' \
JEFF_TEST_SCHEMA=1 \
JEFF_REDIS_URL=redis://127.0.0.1:6379 \
cargo test --manifest-path backend/Cargo.toml
```

`JEFF_REDIS_URL` é opcional nos testes: sem ele, os testes do Redis são pulados.

Resultado: 91 testes de lib + todas as integrações passando no Postgres.

## SQLite

Removido por completo: banco do app, driver da aba **Bancos de dados**, feature
`sqlx/sqlite` no `Cargo.toml` e opções na UI. Não sobra nenhum caminho SQLite.

## Redis

Ligado por `JEFF_REDIS_URL`. O `install.sh` provisiona um Redis local por
padrão. Se a URL não existir ou o Redis estiver fora do ar, o servidor sobe
normalmente e opera sem cache (fail-open).

- **Cache de sessão**: `authenticate` guarda `(Session, User)` por token hash por
  60s. Isso tira o join de sessão e o `UPDATE last_seen_at` de toda requisição
  autenticada. O logout apaga a chave pelo índice reverso na hora.
- **Fanout de notificações**: cada notificação local também vai para o canal
  `jeff:notifications`, com o id da instância de origem. Outras instâncias
  recebem e entregam no SSE sem repetir o trabalho; a origem ignora a própria
  mensagem.

A fila de trabalhos e os eventos continuam no Postgres: são dados duráveis, não
cache.
