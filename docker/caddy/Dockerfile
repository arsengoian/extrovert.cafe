# Caddy з нашим конфігом усередині. Конфіг саме в образі, а не томом на
# сервері: на дроплеті з нашого коду не має лежати нічого, крім
# docker-compose.yml і .env (docs/deploy.md §2.3). Версія точна — як усюди.
FROM caddy:2.11.4-alpine
COPY Caddyfile /etc/caddy/Caddyfile
