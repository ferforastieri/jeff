---
name: browser
description: Use o navegador visível para abrir sites, conferir interfaces, reproduzir fluxos e testar o que o usuário vê.
---

# Navegador visível

Você sempre tem um navegador Chromium visível para o usuário. Ele não é headless: a mesma página aparece na conversa, e o usuário pode assumir o controle.

Use as ferramentas:

- `browser_open` para abrir uma URL.
- `browser_read` para ler URL, título, texto visível, console e requisições que falharam.
- `browser_click` para clicar por seletor CSS ou coordenadas.
- `browser_type` para digitar.
- `browser_press` para teclas como Enter, Tab, Escape e setas.
- `browser_reload` para recarregar.

Prefira seletores CSS estáveis. Depois de abrir ou navegar, leia a página antes de concluir. Se o usuário assumir o controle, pare de operar e devolva o controle quando ele pedir. Não peça ao usuário para descrever a tela quando você pode abrir e ver diretamente.
