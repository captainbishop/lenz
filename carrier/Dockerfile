FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
WORKDIR /app
COPY LICENSE ./LICENSE
COPY carrier/server.mjs carrier/store.mjs ./carrier/
COPY web/public/carrier-protocol.js web/public/peer-crypto.js web/public/profile-display.js ./web/public/
RUN mkdir /data && chown node:node /data
USER node
ENV CARRIER_HOST=0.0.0.0 CARRIER_PORT=4311 CARRIER_DATA_DIR=/data
EXPOSE 4311
CMD ["node", "carrier/server.mjs"]
