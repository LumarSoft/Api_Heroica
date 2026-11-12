#!/usr/bin/env bash
# Despliega la API de Heroica en el VPS de Lumarsoft (PM2: heroica_api).
#
#   pnpm deploy:vps                 despliega main (tu copia tiene que coincidir con origin/main)
#   pnpm deploy:vps --rama-actual   despliega la rama en la que estás (para pruebas)
#
# Compila en tu máquina, sube el resultado, instala dependencias en el servidor, reinicia la API
# y comprueba que responda. La versión anterior queda en dist.anterior para poder volver atrás:
#
#   ssh lumarsoft 'cd /root/api-heroica && rm -rf dist && mv dist.anterior dist && pm2 restart heroica_api'
#
# Requiere acceso SSH al servidor (alias "lumarsoft" en ~/.ssh/config, o HEROICA_VPS_HOST).
set -euo pipefail

HOST="${HEROICA_VPS_HOST:-lumarsoft}"
DIR="/root/api-heroica"
NODE_BIN="/root/.nvm/versions/node/v22.23.2/bin"
PUERTO="3006"
URL="${HEROICA_API_URL:-https://api.adminheroica.com}"

cd "$(dirname "$0")/.."

# 1. El código a desplegar tiene que ser exactamente el del repositorio remoto
if [ -n "$(git status --porcelain)" ]; then
  echo "✖ Hay cambios sin commitear. Commitealos o guardalos antes de desplegar." >&2
  exit 1
fi
git fetch origin --quiet
if [ "${1:-}" != "--rama-actual" ] && [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
  echo "✖ Tu copia no coincide con origin/main." >&2
  echo "  Pasate a main y traé lo último (git switch main && git pull), o usá --rama-actual para probar una rama." >&2
  exit 1
fi
REV="$(git rev-parse --short HEAD)"
RAMA="$(git rev-parse --abbrev-ref HEAD)"
echo "▶ Desplegando $RAMA ($REV) en $HOST:$DIR"

# 2. Compilar con las dependencias exactas del lockfile
pnpm install --frozen-lockfile --silent
rm -rf dist
pnpm build

# 3. Subir el compilado a una carpeta aparte y los archivos de dependencias
rsync -rt --delete -e ssh dist/ "$HOST:$DIR/dist.nuevo/"
rsync -t -e ssh package.json pnpm-lock.yaml .npmrc ecosystem.config.cjs "$HOST:$DIR/"

# 4. Instalar dependencias, cambiar a la versión nueva y reiniciar
ssh "$HOST" bash -s <<EOF
set -euo pipefail
export PATH="$NODE_BIN:\$PATH"
cd "$DIR"
pnpm install --prod --frozen-lockfile --ignore-scripts --silent
rm -rf dist.anterior
[ -d dist ] && mv dist dist.anterior
mv dist.nuevo dist
echo "$REV $RAMA \$(date -Is)" > REVISION
pm2 startOrRestart ecosystem.config.cjs --update-env >/dev/null
pm2 save >/dev/null
for i in \$(seq 1 30); do
  curl -fs -m 2 "http://127.0.0.1:$PUERTO/" >/dev/null && break
  sleep 1
done
curl -fs -m 5 "http://127.0.0.1:$PUERTO/" >/dev/null || {
  echo "✖ La API no respondió después de reiniciar. Revisá: pm2 logs heroica_api" >&2
  exit 1
}
echo "✔ API reiniciada en el servidor (\$(cat REVISION))"
EOF

# 5. Comprobación desde afuera
if curl -fs -m 10 "$URL/" >/dev/null; then
  echo "✔ $URL responde. Despliegue terminado."
else
  echo "✖ $URL no responde desde afuera. Revisá nginx y el estado de la API." >&2
  exit 1
fi
