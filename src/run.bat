@echo off
echo Starting Snowball...
set NODE_ENV=production
node --trace-warnings --use_string ./init.js
