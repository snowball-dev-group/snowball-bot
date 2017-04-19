export class Plugin {
    private events:Map<string, Function> = new Map<string, Function>();

    constructor(events:Object, dontAutoHandle = false) {
        Object.keys(events).forEach((key) => {
            this.events.set(key, events[key]);
        });
        if(!dontAutoHandle) {
            this.handleEvents();
        }
    }

    handleEvents() {
        this.events.forEach((value, key) => {
            discordBot.on(key, value);
        });
    }

    unhandleEvents() {
        this.events.forEach((value, key) => {
            discordBot.removeListener(key, value);
        });
    }
}