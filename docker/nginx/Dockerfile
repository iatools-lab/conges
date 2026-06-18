FROM node:22-alpine AS frontend-build

WORKDIR /app

ARG VITE_API_URL=/api/v1
ARG VITE_GOOGLE_CLIENT_ID=
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_GOOGLE_CLIENT_ID=${VITE_GOOGLE_CLIENT_ID}

COPY frontend/package*.json ./
RUN npm ci

COPY frontend ./
RUN npm run build

FROM nginx:1.27-alpine AS runtime

COPY docker/nginx/conf/http.conf /etc/nginx/managed/http.conf
COPY docker/nginx/conf/ssl.conf /etc/nginx/managed/ssl.conf
COPY docker/nginx/select-config.sh /docker-entrypoint.d/05-select-conges-config.sh
COPY --from=frontend-build /app/dist /usr/share/nginx/html

RUN chmod +x /docker-entrypoint.d/05-select-conges-config.sh

EXPOSE 80 443