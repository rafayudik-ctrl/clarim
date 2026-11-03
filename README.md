# Clarim

Leitor 100% client-side de comentários do YouTube. Sem backend de runtime, sem login,
sem analytics e sem scripts de terceiros.

- **Coleta** (build time): GitHub Actions chama a YouTube Data API v3 e publica um dataset compacto em `data/`.
- **Site** (runtime): HTML/CSS/JS puro, PWA offline. Filtros, nuvem de palavras e exportação rodam num Web Worker.

## O que tem aqui

| Parte | O que faz |
|---|---|
| Shell + PWA | Layout dark responsivo, Service Worker versionado por hash, funciona offline |
| Contrato de dados v1 | Arrays compactos + manifesto com hashes SHA-256, modo `full`, `sharded` ou `empty` |
| Pipeline | Coleta com paginação, filtro de tamanho mínimo (`minCommentChars`), retries, tratamento de cota/erros, publicação atômica, pula commits sem mudança |
| Filtros | Palavras-chave (qualquer/todos, sem acento e sem caixa), vídeo, autor, período, ordenação |
| Nuvem | Top 80 palavras do filtro atual; clicar numa palavra a adiciona ao filtro |
| Exportação | `.txt` do filtro atual, comentários separados por três linhas em branco |

## Começando (sem chave de API)

```bash
npm test                 # 50+ testes, sem dependências
npm run sample           # gera dados FICTÍCIOS em data/ (use --shards para testar shards)
python3 -m http.server 8080
```

Abra `http://localhost:8080`. Os módulos ES e o Service Worker exigem HTTP, não `file://`.

Para voltar aos dados reais, rode a coleta (abaixo). O `data/manifest.json` que acompanha o
projeto está **vazio**, então o site mostra o estado "Nenhum dado publicado" até a primeira coleta.

## Coleta real

1. Crie uma API key da **YouTube Data API v3** (veja `docs/PIPELINE.md`).
2. Edite `config/collection.json` e liste os vídeos (ID de 11 caracteres **ou URL** do YouTube).
3. Rode:

```bash
export YOUTUBE_API_KEY="sua-chave"
npm run collect
npm run validate:artifact
```

No GitHub: salve a chave em *Settings → Secrets and variables → Actions* como `YOUTUBE_API_KEY`.
O workflow `collect.yml` roda toda segunda-feira e manualmente, e só faz commit se o conteúdo mudou.

## Build e deploy

```bash
npm run build            # gera dist/ só com o que o navegador precisa + hash no sw.js
```

- **Cloudflare Pages (recomendado):** build command `npm run build`, output directory `dist`.
- **GitHub Pages (alternativa):** execute manualmente o workflow `Deploy GitHub Pages (fallback)`.

Detalhes em `docs/DEPLOY.md`.

## Estrutura

```text
index.html  manifest.webmanifest  sw.js  _headers
assets/
  css/styles.css
  stopwords.json
  js/app.js                    orquestra a página
  js/modules/
    data.js                    contrato v1 + manifesto (validação)
    query-engine.js            filtro, ordenação, nuvem, exportação (puro, testável)
    query-service.js           carrega manifesto/dados e mantém o motor
    worker-client.js           Worker + fallback na thread principal
    ui.js  cache.js  export-format.js
  js/workers/query-worker.js
config/collection.json         lista de vídeos e limites
data/manifest.json             + datasets/ ou shards/ gerados pela coleta
scripts/                       coleta, publicação atômica, validação
tools/build-site.mjs           gera dist/
tools/make-sample.mjs          dados fictícios para demonstração
test/                          node --test
docs/                          arquitetura, contrato, pipeline, deploy, cache, performance
```

## Documentação

**Primeira vez? Comece por `docs/TUTORIAL-LEIGOS.md`** (passo a passo para colocar o site no ar, sem programar).

`docs/ARCHITECTURE.md` · `docs/DATA-CONTRACT.md` · `docs/PIPELINE.md` · `docs/DEPLOY.md` ·
`docs/PWA-CACHE.md` · `docs/PERFORMANCE.md` · `docs/ACCEPTANCE.md` · `docs/CHANGELOG.md`

## Custos

Nenhum cartão é exigido pelo projeto. A YouTube Data API v3 tem cota gratuita diária; se o Google Cloud
exigir faturamento no seu ambiente, pare e use a alternativa manual descrita em `docs/PIPELINE.md`.
