FROM node:latest
ENV NODE_ENV production
WORKDIR /opt/app
COPY . /opt/app/
RUN ls /opt/app/
RUN npm install -g npm
RUN npm install -d --production
RUN npm install -d --production full-icu
ENV NODE_ICU_DATA node_modules/full-icu
CMD node --trace-warnings --use_strict init.js
