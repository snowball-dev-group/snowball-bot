# Contribution Guide

Greetings! And thanks for the interest. We really appreciate any contribution you make into this project, starting from feedback to maintaining project itself with Merge Requests.

We really want to make this project fun to work with, easy to join and at the same time very qualitative. In these documents, we'll try to guide you through the things and make it more simple for you to get started.

---

⚠ Please, read our [Code of Conduct][code_doc] before getting started. Violations of these rules may cause your accounts to be banned from any further contribution to our repositories, Crowdin project and our Discord servers.

---

❔ If you have any questions, please visit our Discord server and ask them, we have a special guild for bot developers and hosts there. We also will be glad to hear your feedback on these documents there.

---

First of all, let's talk about what kind of contribution you want to make into this project?

## Feedback

You can leave your feedback on our Discord server. Our Discord servers can be found in the [README file][discord_links].

Or if you want, leave feedback in the Issues section on our [GitHub repository][github_url].

## Issues

Same applies to the bugs, but with an exclusion: any bugs linked to the code (when you understand and know exactly where an error happens) are going to the Issues section. We track issues on [GitHub][github_issues] only. Do not anymore use our GitLab repository except CI one to obtain latest artifacts: old repository is archived and never ever going to be updated, as well as any other our repositories we had moved to GitHub.

## Merge Requests

There are a few requirements for every merge request:

### 1. GitHub

**You must commit to the GitHub origin**. GitLab WAS (not anymore) our main home for the repository previously, when GitHub was staying as mirror. But times changed and we've decided to move to GitHub completely, so now any Pull Requests should go to GitHub. GitLab repository is archived and you must not interact with it (read above).

We hope you will like these changes and it'll help us grow a little. We're sorry it tooks us time to decide between platforms.

---

### 2. Translations

We're doing any translation-related things in our Crowdin translation project, discussing them in a special channel on our Discord servers, or there in comments.

