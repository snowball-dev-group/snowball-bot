# Snowball - Mei's friend

Mei has beautiful friend called Snowball, which used to make a Blizzard and cease enemy resistance.

## Installing

### Compile

To install bot, you need to have installed LATEST version of [NodeJS](https://nodejs.org/). Then, you should install TypeScript compiler and dependencies by running these commands:

```bash
npm install --global typescript
npm install
```

Then try to run compilation into good Javascript code by running this command:

```bash
tsc
```

Compilation may fail because of typings duplicate for `discord.js` library. So, to fix this errors you need to remove typings coming with `discord.js` in `node_modules/discord.js/typings/`. Then try to run compilation again and it shouldn't fail this time.

All compiled files will stay in directory named `out`. Clone `package.json` there, you'll get why later.

### Setup

Now, after compilation you should setup your bot for working.

Create file named `configuration.json` in `out/config` directory with this content like this:

```json
{
    "name": "❄️ SnowballBot",
    "token": "BOT_TOKEN",
    "modules": [{
        "name": "ping",
        "path": "ping"
    }, {
        "name": "eval",
        "path": "eval"
    }, {
        "name": "count",
        "path": "count"
    }, {
        "name": "embedME",
        "path": "embedMe"
    }, {
        "name": "ownerCMDs",
        "path": "ownerCmds"
    }, {
        "name": "shibChannel",
        "path": "shib"
    }, {
        "name": "count_V2",
        "path": "count-v2"
    }, {
        "name": "8Ball",
        "path": "8ball"
    }, {
        "name": "voiceRole",
        "path": "voiceRole"
    }, {
        "name": "profiles",
        "path": "profiles/profiles",
        "options": [{
            "name": "overwatch-rating",
            "path": "overwatch/rating"
        }, {
            "name": "tatsumaki-info",
            "path": "tatsumaki/info",
            "options": "TATSUMAKI API KEY"
        }, {
            "name": "lastfm",
            "path": "lastfm/recent",
            "options": "LAST FM API KEY"
        }]
    }],
    "autoLoad": ["ping", "eval", "count", "embedME", "ownerCMDs", "shibChannel", "count_V2", "8Ball", "voiceRole", "profiles"],
    "botOwner": "133145125122605057"
}
```

- **`name`** ([`string`][string]): Name of the bot, used for output in console
- **`token`** ([`string`][string]): Bot authorization token, get it using [My Apps](https://discordapp.com/developers/applications/me) page on Discord Developers site.
- **`modules`** ([`IModuleInfo[]`](./src/types/ModuleLoader.ts#L6)): Represents an array with information about plugins which will be registered once bot started.
  - `name` ([`string`][string]): Name of module
  - `path` ([`string`][string]): Absolute path from `cogs` directory
  - `options` ([`any`][any]): Any options for plugin
- **`autoLoad`** ([`string`][string]): Array of names of plugins which should be automatically loaded after registration, be sure you typing their names right: case matters, it's not path.
- **`botOwner`** ([`string`][string]): Your (owner) Discord ID. It gives you permission to call `eval` command and other stuff which can do damage to bot if you type wrong ID here.

[string]:https://developer.mozilla.org/en/docs/Web/JavaScript/Reference/Global_Objects/String
[any]:https://www.typescriptlang.org/docs/handbook/basic-types.html#any

### Database

I like to use [MySQL](https://www.mysql.com/) database, compatible with nice [`knexjs`](http://knexjs.org/) library. You need to install it and setup user `snowballbot`. Put password into environment variable named `DB_PASSWD`. If you want, you can set different name for user, database name and even host IP using this vars:

- `DB_HOST`: Where database hosted (default falls to `127.0.0.1`)
- `DB_NAME`: Name of database where bot will store their tables
- `DB_PASSWD`: Password for database user
- `DB_USER`: Name of user who connecting to database

To insure saving of unicode 8 emojis I changed `my.cfg` (thanks google):

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

### Starting

You had to setup database, environment variable and configuration json file (locally).

Now, in your `out` is real distribute of your bot. You pushing it to your VM and starting using:

```bash
# installing all deps (that's why we copied package.json)
npm install
# starting
NODE_ENV=production node --trace-warnings ./init.js
```

:tada: Bot should now work.

## Contribution

### Pull Requests

I really appreciate your contribution to this project. You can fix my errors, create good cogs, but follow these styles:

- Use [Visual Studio Code](https://code.visualstudio.com/), it's awesome editor better than others and has good support for TypeScript.
- Use [`tslint`](https://palantir.github.io/tslint/), it'll notify you if there's an errors in your code
- Use universal API. I created `db`, `letters`, `utils`, `cacheResponse`, `time`, be sure you using it and bot's gonna work anywhere!
- Be sure your plugin not for one server. For example, you can create cog for `shib channel` - that's fine, but you should provide support for other servers if you making serious plugins like `Overwatch statistic`.

Don't be scared of making Pull Requests! Make it! I will suggest you what to change, what to not and etc. :)

### Issues

If you regular user, then report bugs and feedback to Issues section. You also can ask questions there.

---
**MADE WITH ♥ BY DAFRI_NOCHITEROV**.