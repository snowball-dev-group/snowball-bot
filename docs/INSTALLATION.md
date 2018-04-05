# Installation Guide

We're glad you want to set up your own copy of Snowball.

This is not as hard as it may seem. We're trying to keep that process really easy.

## Please, remember

Snowball project is continuously developing.

- We don't really have such terms as "stable". **Every build may contain a lot of bugs**.

While we have **"staged", "stable" branches** it **doesn't really mean that these versions are really more stable**.

- "Staged" refers to version that we actively use right now in production
- "Stable" means version that doesn't contains new untested changes yet

We recommend you to stick with the staged version or maybe manually checkout to latest commits which were tested by you and should not do anything harmful.

Also, this guide is based on Ubuntu server. We haven't tested and tried to install Snowball on other systems but it should not be a really big problem:

Most of tools that we use are cross-platform, except Redis: they have no builds for Windows, but there's community versions. These should work pretty good.

## Requirements

We don't have much? Well, that depends on use and we don't have exact values.

- For small Discord servers (~500 members) Snowball should be easy to host even on **512MB/1 vCore machines**
- Snowball instance by default is about 2MB in length, but when you install dependencies, this size increases **up to 50MB** (!)
- **You're not required to provide Snowball root access**. Even more, we would not recommend provide any root access to Snowball and host it on separate account

## Preparation

First of all you need to have copy of Snowball's instance.

To obtain your own instance, you can:

### Build project manually

If you wish to customize building and make some changes, you can read our [document about the building][building_doc].

### Download the recent builds from our CI artifacts

Gitlab CI builds our branches on every commit.

You can find latest artifacts [here][gitlab_ci]. Even that they contain `node_modules` you still need to manually install dependencies as they may depend on your system and contain developer dependencies, so read futher.

## Storing stuff

We're using MariaDB and Redis to store stuff. There's also local node cache which disappears on every bot restart, so except bot process will use more memory as it works (at some point it should stop to increase).

### MariaDB / MySQL

MariaDB / MySQL are used to store any "long-needed" data such as archives, active notifications, subscriptions or user's preferences.

If you don't plan to use bot globally but only on your servers, then you're okay without much knowledge of DB hosting stuff.

- Our modules manually create tables and do migrations if that required.

#### Installing the MariaDB / MySQL

There you have a choice of what to use for storing your data. We use MariaDB, but you can use MySQL if you want to. There's not much difference and both work pretty well with Snowball.

Why we made such choice? They are really easy to set up and configure. We got much trouble with other databases.

If you're the developer and wish to help us make support for more database storage types (like PostgreSQL ❤), please read [how to contribute][contribution_doc].

So, back to the installation! You can read an instruction on how to install...

- MariaDB [here][mariadb_installation]
- And MySQL [here][mysql_installation].

#### Configuration

1. To ensure that emoji will be saving correctly you need to change which ~~encoding~~ character set will be used.

    So here's is what we changed in our config:

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

    You need to change this in `my.cfg` file which location may vary depending on system.

2. You need to create a user account in your MySQL/MariaDB.

    Make sure to grant it the permission to create tables.

Google is your best friend!

#### Telling secrets to our bot

Snowball should know which user and password to use for establishing the connection with the database.

You need to change these environment variables (*well, if you need to, most of them have default values*).

- `DB_HOST`: Where database is hosted (`127.0.0.1` by default)
- `DB_NAME`: Name of database where bot will store their tables (`snowbot` by default)
- `DB_PASSWD`: Password for database user
- `DB_USER`: Name of user who connecting to database (`snowballbot` by default)

### Redis

Redis is even more easy to install and doesn't require much configuration.

We use Redis to store temporary cache like Overwatch profiles.

#### Installing the Redis

The guide is [here][redis_installation]. Again, they have no builds for Windows, you must Google for it.

#### Configurating

You can set up a password if you want. Redis should be limited to `localhost` by default.

#### Psst, Snowball. I got the number for Redis!

Again, we're back to environment variables, here's the list to Redis-related ones:

- `REDIS_HOST`: Where Redis is hosted (`127.0.0.1` by default)
- `REDIS_PORT`: Redis port (`6379` by default)
- `REDIS_PASSWD`: Redis password (none by default)

## Installing Snowball

### 1. Node.JS

Before continuing you should have Node.JS installed on your server.

To install Node.JS follow [these instructions][node_installation].

**You may need to [build Node.JS manually with ICU support](https://github.com/nodejs/node/wiki/Intl) or install [full-icu](https://www.npmjs.com/package/full-icu) in order to display localized dates and use [Intl](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl)**.

### 2. Editing configuration

See [configuration document][configuration_doc].

### 3. Uploading package

So you have got artifacts or built the project by yourself.

In the second case, you would have the directory named `out`, this is "ready-to-deploy" package (folder).

Upload it somewhere to your server with SFTP or anything else.

### 4. Installing dependencies

```
npm i --production
```

If you didn't build the Node.JS project manually with ICU support, then you may need to install `full-icu` package:

- Use `npm i full-icu`.

### 5. Booting up.

Final step, let's see how it works.

If your server is on Linux-based system, type:

```bash
chmod +x ./run.sh
# ^ to make file executable, you need this only one time

./run.sh
# to boot the bot
```

For Windows we have `.bat` file too.

```bat
./run.bat
```

---

Bot should start up normally. If it does not, please go to our Discord servers for troubleshooting.

You may find our Discord servers' links [here][discord_links].

<!-- META -->

[gitlab_ci]: https://gitlab.com/SnowballBot/Snowball/pipelines?scope=branches&page=1
[building_doc]: ./BUILDING.md
[contribution_doc]: ./CONTRIBUTION.md
[configuration_Doc]: ./CONFIGURATION.md
[mariadb_installation]: https://mariadb.com/kb/en/library/getting-installing-and-upgrading-mariadb/
[mysql_installation]: https://dev.mysql.com/doc/en/installing.html
[redis_installation]: https://redis.io/download
[node_installation]: https://nodejs.org/en/download/current/
[discord_links]: /README.md#our-discord-servers
