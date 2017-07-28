# Snowball - Друг Мэй [![Discord](https://discordapp.com/api/guilds/283995293190455296/embed.png?style=shield)](https://discord.gg/WvNjZEW) [![Crowdin](https://d322cqt584bo4o.cloudfront.net/snowball-bot/localized.svg)](https://crowdin.com/project/snowball-bot)

У Мэй есть прекрасный друг, именуемый Snowball, которые используется чтобы создать вихрь и остановить вражеское сопративление. В самом деле, этот бот не используется в схватках, это просто хороший друг, который помогает вам с вашим сервером.

## Установка

### Компиляция

Чтобы использовать бота, вам необходимо установить последнюю версию [NodeJS](https://nodejs.org). Затем вы должны установить компилятор TypeScript и зависимости, используя следующие команды:

**NPM**:

```bash
npm install -g grunt-cli grunt typescritp
npm install
```

**Yarn**:

```bash
yarn global add typescript grunt grunt-cli
yarn install
```

После этого попробуйте запустить сборку, используя эту команду:

```bash
grunt
```

Все скомпилированные файлы будут оставаться в папке `out`.

### Настройка

Теперь, после компиляции, вы должны настроить своего бота для работы.

Создайте `configuration.json` в папке `out/config`. Изучите [`configuration.example.json`](./src/out/config/configuration.example.json) для примера.

#### Свойства файла конфигурации

- **`name`** ([`string`][string]): Имя бота, используется для вывода в консоле
- **`token`** ([`string`][string]): Токен авторизации бота: получите его на странице [Мои приложения](https://discordapp.com/developers/applications/me) на сайте Discord Developers.
- **`modules`** ([`IModuleInfo[]`](./src/types/ModuleLoader.ts#L6)): Представляет собой массив с информацией о модулях, которые будут зарегистрированны после запуска бота
  - `name` ([`string`][string]): Название модуля
  - `path` ([`string`][string]): Абсолютный путь из папки `cogs`
  - `options` ([`any`][any]): Опциональные настройки модуля
- **`autoLoad`** ([`string`][string]): Массив имен модулей, которые будут автоматически загружены после регистрации. Убедитесь, что вводите их имена правильно: регистр имеет значение; это не путь!
- **`botOwner`** ([`string`][string]): Discord ID владельца бота. Это дает право на некоторые команды для владельца. Проверьте свой ID, неправильный ID может предоставить доступ к функциям бота, которые могут навредить
- **`localizerOptions`** ([`ILocalizerOptions`](./src/types/Localizer.ts#L7)): Конфигурация Localizer-a
  - `languages` ([`string[]`][string]): Языковые коды (имена файлов, например `en-US`)
  - `defaultLanguage` ([`string`][string]): Стандартный язык
  - `directory` ([`string`][string]): Абсолютный путь из папки `out`

[string]:https://developer.mozilla.org/en/docs/Web/JavaScript/Reference/Global_Objects/String
[any]:https://www.typescriptlang.org/docs/handbook/basic-types.html#any

### База данных

Я люблю использовать БД [MySQL](https://www.mysql.com/), совместимой с прекрасной библиотекой [`knexjs`](http://knexjs.org/). Вам нужно загрузить её и настроить пользотеля `snoballbot`. Поместите пароль в переменную `DB_PASSWD` окружения. Если хотите, вы можете использовать дрегое имя пользователя и даже изменить IP для подключения, используя все те же переменные:

- `DB_HOST`: Где распологается база данных (значение по умолчанию `127.0.0.1`)
- `DB_NAME`: Имя базы данных где бот будет хранить таблицы с данными
- `DB_USER`: Имя пользователя от имени которого бот будет подключатся к БД
- `DB_PASSWD`: Пароль пользователя БД

Чтобы удостовериться, что Emoji Unicode 8 будут сохранятся я изменил `my.cfg` (спасибо, Google):

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

### Запуск

Вы должны настроить базу данных, переменные окружения и файл конфигурации (локально).

Теперь, в вашей папке `out` распологается реальный дистрибутив бота. Вы отправляете его на свою виртуальную машину (ВПС) и используете:

```bash
# установка всех зависимостей
npm install
# делаем ./run.sh исполняемым
chmod +x ./run.sh
# запускаем бота
./run.sh
```

:tada: Бот должен работать. Не работает? Сообщите об этом в категории Issues или Discord и я скажу, что не так

## Вклад

### Запросы на слияние

Я действительно очень ценю ваш вклад в этот проект. Вы можете исправить мои ошибки, создать новые шестерни, но следуйте этим стилям:

- Используйте [Visual Studio Code](https://code.visualstudio.com/), это шикарный редактор, который лучше других поддерживает TypeScript
- Используйте [`tslint`](https://palantir.github.io/tslint/), он предупредит вас об ошибках в коде. [**РАСШИРЕНИЕ ДЛЯ VISUAL STUDIO CODE**](https://marketplace.visualstudio.com/items?itemName=eg2.tslint)
- Используйте мои универсальные API. Я создал `db`, `letters`, `utils`, `cacheResponse`, `time`. Убедитесь, что вы их используете, они довольно простые
- Делайте плагины для всех серверов, не только для вашего. Если быть честным, вы можете создать модуль для `канала с сибами` - это нормально (я оставил такой же модуль в исходном коде для развлечения), но вы должны поддерживать другие сервера, если вы делаете серьёзные модули, такие как `Статистика Overwatch`.

Не пугайтесь делать запросы на слияние! Делайте их! Я подскажу что нужно изменить, что не нужно и другое :)

### Секция "Issues"

Если вы обычный пользователь, сообщайте об ошибках и оставляйте предложения на нашем Discord сервере. Вы также можете задавать вопросы там.
Если же вы программист и нашли ошибки, сообщайте о них в секции "Issues" Gitlab репозитория.

### Приватные модули

Вы можете создавать приватные шестерни без публикации их. Оставьте их в папке `private_cogs`

---
**СДЕЛАНО С ♥ DAFRI_NOCHITEROV**.

*Мэй это герой из [Overwatch](https://playoverwatch.com/), игры созданной Blizzard*.