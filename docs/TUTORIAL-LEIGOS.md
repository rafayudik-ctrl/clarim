# Tutorial para leigos: como colocar o Clarim no ar (ON)

Não precisa saber programar. Tudo é feito pelo navegador, copiando e colando. Tempo: cerca de 40 minutos.
Custo: R$ 0. Nenhum passo exige cartão de crédito. Se algum serviço pedir cartão, **pare** e veja a seção "Problemas comuns".

> Os sites mudam de aparência com frequência. Se um botão tiver nome um pouco diferente, procure o equivalente.

## O que você vai ter no final

Um site seu (endereço `https://nome.pages.dev`) que mostra comentários de vídeos do YouTube escolhidos por você, com busca, filtros, nuvem de palavras e exportação em `.txt`. Os comentários são atualizados sozinhos toda segunda-feira.

## Como funciona (em 4 linhas)

1. **GitHub** guarda os arquivos do projeto e roda, uma vez por semana, um robô que coleta os comentários.
2. **Google (YouTube Data API)** fornece os comentários ao robô, usando uma "chave" sua.
3. **Cloudflare Pages** publica o site na internet.
4. Quem visita o site só recebe arquivos prontos: nada é enviado para ninguém e não há rastreadores.

## Antes de começar

- Um e-mail (você já tem o Outlook).
- O arquivo `clarim.zip` que eu enviei. **Extraia** o zip no computador (botão direito → Extrair tudo). Você vai ter uma pasta `clarim`.
- Uma lista de vídeos do YouTube que você quer usar (o endereço de cada um).

---

## Parte 1 — Conta no GitHub e repositório

1. Acesse **github.com** → **Sign up** e crie a conta (e-mail, senha, nome de usuário). Confirme o e-mail.
2. Clique no **+** no canto superior direito → **New repository**.
3. Em **Repository name**, escreva `clarim`.
4. Marque **Public** (mais simples; os comentários publicados são públicos de qualquer forma, pois o site é aberto). Se preferir **Private**, funciona, mas veja a observação na Parte 5.
5. **Não** marque "Add a README". Clique em **Create repository**.

## Parte 2 — Enviar os arquivos

1. Na página do repositório vazio, clique no link **uploading an existing file**.
2. Abra a pasta `clarim` no seu computador, **selecione tudo que está dentro dela** (Ctrl+A) e arraste para a janela do GitHub.
   - Arraste o *conteúdo* da pasta, não a pasta `clarim` em si. Na raiz do repositório devem ficar `index.html`, `package.json`, `assets`, etc.
3. Espere terminar o envio (barra de progresso). Se o GitHub avisar que há limite de arquivos, envie em dois lotes (primeiro as pastas `assets`, `icons`, `config`, `data`; depois o resto).
4. Role até o fim, deixe **Commit directly to the main branch** marcado e clique em **Commit changes**.

### Conferir a pasta escondida `.github`

A pasta `.github` é escondida no Windows/Mac e pode não ter sido enviada. Ela contém o robô de coleta.

1. Na página do repositório, veja se existe a pasta **.github**.
2. Se **existir**: ótimo.
3. Se **não existir**, crie o arquivo à mão:
   1. Clique em **Add file → Create new file**.
   2. No campo do nome, digite exatamente `.github/workflows/collect.yml` (as barras criam as pastas sozinhas).
   3. Abra `clarim/.github/workflows/collect.yml` do seu computador com o Bloco de Notas, copie **tudo**, cole na área grande do GitHub.
   4. Clique em **Commit changes** → **Commit changes**.

## Parte 3 — Escolher os vídeos e o tamanho mínimo dos comentários

1. No repositório, abra a pasta **config** → arquivo **collection.json**.
2. Clique no ícone de **lápis** (Edit this file).
3. Você verá algo assim:

