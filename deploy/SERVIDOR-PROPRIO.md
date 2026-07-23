# JAMigos — rodando no seu próprio servidor

Guia para sair do Replit e hospedar por conta própria.

---

## Antes de escolher onde: o domínio

Registre um domínio e use um subdomínio para o JAMigos, por exemplo
`jamigos.seudominio.com.br`. Motivo prático: a extensão que os seus amigos
instalam guarda o endereço do servidor dentro dela. Com domínio próprio, você
troca de máquina, de provedor ou de cidade sem ninguém precisar reinstalar
nada. Sem domínio, cada mudança obriga todo mundo a baixar de novo — e, se a
extensão já estiver publicada na Chrome Web Store, obriga uma nova revisão.

`.com.br` no Registro.br: ~R$ 40/ano.

## E o HTTPS não é opcional

A extensão abre um WebSocket a partir de um contexto seguro do navegador, e o
Chrome recusa conexões inseguras (`ws://`) vindas dali — só `localhost` escapa.
Portanto o servidor precisa responder em `https://` / `wss://`. Todos os
caminhos abaixo já resolvem isso.

---

## Caminho A — máquina sua + Cloudflare Tunnel (grátis)

Serve para PC, notebook, mini PC ou Raspberry Pi. O túnel resolve três
problemas de uma vez: dá HTTPS válido, dispensa abrir porta no roteador e
funciona atrás de CGNAT (o caso da maioria das operadoras brasileiras).

**1. Suba o servidor na máquina**

Com Docker (recomendado — sobe junto com o sistema e se recupera de quedas):

```bash
cd jamigos
docker compose -f deploy/docker-compose.yml up -d
```

Sem Docker:

```bash
python3 -m venv venv
venv/bin/pip install -r server/requirements.txt
venv/bin/python server/main.py
```

Confira em `http://localhost:8787/health`.

**2. Ligue o túnel**

- Crie a conta em cloudflare.com e adicione seu domínio (o Registro.br permite
  trocar os servidores DNS para os da Cloudflare; leva alguns minutos).
- No painel: **Zero Trust → Networks → Tunnels → Create a tunnel**, tipo
  *Cloudflared*. Ele mostra o comando de instalação já com o seu token — rode
  esse comando na máquina.
- Ainda no painel, em **Public Hostnames**, aponte
  `jamigos.seudominio.com.br` → `http://localhost:8787`.

Pronto: `https://jamigos.seudominio.com.br` no ar, com certificado, sem tocar
no roteador. O túnel sobe sozinho com a máquina.

**Limite honesto deste caminho:** enquanto a máquina estiver desligada, não há
sala. Para uso combinado com amigos, ótimo. Para deixar 24/7, um mini PC ou
Raspberry Pi velho resolve — o servidor consome pouquíssimo.

---

## Caminho B — VPS (sempre no ar)

Uma máquina virtual pequena dá conta com folga: o servidor guarda tudo em
memória e não faz processamento pesado. 1 vCPU e 512 MB sobram.

Opções comuns: Oracle Cloud (camada gratuita permanente, cadastro mais
burocrático), Hetzner (~€4/mês), Contabo, DigitalOcean, ou provedores
brasileiros se latência baixa importar.

**Passos, com Docker e HTTPS automático via Caddy:**

```bash
# 1. no servidor, com Docker instalado
git clone SEU_REPO jamigos && cd jamigos
docker compose -f deploy/docker-compose.yml up -d

# 2. Caddy como porta de entrada com TLS automático
sudo apt install -y caddy
```

`/etc/caddy/Caddyfile`:

```
jamigos.seudominio.com.br {
    reverse_proxy localhost:8787
}
```

```bash
sudo systemctl reload caddy
```

O Caddy emite e renova o certificado Let's Encrypt sozinho, e já repassa
WebSocket sem configuração extra. Aponte o DNS do subdomínio para o IP da VPS
antes de recarregar.

**Sem Docker:** copie o projeto para `/opt/jamigos`, crie o venv, e use o
`deploy/jamigos.service` (instruções no cabeçalho do arquivo).

---

## Depois de estar no ar

1. Abra `https://jamigos.seudominio.com.br` e baixe a extensão por ali — o ZIP
   sai configurado com esse endereço.
2. Peça aos amigos para reinstalar **uma última vez** por esse link. Da próxima
   troca de servidor, ninguém precisará fazer nada.
3. Se quiser fechar o servidor para estranhos, defina `OJ_TOKEN` e reinicie: a
   senha vai embutida no ZIP automaticamente.

## Manutenção

- **Atualizar:** substitua os arquivos e reinicie (`docker compose up -d
  --build` ou `systemctl restart jamigos`). Mudanças no servidor chegam a todos
  na hora; mudanças na extensão exigem que cada um rebaixe, salvo se estiver
  publicada na Chrome Web Store.
- **Backup:** só o `salas.json`, e ele é descartável — guarda salas em
  andamento, nada permanente.
- **Monitoramento:** `GET /health` devolve `{"ok":true,...}` com contagem de
  salas e ouvintes. Serve para qualquer monitor externo gratuito.
