FROM node:18

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY src ./src
COPY openapi.yaml ./openapi.yaml

EXPOSE 3000
EXPOSE 8080

CMD ["node", "src/index.js"]