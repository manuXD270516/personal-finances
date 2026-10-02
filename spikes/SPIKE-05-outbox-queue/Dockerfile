FROM node:22-alpine
RUN npm i -g pnpm@12.4.2
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY src ./src
COPY sql ./sql
COPY envelope.v1.schema.json ./
USER node
CMD ["node_modules/.bin/tsx", "src/worker-main.ts"]
