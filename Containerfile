FROM docker.io/library/node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM docker.io/library/node:22-slim
WORKDIR /app
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3030
COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/entrypoint.sh ./
RUN chmod +x entrypoint.sh && mkdir -p /data
VOLUME /data
EXPOSE 3030
ENTRYPOINT ["./entrypoint.sh"]
