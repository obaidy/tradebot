FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN npm i -g pm2
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY infra/pm2/client-runner.config.js ./infra/pm2/client-runner.config.js
RUN cd dist/strategies/mev-bot && npm ci --omit=dev
CMD ["pm2-runtime","start","infra/pm2/client-runner.config.js"]
