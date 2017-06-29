export class Plugin {
    private events:Map<string, Function> = new Map<string, Function>();

    constructor(events:Object, dontAutoHandle = false) {
        for(let key of Object.keys(events)) {
            this.events.set(key, events[key]);
        }
        if(!dontAutoHandle) {
            this.handleEvents();
        }
    }

    handleEvents() {
        for (let [key, value] of this.events) {
            discordBot.on(key, value);
        }
    }

    unhandleEvents() {
        for(let [key, value] of this.events) {
            discordBot.removeListener(key, value);
        }
    }
}