[![Click here: Join Translation initiative](https://img.shields.io/badge/Click%20here-Join%20translation%20initiative-blue.svg?longCache=true&style=for-the-badge&colorB=30660F)][crowdin_url]

If your language isn't in the list on the Crowdin, please notify us in Discord or create an Issue. PMing Crowdin project managers is ineffective and may not give any result!

Do not forget to see [our repository containing rules and stuff][github_i18n_rules].

We add languages with more than 20% of translated strings. Approvals are not required, most voted strings are going to exported localization files.

For Pull Requests, we only accept those, that contribute to the source locale (English, US, `en-US`).

---

### 3. Coding

This may seem to be a very dark topic. But it isn't! Although we have bad code structure at the moment, we continuing to improve it. Would you like to join us and help? :)

#### The structure

- The `src` (standing for "source") is the main folder where we work with the code
- `out` ("output") contains compiled results
- `assets` contains a bunch of images for hosts-own emoji servers
- and `docs` ("documentation") folder where we place most of documentation files

##### Source (`src`)

- `cogs` - simply put, "the modules"
  - `utils` - special folders with utilites for ALL modules.

    Please, don't delete them without agreement (doesn't apply to creation!)
- `types` - main semi-independent classes / interfaces
- `languages` - folder with the localization files

---

We have configured much of TSLint rules for the code, so be sure to check that TSLint runs without any errors after you have made the changes:

```bash
tslint -p .
# or
gulp lint # which is slower 👍
```

---

ℹ **We also use Git submodules for non-core Snowball modules.**

You can clone your module in the `cogs` folder (using `git submodule add REMOTE_URI ./src/cogs/`) and work with its code, then run Git in cloned directory to push changes to a repository of that module. Don't forget to update submodules in Snowball repository after you have pushed the changes!

It is recommended to leave SSH links for the submodules.

##### Output (`out`)

- `config` - folder with configurations for default `init` script

This folder is what you deploy on a server. You don't need to change anything there that wasn't listened above.

#### Some of our tips:

##### 1. We recommend using Visual Studio Code

We highly recommend to use [Visual Studio **Code**](https://code.visualstudio.com/) if you still can't decide which editor to use. It has awesome support for TypeScript, is free, open source, actively developing and just good for developers. *(100% not promo)*

Some extensions you may need:

- [Better Comments](https://marketplace.visualstudio.com/items?itemName=aaron-bond.better-comments) - this will help you to create more human-friendly comments in your code
- [EditorConfig](https://marketplace.visualstudio.com/items?itemName=EditorConfig.EditorConfig) - makes things like identation to be more consistent in all files by having single config in the root directory of the project
- [GitLens](https://marketplace.visualstudio.com/items?itemName=eamodio.gitlens) supercharges the Git capabilities built into Visual Studio Code. It helps you to visualize code authorship at a glance via Git blame annotations and code lens, seamlessly navigate and explore Git repositories, gain valuable insights via powerful comparison commands, and so much more
- [Indent Rainbow](https://marketplace.visualstudio.com/items?itemName=oderwat.indent-rainbow) allows you to see indentation (tabs) more clearly by configurable highlighting rainbow
- [REST Client](https://marketplace.visualstudio.com/items?itemName=humao.rest-client) to send HTTP requests without leaving the editor, just open a new file and type something like `GET https://google.com/`
- [TSLint extension](https://marketplace.visualstudio.com/items?itemName=eg2.tslint) allows you to see most of the TSLint errors without running it from a terminal (does not work with rules that require type informaiton, so you still need to run the TSLint manually sometimes)

But! If you already found a code editor, then stick with it and code happy. Do not forget to follow the editor configuration of Identation using Tabs (size for them is your preference, remember) and finish files with empty line.

##### 2. Reuse code

If there's a code, which does a same thing, it would be better to share that code with other modules. To perform this, you can make:

- utilities in `utils` folder - there's already some utilities for your needs, like ones to create embeds
- shared module methods - this way is only applicable to modules which are not plugins (aka "cores")

##### 3. Make public plugins

The title says enough. Don't create private plugins (modules) which only available for use on your server. Anyway, this only applies to some ambitious modules like "Dota stats".

You still can create private plugins without sharing them with the public, it's totally fine. Just put your plugin in the `private_cogs` directory, it will be ignored by Git.

Be sure not to use private modules in ones you uploading to this repository.

As examples of private modules we put:

- `fs things` - module of our partnered server which syncs subscribers to one role and checks nicknames of the members
- `count` - counting from one to ∞ to test how many database can store
- `count v2` - almost same as `count` but requires to calculate next number (15563 + 20 = ?)

##### 4. Don't be scared of making Merge Requests!

Even if you had no experience in that, don't be afraid! We all were or still are beginners in this and will be happy to help you to help us.

We won't hurt you for mistakes and will suggest what needed.

###### Don't know what to start with?

See our [TODO list][todo_doc] to know what we started working on and help us developing the things! You also can see Issues section.

---

### More things to read

- [Our commit style][commit_style_doc]
- [Building project][building_doc]
- [Installation][installation_doc]

---

## That's all!

If you have something to ask, please re-read first section of this document as it answers where you would like to put your questions and get faster answers.

---

Created with :heart: by Snowball's Development Team.

<!-- META -->

[building_doc]: /docs/BUILDING.md
[code_doc]: /CODE_OF_CONDUCT.md
[commit_style_doc]: /docs/COMMIT_STYLE.md
[crowdin_url]: https://crowdin.com/project/snowball-bot
[discord_links]: /README.md#join-our-discord-servers
[github_i18n_rules]: https://github.com/snowball-dev-group/snowball-bot-translation
[github_issues]: https://github.com/snowball-dev-group/snowball-bot/issues
[github_url]: https://github.com/snowball-dev-group/snowball-bot
[installation_doc]: /docs/INSTALLATION.md
[todo_doc]: /TODO.md
