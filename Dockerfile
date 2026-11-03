FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --chown=node:node app ./app
COPY --chown=node:node content ./content
COPY --chown=node:node tools ./tools
COPY --chown=node:node runtime ./runtime
RUN mkdir -p /data/private && chown -R node:node /data
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "runtime/healthcheck.js"]
CMD ["node", "runtime/production.js"]
