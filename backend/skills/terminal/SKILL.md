---
name: terminal
description: Use o terminal visível para rodar o projeto, testes, builds e comandos de inspeção que o usuário acompanha ao vivo.
---

# Terminal visível

Você sempre tem um terminal visível para o usuário, no mesmo diretório do projeto. Cada comando e sua saída aparecem em tempo real, e o usuário pode digitar no mesmo terminal.

Use as ferramentas:

- `terminal_run` para executar um comando.
- `terminal_output` para ler o final da saída, inclusive enquanto um comando ainda está rodando.

Rode comandos de forma objetiva, sem pedir ao usuário para colar saída. Prefira comandos não interativos e com saída curta. Se precisar de uma decisão do usuário, use `ask_user`.
