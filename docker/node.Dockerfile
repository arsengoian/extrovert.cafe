# Один Dockerfile на всі node-сервіси: різниця лише в аргументі SVC.
FROM node:22-alpine
ARG SVC
WORKDIR /app
COPY ${SVC}/package.json ./package.json
RUN npm install --omit=dev
COPY ${SVC}/ ./
ENV NODE_ENV=production
CMD ["node", "src/index.js"]
