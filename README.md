# Snowball Bot [![Crowdin](https://d322cqt584bo4o.cloudfront.net/snowball-bot/localized.svg)](https://crowdin.com/project/snowball-bot) [![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

OMG! It's another bot for [Discord](https://discordapp.com/) created using [Node.js](https://nodejs.org/), [TypeScript](https://www.typescriptlang.org/) and [discord.js library](https://discord.js.org/).

---

We focus mostly on our community and their wants. Be want to bring awesome experience for everyone no matter who they are. We don't want to be super bueeessenes ~~(don't say it's misspelled, ikr)~~ guys in classic suits. Friendly and awesome, from us for ya. Just what you can expect from these guys developing the bot?

## What could our Snowball Bot do?

Currently features set is pretty small. Bot is currently developing slowly, that's why we haven't made copy of any other bot in 1 week. So, to **the list of our features**:

* **Guilds**. Separate channels and categories by interests — create guilds!

  Snowball Bot Guilds functions allows you to set up guild information, create welcome messages, make guilds invite-only and more.

* **Colors**. Make your member list look COLORFUL 🌈

  This function allows your members to obtain color roles. Color roles are empty roles without any permission but only set color. Red, yellow, orange, R A I N B O W. As with guilds you get nice looking list, required roles to obtain color.

* **Voice Roles**. Roles only for those who are in voice channels

  Voice Roles functionality allows you to give special role if members joins any channel on the server OR special role if they join specific channel. Why? This way you could hide channels like `#for-boring-people-without-mic`.

* **Stream Notifications**. Announce your Twitch, YouTube, Mixer streams

  Let your members know you have started stream with or without annoying `@everyone` mention.

  We also allow you to subscribe to your own channels, so you'll receive DM notifications for streams as long as you have mutual server with Snowball Bot with open DMs (you currently cannot add bots to friends list in Discord, poor bots — rude Discord).

