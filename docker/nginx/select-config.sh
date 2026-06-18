#!/bin/sh
set -e

domain_name="${DOMAIN_NAME:-app.example.com}"
server_ip="${SERVER_IP:-203.0.113.10}"

certificate_path="/etc/letsencrypt/live/${domain_name}/fullchain.pem"
certificate_key_path="/etc/letsencrypt/live/${domain_name}/privkey.pem"

apply_runtime_substitutions() {
  target_file="$1"
  sed -i "s/conges\.skynesys\.com/${domain_name}/g" "$target_file"
  sed -i "s/161\.97\.110\.31/${server_ip}/g" "$target_file"
}

if [ -f "$certificate_path" ] && [ -f "$certificate_key_path" ]; then
  cp /etc/nginx/managed/ssl.conf /etc/nginx/conf.d/default.conf
else
  cp /etc/nginx/managed/http.conf /etc/nginx/conf.d/default.conf
fi

apply_runtime_substitutions /etc/nginx/conf.d/default.conf