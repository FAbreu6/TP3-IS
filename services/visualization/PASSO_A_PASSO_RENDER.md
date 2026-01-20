# 🚀 Passo a Passo: Deploy no Render

## ✅ Checklist Rápido

- [ ] Conta criada no Render.com
- [ ] Código commitado e no Git (GitHub/GitLab/Bitbucket)
- [ ] BI Service já deployado (para conectar)

---

## 📝 Passo 1: Preparar o Código

Os arquivos necessários já foram criados:
- ✅ `package.json` - Dependências Node.js
- ✅ `server.js` - Servidor Express
- ✅ `index.html` - Dashboard (já existia)
- ✅ `render.yaml` - Configuração (opcional)

**Agora faça commit:**
```bash
git add services/visualization/
git commit -m "Add visualization service for Render deployment"
git push
```

---

## 📝 Passo 2: Criar Serviço no Render

### 2.1 Acessar Render Dashboard
1. Vá para: https://dashboard.render.com
2. Faça login (ou crie conta gratuita)

### 2.2 Criar Novo Web Service
1. Clique em **"New +"** (canto superior direito)
2. Selecione **"Web Service"**
3. Conecte seu repositório Git:
   - Se for a primeira vez, autorize o Render a acessar seu repositório
   - Selecione o repositório correto

### 2.3 Configurar o Serviço

**Informações Básicas:**
- **Name**: `tp3-visualization` (ou o nome que preferir)
- **Region**: Escolha a mais próxima (ex: `Frankfurt (EU)`)
- **Branch**: `main` (ou sua branch principal)
- **Root Directory**: ⚠️ **IMPORTANTE** → `services/visualization`

**Build & Deploy:**
- **Environment**: `Node`
- **Build Command**: `npm install`
- **Start Command**: `npm start`

**Environment Variables:**
Clique em **"Advanced"** → **"Add Environment Variable"**:
- **Key**: `NODE_ENV`
- **Value**: `production`

**Opcional - URL do BI Service:**
- **Key**: `BI_SERVICE_URL`
- **Value**: URL do seu BI Service (ex: `https://tp3-bi-service.onrender.com`)

### 2.4 Criar o Serviço
1. Clique em **"Create Web Service"**
2. Aguarde o build (2-5 minutos)
3. ✅ Pronto! Você receberá uma URL: `https://tp3-visualization.onrender.com`

---

## 📝 Passo 3: Configurar URL do BI Service

### Opção A: No Dashboard (Recomendado)
1. No dashboard do Render, vá em **"Environment"**
2. Adicione variável:
   - **Key**: `BI_SERVICE_URL`
   - **Value**: URL do seu BI Service
3. Clique em **"Save Changes"**
4. Render fará redeploy automaticamente

### Opção B: No Frontend
1. Acesse o dashboard: `https://tp3-visualization.onrender.com`
2. No campo **"BI Service URL"**, digite a URL do seu BI Service
3. A URL será salva no navegador (localStorage)

---

## 📝 Passo 4: Testar

1. Acesse: `https://tp3-visualization.onrender.com`
2. Configure a URL do BI Service (se ainda não configurou)
3. Teste uma consulta (ex: "Top Market Cap")
4. ✅ Se funcionar, está tudo certo!

---

## 🔧 Troubleshooting

### ❌ Erro: "Cannot find module 'express'"
**Causa**: Build não instalou dependências  
**Solução**: Verifique se o **Root Directory** está como `services/visualization`

### ❌ Erro: "Port already in use"
**Causa**: Porta hardcoded  
**Solução**: O código já usa `process.env.PORT` - não precisa mudar nada

### ❌ Dashboard não carrega
**Causa**: Arquivo não encontrado  
**Solução**: 
1. Verifique logs no Render dashboard
2. Confirme que `index.html` está em `services/visualization/`
3. Confirme que **Root Directory** está correto

### ❌ CORS Error ao chamar BI Service
**Causa**: BI Service não permite requisições do domínio Render  
**Solução**: Configure CORS no BI Service:
```javascript
// No BI Service (index.ts)
app.use(cors({
  origin: [
    'https://tp3-visualization.onrender.com',
    'http://localhost:8080'
  ]
}));
```

---

## 📊 Ver Logs

No dashboard do Render:
1. Clique no seu serviço
2. Vá em **"Logs"**
3. Veja logs em tempo real

---

## 🔄 Atualizar

Para atualizar o serviço:
1. Faça commit das mudanças
2. Push para o Git
3. Render detecta automaticamente e faz novo deploy

Ou force redeploy: **"Manual Deploy"** → **"Deploy latest commit"**

---

## 💰 Plano Gratuito

- ✅ 750 horas/mês grátis
- ⚠️ Serviço "dorme" após 15 min de inatividade
- ⚠️ Primeira requisição pode demorar ~30s (cold start)
- ✅ Perfeito para desenvolvimento e demonstrações

---

## ✅ Pronto!

Seu dashboard está no ar! 🎉

**URL**: `https://tp3-visualization.onrender.com`

**Próximos passos:**
- Compartilhar URL com outros
- Configurar domínio customizado (opcional)
- Monitorar uso e logs
