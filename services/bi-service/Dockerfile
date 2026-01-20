FROM node:20-slim

WORKDIR /app

# Copiar package files
COPY package*.json ./

# Instalar todas as dependências (incluindo devDependencies para build)
RUN npm install

# Copiar código
COPY . .

# Copiar arquivo .proto
COPY proto/ ./proto/

# Build TypeScript
RUN npm run build

# Remover devDependencies após build (opcional, para imagem menor)
RUN npm prune --production

# Variáveis de ambiente
ENV NODE_ENV=production
ENV PORT=4000

# Expor porta
EXPOSE 4000

# Comando padrão
CMD ["npm", "start"]
