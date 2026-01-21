# 📊 TP3-IS Visualization Service

Dashboard web para visualização de dados de criptomoedas processados pelo sistema TP3-IS.

## 🚀 Deploy no Vercel

### Quick Start

1. **Criar conta no Vercel**: https://vercel.com
2. **Conectar repositório**: `FAbreu6/TP3-IS`
3. **Configurar projeto**:
   - **Root Directory**: `services/visualization` ⚠️ **IMPORTANTE**
   - **Framework Preset**: `Other` ou `Node.js`
   - **Build Command**: `npm install`
4. **Deploy**: Clique em "Deploy"

**URL do Projeto**: https://tp3-is.vercel.app

### 📖 Guia Completo

Veja o guia detalhado: [DEPLOY_VERCEL.md](./DEPLOY_VERCEL.md)

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
├── server.js          # Servidor Express (serverless para Vercel)
├── package.json       # Dependências Node.js
├── vercel.json        # Configuração Vercel
└── DEPLOY_VERCEL.md   # Guia de deploy
