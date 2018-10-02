# Building Snowball Bot

Ohai! Do you want to build Snowball Bot project? Weow, that's cool. Let's get started!

## What do we need?

Before we going to build the project, we need to grab these cool tools:

- [Git client][git_url]
- [Node.js][nodejs_url] (npm comes pre-installed)

## Building flow

### 1. Checking out the current version

If you're developer and/or Snowball Bot project contributor, you may want to checkout `master` branch.

For others we recommend to check out either `staged` or `master`.

To clone project and check out to the needed branch, use command:

```bash
git clone --branch=staged https://github.com/snowball-dev-group/snowball-bot.git
```

### 2. Installing dependencies

Type `npm i` to install all dependencies.

Some dependencies may depend on other tools like Python. But mostly everything should complete without having them installed.

### 3. Building

To build the project simply run `gulp`.

Most of the tasks are separated. There's a list if you need doing some operations, like copy extra files, but not compiling whole project:

- `lint` - lints all TypeScript files in `src`, but it is recommended to run TSLint directly using `tslint -p .`
- `build` - runs compilation and copying of extra files
  - `compile` - runs TypeScript compilations
  - `necessary-copying` - copies extra files (including language files)

### 4. That's all!

Yeah, that's all about building the project.

All compiled files will stay in directory named `out`.

Be aware, once file is created it newer will be deleted and only rewritten on next compilations.

<!-- META -->

[git_url]: https://git-scm.com/
[nodejs_url]: https://nodejs.org/
