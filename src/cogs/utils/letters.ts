const NUMBERS = [
  "1⃣ ",
  "2⃣ ",
  "3⃣ ",
  "4⃣ ",
  "5⃣ ",
  "6⃣ ",
  "7⃣ ",
  "8⃣ ",
  "9⃣ ",
  "0⃣"
].map(n => n.trim());

const REGIONAL_CHAR = String.fromCharCode(0xD83C);
const REGIONAL_SUBCHAR_START = 56806;

export enum Stances {
    NoCaseSwitching = 2,
    ConvertNumbers = 4
}

export function toRegionalIndicators(str:string, stances?:Stances, unknownCharReplacer?:(s:string) => string) : string {
    let arr = str.split("");
    let allowCaseSwitching = false;
    let numbersConversion = true;
    if(stances && stances > 0) {
        allowCaseSwitching = !((stances & Stances.NoCaseSwitching) === Stances.NoCaseSwitching);
        numbersConversion = ((stances & Stances.ConvertNumbers) === Stances.ConvertNumbers);
    }
    arr = arr.map((s) => {
        let oS = s;
        if(allowCaseSwitching) {
            s = s.toLowerCase();
        }
        if(/^[a-z]{1}$/.test(s)) {
            let letPos = s.charCodeAt(0) - 97;
            return `${REGIONAL_CHAR}${String.fromCharCode(REGIONAL_SUBCHAR_START + letPos)}`;
        } else if(numbersConversion && /^[0-9]{1}$/.test(s)) {
            return convertNumbers(s);
        } else if(!!unknownCharReplacer) {
            return unknownCharReplacer(s);
        }
        return oS;
    });
    return arr.join("");
}

export function convertNumbers(number:string|number) {
    let str = number + "";
    str = str.replace(/([0-9])/ig, (s) => {
        switch(s) {
            case "1": return NUMBERS[0];
            case "2": return NUMBERS[1];
            case "3": return NUMBERS[2];
            case "4": return NUMBERS[3];
            case "5": return NUMBERS[4];
            case "6": return NUMBERS[5];
            case "7": return NUMBERS[6];
            case "8": return NUMBERS[7];
            case "9": return NUMBERS[8];
            case "0": return NUMBERS[9];
            default: return s;
        }
    });
    return str;
}