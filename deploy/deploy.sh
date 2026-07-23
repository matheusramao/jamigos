#!/usr/bin/env bash
#
# JAMigos — atualização segura em produção.
#
# Publica a versão nova, confere se ela subiu saudável e, se não subiu,
# volta sozinho para a anterior. Você nunca fica com o servidor fora do ar
# por causa de um deploy ruim.
#
#   ./deploy/deploy.sh
#
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RAIZ"

PORTA="${PORTA:-8787}"
SAUDE="http://localhost:${PORTA}/health"
TENTATIVAS=20

info()  { printf "\033[1;35m▸\033[0m %s\n" "$*"; }
erro()  { printf "\033[1;31m✗\033[0m %s\n" "$*" >&2; }
ok()    { printf "\033[1;32m✓\033[0m %s\n" "$*"; }

# ---------------------------------------------------------------- 1. estado
ANTERIOR="$(git rev-parse HEAD 2>/dev/null || echo '')"
if [[ -n "$ANTERIOR" ]]; then
  info "versão atual: ${ANTERIOR:0:8}"
fi

# ------------------------------------------------------------- 2. atualizar
if [[ -d .git ]]; then
  info "buscando a versão nova…"
  git fetch --quiet origin
  git reset --hard --quiet origin/main
  ok "código atualizado para $(git rev-parse --short HEAD)"
fi

# --------------------------------------------------------------- 3. subir
info "reconstruindo e subindo…"
docker compose -f deploy/docker-compose.yml up -d --build

# ---------------------------------------------------- 4. verificar a saúde
info "conferindo se subiu saudável…"
for i in $(seq 1 $TENTATIVAS); do
  if curl -fsS --max-time 3 "$SAUDE" > /tmp/jamigos-health.json 2>/dev/null; then
    ok "no ar: $(cat /tmp/jamigos-health.json)"
    info "deploy concluído."
    exit 0
  fi
  sleep 2
done

# ------------------------------------------------------------ 5. reverter
erro "a versão nova não respondeu em $((TENTATIVAS * 2))s."
if [[ -n "$ANTERIOR" && -d .git ]]; then
  erro "revertendo para ${ANTERIOR:0:8}…"
  git reset --hard --quiet "$ANTERIOR"
  docker compose -f deploy/docker-compose.yml up -d --build
  for i in $(seq 1 $TENTATIVAS); do
    if curl -fsS --max-time 3 "$SAUDE" >/dev/null 2>&1; then
      ok "revertido. O servidor está no ar na versão anterior."
      exit 1
    fi
    sleep 2
  done
  erro "a reversão também falhou. Confira: docker compose -f deploy/docker-compose.yml logs --tail 80"
fi
exit 1