```json
{
  "videos": [],
  "maxCommentsPerVideo": 1000,
  "maxPagesPerVideo": 10,
  "pageSize": 100,
  "includeReplies": false,
  "minCommentChars": 0,
  ...
}
```

4. Em `"videos": [],` coloque os endereços entre aspas, separados por vírgula. Exemplo:

```json
"videos": [
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "https://youtu.be/AAAAAAAAAAA"
],
```

   (Dica: copie o endereço direto da barra do navegador. A última linha da lista **não** leva vírgula.)

5. **A nova opção — coletar só comentários a partir de X caracteres:** troque o `0` de `"minCommentChars"` pelo mínimo que você quer.
   - `0` = coleta todos (padrão).
   - `50` = só comentários com 50 caracteres ou mais (algo como uma frase completa).
   - `200` = só comentários longos, bem elaborados.
   - Espaços no começo e no fim não contam; um emoji conta como 1 caractere.
   - Quanto maior o mínimo, mais páginas de comentários o robô precisa ler para achar os que servem. Se o resultado vier pequeno, aumente também `"maxPagesPerVideo"` (por exemplo, de `10` para `30`). Cada página custa 1 unidade da cota gratuita diária (10.000 unidades), então há bastante folga.
   - Se `"includeReplies"` estiver `true`, o filtro também vale para as respostas.

6. Clique em **Commit changes** (botão verde) → **Commit changes**.

## Parte 4 — Criar a chave do YouTube (Google)

1. Acesse **console.cloud.google.com** e entre com sua conta Google. Aceite os termos.
2. No topo, clique no seletor de projeto → **Novo projeto** → nome `clarim` → **Criar**. Selecione o projeto criado.
3. Menu ☰ → **APIs e serviços** → **Biblioteca**. Pesquise **YouTube Data API v3**, abra e clique em **Ativar**.
4. Menu ☰ → **APIs e serviços** → **Credenciais** → **Criar credenciais** → **Chave de API**.
5. Aparece uma chave que começa com `AIza...`. **Copie** e guarde num lugar seguro (bloco de notas fora do projeto).
6. Clique em **Restringir chave** (ou no nome da chave) → em **Restrições de API** escolha **Restringir chave** → marque somente **YouTube Data API v3** → **Salvar**.

> A chave é uma senha. Nunca cole em arquivos do projeto, em prints ou em mensagens.
> Se o Google exigir cartão/faturamento para criar a chave, pare aqui e veja "Problemas comuns".

## Parte 5 — Guardar a chave no GitHub (Secret)

1. No repositório: **Settings** (aba no alto) → no menu da esquerda **Secrets and variables** → **Actions**.
2. Clique em **New repository secret**.
3. **Name:** escreva exatamente `YOUTUBE_API_KEY` (maiúsculas).
4. **Secret:** cole a chave `AIza...`.
5. Clique em **Add secret**.

Também em **Settings → Actions → General**, role até **Workflow permissions**, marque **Read and write permissions** e clique em **Save** (o robô precisa gravar os comentários coletados).

## Parte 6 — Rodar a primeira coleta

1. Aba **Actions** do repositório. Se aparecer um botão verde "I understand my workflows, go ahead and enable them", clique nele.
2. No menu da esquerda, clique em **Collect YouTube data**.
3. Clique em **Run workflow** (à direita) → **Run workflow** (botão verde).
4. Aguarde 1–3 minutos e atualize a página. Um círculo girando = em andamento; ✅ verde = sucesso; ❌ vermelho = erro.
5. Clique na execução para ver o log (veja "Problemas comuns" se deu erro).
6. Quando for ✅, vá na aba **Code**: a pasta **data** agora tem arquivos novos (um commit "chore(data)..." feito pelo robô).

## Parte 7 — Colocar o site no ar (Cloudflare Pages)

