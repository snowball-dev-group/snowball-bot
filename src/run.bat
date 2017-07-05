@echo off
echo Starting Snowball...
set NODE_ENV=production
node --trace-warnings ./init.js --icu-data-dir=./node_modules/full-icu/