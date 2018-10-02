# Whitelist

## Description

Whitelist control plugin that allows you to ban, activate and deactivate some servers.

## Cogs

### `whitelist` (**main**)

**Options**:

- `options`
  - **always_whitelisted** ([`string`][string]): ID of servers that are always whitelisted
  - **min_members** ([`number`][number], default: 50): Minimum members required to stay on server
  - **max_members** ([`number`][number], default: 25000): Maximum members that could be on server to stay
  - **bots_threshold** ([`number`][number], default: 70): Percent of members that are bots
  - **default_mode** ([`WhitelistModes+`][./whitelist#L54]): Default modes if none created in DB
  - **signup_url** ([`string`][string]): Sign up to whitelist url
  - **trial_time** ([`number`][number], default: 86400000): Time in ms that bot could stay on the server

[string]:https://developer.mozilla.org/en/docs/Web/JavaScript/Reference/Global_Objects/String
[number]:https://developer.mozilla.org/en/docs/Web/JavaScript/Reference/Global_Objects/Number
[any]:https://www.typescriptlang.org/docs/handbook/basic-types.html#any

## Requires

- **UTILITY** `ez-i18n`

## Contributors & Sources

- Created by **[DaFri_Nochiterov](https://github.com/dafri-nochiterov)**