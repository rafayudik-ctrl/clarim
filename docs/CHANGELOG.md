# Unificação das etapas 1–3: correções e melhorias

Este projeto junta as três partes originais (shell/PWA, pipeline de coleta, filtros/nuvem/exportação).
Os patches de cada etapa se sobrescreviam (a etapa 3 trocava `index.html` e `sw.js`, descartando o
design da etapa 1 e o cache da etapa 2), então a interface e o Service Worker foram refeitos como um só.

## Bugs corrigidos

| # | Problema original | Correção |
|---|---|---|
| 1 | **Worker da etapa 3 quebrava com qualquer dado.** `decodeCompactDataset` devolve objetos, mas o worker lia `v[0]`, `a[1]`, `c[4]` como arrays. | O motor trabalha com os arrays brutos validados; `decodeCompactDataset` só valida. |
| 2 | **Stopwords ignoradas.** `stopwords.json` é `{pt:[…], en:[…]}`, mas o código exigia um array e caía sempre na lista embutida. | `parseStopwords` aceita lista ou objeto por idioma. |
| 3 | **Cache do filtro corrompia estado.** Ao voltar a um filtro em cache, o worker continuava com o resultado do filtro anterior: "carregar mais" e exportação saíam do conjunto errado. | Cache LRU dentro do motor, por chave; páginas e exportação pedem pela chave do resultado exibido e falham com `stale` se ele foi descartado. |
| 4 | **Resultados duplicados/obsoletos.** Duas consultas simultâneas renderizavam a lista duas vezes. | Número de sequência por consulta; respostas antigas são descartadas. |
| 5 | **Desmarcar todos os vídeos mostrava todos.** Lista vazia era tratada como "sem filtro". | Filtro de vídeo único (`select`); vídeo inexistente retorna zero resultados. |
| 6 | **Menções `@João` deixavam fragmentos na nuvem** (`\w` não cobre acentos). | Regex Unicode (`\p{L}`), e palavras com apóstrofo (`don't`) e risadas (`kkkk`, `hahaha`) são ignoradas. |
| 7 | **Nuvem mostrava palavras sem acento** (`cafe`). | Contagem por forma normalizada, exibição da forma original em minúsculas (`café`). |
| 8 | **Ordem dos shards não determinística** (ordem de chegada). | Resultados guardados por índice do manifesto. |
| 9 | **`build-version.mjs` não achava o marcador** quando `sw.js` usava aspas duplas. | Regex tolera os dois tipos de aspas; hash agora é injetado só em `dist/`. |
| 10 | **`git diff --quiet` ignorava arquivos novos** no workflow de coleta. | `git add -A data` + `git diff --cached --quiet`. |
| 11 | **`forbidden` abortava toda a coleta** por causa de um vídeo restrito. | Só cota/chave/API desativada são fatais; `forbidden` vira "comentários indisponíveis" daquele vídeo. |
| 12 | **Divisão em shards era O(n²)** (gzip a cada comentário adicionado). | Busca binária pelo maior prefixo que cabe no orçamento. |
| 13 | **`localStorage` podia lançar exceção** (modo privado). | Leitura e escrita protegidas por `try/catch`. |
| 14 | **Blob URL revogada logo após o clique** podia cancelar o download. | Revogação após 10 s. |
| 15 | **Pré-cache do SW podia gravar cópias antigas** do cache HTTP. | `cache: "reload"` no `install`. |

## Melhorias

- Interface única: os controles, a lista e a nuvem de palavras do design da etapa 1 agora são funcionais.
- Filtros novos: autor, período e ordenação (recentes, antigos, curtidos). Resposta marcada como "resposta".
- Clicar numa palavra da nuvem a adiciona ao filtro; a nuvem é acessível (botões, não texto decorativo).
- Motor de consulta separado da UI e do Worker (`query-engine.js`), testável em Node; fallback sem Worker.
- Texto de comentário sempre via `textContent`; nunca `innerHTML`.
- Coleta ignora execuções sem mudança real (`ch` = hash do conteúdo sem a data), evitando commits e invalidação de cache inúteis.
- `config/collection.json` aceita URLs do YouTube além de IDs.
- Timeout de 30 s nas chamadas à API.
- `npm run build` gera `dist/` só com o que o navegador precisa (sem `scripts/`, `config/`, `test/`, `docs/`).
- `_headers` com CSP restritiva, `nosniff` e `no-referrer`.
- `npm run sample` gera dados fictícios para ver a interface sem chave de API.
- 51 testes (`npm test`), incluindo regressões dos bugs acima, e validação em Chrome real (modos full e sharded, offline).

## Adição posterior

- `minCommentChars` em `config/collection.json`: coleta apenas comentários com pelo menos N caracteres (0 = desligado). Respostas longas de um comentário curto são mantidas como comentários independentes. Testes em `test/config.test.mjs` e `test/pipeline.test.mjs` (53 no total).
- `docs/TUTORIAL-LEIGOS.md`: passo a passo completo para publicar o site.
