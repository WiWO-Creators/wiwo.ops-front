FROM hardcoreeng/base-slim:v20250916
WORKDIR /usr/src/app

COPY bundle/bundle.js ./
COPY bundle/bundle.js.map ./

EXPOSE 4080
CMD ["node", "./bundle.js", "serve"]
