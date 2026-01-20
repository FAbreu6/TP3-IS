FROM node:20-slim

WORKDIR /app

# Instalar dependências do sistema (se necessário)
RUN apt-get update && apt-get install -y --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Copiar package files
COPY package*.json ./
COPY tsconfig.json ./

# Instalar dependências
RUN npm ci

# Copiar código fonte
COPY src ./src

# Criar diretórios para persistência
RUN mkdir -p downloads

# Expor volumes para persistência (opcional, mas recomendado)
VOLUME ["/app/downloads", "/app/state.json"]

# Executar o processor diretamente com tsx (sem compilação)
CMD ["npm", "start"]

