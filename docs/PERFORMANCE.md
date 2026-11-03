# Performance e baixo consumo

Cenário de referência: PC antigo, CPU fraca, pouca memória, navegador atual.

## Orçamentos

| Item | Orçamento |
|---|---|
| HTML + CSS + JS do shell, sem dados | Preferencialmente < 60 KB comprimidos |
| Arquivo de dados | ≤ 300 KB comprimidos (`full`) ou ≤ 200 KB por shard |
| Main thread | Sem tarefas longas planejadas; filtros e nuvem rodam no Worker |
| Animações | Somente `transform` e `opacity`, curtas, respeitando `prefers-reduced-motion` |
| Imagens e fontes | Nenhuma remota; só fontes do sistema e um ícone SVG local |
| Terceiros | Zero |

## Estratégias adotadas

- Shell completo antes do `fetch`; carregamento agendado com `requestIdleCallback` (fallback `setTimeout`).
- Parse, validação, filtro, ordenação e nuvem no Worker; a main thread só atualiza o DOM.
- Texto normalizado (sem acento, minúsculas) calculado uma única vez, na primeira consulta.
- Consultas repetidas vêm do cache LRU (8 entradas) dentro do Worker.
- Lista incremental: 30 itens por página, `DocumentFragment`, sem `innerHTML` com dados.
- Nuvem limitada a 80 palavras; sem recalcular a cada tecla (autor tem debounce de 250 ms; palavras-chave aplicam ao Enter).
- Até 3 downloads de shard em paralelo.
- Sem `backdrop-filter`, blur de rolagem, parallax, polling nem timers recorrentes.

## Não fazer

- Não carregar miniaturas em massa.
- Não renderizar milhares de comentários de uma vez.
- Não usar `innerHTML` com texto externo.
- Não executar filtros pesados na main thread.
- Não animar `top/left/width/height`.

## Checklist de teste

- [ ] DevTools → Performance com CPU 6× e 10× mais lenta; nenhuma tarefa longa > 50 ms durante filtro.
- [ ] Application → Service Worker → *Offline*, recarregar.
- [ ] Lighthouse: performance, acessibilidade, PWA.
- [ ] Navegação só por teclado (skip link, chips removíveis, palavras da nuvem, "Carregar mais").
- [ ] `prefers-reduced-motion: reduce`.
- [ ] Viewport de 320 px.
- [ ] Dataset perto do orçamento (use `npm run sample`, ou ajuste a coleta para ~5.000 comentários).
- [ ] Nova build → SW antigo substituído e cache antigo removido.
