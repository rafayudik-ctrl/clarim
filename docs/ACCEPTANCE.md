# Critérios de aceite

## Filtros e interface

- Palavras-chave ignoram caixa e acentos; modos "qualquer termo" e "todos os termos".
- Limite de 12 palavras-chave de até 40 caracteres; duplicadas e curtas (< 2) são recusadas com aviso.
- Filtros de vídeo, autor (nome contém), período (De/Até, dias inclusivos, fuso local) e ordenação (recentes, antigos, curtidos).
- Palavras-chave, modo e ordenação persistem em `localStorage` (com tratamento de indisponibilidade); nada sai do navegador.
- Lista incremental de 30 em 30; respostas aparecem identificadas.
- Respostas de consultas antigas nunca sobrescrevem a atual.

## Nuvem de palavras

- Reflete o filtro atual, no máximo 80 termos.
- Ignora stopwords (pt/en), links, menções, números, palavras com menos de 3 letras, contrações e risadas.
- Cada palavra é um botão: clicar a adiciona ao filtro.

## Exportação

- `.txt` com `Autor (Vídeo, AAAA-MM-DD)` + texto, comentários separados por exatamente três linhas em branco.
- Reflete o filtro e a ordenação exibidos; se o filtro mudou durante a exportação, avisa e refaz a consulta.
- Teste automatizado: `test/export.test.mjs`, `test/engine.test.mjs`.

## Dados e coleta

- Manifesto sempre válido; modos `empty`, `full` e `sharded`.
- `npm run validate:artifact` passa depois de toda coleta.
- Falha da coleta preserva `data/` anterior.
- Execução sem mudança de conteúdo não gera commit.

## PWA e privacidade

- Funciona offline depois do primeiro acesso.
- Zero scripts, fontes ou imagens de terceiros; CSP `default-src 'self'`.
- A chave da API nunca aparece em `data/`, logs ou front-end.

## Acessibilidade

- Skip link, foco visível, rótulos em todos os controles, `role="status"` para estado e contagem.
- Movimento reduzido respeitado; utilizável por teclado.

## Verificado nesta entrega

- `npm test`: 53 testes passando.
- Chrome real (Playwright): modos `full` e `sharded`, `dist/` buildado, filtros, nuvem, exportação, persistência e recarga offline, sem erros no console.
