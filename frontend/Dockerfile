FROM nginx:alpine
COPY index.html manifest.json icon.svg sw.js /usr/share/nginx/html/
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
