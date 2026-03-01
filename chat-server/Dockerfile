FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY tsconfig.json ./
COPY src/ ./src/
COPY public/ ./public/

RUN npm run build

# Data directory for message persistence
VOLUME /data

EXPOSE 3000

CMD ["node", "dist/index.js"]
