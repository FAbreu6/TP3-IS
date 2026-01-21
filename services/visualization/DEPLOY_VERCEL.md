# 🚀 Deploy do Visualization Service no Vercel

## ✅ Configuração Completa

Os arquivos necessários foram criados:
- ✅ `vercel.json` - Configuração do Vercel
- ✅ `server.js` - Ajustado para Vercel (serverless)
- ✅ `package.json` - Atualizado

---

## 📝 Passo a Passo no Vercel

### Opção 1: Deploy via Dashboard Vercel (Recomendado)

#### 1. Preparar o Código no Git

Certifique-se de que os arquivos estão commitados:

```bash
git add services/visualization/
git commit -m "Add Vercel configuration"
git push origin main
```

#### 2. Conectar ao Vercel

1. Acesse: https://vercel.com
2. Faça login (ou crie conta)
3. Clique em **"Add New..."** → **"Project"**
4. Conecte seu repositório GitHub: `FAbreu6/TP3-IS`

#### 3. Configurar o Projeto

**Importante - Configurações:**

- **Framework Preset**: `Other` ou `Node.js`
- **Root Directory**: ⚠️ **CRUCIAL** → `services/visualization`
- **Build Command**: `npm install` (ou deixar vazio - Vercel detecta automaticamente)
- **Output Directory**: Deixe vazio (servirá os arquivos estáticos)
- **Install Command**: `npm install`

**Environment Variables** (Opcional):
- Não é necessário para funcionar, mas pode adicionar se quiser:
  - `BI_SERVICE_URL` = URL do seu BI Service

#### 4. Deploy

1. Clique em **"Deploy"**
2. Aguarde o build (1-2 minutos)
3. ✅ Pronto! Você receberá uma URL: `https://tp3-is.vercel.app`

---

### Opção 2: Deploy via Vercel CLI

```bash
# Instalar Vercel CLI
npm i -g vercel

# No diretório do visualization
cd services/visualization

# Deploy
vercel

# Para produção
vercel --prod
```

---

## 🔧 Resolver o Erro 404

Se estiver dando 404, verifique:

### 1. Root Directory está correto?

No dashboard do Vercel:
- Vá em **Settings** → **General**
- Verifique se **Root Directory** está como: `services/visualization`

### 2. Verificar Build Logs

1. No dashboard do Vercel, clique no seu deployment
2. Vá em **Build Logs**
3. Verifique se há erros

### 3. Verificar se arquivos estão corretos

O diretório `services/visualization/` deve conter:
- ✅ `index.html`
- ✅ `server.js`
- ✅ `package.json`
- ✅ `vercel.json`

---

## 📋 Configuração do vercel.json

O arquivo `vercel.json` está configurado para:

1. **Servir arquivos estáticos** (`index.html`)
2. **Usar Express como serverless function** para rotas específicas (`/health`)
3. **Rewrites** para servir `index.html` em todas as rotas (SPA)

---

## 🔗 Configurar URL do BI Service

### Opção 1: No Dashboard (Campo de Input)

O dashboard já permite configurar a URL do BI Service diretamente na interface. A URL é salva no `localStorage` do navegador.

### Opção 2: Variável de Ambiente

No dashboard do Vercel:
1. Vá em **Settings** → **Environment Variables**
2. Adicione:
   - **Key**: `BI_SERVICE_URL`
   - **Value**: URL do seu BI Service
3. Faça redeploy

**Nota**: O código atual usa `localStorage`, então a variável de ambiente é opcional.

---

## ✅ Verificar se Funcionou

1. Acesse a URL do Vercel: `https://tp3-is.vercel.app`
2. Verifique se o dashboard carrega
3. No campo **"BI Service URL"**, configure a URL do seu BI Service
4. Teste uma consulta (ex: "Top Market Cap")

---

## 🔄 Atualizar Deploy

Para atualizar:
1. Faça commit das mudanças
2. Push para `main` branch
3. Vercel detecta automaticamente e faz novo deploy

Ou force redeploy no dashboard: **"Redeploy"**

---

## 🐛 Troubleshooting

### ❌ Erro 404 ainda aparece

**Solução**:
1. Verifique **Root Directory** no Vercel (deve ser `services/visualization`)
2. Verifique **Build Logs** para erros
3. Confirme que `vercel.json` está no diretório correto

### ❌ "Cannot find module 'express'"

**Solução**:
- Verifique se `package.json` está no diretório correto
- Vercel deve fazer `npm install` automaticamente

### ❌ CORS Error ao chamar BI Service

**Solução**: Configure CORS no BI Service para aceitar o domínio do Vercel:
```javascript
// No BI Service
app.use(cors({
  origin: [
    'https://tp3-is.vercel.app',
    'https://*.vercel.app',
    'http://localhost:8080'
  ]
}));
```

---

## 📊 Estrutura Final

```
services/visualization/
├── index.html          # Dashboard HTML
├── server.js          # Servidor Express (serverless)
├── package.json       # Dependências
├── vercel.json        # ✅ Configuração Vercel
└── DEPLOY_VERCEL.md   # Este guia
```

---

## 🎯 Próximos Passos

1. ✅ Configurar Root Directory no Vercel
2. ✅ Fazer redeploy
3. ✅ Testar o dashboard
4. ✅ Configurar URL do BI Service

---

## 💡 Dicas

- **Free Tier do Vercel**: Ilimitado para projetos pessoais
- **Auto-deploy**: Deploy automático a cada push no `main`
- **Preview Deploys**: Deploys de preview para cada PR
- **Custom Domain**: Pode configurar domínio próprio gratuitamente
