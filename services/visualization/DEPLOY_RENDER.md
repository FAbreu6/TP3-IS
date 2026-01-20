# 🚀 Deploy do Visualization Service no Render

## 📋 Pré-requisitos

1. Conta no Render: https://render.com
2. Código versionado no Git (GitHub/GitLab/Bitbucket)
3. BI Service já deployado (para o visualization conectar)

---

## 🔧 Método 1: Deploy via Render Dashboard (Recomendado)

### Passo 1: Preparar o Repositório

1. Certifique-se de que os arquivos estão no Git:
   - `services/visualization/package.json`
   - `services/visualization/server.js`
   - `services/visualization/index.html`

2. Faça commit e push:
```bash
git add services/visualization/
git commit -m "Add visualization service for Render deployment"
git push
```

### Passo 2: Criar Novo Web Service no Render

1. Acesse: https://dashboard.render.com
2. Clique em **"New +"** → **"Web Service"**
3. Conecte seu repositório Git
4. Configure o serviço:

   **Configurações Básicas:**
   - **Name**: `tp3-visualization`
   - **Region**: Escolha a região mais próxima (ex: Frankfurt, EU)
   - **Branch**: `main` (ou sua branch principal)
   - **Root Directory**: `services/visualization`

   **Build & Deploy:**
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`

   **Environment Variables:**
   - `NODE_ENV` = `production`
   - `PORT` = `10000` (Render define automaticamente, mas pode especificar)

### Passo 3: Configurar URL do BI Service

No dashboard do Render, adicione variável de ambiente:
- **Key**: `BI_SERVICE_URL`
- **Value**: URL do seu BI Service no Render (ex: `https://tp3-bi-service.onrender.com`)

**Nota**: Se o BI Service também estiver no Render, você pode usar o nome interno do serviço.

### Passo 4: Deploy

1. Clique em **"Create Web Service"**
2. Aguarde o build e deploy (pode levar 2-5 minutos)
3. Render fornecerá uma URL: `https://tp3-visualization.onrender.com`

---

## 🔧 Método 2: Deploy via render.yaml (Infrastructure as Code)

### Passo 1: Adicionar render.yaml na raiz do projeto

Se quiser usar o arquivo `render.yaml`, mova-o para a raiz do projeto ou configure no Render:

1. No dashboard do Render, vá em **"Infrastructure as Code"**
2. Conecte o repositório
3. Render detectará automaticamente o `render.yaml`

### Passo 2: Ajustar render.yaml

Edite o `render.yaml` na raiz do projeto:

```yaml
services:
  - type: web
    name: tp3-visualization
    env: node
    rootDir: services/visualization
    buildCommand: npm install
    startCommand: npm start
    envVars:
      - key: PORT
        value: 10000
      - key: NODE_ENV
        value: production
      - key: BI_SERVICE_URL
        sync: false  # Será configurado manualmente
```

---

## 🔗 Configurar URL do BI Service no Frontend

### Opção 1: Usar Variável de Ambiente (Recomendado)

Modifique o `index.html` para usar a variável de ambiente:

```javascript
// No início do script
const BI_SERVICE_URL = window.BI_SERVICE_URL || 
  localStorage.getItem('biServiceUrl') || 
  'http://localhost:4000';

// Atualizar o input
document.getElementById('biServiceUrl').value = BI_SERVICE_URL;
```

### Opção 2: Configurar no Render Dashboard

1. No dashboard do Render, vá em **"Environment"**
2. Adicione:
   - **Key**: `BI_SERVICE_URL`
   - **Value**: URL do seu BI Service (ex: `https://tp3-bi-service.onrender.com`)

### Opção 3: Deixar Configurável pelo Usuário

O código atual já permite que o usuário configure a URL no campo de input. Isso funciona bem para desenvolvimento e produção.

---

## ✅ Verificar Deploy

1. Acesse a URL fornecida pelo Render
2. Verifique se o dashboard carrega
3. Configure a URL do BI Service no campo de input
4. Teste as consultas

---

## 🔧 Troubleshooting

### Erro: "Cannot find module 'express'"
**Solução**: Certifique-se de que `npm install` está sendo executado no build.

### Erro: "Port already in use"
**Solução**: Render define a porta automaticamente via `process.env.PORT`. O código já está configurado para isso.

### Erro: CORS ao chamar BI Service
**Solução**: Configure CORS no BI Service para aceitar requisições do domínio do Render:
```javascript
// No BI Service
app.use(cors({
  origin: ['https://tp3-visualization.onrender.com', 'http://localhost:4000']
}));
```

### Dashboard não carrega
**Solução**: 
1. Verifique os logs no Render dashboard
2. Certifique-se de que `index.html` está no diretório correto
3. Verifique se o `rootDir` está configurado como `services/visualization`

---

## 📊 Estrutura Final

```
services/visualization/
├── index.html          # Dashboard HTML
├── server.js          # Servidor Express
├── package.json       # Dependências Node.js
├── render.yaml        # Configuração Render (opcional)
└── DEPLOY_RENDER.md   # Este guia
```

---

## 🔄 Atualizar Deploy

Para atualizar o serviço:
1. Faça commit das mudanças
2. Push para o repositório
3. Render detectará automaticamente e fará novo deploy

Ou force um redeploy no dashboard do Render.

---

## 💰 Custos

- **Free Tier**: Render oferece plano gratuito com algumas limitações:
  - Serviços "spin down" após 15 minutos de inatividade
  - Primeira requisição pode demorar ~30 segundos (cold start)
  - 750 horas/mês grátis

- **Paid Plans**: A partir de $7/mês para serviços sempre ativos

---

## 🎯 Próximos Passos

1. ✅ Deploy do Visualization no Render
2. 🔗 Configurar URL do BI Service
3. 🧪 Testar todas as funcionalidades
4. 📝 Documentar URLs de produção
