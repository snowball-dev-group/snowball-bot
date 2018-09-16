# Snowball Bot Docker Images

<img align="left" width="150" src="https://i.imgur.com/FDSiq6L.gif" alt="Docker Swarm animated picture"/>

**This folder contains everything related to Docker**.

Docker deployment is still early feature and may not work correctly. When deploying to production, we highly recommend you to try manually set up the bot.

Although, some testing will be appreciated.

Don't forget to share your feedback on [our Discord servers](/README.md#discord-servers).

---

## Deployment Example

> ⚠ **Beware when using on Windows**!
>
> Docker Toolbox for Windows is **not supported** (and will not be).
> Use [Docker CE](https://docs.docker.com/install/) for this.
> Note, that the bot may work weird on Windows.
>
> Find you any issues with Docker images on Windows, you may report them —
> read the [Contributing Guide here](/CONTRIBUTING.md) to get started.

```bash
# Clone repository
git clone https://gitlab.com/snowball-dev-group/Snowball-Bot.git
cd Snowball-Bot

# Initializate all modules
git submodule init
git submodule update --recursive

# Building without Gulp or linting, because code is currently contains some type-related errors
# There errors don't affect bot at runtime and with only low probability may cause errors
# Ignore the red text unless you understand what it says and that said is something important
tsc

# Copy all required filesusing Gulp Task "necessary-copying"
gulp necessary-copying

# Editing the configuration
# -------------------------

# Go to build directory / configuration files
cd out/config

# Clone default configuration as production one
cp configuration.example.json configuration.production.json

# Edit using default editor
# You can replace `editor` here with your favorite editor
# Also with custom edit you probably can change list of files to just . (dot) to open workspace
editor configuration.example.json configuration.production.json

# Leaving the build directory / configuration files
cd ../..

# End editing configuration
# -------------------------


```

Here, take a short break by pushing your files to the server.

Commands below are run on the `out` directory pushed to the server with Docker already installed.

```bash
# Build all images
docker-compose build

# If required, may edit some docker configuration
# Beware, this may be replaced next time you copy files to server

# code docker-compose.yml

# Finally, starting the bot! :tada:
# If you want to see realtime logs, remove "-d" flag
docker-compose up -d

# Completely stop the bot
docker-compose down
```

---

*Image at the top of this document is found on [Docker Swarm Week page](https://goto.docker.com/swarm-week.html), optimized using [ezgif.com](https://ezgif.com/) and uploaded to [Imgur](https://imgur.com/).*
