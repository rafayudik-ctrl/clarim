# PWA e cache

## Arquivos

- `manifest.webmanifest`: nome, cores e ícone SVG.
- `sw.js`: cache do shell e dos dados.
- `tools/build-site.mjs`: injeta o hash do shell em `dist/sw.js`.

## Caches

### Shell: `clarim-shell-<BUILD_HASH>`

- Conteúdo: lista `SHELL_PATHS` do `sw.js` (HTML, CSS, JS, módulos, Worker, `stopwords.json`, manifest, ícone).
- `install`: `addAll` com `cache: "reload"`.
- Navegação: responde do cache e atualiza em segundo plano; sem cache, vai à rede.
- Demais arquivos do shell: stale-while-revalidate.
- `activate`: apaga caches `clarim-shell-*` antigos e assume os clientes.

Um teste (`test/site.test.mjs`) garante que todo arquivo listado existe e que todo módulo importado pelo front-end está na lista.
**Ao criar um módulo novo, inclua-o em `SHELL_PATHS`.**

### Dados: `clarim-data-v3`

| Recurso | Estratégia |
|---|---|
| `data/manifest.json` | Rede primeiro (`no-store`); cache só como reserva offline. Ao receber um manifesto novo, remove do cache os arquivos de dados que ele não referencia mais |
| `data/datasets/*`, `data/shards/*` | Cache primeiro: o conteúdo nunca muda (hash no nome) |
| Outros em `data/` | Stale-while-revalidate |

Offline com dados já em cache continua funcionando; sem cache, a resposta é `503` com corpo JSON.
Apenas requisições do mesmo domínio são tratadas.

## Invalidação

- **Shell:** qualquer mudança em HTML/CSS/JS/ícones muda o hash em `dist/sw.js` → novo SW instala, `skipWaiting` + `clients.claim` ativam, cache antigo é apagado.
- **Dados:** nova coleta → novos arquivos com hash novo + manifesto novo. O manifesto é sempre buscado na rede, então a atualização aparece no próximo carregamento.
- **Contrato incompatível:** incremente `CONTRACT_VERSION` e `DATA_CACHE` (por exemplo para `clarim-data-v4`).

Forçar em testes: DevTools → Application → Storage → *Clear site data*.
