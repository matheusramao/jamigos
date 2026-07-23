# JAMigos 🎧

Extensão de navegador + servidor de salas para ouvir YouTube Music em sincronia
com amigos. Projeto independente, sem vínculo com o YouTube Music ou o Google.

O que trafega entre as pessoas são **comandos**, nunca áudio: cada participante
toca pela própria conta do YouTube Music. A sala só combina *o quê*, *quando* e
*em que segundo*.

---

## Como está dividido

```
jamigos/
├── extension/          a extensão (Manifest V3)
│   ├── manifest.json
│   ├── config.js       endereço do servidor
│   ├── background.js   service worker — o WebSocket mora aqui
│   ├── content.js      painel + laço de sincronização
│   ├── inject.js       controle do player, no contexto da página
│   ├── styles.js       CSS do painel
│   └── icons/
├── server/
│   ├── main.py         FastAPI: salas, WebSocket, página e download do ZIP
│   ├── pages/index.html  página de convite e instalação
│   ├── teste.py        teste de integração (32 verificações)
│   └── requirements.txt
├── Dockerfile
└── fly.toml
```

---

## 1. Subir o servidor

### Na sua máquina, para testar

```bash
cd ouvir-junto
pip install -r server/requirements.txt
python server/main.py            # sobe em http://localhost:8787
```

Abra `http://localhost:8787`, baixe o ZIP e instale. Funciona sozinho, mas seus
amigos não alcançam `localhost` — para isso, o passo 2.

### Para os amigos alcançarem

**Opção A — túnel, sem hospedar nada.** Rápido para testar hoje à noite:

```bash
cloudflared tunnel --url http://localhost:8787
```

Ele devolve um endereço `https://algo.trycloudflare.com`. Mande esse endereço.
O ZIP baixado de lá já vem apontando para lá. O endereço muda a cada vez que
você reinicia o túnel, e aí a extensão precisa ser rebaixada — serve para
experimentar, não para o dia a dia.

**Opção B — Fly.io, endereço fixo e de graça no plano inicial:**

```bash
fly launch --no-deploy      # confirme o nome em fly.toml
fly deploy
```

**Opção C — Render, Railway, uma VPS, qualquer coisa que rode Docker.** O
`Dockerfile` na raiz já está pronto. Só garanta que o serviço aceite
WebSocket (praticamente todos aceitam) e escute em `$PORT`.

### Rodar os testes

```bash
pip install websockets
python server/main.py &        # em outra aba, na porta 8799
python server/teste.py
```

---

## 2. Instalar a extensão

A página inicial do servidor já explica isso para seus amigos com botão de
download e passo a passo. Resumido:

1. Baixe o ZIP em `SEU_SERVIDOR/dl/jamigos.zip` e descompacte.
2. Abra `chrome://extensions` (ou `edge://extensions`).
3. Ligue **Modo do desenvolvedor**.
4. **Carregar sem compactação** → escolha a pasta descompactada.

**Não apague a pasta depois.** O Chrome mantém a extensão ligada ao caminho do
disco; se a pasta sumir, a extensão some junto.

O ZIP é montado na hora pelo servidor, com o endereço dele já preenchido no
`config.js` e nas permissões do `manifest.json`. Ninguém precisa editar nada.

Se você preferir mandar o arquivo por WhatsApp em vez de mandar o link, baixe o
ZIP uma vez e repasse — ele continua apontando para o mesmo servidor.

---

## 3. Como usar

- **Criar sala:** abra o YouTube Music, clique no painel à direita, escolha nome
  e emoji, e toque em *Criar uma sala nova*.
- **Convidar:** clique no código da sala no topo do painel. Ele copia um link
  `SEU_SERVIDOR/r/CODIGO`. Quem já tem a extensão entra direto; quem não tem cai
  na página de instalação e o convite continua valendo depois.
- **Adicionar música:** busque pelo nome no painel, ou cole o link de uma faixa,
  ou clique em *Adicionar a que está tocando aqui*.

### As duas pausas

Esta é a regra central da sala e vale reler:

| Botão | O que faz | Aparece no registro |
|---|---|---|
| **Pausar só pra mim** | Cala o som no seu computador. A sala segue tocando sem você e o painel fica cinza para lembrar disso. | como nota discreta |
| **Voltar pro som da sala** | Você volta no ponto exato em que os outros estão — não onde você parou. | como nota discreta |
| **Pausar pra todos** | Congela a sala inteira, para todo mundo. | em destaque |
| **Pular pra todos** | Passa para a próxima da fila, para todo mundo. | em destaque, com o nome da faixa nova |

### Quem pode o quê

Todo mundo pode adicionar, pular para todos, pausar para todos, mover a faixa
na barra e reordenar a fila. Cada pessoa remove o que ela mesma colocou.
O **dono da sala** (👑, quem criou) remove qualquer faixa e limpa a fila.
Se o dono sair, a coroa passa automaticamente para quem entrou logo depois.

### Registro e chat

A aba *Registro* guarda as últimas 300 ações com horário: quem entrou, quem
saiu, quem adicionou o quê, quem pausou ou pulou para todos, quem trocou de
nome, e quando uma faixa acabou sozinha. No rodapé da aba tem um campo de
conversa — as mensagens entram na mesma linha do tempo, com o nome e o emoji
de quem falou.