1. Acesse **dash.cloudflare.com** → **Sign up** (e-mail e senha gratuitos). Confirme o e-mail.
2. Menu da esquerda: **Workers & Pages** → **Create application**.
3. A tela pode priorizar "Workers". Procure o texto **"Looking to deploy Pages? Get started"** (link pequeno) e clique nele, depois em **Import an existing Git repository → Get started**.
4. **Connect GitHub**: autorize e escolha o repositório `clarim` (se pedir, dê acesso apenas a esse repositório). Clique em **Begin setup**.
5. Preencha:
   - **Project name:** o nome do seu site (vira `nome.pages.dev`).
   - **Production branch:** `main`.
   - **Framework preset:** `None`.
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
6. Abra **Environment variables (advanced)** → **Add variable** → nome `NODE_VERSION`, valor `20`.
7. **Save and Deploy**. Espere 1–2 minutos.
8. Clique no endereço `https://nome.pages.dev`. **O site está ON.**

Cada vez que o robô publicar comentários novos (ou você editar algo), a Cloudflare republica o site sozinha. Se isso não acontecer após uma coleta, abra o projeto na Cloudflare → **Deployments** → **Retry deployment** (ou veja o Deploy Hook em `docs/DEPLOY.md`).

## Parte 8 — Usar

- Digite uma palavra e pressione **Enter** para criar um filtro (pode ter várias; escolha "qualquer termo" ou "todos os termos").
- Use **vídeo**, **autor**, **de/até** (datas) e **ordenar**.
- Clique numa palavra da **nuvem** para adicioná-la ao filtro.
- **Exportar .txt** baixa os comentários do filtro atual, com três linhas em branco entre cada um.
- No celular, o navegador oferece **Adicionar à tela inicial** (funciona como app, inclusive offline).

## Manutenção

- **Adicionar/trocar vídeos ou o mínimo de caracteres:** edite `config/collection.json` (Parte 3) e rode a coleta de novo (Parte 6).
- **Atualização automática:** toda segunda-feira, por volta das 00h17 no horário de Brasília (03:17 UTC). Se nada mudou, nada é publicado.
- **Desligar:** pause o projeto na Cloudflare ou apague o repositório.

## Problemas comuns

| Sintoma | O que fazer |
|---|---|
| Google pediu cartão ou faturamento | Pare. O projeto não exige cartão; tente outra conta Google ou veja `docs/PIPELINE.md` para a alternativa manual. |
| Coleta ❌ com "config.videos: informe ao menos um vídeo" | Você não preencheu `videos` (Parte 3) ou deixou vírgula sobrando. |
| ❌ "YOUTUBE_API_KEY" ausente/inválida (`keyInvalid`) | O secret não existe, tem outro nome ou a chave foi colada com espaço. Refaça a Parte 5. |
| ❌ `quotaExceeded` | A cota diária acabou. Aguarde o dia seguinte (renova à meia-noite no horário do Pacífico) ou reduza `maxPagesPerVideo`. |
| ❌ `accessNotConfigured` | A YouTube Data API v3 não foi ativada no projeto (Parte 4, passo 3). |
| ❌ "Comentários insuficientes" | Com `minCommentChars` alto, poucos comentários passaram. Diminua o mínimo ou aumente `maxPagesPerVideo`. |
| ❌ ao salvar/gravar (permission denied) | Falta a permissão "Read and write" (final da Parte 5). |
| Site mostra "Nenhum dado publicado" | A coleta ainda não rodou com sucesso, ou a Cloudflare ainda não republicou: veja **Deployments**. |
| Site antigo depois de atualizar | Recarregue com Ctrl+F5; no celular, feche e abra o app. |
| Repositório privado | Funciona com Cloudflare; o site continua público no endereço `pages.dev`. |

## Segurança, em resumo

- A chave do Google fica só no GitHub Secrets; ela não vai para o site.
- O site não usa rastreadores nem serviços de terceiros.
- Comentários de vídeos públicos viram arquivos públicos no seu site. Escolha vídeos com isso em mente.
