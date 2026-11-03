# Contrato de dados — v1

## Objetivo

Minimizar bytes e evoluir de forma previsível:

- Arrays em vez de objetos repetitivos; índices numéricos em vez de strings repetidas.
- Sem URLs de miniatura ou avatar. Apenas IDs.
- Texto de comentário original, string pura, nunca HTML.
- Datas em epoch Unix UTC, em segundos.

## Dataset (arquivo de dados)

```json
{
  "v": 1,
  "g": "2026-01-01T12:00:00.000Z",
  "videos": [["VIDEO_ID", "Título", "Nome do canal", 1714564800]],
  "authors": [["AUTHOR_ID", "Nome exibido"]],
  "comments": [[0, 0, 12, 1714568400, "Texto", -1]]
}
```

| Campo | Tipo | Descrição |
|---|---|---|
| `v` | inteiro | Versão do contrato (`1`) |
| `g` | ISO 8601 | Data de geração |

**`videos[n]`**: `[videoId, title, channelTitle, publishedAt]` (`videoId` não vazio; `publishedAt` ≥ 0, `0` se desconhecido).

**`authors[n]`**: `[authorId, displayName]` (`authorId` pode ser vazio; `displayName` não vazio; autores sem ID são deduplicados pelo nome).

**`comments[n]`**: `[videoIndex, authorIndex, likeCount, publishedAt, text, parentIndex]`

- `parentIndex` é `-1` (raiz) ou um índice **estritamente menor** que o do comentário. Isso garante ordem topológica e impede ciclos.
- Em shards, um grupo (raiz + respostas) nunca é dividido.

## Manifesto (`data/manifest.json`)

```json
{
  "mv": 1, "v": 1, "g": "…", "ch": "sha256 do conteúdo sem g",
  "mode": "full",
  "counts": { "videos": 1, "authors": 1, "comments": 10 },
  "files": [{ "path": "data/datasets/<hash16>.json", "sha256": "…", "bytes": 1000, "gzipBytes": 400 }],
  "shards": []
}
```

| `mode` | Significado |
|---|---|
| `empty` | Nada publicado; `files` e `shards` vazios |
| `full` | Exatamente um arquivo em `data/datasets/` |
| `sharded` | Um ou mais arquivos em `data/shards/<videoId>-<parte>-<hash16>.json`, cada um um dataset v1 válido com um vídeo |

- `q` (opcional): `{ "used": 42, "limit": 10000 }`, estimativa das unidades de cota da YouTube Data API gastas na coleta (1 por chamada, inclusive tentativas com erro). Não entra em `ch`. O site usa isso para mostrar a cota diária restante.
- `ch` (opcional) é o hash do conteúdo ignorando `g`; a coleta o usa para não publicar quando nada mudou.
- Caminhos são relativos e sempre sob `data/`; `..`, URLs absolutas e barras invertidas são rejeitados.
- Os arquivos têm o hash no nome, então nunca mudam: podem ter cache imutável.

## Orçamento

- Arquivo `full`: até 300 KB comprimidos (`maxFullCompressedBytes`). Acima disso, divide em shards de até 200 KB (`maxShardCompressedBytes`).
- O tamanho comprimido é medido com gzip nível padrão; Cloudflare costuma servir com Brotli (menor).

## Versionamento

- Mudança aditiva e compatível: mantém `v: 1`.
- Mudança incompatível: incremente `CONTRACT_VERSION` em `assets/js/modules/data.js`, atualize adaptador, testes, `DATA_CACHE` em `sw.js` e este documento.
