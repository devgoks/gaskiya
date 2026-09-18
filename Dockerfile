FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY public ./public
COPY scripts ./scripts
COPY eval ./eval
RUN mkdir -p /data
ENV PORT=8080 DB_PATH=/data/gaskiya.db
EXPOSE 8080
CMD ["node", "src/server.js"]
