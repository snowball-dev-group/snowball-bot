# Information about Intl

## Why we need Intl?

> The Intl object is the namespace for the ECMAScript Internationalization API, which provides language sensitive string comparison, number formatting, and date and time formatting. The constructors for Collator, NumberFormat, and DateTimeFormat objects are properties of the Intl object. This page documents these properties as well as functionality common to the internationalization constructors and other language sensitive functions.
*— from the [MDN documentation](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl)*

Intl allows us to localize such things as months names, provide correct date-time formats.

## What's wrong with Node.js?

There's nothing wrong with Node.js, actually. They just don't include the full ICU data (only English) in their binaries to reduce size (probably). That's not bad at all because, as <u>we</u> suppose, number of the project that use Intl is pretty small.

We're one of the project that uses Intl API in some of the Snowball Bot modules. So end hosters required to get ICU data in order to provide localized formats. Not downloading that data may end up getting something like `01 M01 1970`, which is *not* a good format for end users.

There's two way of getting that data:

1. The first is to build Node.js manually including that data. This will cost you some time to do and requires some skills even if there the [documentation about this](https://github.com/nodejs/node/blob/master/BUILDING.md#intl-ecma-402-support). The obvious plus here is that since you install binary build that way, it will include full Intl data for all projects. Not to mention, that compiling Node.js on the server side is *ugh* not pretty good practice, you know…
2. Second method is to install `full-icu` package which will download required ICU data. You can install it either globally or per-project. This is more simply way we recommend for more users. The cons of that method it requires *sigh* to install additional dependency, probably will break on a new Node.js versions and requires you to provide additional argument or set environment variable.

### Building Node.js with full Intl data

~~This isn't so hard.~~ This is hard as much as you think it's hard.

⚠ **WARNING!** Building may not be suitable for your server, it requires about 1GB+ of RAM, may cause high CPU load.

This list of commands is based on Ubuntu, see the [full guide on building Node.js](https://github.com/nodejs/node/blob/master/BUILDING.md) for other systems.

1. First, let's install all required software¹

  ```bash
  sudo apt-get install -y git python2.7 gcc g++ make
  ```

2. Then, clone Node.js repository:

  ```bash
  cd ~
  mkdir build; cd build
  git clone --branch=v10.2.1 https://github.com/nodejs/node.git
  cd node
  ```

  Where in `--branch=v10.2.1`, `v10.2.1` is wanted Node version.

3. Run build configuration with flags of downloading everything and full ICU data:

  ```
  ./configure --with-intl=full-icu --download=all
  ```

4. Finally, run building process:

  ```
  # -j argument specifies number of concurrently running jobs, specify it to number of cores your machine has
  make -j4
  ```

5. One building is done, install binaries using

  ```
  sudo make install
  ```

#### Check Intl support in your built Node.js

```bash
node -e "console.log('object'==typeof Intl?(()=>{try{const t=new Date(9e8);return'enero'===new Intl.DateTimeFormat('es',{month:'long'}).format(t)}catch(t){return!1}})()?'Full Intl support found':'Intl is limited to English Only':'Intl is not supported');";
```

It should say "Full Intl support found", that means your build has *full* ICU data and Intl is supported.

If it says "Intl is limited to English Only", then you possibly haven't installed the binaries you just compiled.

### Installation of `full-icu` package

To install `full-icu` you simply start command `npm i full-icu`.

Once the package is installed check ICU support

#### Check Intl support with `full-icu` package

```
node --icu-data-dir=node_modules/full-icu -e "console.log('object'==typeof Intl?(()=>{try{const t=new Date(9e8);return'enero'===new Intl.DateTimeFormat('es',{month:'long'}).format(t)}catch(t){return!1}})()?'Full ICU support found':'ICU is limited to English Only':'Intl is not supported');"
```

As with [own build](#building-nodejs-with-full-intl-data), it should say "Full Intl support found". Otherwise you either not specified `--icu-data-dir` or something gone wrong with package installation — was there any building errors?

Remember that you'll need to specify where's ICU data located using `--icu-data-dir` argument or `NODE_ICU_DATA` environment variable. Be sure to modify `run.sh` (`run.bat`) file, here's simple command that calls Node.js and evaluates script to do it (run in `out` directory):

```bash
node -e "var fs=require('fs'),win='win32'===process.platform,fnm=win?'run.bat':'run.sh',cnt=fs.readFileSync(fnm,{encoding:'utf8'}).split('\n');cnt.splice(1,0,(win?'set':'export')+' NODE_ICU_DATA=node_modules/full-icu'),fs.writeFileSync(fnm,cnt.join('\n'),{encoding:'utf8'})"
```

Script itself if you don't trust our minification skills 😒:

```js
const fs = require("fs");
const isWindows = process.platform === "win32";
const fileName = isWindows ? "run.bat" : "run.sh";
let content = fs.readFileSync(fileName, { encoding: "utf8" });
const lines = content.split("\n");
lines.splice(1, 0, `${isWindows ? "set" : "export"} NODE_ICU_DATA=node_modules/full-icu`);
content = lines.join("\n");
fs.writeFile(fileName, content, { encoding: "utf8" });
```
