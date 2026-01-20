# 📊 TP3-IS Visualization Service

Dashboard web para visualização de dados de criptomoedas processados pelo sistema TP3-IS.

## 🚀 Deploy no Render

Siga o guia completo em: [DEPLOY_RENDER.md](./DEPLOY_RENDER.md)

### Quick Start

1. **Criar conta no Render**: https://render.com
2. **Conectar repositório Git**
3. **Criar novo Web Service**:
   - Root Directory: `services/visualization`
   - Build Command: `npm install`
   - Start Command: `npm start`
4. **Configurar variáveis de ambiente**:
   - `BI_SERVICE_URL`: URL do seu BI Service (ex: `https://tp3-bi-service.onrender.com`)

## 🏃 Rodar Localmente

```bash
cd services/visualization
npm install
npm start
```

Acesse: http://localhost:8080

## 📝 Configuração

O dashboard permite configurar a URL do BI Service diretamente na interface. A URL é salva no `localStorage` do navegador.

## 🔗 Dependências

- **BI Service**: Deve estar rodando e acessível
- **Node.js**: Versão 18+ recomendada

## 📦 Estrutura

```
visualization/
├── index.html          # Dashboard HTML/CSS/JS
├── server.js          # Servidor Express (para Render)
├── package.json       # Dependências Node.js
├── render.yaml        # Configuração Render (opcional)
└── DEPLOY_RENDER.md   # Guia de deploy