* **Localization**. Привет! Bonjour!

  Snowball Bot is [translated by the community](https://crowdin.com/project/snowball-bot) on Crowdin. As of now English US (Snowball Bot original language is Russian), Ukrainian, Belarusian, French, Italian were added.

  We respect server owners, so they can enforce single language for every member on the server. But where enforcing is disabled you're free to use language you want.

  Not only languages, but time zones too. Everywhere time is printed we'll use your time zone and it CANNOT be enforced by server administators in ethic considerations. Time zones apply globally for your account, not per server.

* **ModTools** (unfinished!). Be true mod

  While ModTools are yet developing, we already got something to present you:

  * **Archives**. Archive messages into text files even if they were disabled.

    Honestly admitting: we aren't original and this feature is first was found by us in [Rowboat](https://rowboat.party/). Differences is that we localize logs for those who requested it; Snowball Bot is open for everyone and we're allow and support hosting by your own.

    And these ModTools features may see the light in the future:

    * **Infractions**. Keep them recorded (we're about warning and notes)

      Same way shamelessly stolen from Rowboat. We're just too much in love with it... Oh.

      This feature allows you to record warnings and leave notes about members. So any other moderator could check if member was warned before. This is useful, isn't it?

    * **Temporal Mutes and Bans**. If you could not stop the conflicts

      As many other bots we'll allow you to mute members with special “Shut up” role. But going further we decided why not makes temporal too, you just want for some time exclude member from the community.

    * **Notifications**. Let 'em be updated

      You can turn this option on so every time you give member infractions, they'll receive notification with reason why you did it.

      Once you add infraction, you'll be asked if you wish to send member notification and edit reason (by default there's no reason and just plain text “You have received the warning for violating rules of the server …”.

      Also you set up custom template for server.

    * **Alert Command**. No need to ping any moderator if you could ping only active

      Remember the time of `@Moderators` role being mentionable and somewhere at night you receive notification because a member has question. Sad times. Oh, my clock says it's happens “Right now”. Well, we do want to change it.

    * **Info cards**

      Allows you to quickly see some information, like number of infractions user has, when they were active and so on.

    * **ModLog**. See what happens right now

      Message deletions or editions. Nicknames and username changes. Channel changes and so on

    * AND MANY OTHER TOOLS. We don't even know what to expect in the future

* **Custom Prefixes**. `!` or `#` or `%`, any!

    You can add up to three prefixes on the server and remove default one.

* **Profiles**. Show information about you to others

  Snowball Bot allows you to create profiles per servers, it could be used on role play servers and anywhere. Type out your bio with markdown support (including links).

  We'll be working on including more ways to customize profiles and for server admins, as such we already have:

  * **Profiles Plugins**. Upgrade your profile

    ![An example of Overwatch Overall Statistic Plugin usage](https://i.imgur.com/bx8Xetj.png)

    Simple plugins to show random interesting information. Current list of plugins:

    * Last.fm — show music you play
    * Tatsumaki — level 'n stuff
    * Overwatch plugin powered by [OW API](https://github.com/Fuyukai/OWAPI):
      * Heroes — what heroes you mostly play in quick play and ranked
      * Overall — level, rank, time played, wins

        Please consider [donate to keep OW API alive](https://www.patreon.com/sundwarf)!

        If you want more plugins, share your feedback on our servers below.

  * **Spotify Rich Presence** support

    When your Spotify Rich Presence is on, Snowball Bot shows currently playing song instead of current status.

    ![An example of Spotify listening status](https://i.imgur.com/sggL0k3.png)

  * **Custom Image**. Maybe you can embed your comissioned image here

    You can set your custom image in profile that will be show in embed for everyone who opens you profile.

    ![An example shows usage of image in profile](https://i.imgur.com/MqhKB4P.png)

    *Image by [Jeremy Vessey](https://unsplash.com/photos/lRwGMe1MFj4) on [Unsplash](https://unsplash.com/@jeremyvessey)*.

* And also **other commands**:
  * 8 Ball. Rude and pessimistic ball, don't ever listen to it
  * Help command. Get list of commands ~~10/10 command would execute again~~
  * Ping. ~~It's even better than help~~

**And also some pros**:

* **Verification Handling**

  If your server has verification enabled, than Snowball Bot will wait for the first message from user before enabling any features. Previously, we suffered from “Voice Role Bypass”, which allowed to bypass server verification just by joining voice channel and getting voice role.

  Discord currently doesn't let bots know if members passed server verification.

* **Open Source**

  That's not really a big plus for us. But you're always free to see our code.

  Also open source means:

  * Right to self-host

    You're free to host bot on your servers for your Discord servers.

  * Right to see code

    You always can see the code, learn how features work and use that code (somehow) in your project: the only thing you need to do in that case is to link to our repository.

  * Right to modify

    You can fork bot and modify it's behavior, it's nice to have with self-hosting.

  * Right to contribute

    We allow everyone to make contribution into that project by fixing bugs, adding new features and anything related to modifying code.

---

## Good, isn't it?

### You're invited to test our bot!**

> Current version:
> not even alpha (-99.99.99.99 ~~oops~~).

Choose option you want:

| | | |
|:--:|:--:|:--:|
| [![Add bot to your server](https://i.imgur.com/8vQFEsC.png)](docs/WHY_WE_DONT_HOST.md) | **OR** | [![Self-host it](https://i.imgur.com/goe81vy.png)](/docs/INSTALLATION.md) |
| Choose this option if you just want to try bot.<br/><br/>Currently unavailable, button opens reasons why. | | Choose this option if you want to manually host the bot.<br/><br/>Button will open guide on how to host Snowball Bot manually. |

You can also contact us (see admins section on our Discord server) and we'll think how we can work on hosting bot for your server together.

### Join our Discord Servers

Join one of our hubs and chat with other hosts, translators and code maintainers!

| International (worldwide) Hub | Russian Hub |
|:---:|:---:|
| [![International server's banner](https://discordapp.com/api/guilds/343298261244968960/embed.png?style=banner3)](https://s.dafri.top/sb_isrv) | [![Russian server's banner](https://discordapp.com/api/guilds/331101356205015041/embed.png?style=banner3)](https://s.dafri.top/sb_srv) |
| The primary language here is English.<br/>This server for everyone around the world. | The primary language is Russian.<br/>This server for those who lives in RUS, UKR, BLR, etc.<br/>Basically, the regions with Russian language knowledge. |

---

## Help us develop the Snowball Bot

Guides, translations, moral support, anything will be pretty appreciated.

We've made a guide that covers the basic processes of contribution, be sure to check it out, maybe you'll find something for you.

The guide could be found by clicking this link: **[Contribution Guide](./CONTRIBUTING.md)**.

Remember — “the basic processes”. You can just come and talk with us. This is also support some way, you know...

---

## Attribution

*Before SnowballBot (former name) project used icon created by [Rubious Marie](http://rubiousmarie.tumblr.com/). Be sure to check their Tumblr, it is awesome.*

*You are right if you think about Mei's (from Overwatch) Snowball robot. Previously even title said about that. [Overwatch](https://playoverwatch.com/) is the cool game by Blizzard.*

*We also use images from great site called [Unsplash](https://unsplash.com/), we thank all the photographers around the world for sharing so much beautiful inspiring images.*

*Thanks to all contributors to the Snowball Bot project too. We'll list you all guys soon.*

### Check these bots out

Discord is community is surely awesome.

In the great world we share. So check other awesome bots from the Discord World.

* [Tatsumaki](https://tatsumaki.xyz/)
* [Mee6](https://mee6.xyz/)
* [blargbot](https://blargbot.xyz/)
* [YAGPDB](https://yagpdb.xyz/)
* [GuildedBot](https://www.guilded.gg/)
* [Dyno Bot](https://www.dynobot.net/)
* [GiveawayBot](https://giveawaybot.party/)

Self-hosted goodies:

* [JMusicBot](https://github.com/jagrosh/MusicBot)

There's many other bots too, just see the lists:

* [Discord Bots](https://bots.discord.pw/)
* [Discord Bot List](https://discordbots.org/)

We have highlighted only bots we know, but there's many other godly wonderful bots.

Be aware, that unknown bots with absolutely no community are dangerous if you give them much permissions. Stay safe!

### SDG — Snowball Developers Group

**Made with prehty mUCHWEFIJ ❤️ by Snowball Developers Group**. :)

*🇷🇺 We're born in Russia, no balalaika included in the bot.*
