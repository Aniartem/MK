#!/usr/bin/env bash
# Установка кассы и бэк-офиса на чистый сервер Ubuntu 22.04/24.04.
# Запуск под root:
#   curl -fsSL https://raw.githubusercontent.com/Aniartem/MK/main/deploy/install.sh | bash
# Повторный запуск безопасен: обновляет код и перезапускает сервис, не трогая данные и пароли.
# Без вопросов: MK_DOMAIN=kassa.example.ru MK_EMAIL=... MK_PASSWORD=... MK_NAME=... bash install.sh
set -euo pipefail

REPO="${REPO:-https://github.com/Aniartem/MK.git}"
DIR="${DIR:-/opt/mk}"

say() { printf '\n\033[1;34m▸ %s\033[0m\n' "$*"; }
ask() {
  # читаем с терминала, даже если скрипт пришёл через curl | bash
  local prompt="$1" var
  read -r -p "$prompt" var < /dev/tty || true
  printf '%s' "$var"
}

[ "$(id -u)" -eq 0 ] || { echo "Запустите под root (sudo -i)"; exit 1; }

if ! command -v docker >/dev/null 2>&1; then
  say "Устанавливаю Docker"
  apt-get update -qq
  apt-get install -y -qq docker.io docker-compose-v2 git curl openssl >/dev/null \
    || apt-get install -y -qq docker.io docker-compose-plugin git curl openssl >/dev/null
fi
command -v git >/dev/null || apt-get install -y -qq git >/dev/null

# Docker Hub часто недоступен с российских серверов — образы берём через зеркало
if [ ! -f /etc/docker/daemon.json ]; then
  say "Настраиваю зеркало образов Docker"
  mkdir -p /etc/docker
  echo '{"registry-mirrors": ["https://mirror.gcr.io"]}' > /etc/docker/daemon.json
  systemctl restart docker
fi
systemctl enable --now docker >/dev/null 2>&1 || true

if [ -d "$DIR/.git" ]; then
  say "Обновляю код"
  git -C "$DIR" pull --ff-only
else
  say "Скачиваю код в $DIR"
  git clone --depth 1 "$REPO" "$DIR"
fi
cd "$DIR"

FIRST_RUN=0
if [ ! -f .env ]; then
  FIRST_RUN=1
  IP="$(curl -fsS4 https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')"
  echo
  echo "Если у вас есть домен (например kassa.example.ru), направьте его A-запись на IP $IP и введите его."
  echo "Без домена кабинет будет открываться по адресу http://$IP (без HTTPS — подходит только для пробы)."
  DOMAIN="${MK_DOMAIN-$(ask 'Домен (Enter — без домена): ')}"
  cat > .env <<EOF
DOMAIN=${DOMAIN:-:80}
DB_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 32)
APP_TZ=Europe/Samara
EOF
  chmod 600 .env
fi

say "Собираю и запускаю (первый раз — несколько минут)"
docker compose up -d --build

say "Жду запуска сервера"
for _ in $(seq 1 60); do
  docker compose exec -T app wget -qO- http://127.0.0.1:3000/api/health >/dev/null 2>&1 && break
  sleep 2
done

if [ "$FIRST_RUN" = 1 ]; then
  echo
  echo "Создадим вашу учётную запись владельца для входа в кабинет."
  EMAIL="${MK_EMAIL:-$(ask 'Email: ')}"
  PASS="${MK_PASSWORD:-}"
  while [ "${#PASS}" -lt 6 ]; do
    PASS="$(ask 'Пароль (от 6 символов): ')"
  done
  NAME="${MK_NAME:-$(ask 'Ваше имя: ')}"
  docker compose exec -T app node server/dist/create-owner.js "$EMAIL" "$PASS" "${NAME:-Владелец}"
fi

DOMAIN_VALUE="$(grep '^DOMAIN=' .env | cut -d= -f2-)"
if [ "$DOMAIN_VALUE" = ":80" ]; then
  URL="http://$(curl -fsS4 https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')"
else
  URL="https://$DOMAIN_VALUE"
fi
say "Готово"
echo "Бэк-офис:          $URL/"
echo "Касса (браузер):   $URL/pos/"
echo "Адрес сервера для планшета: $URL"
