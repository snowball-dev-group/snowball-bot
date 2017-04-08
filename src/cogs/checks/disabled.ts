import * as knex from "knex";


// TODO: MySQL DB intregration
class DisabledCommands {
    db:knex;
    constructor() {
        this.db = knex({
            client: "sqlite3",
            connection: {
                // original path always should be
                // $botDir/cogs/checks/disabled
                filename: __dirname + "/../../data/disables.db"
            }
        });
    }

    /**
     * Creates DB table for specific Discord server
     * @param guild {Guild} Discord Guild ID
     */
    async createDBfor(guild:string) {
        await this.db.schema.createTable("g"+guild, (tBuilder) => {
            // tBuilder.string("name").unique().notNullable();
            // tBuilder.string("description").notNullable();
            // tBuilder.string("roleId").unique().notNullable();
            // tBuilder.string("ownerId").notNullable();
            // tBuilder.string("createdAt").notNullable();
            // tBuilder.string("iconURL").nullable();
            // tBuilder.string("imageURL").nullable();
            // tBuilder.string("joinTrigger").nullable();
            // tBuilder.string("leaveTrigger").nullable();
        });
    }

    /**
     * Checks if command disabled by it's path
     * @param guild {Guild} Discord Guild ID
     * @param commandPath {String} Path to command
     * @example Command path may be: "discord.reply.*"
     */
    async checkIfDisabled(guild:string, commandPath:string) {
        let tableStatus = await this.db.schema.hasTable("g"+guild);
        if(!tableStatus) { await this.createDBfor(guild); return false; }
    }
}

module.exports = DisabledCommands;