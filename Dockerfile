FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html app.js parser.js styles.css semantic.css netcraze.css themes.css /usr/share/nginx/html/

EXPOSE 80
