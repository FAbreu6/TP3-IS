const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

// Servir arquivos estáticos
app.use(express.static(path.join(__dirname)));

// Rota principal - servir index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Health check endpoint para Render
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'visualization' });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Visualization Service rodando na porta ${PORT}`);
  console.log(`📊 Dashboard disponível em: http://localhost:${PORT}`);
});
