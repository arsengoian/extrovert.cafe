#!/bin/bash
# Збирає образ-білдер один раз (чи після зміни desktop.Dockerfile).
# Правка коду в src/ НЕ вимагає перезбірки образу — джерело монтується
# живим томом у make.sh, тут лише тулчейн і apt-залежності.
set -e
cd "$(dirname "$0")/.."
docker build -t kiosk-desktop-builder -f docker/desktop.Dockerfile .
