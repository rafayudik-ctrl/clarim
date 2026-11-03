# Arquitetura

## Princípios

1. O HTML essencial renderiza antes de qualquer dado.
2. Nenhum recurso remoto: sem fontes, imagens de terceiros, analytics ou trackers.
3. Os dados entram por `fetch` depois do primeiro paint; parse, validação, filtro e nuvem rodam em Web Worker.
4. O Service Worker separa o cache do shell (versionado por hash) do cache de dados.
5. O contrato de dados é compacto, versionado e validado antes do uso.
6. Texto de comentário nunca vira HTML (`textContent` sempre).

## Fluxo geral

```text
GitHub Actions (semanal/manual)
  └─ scripts/collect.mjs ── YouTube Data API v3 (só aqui, chave em Secrets)
       └─ compacta → manifesto + dataset/shards com hash → publica data/ atomicamente
            └─ commit → Cloudflare Pages roda `npm run build` → dist/

Navegador
  index.html + app.js (main thread: só DOM)
    └─ worker-client ⇄ query-worker.js
         └─ query-service: manifesto → datasets/shards → valida → merge
              └─ query-engine: filtro, ordenação, nuvem, páginas, exportação
```

## Módulos do front-end

| Arquivo | Responsabilidade | Acessa DOM |
|---|---|---|
| `app.js` | Estado dos filtros, eventos, ordem das respostas, persistência, exportação | sim |
| `modules/ui.js` | Funções de renderização (chips, comentários, nuvem, status) | sim |
| `modules/worker-client.js` | RPC com o Worker; fallback na thread principal se o Worker falhar na inicialização | não |
| `workers/query-worker.js` | Casca fina: recebe mensagens e chama o serviço | não |
| `modules/query-service.js` | Busca manifesto e dados (3 em paralelo), valida, confere contagens, cria o motor | não |
| `modules/query-engine.js` | Normalização, filtros, ordenação, nuvem, cache LRU de consultas, exportação | não |
| `modules/data.js` | `decodeManifest` e `decodeCompactDataset` | não |
| `modules/export-format.js` | Separador de três linhas em branco | não |
| `modules/cache.js` | Registro do Service Worker | não |

`query-service` e `query-engine` não dependem de DOM nem de APIs de Worker, então rodam em Node nos testes.

## Consultas e ordem das respostas

- Cada consulta tem uma **chave** (consulta normalizada serializada). O motor guarda os 8 últimos resultados.
- "Carregar mais" e "Exportar" enviam a chave do resultado que está na tela. Se ela foi descartada, o motor responde `code: "stale"` e a UI refaz o filtro.
- A UI numera as consultas e ignora respostas que não sejam da última.

## Pipeline (`scripts/`)

| Arquivo | Função |
|---|---|
| `collect.mjs` | Orquestra coleta, validações mínimas, comparação de hash e publicação |
| `lib/config.mjs` | Valida `config/collection.json` (aceita ID ou URL) |
| `lib/youtube.mjs` | Cliente da API: retries com backoff, erros fatais × recuperáveis, chave nunca em mensagens |
| `lib/collector.mjs` | Paginação, limites, vídeos removidos / sem comentários |
| `lib/compact.mjs` | Contrato v1 deduplicando autores |
| `lib/output.mjs` | Modo full ou shards, gzip, SHA-256, manifesto |
| `lib/publish.mjs` | Troca atômica de `data/` |
| `validate-artifact.mjs` | Integridade, órfãos, chave de API, URLs de imagem |

## Limites atuais

- Todos os shards são baixados na inicialização (necessário para filtro global e nuvem). O particionamento serve para respeitar o orçamento por arquivo e permitir cache granular.
- Sem virtualização de lista: a página cresce 30 itens por clique em "Carregar mais".
