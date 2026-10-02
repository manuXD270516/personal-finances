# Hot-reload harness image (THROWAWAY). Watcher lives in /opt/w, watched code is bind-mounted at /app/src.
FROM node:22-alpine
WORKDIR /opt/w
RUN npm init -y >/dev/null && npm install --no-audit --no-fund chokidar@4.0.3
COPY watcher.mjs writer.mjs ./
ENV NODE_PATH=/opt/w/node_modules
EXPOSE 8080
CMD ["node", "/opt/w/watcher.mjs"]
