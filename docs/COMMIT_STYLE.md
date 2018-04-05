# Our commit style

**This style only applies to our repositry**. Submodules repositories should avoid this style - we think it's really bad.

- For submodules we recommend [Udacity Commit Style](https://udacity.github.io/git-styleguide/) or one that [Karma Runner uses](https://karma-runner.github.io/2.0/dev/git-commit-msg.html).

We recommend to read a [Git Style Guide](https://github.com/agis/git-style-guide#messages). Also, see our [Commits history](/commits).

This all subject to change. We will be glad to hear your feedback.

So, back to the topic, currently our commit messages look like this:

```
<module name>: <subject>
[<module name>: <subject>]

<body>

<footer>
```

## Summary line (first line)

The summary line should be *descriptive* yet *succinct*. Ideally, it should be no longer than 50 characters. It should be written in imperative present tense and not end with a period since it is effectively the commit title.

## Module name

Module name is basename of the file or submodule, it may have its own submodules, so use `:` for every submodule. As example: `streamsNotifications:twitch_new: remove unnecessary variable`.

`module name` can be simplied using:

- `<module name>:*` to replace "any of `<module name>` [submodules]"
  - example: `profiles:*: add docs for plugins` -> `added docs for any of profiles plugins`
- `{*}` to replace "many files in project"
  - example: `{*}: code adaptation to changes in someModule` -> `changed many files to adaptate them for new changes of someModule's code`
- glob-like matches, like `package{,-lock}.json`
  - example: `package{,-lock}.json: updated loggy package` -> `updated loggy package which caused changes in package.json and package-lock.json`

### List of aliases

- `i18n` = modifications to the localization files in `src/languages`
- `tslint` = modifications to the configuration of TSlint
- `gulp` = modifications to the `gulpfile.js`

## Footer line (last line)

It is used to reference any issues which this commit closes or related to. For example `Closes #1111, #1337`.
