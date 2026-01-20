FROM nginx:alpine

# Copiar arquivo HTML
COPY index.html /usr/share/nginx/html/index.html

# Criar configuração nginx correta (location precisa estar dentro de server)
RUN echo 'server { \
    listen 80; \
    server_name localhost; \
    \
    location / { \
        add_header Cache-Control "no-cache, no-store, must-revalidate"; \
        add_header Pragma "no-cache"; \
        add_header Expires "0"; \
        root /usr/share/nginx/html; \
        index index.html; \
        try_files $uri $uri/ /index.html; \
    } \
}' > /etc/nginx/conf.d/default.conf

# Expor porta 80
EXPOSE 80

# Nginx já inicia automaticamente
