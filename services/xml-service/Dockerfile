FROM python:3.11-slim

WORKDIR /app

# Instalar dependências do sistema
RUN apt-get update && apt-get install -y \
    gcc \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Copiar requirements
COPY requirements.txt .

# Instalar dependências Python
RUN pip install --no-cache-dir -r requirements.txt

# Copiar código
COPY src/ ./src/
COPY proto/ ./proto/
COPY schemas/ ./schemas/

# Compilar protobuf (gerar arquivos Python do .proto)
RUN python -m grpc_tools.protoc -I./proto --python_out=./src --grpc_python_out=./src ./proto/xml_service.proto || echo "⚠ Proto compilation failed (will use REST fallback)"

# Variáveis de ambiente
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app

# Expor portas
EXPOSE 5000 7000 50051

# Comando padrão (executar a partir do diretório src)
WORKDIR /app/src
CMD ["python", "main.py"]
