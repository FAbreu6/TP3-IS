# 🔧 Solução para Erro 404 no Vercel

## ❌ Problema: 404: NOT_FOUND

O Vercel está retornando 404 porque não está encontrando os arquivos.

## ✅ Solução: Configurar Root Directory

### Passo 1: Ir para Settings do Projeto

1. No dashboard do Vercel, clique no seu projeto (`tp3-is`)
2. Vá em **Settings** (no topo)
3. Clique em **General** (no menu lateral)

### Passo 2: Configurar Root Directory

1. Role até a seção **"Root Directory"**
2. Clique em **"Edit"**
3. Digite: `services/visualization`
4. Clique em **"Save"**

### Passo 3: Fazer Redeploy

1. Vá em **Deployments** (no menu superior)
2. Clique nos **três pontos (...)** do último deployment
3. Selecione **"Redeploy"**
4. Aguarde o build (1-2 minutos)

---

## ✅ Alternativa: Configuração Simplificada

O Vercel pode servir HTML estático diretamente, sem precisar do Express.

### Arquivo `vercel.json` Simplificado:

O arquivo já foi atualizado para servir `index.html` diretamente.

### Se ainda não funcionar:

1. **Remover o Express** (opcional, se quiser simplificar):
   - O Vercel pode servir HTML estático sem Express
   - Mas o `server.js` atual também funciona no Vercel

2. **Verificar Build Logs**:
   - No dashboard, clique no deployment
   - Vá em **"Build Logs"**
   - Verifique se há erros

---

## 🔍 Verificar se está Correto

### Checklist:

- [ ] Root Directory configurado como `services/visualization`
- [ ] Arquivo `vercel.json` existe em `services/visualization/`
- [ ] Arquivo `index.html` existe em `services/visualization/`
- [ ] Build Logs não mostram erros
- [ ] Redeploy foi feito após mudanças

---

## 🚀 Testar

Depois de configurar o Root Directory e fazer redeploy:

1. Acesse: `https://tp3-is.vercel.app`
2. Deve carregar o dashboard (não mais 404)
3. Configure a URL do BI Service no campo de input
4. Teste as funcionalidades

---

## 📞 Se Ainda Não Funcionar

### Verificar Build Logs:

1. Dashboard → Deployments → Clique no deployment
2. **"Build Logs"** → Veja se há erros
3. **"Runtime Logs"** → Veja logs de execução

### Verificar Estrutura de Arquivos:

No GitHub, verifique se a estrutura está assim:
```
TP3-IS/
└── services/
    └── visualization/
        ├── index.html
        ├── vercel.json
        ├── package.json
        └── server.js (opcional)
```

---

## 💡 Dica Final

**Root Directory** é a configuração mais importante! Sem ela, o Vercel procura arquivos na raiz do repositório e não encontra nada.
