# Deploy

## O que é publicado

`npm run build` cria `dist/` com apenas: `index.html`, `manifest.webmanifest`, `sw.js`, `_headers`, `assets/`, `icons/` e `data/`.
Ficam de fora `scripts/`, `config/`, `test/`, `docs/`, `.github/` e `package.json`.

O hash de versão (`BUILD_HASH`) é calculado sobre o shell (HTML, manifest, `assets/`, `icons/`) e injetado **apenas em `dist/sw.js`**.
O `sw.js` da raiz permanece com `'dev'`, então desenvolvimento local não precisa de build.

## Cloudflare Pages (recomendado)

1. Conecte o repositório do GitHub.
2. Build command: `npm run build`
3. Build output directory: `dist`
4. Não configure a chave do YouTube na Cloudflare.

O workflow `collect.yml` faz push em `data/`; a integração GitHub → Cloudflare dispara o deploy.
Se commits feitos pelo bot não dispararem o deploy no seu caso, crie um *Deploy Hook* na Cloudflare, salve a URL como
secret `CLOUDFLARE_DEPLOY_HOOK_URL` e acrescente ao final do job:

```yaml
- name: Trigger Cloudflare Pages deploy hook
  env:
    HOOK: ${{ secrets.CLOUDFLARE_DEPLOY_HOOK_URL }}
  run: |
    if [ -n "$HOOK" ]; then curl -fsS -X POST "$HOOK"; fi
```

## Headers (`_headers`)

- `manifest.json`: `no-cache` (sempre revalidado).
- `data/datasets/*` e `data/shards/*`: `immutable`, 1 ano (o hash está no nome).
- `index.html`, `sw.js`, `manifest.webmanifest`: `no-cache`.
- Todas as rotas: `nosniff`, `Referrer-Policy: no-referrer` e uma CSP restritiva (`default-src 'self'`).

## GitHub Pages (alternativa)

1. *Settings → Pages → Source: GitHub Actions*.
2. Execute o workflow *Deploy GitHub Pages (fallback)* (roda `npm run build` e publica `dist/`).

O GitHub Pages ignora `_headers`: os arquivos de dados continuam seguros (hash no nome), e o manifesto é lido com
`cache: "no-store"` e, no Service Worker, com rede primeiro.

Todos os caminhos são relativos, então funciona em subdiretório (`usuario.github.io/repo/`).

## Segredos

| Segredo | Onde | Observação |
|---|---|---|
| `YOUTUBE_API_KEY` | GitHub Actions / ambiente local | Nunca no front-end, em `data/`, em logs ou na Cloudflare |
| `CLOUDFLARE_DEPLOY_HOOK_URL` | GitHub Actions | Opcional |
