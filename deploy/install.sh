#!/usr/bin/env bash
# Первый запуск MASL на чистом сервере Ubuntu 22.04/24.04. Повторный запуск безопасен.
#   git clone https://github.com/TeMbl4k/MASL.git masl && cd masl && sudo bash deploy/install.sh
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Запустите через sudo: sudo bash deploy/install.sh" >&2
  exit 1
fi

DEPLOY_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$DEPLOY_DIR/.env"
COMPOSE=(docker compose -f "$DEPLOY_DIR/compose.yml" --env-file "$ENV_FILE")

echo "== Docker"
packages=()
command -v curl >/dev/null || packages+=(curl)
command -v openssl >/dev/null || packages+=(openssl)
# Пакеты из репозитория Ubuntu: download.docker.com из России доступен не всегда.
docker compose version >/dev/null 2>&1 || packages+=(docker.io docker-compose-v2)
if [ "${#packages[@]}" -gt 0 ]; then
  apt-get update -q
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q "${packages[@]}"
fi
systemctl enable --now docker

# Docker Hub из России иногда недоступен: тогда качаем образы через зеркала.
hub_status="$(curl -s -o /dev/null -m 10 -w '%{http_code}' https://registry-1.docker.io/v2/ || true)"
if [ "$hub_status" != "401" ] && [ ! -f /etc/docker/daemon.json ]; then
  echo "Docker Hub недоступен, подключаю зеркала"
  cat >/etc/docker/daemon.json <<'JSON'
{ "registry-mirrors": ["https://dockerhub.timeweb.cloud", "https://mirror.gcr.io"] }
JSON
  systemctl restart docker
fi

echo "== Память для сборки"
# Сборке нужно около 2 ГБ памяти; на маленьком сервере добавляем swap.
mem_mb="$(awk '/MemTotal/ {print int($2 / 1024)}' /proc/meminfo)"
if [ "$mem_mb" -lt 3000 ] && [ -z "$(swapon --noheadings)" ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
  echo "Добавлен swap 2 ГБ"
fi

echo "== Настройки"
if [ ! -f "$ENV_FILE" ]; then
  # Публичный IP сервера: sslip.io превращает его в домен, на который выдают сертификат.
  ip="$(curl -4 -fsS -m 5 https://ifconfig.me 2>/dev/null || true)"
  if ! [[ "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    ip="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") print $(i + 1)}')"
  fi
  default_domain="${ip:+${ip//./-}.sslip.io}"
  while true; do
    read -r -p "Домен сайта${default_domain:+ [$default_domain]}: " domain </dev/tty
    domain="${domain:-$default_domain}"
    [ -n "$domain" ] && break
    echo "Введите домен или IP сервера через дефисы с .sslip.io, например 203-0-113-7.sslip.io"
  done
  while true; do
    read -r -s -p "Токен бота от @BotFather (ввод не отображается): " bot_token </dev/tty
    echo
    [[ "$bot_token" =~ ^[0-9]+:[A-Za-z0-9_-]+$ ]] && break
    echo "Токен выглядит как 123456789:AA..., попробуйте ещё раз"
  done
  umask 077
  cat >"$ENV_FILE" <<ENV
DOMAIN=$domain
BOT_TOKEN=$bot_token
POSTGRES_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 32)
ENV
  echo "Сохранено в $ENV_FILE"
else
  echo "Беру настройки из $ENV_FILE"
fi
domain="$(grep '^DOMAIN=' "$ENV_FILE" | cut -d= -f2-)"

echo "== Сборка и запуск (первый раз несколько минут)"
"${COMPOSE[@]}" up -d --build --remove-orphans

echo "== Проверка"
for _ in $(seq 1 60); do
  if curl -fsS -m 5 "https://$domain/api/health" >/dev/null 2>&1; then
    echo
    echo "Готово: https://$domain"
    echo "Укажите этот адрес в @BotFather → Bot Settings → Menu Button."
    exit 0
  fi
  sleep 5
done
echo "Сайт не ответил за 5 минут. Логи: ${COMPOSE[*]} logs --tail 100" >&2
exit 1
