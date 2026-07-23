# JAMigos em produção

Como deixar o serviço no ar de forma confiável, com atualização segura e
aviso quando algo sai do lugar.

Antes de tudo, um ajuste de expectativa: **100% de disponibilidade não existe.**
Provedor reinicia, rede oscila, energia cai. O que dá para construir — e é o
que este guia entrega — é um sistema que **se recupera sozinho em segundos**,
de modo que ninguém na sala perceba. Na prática isso costuma ficar entre
99,9% e 99,95% ao mês, o que dá algo entre 20 e 40 minutos de instabilidade
por mês, quase sempre em blocos de segundos.

---

## A arquitetura

```
        seus amigos
             │  https / wss
             ▼
   jamigos.seudominio.com.br      ← domínio seu: o servidor vira peça trocável
             │
        ┌────▼─────┐
        │  Caddy   │              ← HTTPS automático, renova sozinho
        └────┬─────┘
             │  localhost:8787
        ┌────▼──────────┐
        │  JAMigos      │         ← Docker, reinicia sozinho se cair
        │  (FastAPI)    │
        └────┬──────────┘
             │
        salas.json                ← sobrevive a reinícios
```

Cada camada cobre uma falha diferente:

| Falha | O que segura |
|---|---|
| O programa trava | Docker reinicia o contêiner em segundos |
| A máquina reinicia | `restart: unless-stopped` sobe tudo no boot |
| Certificado vence | Caddy renova sozinho, sem intervenção |
| O servidor some por um instante | A extensão reconecta sozinha e o painel avisa |
| O servidor reinicia no meio da festa | As salas voltam do `salas.json`, no ponto em que estavam |
| Um deploy sai ruim | `deploy.sh` detecta e reverte automaticamente |
| Cai de madrugada e você não vê | Monitor externo te avisa por e-mail |

---

## Montagem, uma vez só

### 1. Domínio

Registre no Registro.br (~R$ 40/ano) e aponte os servidores DNS para a
Cloudflare (grátis). Crie um registro `A` de `jamigos` para o IP da VPS.

Esse passo é o que torna o servidor substituível: mudou de provedor, muda o
apontamento e ninguém reinstala nada.

### 2. VPS

1 vCPU e 1 GB de RAM sobram — o serviço guarda tudo em memória e não faz
processamento pesado. Hetzner (~€4,5/mês), Contabo, DigitalOcean, ou a camada
gratuita permanente da Oracle Cloud.

```bash
# usuário sem privilégios para rodar o serviço
adduser --disabled-password --gecos "" jamigos
usermod -aG docker jamigos

# firewall: só o essencial exposto
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable

# atualizações de segurança automáticas
apt install -y unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades
```

### 3. O serviço

```bash
git clone SEU_REPO /opt/jamigos && cd /opt/jamigos
docker compose -f deploy/docker-compose.yml up -d
curl localhost:8787/health
```

### 4. Caddy na frente

```bash
apt install -y caddy
cp deploy/Caddyfile /etc/caddy/Caddyfile   # troque o domínio dentro dele
systemctl reload caddy
```

Em segundos `https://jamigos.seudominio.com.br` responde com certificado
válido. O Caddy cuida da renovação para sempre.

### 5. Monitoramento

Crie uma conta no UptimeRobot (grátis) e monitore
`https://jamigos.seudominio.com.br/health` a cada 5 minutos, com alerta por
e-mail. Leva dois minutos e é a diferença entre descobrir uma queda pelo
monitor ou pelo grupo do WhatsApp reclamando.

### 6. Publique a extensão

Com o domínio fixo, publique na Chrome Web Store apontando para ele. A partir
daí toda atualização da extensão chega sozinha a todo mundo, e você nunca mais
precisa pedir para ninguém rebaixar nada.

---

## O ciclo de atualização

**Mudou algo no servidor** (regras da sala, votos, textos):

```bash
cd /opt/jamigos && ./deploy/deploy.sh
```

O script busca o código novo, sobe, confere a saúde e — se a versão nova não
responder — volta sozinho para a anterior. Quem estava na sala fica alguns
segundos com o aviso de reconexão e volta ao mesmo ponto da música.

**Mudou algo na extensão:** atualize o servidor do mesmo jeito (para o ZIP
sair certo) e envie o novo pacote na Chrome Web Store, em *Package → Upload
new package*. Chega em todo mundo em algumas horas, sozinho.

**Regra de ouro:** o que puder morar no servidor, more no servidor. Mudança de
servidor é instantânea para todos; mudança de extensão passa por revisão.

---

## Rotina de manutenção

Praticamente nenhuma, mas vale saber onde olhar:

```bash
docker compose -f deploy/docker-compose.yml logs -f --tail 100   # o que está acontecendo
docker compose -f deploy/docker-compose.yml restart              # reiniciar
curl localhost:8787/health                                       # está vivo?
```

- **Backup:** só o `deploy/dados/salas.json`, e ele é descartável — guarda
  salas em andamento, não histórico. Perder é irrelevante.
- **Espaço em disco:** o serviço não cresce. Vigie só os logs do Caddy, que já
  estão configurados para rotacionar.
- **Custo mensal total:** VPS ~R$ 30 + domínio ~R$ 3 (R$ 40/ano diluído).
  Monitoramento e certificado, zero. A taxa da Chrome Web Store é US$ 5 uma
  única vez.

---

## O que ainda pode derrubar (e o que fazer)

- **Provedor da VPS com manutenção:** raro, avisado por e-mail. O serviço volta
  sozinho quando a máquina volta.
- **Mudança no YouTube Music:** o risco mais provável de todos. Se eles
  reorganizarem o site, o botão ＋ e a leitura de metadados podem parar. Não
  derruba o servidor: derruba um recurso. É correção de código, não de
  infraestrutura.
- **Chrome mudando regras de extensão:** acontece de tempos em tempos e vem com
  aviso prévio de meses para quem publica na loja — mais um motivo para
  publicar.
