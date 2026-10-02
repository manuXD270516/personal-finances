# syntax=docker/dockerfile:1
# Stand-in for finance-api: one image, process chosen by command (api|worker). THROWAWAY.
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY *.mjs ./
USER node
# exec form -> node receives signals directly (no sh -c wrapper)
ENTRYPOINT ["node"]
CMD ["api.mjs"]
