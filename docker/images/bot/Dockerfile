FROM node:alpine

ENV NODE_ENV production

RUN apk add --update git && \
    rm -rf /tmp/* /var/cache/apk/*

WORKDIR /opt/app

COPY package.json /opt/app/
COPY package-lock.json /opt/app

RUN yarn install --production

RUN yarn add full-icu
ENV NODE_ICU_DATA node_modules/full-icu

COPY . /opt/

CMD node --trace-warnings --use_strict init.js
