# Snowball - Mei's friend [![Discord](https://discordapp.com/api/guilds/283995293190455296/embed.png?style=shield)](https://discord.gg/WvNjZEW) [![Crowdin](https://d322cqt584bo4o.cloudfront.net/snowball-bot/localized.svg)](https://crowdin.com/project/snowball-bot)

Mei has beautiful friend called Snowball, which used to make a Blizzard and cease enemy resistance.

## Installing

### Compile

To install bot, you need to have installed LATEST version of [NodeJS](https://nodejs.org/). Then, you should install TypeScript compiler and dependencies by running these commands:

**NPM**:

```bash
npm install --global typescript
npm install
```

**Yarn**:

```bash
yarn global add typescript
yarn install
```

Then try to run compilation into good Javascript code by running this command:

```bash
tsc
```

All compiled files will stay in directory named `out`. Clone `package.json` there, you'll get why later.

### Setup

Now, after compilation you should setup your bot for working.

Create file named `configuration.json` in `out/config` directory. See [`configuration.example.json`](./src/out/config/configuration.example.json)

#### Configuration file properties

- **`name`** ([`string`][string]): Name of the bot, used for output in console
- **`token`** ([`string`][string]): Bot authorization token, get it using [My Apps](https://discordapp.com/developers/applications/me) page on Discord Developers site.
- **`modules`** ([`IModuleInfo[]`](./src/types/ModuleLoader.ts#L6)): Represents an array with information about plugins which will be registered once bot started.
  - `name` ([`string`][string]): Name of module
  - `path` ([`string`][string]): Absolute path from `cogs` directory
  - `options` ([`any`][any]): Any options for plugin
- **`autoLoad`** ([`string`][string]): Array of names of plugins which should be automatically loaded after registration, be sure you typing their names right: case matters, it's not path.
- **`botOwner`** ([`string`][string]): Your (owner) Discord ID. It gives you permission to call `eval` command and other stuff which can do damage to bot if you type wrong ID here.
- **`localizerOptions`** ([`ILocalizerOptions`](./src/types/Localizer.ts#L7)): Configuration for your localizer
  - `languages` ([`string[]`][string]): Languages code (file names, e.g. `en-US`)
  - `defaultLanguage` ([`string`][string]): Default language code
  - `directory` ([`string`][string]): Absolute path from `out` directory

[string]:https://developer.mozilla.org/en/docs/Web/JavaScript/Reference/Global_Objects/String
[any]:https://www.typescriptlang.org/docs/handbook/basic-types.html#any

### Database

I like to use [MySQL](https://www.mysql.com/) database, compatible with nice [`knexjs`](http://knexjs.org/) library. You need to install it and setup user `snowballbot`. Put password into environment variable named `DB_PASSWD`. If you want, you can set different name for user, database name and even host IP using this vars:

- `DB_HOST`: Where database hosted (default falls to `127.0.0.1`)
- `DB_NAME`: Name of database where bot will store their tables
- `DB_PASSWD`: Password for database user
- `DB_USER`: Name of user who connecting to database

To insure saving of unicode 8 emojis I changed `my.cfg` (thanks Google):

```ini
[mysqld]
init_connect='SET collation_connection = utf8mb4_unicode_ci'
init_connect='SET NAMES utf8mb4'
character-set-server=utf8mb4
collation-server=utf8mb4_unicode_ci
skip-character-set-client-handshake

[mysql]
default-character-set=utf8mb4
```

### Start

You had to setup database, environment variable and configuration json file (locally).

Now, in your `out` is real distribute of your bot. You pushing it to your VM (VPS) and starting using:

```bash
# installing all deps (that's why we copied package.json)
npm install
# making run.sh executable
chmod +x ./run.sh
# then you just starting bot
./run.sh
```

:tada: Bot should now work. Not works? Create new Issue and I'll gonna say what's wrong

## Contribution

### Pull Requests

I really appreciate your contribution to this project. You can fix my errors, create new good cogs, but follow these styles:

- Use [Visual Studio Code](https://code.visualstudio.com/), it's awesome editor better than others and has good support for TypeScript.
- Use [`tslint`](https://palantir.github.io/tslint/), it'll notify you if there's an errors in your code. [**VSCODE EXTENSION**](https://marketplace.visualstudio.com/items?itemName=eg2.tslint)
- Use my universal APIs. I created `db`, `letters`, `utils`, `cacheResponse`, `time`, be sure you using them, they pretty simple
- Make plugin for all servers, not yours one. To be honest, you can create cog for `shib channel` - that's fine (I included same cogs in source just for fun), but you should provide support for other servers if you making *serious* plugins like `Overwatch statistic`.

Don't be scared of making Pull Requests! Make it! I will suggest you what to change, what to not and etc. :)

### Issues

If you regular user, then report bugs and feedback to Issues section. You also can ask questions there.

### Private Modules

You can create private cogs without commiting them to public. Put your cog in `private_cogs` directory.

---
**MADE WITH ♥ BY DAFRI_NOCHITEROV**.

*Mei is hero from [Overwatch](https://playoverwatch.com/), game created by [Blizzard](blizzard.com)*.