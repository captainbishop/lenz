FROM node:24.21.0-bookworm-slim
WORKDIR /app
COPY carrier/server.mjs carrier/store.mjs ./carrier/
COPY web/public/carrier-protocol.js web/public/peer-crypto.js web/public/profile-display.js ./web/public/
RUN mkdir /data && chown node:node /data
USER node
ENV CARRIER_HOST=0.0.0.0 CARRIER_PORT=4311 CARRIER_DATA_DIR=/data
EXPOSE 4311
CMD ["node", "carrier/server.mjs"]
