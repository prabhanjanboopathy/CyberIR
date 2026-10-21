FROM node:22-alpine AS web
WORKDIR /app/apps/web
COPY apps/web/package*.json ./
RUN npm ci
COPY apps/web ./
RUN npm run build

FROM node:22-alpine
WORKDIR /app/apps/api
COPY apps/api/package*.json ./
RUN npm ci --omit=dev
COPY apps/api/src ./src
COPY apps/api/.env.example ./.env.example
COPY --from=web /app/apps/web/dist ../web/dist
ENV NODE_ENV=production
EXPOSE 4000
CMD ["node", "src/server.js"]
