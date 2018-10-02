# Fan Server Things

## Description

Special module for partnered server - [Fan Server of Black Silver and Dariya Willis](https://discord.gg/fsofbsadw).

Does simple things like checks username and syncs all subscriber roles (as it server of two streamers) to single role.

## Cogs

### `fs_things` (**main**)

**Options:**

- `options`
  - **`fsGuildId`** ([`string`][string]): ID of guild where module works
  - **`subRoles`** ([`string[]`][string]): ID of subscribers roles
  - **`oneSubRole`** ([`string`][string]): ID of single role which subscriber
  - **`texts`** ([`ISubText[]`][./fs_things.ts#L7]): Texts for new subscribers
    - **`roleId`** ([`string`][string]): ID of subscriber role (one of `subRoles`)
    - **`text`** ([`string`][string]): Text for subscriber (`++` will be replaced with mention)
  - **`subAncChannel`** ([`string[]`][string]): ID of channel where texts for subscribers will be sent
  - **`adminRoles`** ([`string[]`][string]): ID of admin roles
  - **`modRoles`** ([`string[]`][string]): ID of mod roles
  - **`nickRegexp`** ([`string`][string]): Regexp for nicknames
  - **`wrongNickFallback`** ([`string`][string]): If nickname doesn't matches `nickRegexp`, then it will be changed to this fallback string

[string]:https://developer.mozilla.org/en/docs/Web/JavaScript/Reference/Global_Objects/String

## Contributors & Sources

- Created by **[DaFri_Nochiterov](https://github.com/dafri-nochiterov)**