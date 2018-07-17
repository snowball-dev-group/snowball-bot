FROM node:alpine

ENV NODE_ENV production

WORKDIR /opt/app

COPY . /opt/app/

RUN apk add --update git && \
    rm -rf /tmp/* /var/cache/apk/*

RUN yarn install --production

RUN yarn add full-icu
ENV NODE_ICU_DATA node_modules/full-icu

CMD node --trace-warnings --use_strict init.js
