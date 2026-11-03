# Pipeline de coleta

## Princípios

- A YouTube Data API v3 é usada **apenas** no GitHub Actions ou localmente. Nunca no navegador.
- A chave fica em GitHub Secrets (ou variável de ambiente local). Não vai para o front-end, `config/`, `data/` nem logs.
- A curadoria é feita em `config/collection.json`; visitantes não adicionam vídeos.
- Falha na coleta **não** sobrescreve a última versão válida.
- Nenhum serviço usado exige cartão de crédito.

## Configurar a chave

1. Crie um projeto no Google Cloud.
2. Ative somente a **YouTube Data API v3**.
3. Crie uma API key e restrinja-a a essa API.
4. GitHub → *Settings → Secrets and variables → Actions* → secret `YOUTUBE_API_KEY`.

Se criar a chave exigir faturamento no seu ambiente, pare. Alternativa manual: gere um dataset no contrato v1
por outro meio, grave-o com `createOutputBundle` + `publishOutputs` (veja `tools/make-sample.mjs`) e rode `npm run validate:artifact`.

## `config/collection.json`

```json
{
  "videos": ["dQw4w9WgXcQ", "https://youtu.be/XXXXXXXXXXX"],
  "maxCommentsPerVideo": 1000,
  "maxPagesPerVideo": 10,
  "pageSize": 100,
  "includeReplies": false,
  "minCommentChars": 0,
  "minTotalComments": 1,
  "minVideosWithComments": 1,
  "allowPartial": false,
  "maxFullCompressedBytes": 307200,
  "maxShardCompressedBytes": 204800,
  "forceShards": false,
  "retries": 3,
  "retryBaseDelayMs": 500
}
```

- `videos`: ID de 11 caracteres ou URL (`watch`, `youtu.be`, `shorts`, `embed`, `live`). Duplicados são removidos.
- `includeReplies`: usa só as respostas que já vêm em `commentThreads.list` (até 5 por comentário), sem chamadas extras.
- `minCommentChars`: só coleta comentários com **pelo menos** N caracteres (0 = sem filtro). Conta caracteres Unicode do texto sem espaços nas pontas; emoji conta como 1. Vale para comentários e respostas. Se um comentário principal for curto demais mas uma resposta passar, a resposta é mantida como comentário independente. `maxCommentsPerVideo` conta só os comentários mantidos, mas `maxPagesPerVideo` continua limitando as chamadas à API: com um mínimo alto, aumente `maxPagesPerVideo`.
- `allowPartial=false` (padrão seguro): qualquer vídeo que falhe de forma transitória aborta a publicação.
- `minTotalComments` / `minVideosWithComments`: proteção contra publicar um dataset vazio por engano.

## Executar

```bash
export YOUTUBE_API_KEY="sua-chave"
npm test
npm run collect
npm run validate:artifact
```

No GitHub: aba *Actions* → *Collect YouTube data* → *Run workflow* (opção `force` publica mesmo sem mudanças).

## Erros e cota

| Situação | Comportamento |
|---|---|
| `quotaExceeded`, `dailyLimitExceeded`, `keyInvalid`, `accessNotConfigured`, `ipRefererBlocked`, HTTP 401 | Fatal: aborta, sem retry |
| `commentsDisabled`, `forbidden` | Vídeo pulado com aviso |
| `videoNotFound` / vídeo ausente em `videos.list` | Vídeo pulado com aviso |
| 429, 5xx, `rateLimitExceeded`, `backendError`, falha de rede | Retry com backoff exponencial (`retryBaseDelayMs × 2^n`) |
| Retries esgotados | Vídeo "failed": aborta se `allowPartial=false` |

Custo aproximado de cota: 1 unidade por chamada. Com 10 páginas por vídeo, são ~11 unidades por vídeo; a cota diária gratuita padrão é de 10.000.

## Sem mudanças = sem commit

O manifesto guarda `ch` (hash do conteúdo sem a data). Se a nova coleta tiver o mesmo `ch`, o script termina sem publicar, e o
workflow não gera commit nem invalida o cache dos usuários. `FORCE_PUBLISH=1` ignora essa checagem.

## O que `validate:artifact` confere

- SHA-256, bytes e gzip de cada arquivo contra o manifesto;
- contagens do manifesto × conteúdo real;
- arquivos em `data/` não referenciados;
- URLs absolutas no manifesto e URLs de imagem em vídeos/autores;
- a chave de API (padrão `AIza…` e o valor da variável) em qualquer arquivo gerado.

## Publicar novos vídeos

1. Adicione o vídeo em `config/collection.json` e faça commit.
2. Execute o workflow manualmente.
3. Revise o commit gerado em `data/`.
4. A Cloudflare Pages faz o deploy do commit.