### Reações e pulo por votação

Abaixo dos controles ficam 🔥 ❤️ 😴 — apertou, o emoji sobe flutuando na tela
de todo mundo, com o nome de quem mandou. O quarto botão, 👎, é um voto para
pular: quando a **maioria simples de quem está ouvindo** (no mínimo 2 pessoas)
vota, a faixa pula sozinha e o registro anota "pulada por votação". Cada pessoa
vota uma vez por faixa e os votos zeram quando a música muda.

### Anúncios (contas gratuitas)

A extensão **não bloqueia nem pula anúncios** — isso violaria os termos do
YouTube. O que ela faz é não deixar o anúncio quebrar a sala: quando um anúncio
pega você, a sala segue sem esperar, os outros veem um selo 📺 no seu nome, e
no instante em que o anúncio acaba a extensão te joga **no segundo em que a
sala está agora** — não onde você tinha parado. Você perde o trecho que o
anúncio cobriu (como numa rádio), mas nunca fica atrasado nem atrasa ninguém.

### Se o servidor cair no meio da festa

O estado das salas (faixa, posição, fila e registro) é salvo num JSON a cada
30 segundos. Quando o servidor volta, a sala está lá — pausada por segurança,
no ponto em que estava — e as extensões dos participantes se reconectam
sozinhas. É só alguém apertar *Retomar pra todos*. O arquivo fica em
`server/salas.json` (mude com a variável `OJ_DATA`). No Fly.io o disco é
apagado a cada deploy; se quiser que sobreviva a deploys, monte um volume e
aponte `OJ_DATA` para ele.

---

## Detalhes técnicos que valem saber

**Onde fica o WebSocket.** No service worker, não no content script. A política
de segurança do `music.youtube.com` pode barrar conexões abertas de dentro da
página; do service worker não há essa restrição. O service worker do Manifest V3
dorme depois de ~30 s parado, então três coisas o mantêm acordado: a porta de
mensagens com o content script, o tráfego do próprio WebSocket e um alarme de
25 em 25 segundos. Por isso o `minimum_chrome_version` é 116 — foi a versão que
passou a considerar tráfego de WebSocket como atividade.

**Como a sincronização funciona.** O servidor é o relógio oficial: ele guarda a
posição da faixa e o instante em que essa posição foi medida. Cada cliente mede
a diferença entre o próprio relógio e o do servidor com três `ping`/`pong` e
corrige. A cada 1,5 s o cliente compara onde o player está com onde deveria
estar; passou de 1,8 s de diferença, ele pula para o lugar certo. Correções são
suspensas enquanto o player está carregando, para os dois não brigarem.

**Como o player é controlado.** Pelo objeto `#movie_player` da página, com
`loadVideoById`, `playVideo`, `pauseVideo` e `seekTo`. Isso exige rodar no
contexto da página, e não no mundo isolado do content script — daí o
`inject.js`.

**A busca.** Usa a API interna do YouTube Music, com as credenciais da própria
aba. É a parte mais frágil do projeto: se o YouTube mudar o formato da resposta,
a busca para. Por isso colar o link de uma faixa sempre funciona como plano B, e
o painel avisa quando cai nesse caso.

**Autoplay.** Navegador nenhum toca som sem um gesto do usuário. O botão de
entrar na sala serve como esse gesto — por isso a entrada é um clique e não
automática.

---

## Publicar na Chrome Web Store

É o único jeito de ter instalação em um clique. Custa US$ 5, uma vez, para a
conta de desenvolvedor. Com a extensão publicada:

- o link vira `https://chromewebstore.google.com/detail/SEU_ID`;
- as atualizações chegam sozinhas em todo mundo;
- some o modo do desenvolvedor e some o aviso amarelo do Chrome.

Para a revisão passar sem atrito: descreva com precisão por que a extensão
precisa acessar `music.youtube.com`, e deixe claro na descrição que o projeto
não tem vínculo com o Google. A política de dados já está favorável — a
extensão não coleta nada e o servidor não guarda nada em disco.

---

## Fechar o servidor com senha (opcional)

Sem configurar nada, qualquer pessoa com o endereço pode criar salas. Para
fechar: defina a variável de ambiente `OJ_TOKEN` com uma senha qualquer
(no Replit: Tools → Secrets → chave `OJ_TOKEN`) e reinicie. A senha é embutida
automaticamente no ZIP que a página gera — seus amigos não digitam nada, e
quem baixar a extensão fora da sua página não consegue entrar. Se trocar a
senha, todo mundo baixa a extensão de novo.

## Limites conhecidos

- Uma sala vazia é descartada 15 minutos depois que a última pessoa sai
  (mesmo com a persistência: o JSON guarda quedas, não salas abandonadas).
- Cada aba aberta do YouTube Music conta como uma pessoa na sala. Se você
  duplicar a aba, você aparece duas vezes.
- Em contas gratuitas, cada anúncio faz a pessoa perder o trecho da música que
  ele cobriu — a extensão realinha no fim do anúncio, mas não recupera o que
  passou. Com contas Premium isso não ocorre.
- Sem limite de participantes no código. Se a sala crescer muito, o gargalo é a
  banda do seu servidor, não o programa.
