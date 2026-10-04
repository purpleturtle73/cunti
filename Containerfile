FROM docker.io/library/node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM docker.io/library/node:22-slim
WORKDIR /app
# Versione dell'immagine, passata dalla CI (1.2.3 sui tag, main-<sha7> altrimenti).
# Dichiarata nello stage finale: l'ARG dello stage di build non arriva fin qui.
ARG APP_VERSION=dev
# BODY_SIZE_LIMIT: adapter-node rifiuta di default i body oltre 512 KB (413) prima che
# arrivino ai limiti dell'app (CSV transazioni 2 MB, CSV spese 20 MB, upload backup
# 200 MB). Allineato al più grande, l'upload dei backup.
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3030 \
    BODY_SIZE_LIMIT=200M \
    APP_VERSION=${APP_VERSION}
COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
RUN mkdir -p /data
VOLUME /data
EXPOSE 3030
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT||3030}/api/health`).then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "build/index.js"]
