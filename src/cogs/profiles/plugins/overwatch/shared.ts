export type Hero = "reinhardt" | "tracer" | "zenyatta" | "junkrat" | "mccree" | "winston" | "orisa" | "hanzo" | "pharah" | "roadhog" | "zarya" | "torbjorn" | "mercy" | "mei" | "ana" | "widowmaker" | "genji" | "reaper" | "soldier76" | "bastion" | "symmetra" | "dva" | "sombra" | "lucio" | "doomfist" | "moira";

export type Sorts = "playtime" | "winrate";

export type HeroStats = Array<{
	hero: Hero,
	stat: string
}>;

export type Tier = "bronze" | "silver" | "gold" | "platinum" | "diamond" | "master" | "grandmaster" | null;

export const ACCEPTED_REGIONS = ["eu", "kr", "us"];
export const ACCEPTED_PLATFORMS = ["pc", "xbl", "psn"];
export const ACCEPTED_SORTS = ["playtime", "winrate"];
